import { db, withTransaction } from '../db/knex.js';
import { distanceM } from '../domain/zones.js';
import { isWithinDriverRadius } from '../domain/matching.js';
import { estimateFare } from '../domain/fare.js';
import { assertRideTransition } from '../domain/stateMachine.js';
import { conflict, notFound } from '../lib/errors.js';
import { formatTaka } from '../lib/money.js';
import { logger } from '../lib/logger.js';
import { recordEvent } from './rideEvents.js';
import { zoneRef } from './presenters.js';
import { lockRide, lockVehicle } from './poolMembership.js';
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

/** Everything the driver dashboard needs in one call. */
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
    // While carrying passengers the Tesla's location is driven by the trip, not by the driver.
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

  if (active) return { mode: 'BUSY', requests: [] };

  const rows = await waiting.andWhere('r.seats', '<=', vehicle.capacity);
  const nearby = rows
    .filter((r) => isWithinDriverRadius(vehicle.current_zone, r.pickup_zone))
    .map((r) => presentRequest(r, vehicle.current_zone))
    .sort((a, b) => a.pickupDistanceM - b.pickupDistanceM || new Date(a.requestedAt) - new Date(b.requestedAt));
  return { mode: 'IDLE', requests: nearby };
}

/**
 * Jashim accepts a waiting request. With no active pool this opens a new pool at the
 * request's pickup zone; joining an existing pool is added with the pooling feature.
 * Lock order: vehicle -> pool -> ride.
 */
export async function acceptRequest(driver, rideId) {
  const poolId = await withTransaction(
    async (trx) => {
      const vehicle = await lockVehicle(trx, { driver_id: driver.id });
      if (!vehicle) throw notFound('Tesla for this driver');
      if (!vehicle.is_online) throw conflict('DRIVER_OFFLINE', 'Go online before accepting rides');

      const active = await getActivePool(trx, vehicle.id);
      if (active) throw conflict('POOL_BUSY', 'Finish your current trip first');

      const ride = await lockRide(trx, { id: rideId });
      if (!ride) throw notFound('Ride request');
      if (ride.status !== 'REQUESTED') throw conflict('RIDE_NOT_AVAILABLE', 'This request was already taken or cancelled');
      assertRideTransition(ride.status, 'MATCHED');
      if (ride.seats > vehicle.capacity) throw conflict('NOT_ENOUGH_SEATS', `${vehicle.name} has only ${vehicle.capacity} seats`);
      if (!isWithinDriverRadius(vehicle.current_zone, ride.pickup_zone)) throw conflict('TOO_FAR', 'This pickup is too far from your Tesla');

      const [pool] = await trx('pools')
        .insert({
          vehicle_id: vehicle.id,
          driver_id: driver.id,
          pickup_zone: ride.pickup_zone,
          capacity: vehicle.capacity,
          seats_taken: ride.seats,
          status: 'OPEN',
        })
        .returning('*');
      await trx('rides').where({ id: ride.id }).update({ status: 'MATCHED', pool_id: pool.id, matched_at: trx.fn.now(), updated_at: trx.fn.now() });
      await recordEvent(trx, { poolId: pool.id, actorId: driver.id, type: 'POOL_OPENED', to: 'OPEN', details: { pickup: pool.pickup_zone, capacity: pool.capacity } });
      await recordEvent(trx, { rideId: ride.id, poolId: pool.id, actorId: driver.id, type: 'RIDE_MATCHED', from: 'REQUESTED', to: 'MATCHED', details: { via: 'DRIVER_ACCEPT', seatsTaken: pool.seats_taken, capacity: pool.capacity } });
      logger.info({ poolId: pool.id, rideId }, 'driver accepted request, pool opened');
      return pool.id;
    },
    { label: 'acceptRequest' },
  );
  const pool = await db('pools').where({ id: poolId }).first();
  return presentPool(db, pool);
}