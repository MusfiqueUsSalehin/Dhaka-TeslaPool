import { db, withTransaction } from '../db/knex.js';
import { distanceM } from '../domain/zones.js';
import { checkCompatibility, isWithinDriverRadius } from '../domain/matching.js';
import { estimateFare } from '../domain/fare.js';
import { assertRideTransition } from '../domain/stateMachine.js';
import { conflict, notFound } from '../lib/errors.js';
import { formatTaka } from '../lib/money.js';
import { logger } from '../lib/logger.js';
import { recordEvent } from './rideEvents.js';
import { zoneRef } from './presenters.js';
import { claimSeats, evaluateJoin, lockPool, lockRide, lockVehicle } from './poolMembership.js';
import { getActivePool, presentPool } from './poolService.js';

async function vehicleOf(q, driver) {
  const vehicle = await q('vehicles').where({ driver_id: driver.id }).first();
  if (!vehicle) throw notFound('Tesla for this driver');
  return vehicle;
}

const presentVehicle = (v) => ({
  id: v.id,
  name: v.name,
  plate: v.plate,
  capacity: v.capacity,
  isOnline: v.is_online,
  currentZone: zoneRef(v.current_zone),
});

export async function getDashboard(driver) {
  const vehicle = await vehicleOf(db, driver);
  const active = await getActivePool(db, vehicle.id);
  const stats = await db('rides as r')
    .join('pools as p', 'p.id', 'r.pool_id')
    .where('p.driver_id', driver.id)
    .andWhere('r.status', 'COMPLETED')
    .select(db.raw('count(*)::int AS rides'), db.raw('coalesce(sum(r.fare_total_paisa), 0)::bigint AS earned'))
    .first();
  return {
    vehicle: presentVehicle(vehicle),
    activePool: active ? await presentPool(db, active) : null,
    stats: { completedRides: stats.rides, earnedPaisa: stats.earned, earned: formatTaka(stats.earned) },
  };
}

export async function goOnline(driver, zone) {
  await withTransaction(async (trx) => {
    const vehicle = await lockVehicle(trx, { driver_id: driver.id });
    if (!vehicle) throw notFound('Tesla for this driver');
    const active = await getActivePool(trx, vehicle.id);
    const newZone = active ? vehicle.current_zone : zone;
    await trx('vehicles').where({ id: vehicle.id }).update({ is_online: true, current_zone: newZone, updated_at: trx.fn.now() });
    logger.info({ vehicleId: vehicle.id, zone: newZone }, 'driver online');
  });
  return getDashboard(driver);
}

export async function goOffline(driver) {
  await withTransaction(async (trx) => {
    const vehicle = await lockVehicle(trx, { driver_id: driver.id });
    if (!vehicle) throw notFound('Tesla for this driver');
    if (await getActivePool(trx, vehicle.id)) {
      throw conflict('ACTIVE_POOL', 'Finish or release your current passengers before going offline');
    }
    await trx('vehicles').where({ id: vehicle.id }).update({ is_online: false, updated_at: trx.fn.now() });
    logger.info({ vehicleId: vehicle.id }, 'driver offline');
  });
  return getDashboard(driver);
}

function presentRequest(r, vehicleZone) {
  const est = estimateFare({ pickup: r.pickup_zone, dropoff: r.dropoff_zone, seats: r.seats });
  return {
    id: r.id,
    passenger: { name: r.passenger_name },
    pickup: zoneRef(r.pickup_zone),
    dropoff: zoneRef(r.dropoff_zone),
    seats: r.seats,
    paymentMethod: r.payment_method,
    distanceM: r.distance_m,
    pickupDistanceM: vehicleZone ? distanceM(vehicleZone, r.pickup_zone) : null,
    estimate: { soloPaisa: est.solo.totalPaisa, pooledPaisa: est.pooled.totalPaisa, solo: formatTaka(est.solo.totalPaisa), pooled: formatTaka(est.pooled.totalPaisa) },
    requestedAt: r.requested_at,
  };
}

/**
 * "Relevant requests" for the driver (docs/domain-rules.md §2):
 *  - offline or busy (arrived/started): nothing
 *  - with an OPEN pool: waiting requests that pass the matching rule for that pool
 *  - otherwise: waiting requests within 4 km of the Tesla that fit its seats
 */
export async function listRelevantRequests(driver) {
  const vehicle = await vehicleOf(db, driver);
  if (!vehicle.is_online) return { mode: 'OFFLINE', requests: [] };

  const active = await getActivePool(db, vehicle.id);
  const waiting = db('rides as r')
    .join('users as u', 'u.id', 'r.passenger_id')
    .where('r.status', 'REQUESTED')
    .orderBy('r.requested_at')
    .select('r.*', 'u.name as passenger_name');

  if (active && active.status !== 'OPEN') return { mode: 'BUSY', poolId: active.id, requests: [] };

  if (active) {
    const members = await db('rides').where({ pool_id: active.id, status: 'MATCHED' }).select('id', 'dropoff_zone');
    const rows = await waiting.andWhere('r.pickup_zone', active.pickup_zone).andWhere('r.seats', '<=', active.capacity - active.seats_taken);
    const compatible = rows.filter(
      (r) =>
        checkCompatibility({
          pool: { pickupZone: active.pickup_zone, capacity: active.capacity, seatsTaken: active.seats_taken },
          members: members.map((m) => ({ id: m.id, dropoff: m.dropoff_zone })),
          candidate: { id: r.id, pickup: r.pickup_zone, dropoff: r.dropoff_zone, seats: r.seats },
        }).ok,
    );
    return { mode: 'FILLING_POOL', poolId: active.id, requests: compatible.map((r) => presentRequest(r, vehicle.current_zone)) };
  }

  const rows = await waiting.andWhere('r.seats', '<=', vehicle.capacity);
  const nearby = rows
    .filter((r) => isWithinDriverRadius(vehicle.current_zone, r.pickup_zone))
    .map((r) => presentRequest(r, vehicle.current_zone))
    .sort((a, b) => a.pickupDistanceM - b.pickupDistanceM || new Date(a.requestedAt) - new Date(b.requestedAt));
  return { mode: 'IDLE', requests: nearby };
}

/**
 * Jashim accepts a waiting request.
 *  - Bullet already has an OPEN pool: the request joins it if it passes the matching rule.
 *  - Bullet is idle: a new pool opens at the request's pickup zone.
 * Lock order: vehicle -> pool -> ride.
 */
export async function acceptRequest(driver, rideId) {
  const poolId = await withTransaction(
    async (trx) => {
      const vehicle = await lockVehicle(trx, { driver_id: driver.id });
      if (!vehicle) throw notFound('Tesla for this driver');
      if (!vehicle.is_online) throw conflict('DRIVER_OFFLINE', 'Go online before accepting rides');

      const active = await getActivePool(trx, vehicle.id);
      if (active && active.status !== 'OPEN') throw conflict('POOL_BUSY', 'You already left the pickup point; finish this trip first');
      const pool = active ? await lockPool(trx, active.id) : null;

      const ride = await lockRide(trx, { id: rideId });
      if (!ride) throw notFound('Ride request');
      if (ride.status !== 'REQUESTED') throw conflict('RIDE_NOT_AVAILABLE', 'This request was already taken or cancelled');
      assertRideTransition(ride.status, 'MATCHED');

      if (pool) {
        const verdict = await evaluateJoin(trx, pool, { id: ride.id, pickup: ride.pickup_zone, dropoff: ride.dropoff_zone, seats: ride.seats });
        if (!verdict.ok) {
          const messages = {
            PICKUP_MISMATCH: 'This passenger is waiting in a different zone from your current pickup',
            NOT_ENOUGH_SEATS: `Not enough free seats in ${vehicle.name}`,
            DETOUR_TOO_LONG: 'This destination would make the trip too long for your passengers',
            POOL_NOT_OPEN: 'Your pool is no longer taking passengers',
          };
          throw conflict(verdict.reason, messages[verdict.reason] ?? 'Not compatible with your current pool');
        }
        const updated = await claimSeats(trx, pool.id, ride.seats);
        await trx('rides').where({ id: ride.id }).update({ status: 'MATCHED', pool_id: pool.id, matched_at: trx.fn.now(), updated_at: trx.fn.now() });
        await recordEvent(trx, { rideId: ride.id, poolId: pool.id, actorId: driver.id, type: 'RIDE_MATCHED', from: 'REQUESTED', to: 'MATCHED', details: { via: 'DRIVER_ACCEPT', seatsTaken: updated.seats_taken, capacity: updated.capacity } });
        logger.info({ poolId: pool.id, rideId, seatsTaken: updated.seats_taken }, 'driver added request to existing pool');
        return pool.id;
      }

      if (ride.seats > vehicle.capacity) throw conflict('NOT_ENOUGH_SEATS', `${vehicle.name} has only ${vehicle.capacity} seats`);
      if (!isWithinDriverRadius(vehicle.current_zone, ride.pickup_zone)) throw conflict('TOO_FAR', 'This pickup is too far from your Tesla');

      const [opened] = await trx('pools')
        .insert({
          vehicle_id: vehicle.id,
          driver_id: driver.id,
          pickup_zone: ride.pickup_zone,
          capacity: vehicle.capacity,
          seats_taken: ride.seats,
          status: 'OPEN',
        })
        .returning('*');
      await trx('rides').where({ id: ride.id }).update({ status: 'MATCHED', pool_id: opened.id, matched_at: trx.fn.now(), updated_at: trx.fn.now() });
      await recordEvent(trx, { poolId: opened.id, actorId: driver.id, type: 'POOL_OPENED', to: 'OPEN', details: { pickup: opened.pickup_zone, capacity: opened.capacity } });
      await recordEvent(trx, { rideId: ride.id, poolId: opened.id, actorId: driver.id, type: 'RIDE_MATCHED', from: 'REQUESTED', to: 'MATCHED', details: { via: 'DRIVER_ACCEPT', seatsTaken: opened.seats_taken, capacity: opened.capacity } });
      logger.info({ poolId: opened.id, rideId }, 'driver accepted request, pool opened');
      return opened.id;
    },
    { label: 'acceptRequest' },
  );
  const pool = await db('pools').where({ id: poolId }).first();
  return presentPool(db, pool);
}