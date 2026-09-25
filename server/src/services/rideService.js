import { db, withTransaction } from '../db/knex.js';
import { distanceM } from '../domain/zones.js';
import { estimateFare } from '../domain/fare.js';
import { ACTIVE_RIDE_STATUSES, assertPassengerCanCancel, assertRideTransition } from '../domain/stateMachine.js';
import { conflict, notFound } from '../lib/errors.js';
import { formatTaka } from '../lib/money.js';
import { logger } from '../lib/logger.js';
import { recordEvent, presentEvent } from './rideEvents.js';
import { presentRideForPassenger, rideWithPoolQuery } from './presenters.js';
import { claimSeats, evaluateJoin, lockPool, lockRide, releaseSeats } from './poolMembership.js';

async function loadPassengerRide(q, passengerId, rideId) {
  const row = await rideWithPoolQuery(q).where('r.id', rideId).andWhere('r.passenger_id', passengerId).first();
  if (!row) throw notFound('Ride');
  return row;
}

/**
 * Look for an OPEN pool the new request can share. Each candidate is locked
 * (SELECT … FOR UPDATE) and re-evaluated before seats are claimed, so two passengers
 * racing for Bullet's last seat are serialised: the second one sees the pool full.
 * Returns the updated pool, or null if nothing fits.
 */
async function findPoolToJoin(trx, { pickup, dropoff, seats }) {
  const candidates = await trx('pools as p')
    .join('vehicles as v', 'v.id', 'p.vehicle_id')
    .where({ 'p.status': 'OPEN', 'p.pickup_zone': pickup, 'v.is_online': true })
    .andWhereRaw('p.capacity - p.seats_taken >= ?', [seats])
    .orderBy('p.created_at')
    .select('p.id');

  for (const { id } of candidates) {
    const pool = await lockPool(trx, id);
    const verdict = await evaluateJoin(trx, pool, { id: 'new-request', pickup, dropoff, seats });
    if (!verdict.ok) {
      logger.debug({ poolId: id, reason: verdict.reason, seatsTaken: pool.seats_taken }, 'pool not joinable');
      continue;
    }
    return claimSeats(trx, pool.id, seats);
  }
  return null;
}

/**
 * Nusrat requests a ride. If a compatible Tesla is already collecting passengers at her
 * pickup zone she joins it immediately (MATCHED); otherwise she waits (REQUESTED).
 */
export async function requestRide(passenger, { pickup, dropoff, seats, paymentMethod }) {
  const meters = distanceM(pickup, dropoff);
  const estimate = estimateFare({ pickup, dropoff, seats });

  if (paymentMethod === 'TESLAPAY' && passenger.wallet_balance_paisa < estimate.solo.totalPaisa) {
    throw conflict('INSUFFICIENT_BALANCE', `TeslaPay balance ${formatTaka(passenger.wallet_balance_paisa)} is below the fare ${formatTaka(estimate.solo.totalPaisa)}. Top up or pay cash.`);
  }

  const rideId = await withTransaction(
    async (trx) => {
      const active = await trx('rides').where({ passenger_id: passenger.id }).whereIn('status', ACTIVE_RIDE_STATUSES).first('id');
      if (active) throw conflict('ACTIVE_RIDE_EXISTS', 'You already have a ride in progress', { rideId: active.id });

      // 1) Try to share: the oldest compatible OPEN pool in the same pickup zone wins.
      const joined = await findPoolToJoin(trx, { pickup, dropoff, seats });

      const [ride] = await trx('rides')
        .insert({
          passenger_id: passenger.id,
          pickup_zone: pickup,
          dropoff_zone: dropoff,
          seats,
          payment_method: paymentMethod,
          distance_m: meters,
          status: joined ? 'MATCHED' : 'REQUESTED',
          pool_id: joined?.id ?? null,
          matched_at: joined ? trx.fn.now() : null,
        })
        .returning('*');
      await recordEvent(trx, {
        rideId: ride.id,
        actorId: passenger.id,
        type: 'RIDE_REQUESTED',
        to: 'REQUESTED',
        details: { pickup, dropoff, seats, paymentMethod, distanceM: meters },
      });
      if (joined) {
        await recordEvent(trx, {
          rideId: ride.id,
          poolId: joined.id,
          type: 'RIDE_MATCHED',
          from: 'REQUESTED',
          to: 'MATCHED',
          details: { via: 'AUTO_JOIN', seatsTaken: joined.seats_taken, capacity: joined.capacity },
        });
      }
      // 2) Otherwise the ride waits as REQUESTED and shows up in nearby drivers' feeds.
      logger.info({ rideId: ride.id, passengerId: passenger.id, pickup, dropoff, seats, poolId: joined?.id ?? null }, joined ? 'ride requested and joined a pool' : 'ride requested, waiting for a driver');
      return ride.id;
    },
    { label: 'requestRide' },
  );

  return presentRideForPassenger(await loadPassengerRide(db, passenger.id, rideId));
}

export async function cancelRide(passenger, rideId, reason = 'Cancelled by passenger') {
  await withTransaction(
    async (trx) => {
      const snapshot = await trx('rides').where({ id: rideId, passenger_id: passenger.id }).first();
      if (!snapshot) throw notFound('Ride');

      const pool = snapshot.pool_id ? await lockPool(trx, snapshot.pool_id) : null;
      const ride = await lockRide(trx, { id: rideId });
      if (ride.pool_id !== snapshot.pool_id) throw conflict('RIDE_CHANGED', 'Your ride was just updated, please try again');

      assertPassengerCanCancel(ride.status);
      assertRideTransition(ride.status, 'CANCELLED');

      await trx('rides').where({ id: ride.id }).update({
        status: 'CANCELLED',
        payment_status: 'NOT_CHARGED',
        cancel_reason: reason,
        cancelled_by: passenger.id,
        cancelled_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
      await recordEvent(trx, {
        rideId: ride.id,
        poolId: ride.pool_id,
        actorId: passenger.id,
        type: 'RIDE_CANCELLED',
        from: ride.status,
        to: 'CANCELLED',
        details: { reason, by: 'PASSENGER' },
      });

      if (pool && ride.status === 'MATCHED') await releaseSeats(trx, pool, ride, passenger.id);
      logger.info({ rideId, from: ride.status }, 'ride cancelled by passenger');
    },
    { label: 'cancelRide' },
  );
  return presentRideForPassenger(await loadPassengerRide(db, passenger.id, rideId));
}

export async function getActiveRide(passenger) {
  const row = await rideWithPoolQuery(db).where('r.passenger_id', passenger.id).whereIn('r.status', ACTIVE_RIDE_STATUSES).first();
  return row ? presentRideForPassenger(row) : null;
}

export async function listRides(passenger, { limit = 20, before } = {}) {
  const q = rideWithPoolQuery(db).where('r.passenger_id', passenger.id).orderBy('r.requested_at', 'desc').limit(limit);
  if (before) q.andWhere('r.requested_at', '<', before);
  const rows = await q;
  return rows.map(presentRideForPassenger);
}

export async function getRide(passenger, rideId) {
  const row = await loadPassengerRide(db, passenger.id, rideId);
  const events = await db('ride_events as e')
    .leftJoin('users as u', 'u.id', 'e.actor_id')
    .where('e.ride_id', rideId)
    .orderBy('e.id')
    .select('e.*', 'u.name as actor_name', 'u.role as actor_role');
  return { ...presentRideForPassenger(row), timeline: events.map(presentEvent) };
}