import { assertPoolTransition, SEATED_RIDE_STATUSES } from '../domain/stateMachine.js';
import { logger } from '../lib/logger.js';
import { recordEvent } from './rideEvents.js';

/** SELECT … FOR UPDATE helpers. Lock order everywhere: vehicle -> pool -> ride. */
export const lockVehicle = (trx, where) => trx('vehicles').where(where).forUpdate().first();
export const lockPool = (trx, id) => trx('pools').where({ id }).forUpdate().first();
export const lockRide = (trx, where) => trx('rides').where(where).forUpdate().first();

/** Rides currently holding seats in the pool (the pool's members). */
export function seatedMembers(trx, poolId) {
  return trx('rides').where({ pool_id: poolId }).whereIn('status', SEATED_RIDE_STATUSES).orderBy('matched_at');
}

/**
 * Give a ride's seats back to its pool (after a cancel or no-show). If that leaves the
 * pool empty before the trip started, the pool is cancelled and the Tesla is free.
 * Caller must hold the pool lock.
 */
export async function releaseSeats(trx, pool, ride, actorId) {
  const [updated] = await trx('pools')
    .where({ id: pool.id })
    .update({ seats_taken: trx.raw('seats_taken - ?', [ride.seats]), updated_at: trx.fn.now() })
    .returning('*');
  logger.debug({ poolId: pool.id, released: ride.seats, seatsTaken: updated.seats_taken }, 'seats released');

  const remaining = await seatedMembers(trx, pool.id);
  if (remaining.length === 0) {
    assertPoolTransition(updated.status, 'CANCELLED');
    await trx('pools').where({ id: pool.id }).update({ status: 'CANCELLED', ended_at: trx.fn.now(), updated_at: trx.fn.now() });
    await recordEvent(trx, {
      poolId: pool.id,
      actorId,
      type: 'POOL_CANCELLED',
      from: updated.status,
      to: 'CANCELLED',
      details: { reason: 'no passengers left' },
    });
    logger.info({ poolId: pool.id }, 'pool cancelled: last passenger left');
    return { ...updated, status: 'CANCELLED' };
  }
  return updated;
}