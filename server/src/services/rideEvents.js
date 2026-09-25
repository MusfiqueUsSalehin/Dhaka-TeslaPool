import { logger } from '../lib/logger.js';

/**
 * Append one row to the audit trail. Always called with the same transaction as the
 * state change it describes, so the history can never disagree with the data.
 */
export async function recordEvent(trx, { rideId = null, poolId = null, actorId = null, type, from = null, to = null, details = {} }) {
  await trx('ride_events').insert({
    ride_id: rideId,
    pool_id: poolId,
    actor_id: actorId,
    type,
    from_status: from,
    to_status: to,
    details: JSON.stringify(details),
  });
  logger.debug({ rideId, poolId, actorId, type, from, to, details }, `event ${type}`);
}

export function presentEvent(e) {
  return {
    id: e.id,
    type: e.type,
    from: e.from_status,
    to: e.to_status,
    details: e.details,
    actor: e.actor_name ? { name: e.actor_name, role: e.actor_role } : { name: 'System', role: 'SYSTEM' },
    at: e.created_at,
  };
}