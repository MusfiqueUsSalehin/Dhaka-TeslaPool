import { logger } from '../lib/logger.js';
import { recordEvent } from './rideEvents.js';

/**
 * Settle a ride at drop-off, inside the drop-off transaction.
 * CASH: the driver collected the locked fare, so the ride is PAID.
 * TESLAPAY: left PENDING until the wallet ledger exists.
 */
export async function settlePayment(trx, { ride, driver, poolId }) {
  if (ride.payment_method !== 'CASH') {
    logger.warn({ rideId: ride.id }, 'TeslaPay settlement not implemented yet; payment left PENDING');
    return;
  }
  await trx('rides').where({ id: ride.id }).update({ payment_status: 'PAID', updated_at: trx.fn.now() });
  await recordEvent(trx, {
    rideId: ride.id,
    poolId,
    actorId: driver.id,
    type: 'PAYMENT_CAPTURED',
    details: { method: 'CASH', amountPaisa: ride.fare_total_paisa },
  });
}