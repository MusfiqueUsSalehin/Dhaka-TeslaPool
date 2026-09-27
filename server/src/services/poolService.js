import { db, withTransaction } from '../db/knex.js';
import { calculateFare, isPooled } from '../domain/fare.js';
import { planRoute } from '../domain/matching.js';
import { assertPoolTransition, assertRideTransition, ACTIVE_POOL_STATUSES } from '../domain/stateMachine.js';
import { conflict, notFound } from '../lib/errors.js';
import { formatTaka } from '../lib/money.js';
import { logger } from '../lib/logger.js';
import { recordEvent, presentEvent } from './rideEvents.js';
import { presentRideForDriver, zoneRef } from './presenters.js';
import { lockPool, lockRide, lockVehicle, releaseSeats } from './poolMembership.js';
import { settlePayment } from './paymentService.js';

function poolMembersQuery(q, poolId) {
  return q('rides as r')
    .join('users as u', 'u.id', 'r.passenger_id')
    .where('r.pool_id', poolId)
    .orderBy('r.matched_at')
    .select(
      'r.*',
      'u.name as passenger_name',
      'u.phone as passenger_phone',
      q.raw(
        `(SELECT count(*)::int FROM rides r2 WHERE r2.pool_id = r.pool_id
            AND r2.status IN ('MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED')) AS pool_bookings`,
      ),
    );
}

export async function presentPool(q, pool) {
  const members = await poolMembersQuery(q, pool.id);
  const onBoardOrWaiting = members.filter((m) => ['MATCHED', 'DRIVER_ARRIVED', 'STARTED'].includes(m.status));
  const route = planRoute(
    pool.pickup_zone,
    onBoardOrWaiting.map((m) => ({ id: m.id, dropoff: m.dropoff_zone })),
  );
  const names = new Map(members.map((m) => [m.id, m.passenger_name]));
  const earnedPaisa = members.filter((m) => m.status === 'COMPLETED').reduce((sum, m) => sum + m.fare_total_paisa, 0);

  return {
    id: pool.id,
    status: pool.status,
    pickup: zoneRef(pool.pickup_zone),
    capacity: pool.capacity,
    seatsTaken: pool.seats_taken,
    seatsFree: pool.capacity - pool.seats_taken,
    members: members.map(presentRideForDriver),
    nextStops: route.stops.map((s) => ({ rideId: s.id, passenger: names.get(s.id), dropoff: zoneRef(s.dropoff), atM: s.inVehicleM })),
    earnedPaisa,
    earned: formatTaka(earnedPaisa),
    timestamps: { createdAt: pool.created_at, arrivedAt: pool.arrived_at, startedAt: pool.started_at, endedAt: pool.ended_at },
  };
}

export async function getActivePool(q, vehicleId) {
  return q('pools').where({ vehicle_id: vehicleId }).whereIn('status', ACTIVE_POOL_STATUSES).first();
}

export async function listPools(driver, { limit = 20 } = {}) {
  const pools = await db('pools').where({ driver_id: driver.id }).orderBy('created_at', 'desc').limit(limit);
  return Promise.all(pools.map((p) => presentPool(db, p)));
}

export async function getPool(driver, poolId) {
  const pool = await db('pools').where({ id: poolId, driver_id: driver.id }).first();
  if (!pool) throw notFound('Pool');
  const events = await db('ride_events as e')
    .leftJoin('users as u', 'u.id', 'e.actor_id')
    .leftJoin('rides as r', 'r.id', 'e.ride_id')
    .leftJoin('users as pax', 'pax.id', 'r.passenger_id')
    .where('e.pool_id', poolId)
    .orderBy('e.id')
    .select('e.*', 'u.name as actor_name', 'u.role as actor_role', 'pax.name as subject_name');
  return { ...(await presentPool(db, pool)), timeline: events.map(presentEvent) };
}

async function lockDriverPool(trx, driver, poolId) {
  // Lock the driver's vehicle first, like acceptRequest does. Without this, "Add Rafiq"
  // (vehicle -> pool) racing "I've arrived" (pool -> vehicle update) deadlocked.
  await lockVehicle(trx, { driver_id: driver.id });
  const pool = await lockPool(trx, poolId);
  if (!pool || pool.driver_id !== driver.id) throw notFound('Pool');
  return pool;
}

async function lockPoolRide(trx, pool, rideId) {
  const ride = await lockRide(trx, { id: rideId, pool_id: pool.id });
  if (!ride) throw notFound('Passenger in this pool');
  return ride;
}

export async function markArrived(driver, poolId) {
  await withTransaction(
    async (trx) => {
      const pool = await lockDriverPool(trx, driver, poolId);
      assertPoolTransition(pool.status, 'DRIVER_ARRIVED');

      const members = await trx('rides').where({ pool_id: pool.id, status: 'MATCHED' }).forUpdate();
      for (const m of members) {
        assertRideTransition(m.status, 'DRIVER_ARRIVED');
        await recordEvent(trx, { rideId: m.id, poolId: pool.id, actorId: driver.id, type: 'DRIVER_ARRIVED', from: m.status, to: 'DRIVER_ARRIVED' });
      }
      await trx('rides').where({ pool_id: pool.id, status: 'MATCHED' }).update({ status: 'DRIVER_ARRIVED', arrived_at: trx.fn.now(), updated_at: trx.fn.now() });
      await trx('pools').where({ id: pool.id }).update({ status: 'DRIVER_ARRIVED', arrived_at: trx.fn.now(), updated_at: trx.fn.now() });
      await trx('vehicles').where({ id: pool.vehicle_id }).update({ current_zone: pool.pickup_zone, updated_at: trx.fn.now() });
      await recordEvent(trx, { poolId: pool.id, actorId: driver.id, type: 'POOL_DRIVER_ARRIVED', from: pool.status, to: 'DRIVER_ARRIVED', details: { passengers: members.length } });
      logger.info({ poolId, passengers: members.length }, 'driver arrived at pickup');
    },
    { label: 'markArrived' },
  );
  return getPool(driver, poolId);
}

export async function startTrip(driver, poolId) {
  await withTransaction(
    async (trx) => {
      const pool = await lockDriverPool(trx, driver, poolId);
      assertPoolTransition(pool.status, 'STARTED');

      const members = await trx('rides').where({ pool_id: pool.id, status: 'DRIVER_ARRIVED' }).forUpdate();
      if (members.length === 0) throw conflict('POOL_EMPTY', 'Nobody is on board');
      const pooled = isPooled(members.length);

      for (const m of members) {
        assertRideTransition(m.status, 'STARTED');
        const fare = calculateFare({ distanceM: m.distance_m, seats: m.seats, pooled });
        await trx('rides').where({ id: m.id }).update({
          status: 'STARTED',
          started_at: trx.fn.now(),
          updated_at: trx.fn.now(),
          pooled,
          fare_base_paisa: fare.basePaisa,
          fare_distance_paisa: fare.distancePaisa,
          fare_discount_paisa: fare.discountPaisa,
          fare_total_paisa: fare.totalPaisa,
        });
        await recordEvent(trx, {
          rideId: m.id,
          poolId: pool.id,
          actorId: driver.id,
          type: 'TRIP_STARTED',
          from: m.status,
          to: 'STARTED',
          details: { fareLocked: fare, bookingsOnBoard: members.length },
        });
        logger.debug({ rideId: m.id, pooled, totalPaisa: fare.totalPaisa }, 'fare locked');
      }
      await trx('pools').where({ id: pool.id }).update({ status: 'STARTED', started_at: trx.fn.now(), updated_at: trx.fn.now() });
      await recordEvent(trx, { poolId: pool.id, actorId: driver.id, type: 'POOL_STARTED', from: pool.status, to: 'STARTED', details: { bookingsOnBoard: members.length, pooled } });
      logger.info({ poolId, bookings: members.length, pooled }, 'trip started');
    },
    { label: 'startTrip' },
  );
  return getPool(driver, poolId);
}

export async function dropOff(driver, poolId, rideId) {
  await withTransaction(
    async (trx) => {
      const pool = await lockDriverPool(trx, driver, poolId);
      if (pool.status !== 'STARTED') throw conflict('INVALID_TRANSITION', `Cannot drop off while the pool is ${pool.status}`);
      const ride = await lockPoolRide(trx, pool, rideId);
      assertRideTransition(ride.status, 'COMPLETED');

      await trx('rides').where({ id: ride.id }).update({ status: 'COMPLETED', completed_at: trx.fn.now(), updated_at: trx.fn.now() });
      await recordEvent(trx, {
        rideId: ride.id,
        poolId: pool.id,
        actorId: driver.id,
        type: 'RIDE_COMPLETED',
        from: ride.status,
        to: 'COMPLETED',
        details: { dropoff: ride.dropoff_zone, farePaisa: ride.fare_total_paisa },
      });
      await settlePayment(trx, { ride, driver, poolId: pool.id });
      await trx('vehicles').where({ id: pool.vehicle_id }).update({ current_zone: ride.dropoff_zone, updated_at: trx.fn.now() });

      const stillOnBoard = await trx('rides').where({ pool_id: pool.id, status: 'STARTED' }).count({ n: '*' }).first();
      if (Number(stillOnBoard.n) === 0) {
        assertPoolTransition(pool.status, 'COMPLETED');
        await trx('pools').where({ id: pool.id }).update({ status: 'COMPLETED', seats_taken: 0, ended_at: trx.fn.now(), updated_at: trx.fn.now() });
        await recordEvent(trx, { poolId: pool.id, actorId: driver.id, type: 'POOL_COMPLETED', from: pool.status, to: 'COMPLETED' });
        logger.info({ poolId }, 'pool completed: last passenger dropped off');
      } else {
        await trx('pools').where({ id: pool.id }).update({ seats_taken: trx.raw('seats_taken - ?', [ride.seats]), updated_at: trx.fn.now() });
      }
    },
    { label: 'dropOff' },
  );
  return getPool(driver, poolId);
}

export async function markNoShow(driver, poolId, rideId) {
  await withTransaction(
    async (trx) => {
      const pool = await lockDriverPool(trx, driver, poolId);
      if (pool.status !== 'DRIVER_ARRIVED') throw conflict('INVALID_TRANSITION', 'No-show can only be marked while waiting at the pickup');
      const ride = await lockPoolRide(trx, pool, rideId);
      assertRideTransition(ride.status, 'CANCELLED');

      await trx('rides').where({ id: ride.id }).update({
        status: 'CANCELLED',
        payment_status: 'NOT_CHARGED',
        cancel_reason: 'No-show at pickup',
        cancelled_by: driver.id,
        cancelled_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
      await recordEvent(trx, { rideId: ride.id, poolId: pool.id, actorId: driver.id, type: 'RIDE_NO_SHOW', from: ride.status, to: 'CANCELLED', details: { by: 'DRIVER' } });
      await releaseSeats(trx, pool, ride, driver.id);
      logger.info({ poolId, rideId }, 'passenger marked as no-show');
    },
    { label: 'markNoShow' },
  );
  return getPool(driver, poolId);
}