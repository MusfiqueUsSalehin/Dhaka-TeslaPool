import { db, withTransaction } from '../db/knex.js';
import { distanceM } from '../domain/zones.js';
import { estimateFare } from '../domain/fare.js';
import { ACTIVE_RIDE_STATUSES, assertPassengerCanCancel, assertRideTransition } from '../domain/stateMachine.js';
import { conflict, notFound } from '../lib/errors.js';
import { formatTaka } from '../lib/money.js';
import { logger } from '../lib/logger.js';
import { recordEvent, presentEvent } from './rideEvents.js';
import { presentRideForPassenger, rideWithPoolQuery } from './presenters.js';
import { lockPool, lockRide, releaseSeats } from './poolMembership.js';

async function loadPassengerRide(q, passengerId, rideId) {
  const row = await rideWithPoolQuery(q).where('r.id', rideId).andWhere('r.passenger_id', passengerId).first();
  // 404 (not 403) for other people's rides: do not confirm that the ID exists.
  if (!row) throw notFound('Ride');
  return row;
}

/**
 * Nusrat requests a ride. Creates the ride as REQUESTED (waiting for a Tesla).
 */
export async function requestRide(passenger, { pickup, dropoff, seats, paymentMethod }) {
  const meters = distanceM(pickup, dropoff);
  const estimate = estimateFare({ pickup, dropoff, seats });

  // TeslaPay must be able to cover the worst case (solo fare) before we book.
  if (paymentMethod === 'TESLAPAY' && passenger.wallet_balance_paisa < estimate.solo.totalPaisa) {
    throw conflict('INSUFFICIENT_BALANCE', `TeslaPay balance ${formatTaka(passenger.wallet_balance_paisa)} is below the fare ${formatTaka(estimate.solo.totalPaisa)}. Top up or pay cash.`);
  }

  const rideId = await withTransaction(
    async (trx) => {
      const active = await trx('rides').where({ passenger_id: passenger.id }).whereIn('status', ACTIVE_RIDE_STATUSES).first('id');
      if (active) throw conflict('ACTIVE_RIDE_EXISTS', 'You already have a ride in progress', { rideId: active.id });

      const [ride] = await trx('rides')
        .insert({
          passenger_id: passenger.id,
          pickup_zone: pickup,
          dropoff_zone: dropoff,
          seats,
          payment_method: paymentMethod,
          distance_m: meters,
          status: 'REQUESTED',
        })
        .returning('*');
      await recordEvent(trx, {
        rideId: ride.id,
        actorId: passenger.id,
        type: 'RIDE_REQUESTED',
        to: 'REQUESTED',
        details: { pickup, dropoff, seats, paymentMethod, distanceM: meters },
      });
      logger.info({ rideId: ride.id, passengerId: passenger.id, pickup, dropoff, seats }, 'ride requested');
      return ride.id;
    },
    { label: 'requestRide' },
  );

  return presentRideForPassenger(await loadPassengerRide(db, passenger.id, rideId));
}

/**
 * Passenger cancels. Allowed while REQUESTED or MATCHED; seats go back to the pool.
 * Lock order: pool (if any) then ride, re-checking status after the locks.
 */
export async function cancelRide(passenger, rideId, reason = 'Cancelled by passenger') {
  await withTransaction(
    async (trx) => {
      const snapshot = await trx('rides').where({ id: rideId, passenger_id: passenger.id }).first();
      if (!snapshot) throw notFound('Ride');

      const pool = snapshot.pool_id ? await lockPool(trx, snapshot.pool_id) : null;
      const ride = await lockRide(trx, { id: rideId });
      // The ride may have been matched to a pool between our read and the lock.
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

/** One ride with its full timeline — "explain exactly what happened". */
export async function getRide(passenger, rideId) {
  const row = await loadPassengerRide(db, passenger.id, rideId);
  const events = await db('ride_events as e')
    .leftJoin('users as u', 'u.id', 'e.actor_id')
    .where('e.ride_id', rideId)
    .orderBy('e.id')
    .select('e.*', 'u.name as actor_name', 'u.role as actor_role');
  return { ...presentRideForPassenger(row), timeline: events.map(presentEvent) };
}