import { logger } from '../lib/logger.js';
import { recordEvent } from './rideEvents.js';
import { applyWalletChange } from './walletService.js';

/**
 * Settle a ride at drop-off, inside the drop-off transaction (so a ride is never
 * COMPLETED without being settled, or settled without being COMPLETED).
 *
 * CASH:     Jashim collected the locked fare; mark PAID.
 * TESLAPAY: debit the passenger, credit the driver, one ledger row each. The
 *           (ride_id, type) unique index makes a retried settlement fail instead of
 *           charging twice. If the wallet cannot cover the fare (should not happen —
 *           the solo fare was checked at request time and only one ride can be active)
 *           we fall back to cash rather than block the driver at the roadside.
 */
export async function settlePayment(trx, { ride, driver, poolId }) {
  const amount = ride.fare_total_paisa;
  let method = ride.payment_method;

  if (method === 'TESLAPAY') {
    const debited = await applyWalletChange(trx, { userId: ride.passenger_id, amountPaisa: -amount, type: 'RIDE_PAYMENT', rideId: ride.id });
    if (debited === null) {
      method = 'CASH';
      await trx('rides').where({ id: ride.id }).update({ payment_method: 'CASH' });
      await recordEvent(trx, { rideId: ride.id, poolId, type: 'PAYMENT_FALLBACK_TO_CASH', details: { reason: 'insufficient TeslaPay balance', amountPaisa: amount } });
      logger.warn({ rideId: ride.id, amount }, 'TeslaPay debit refused, falling back to cash');
    } else {
      await applyWalletChange(trx, { userId: driver.id, amountPaisa: amount, type: 'RIDE_EARNING', rideId: ride.id });
    }
  }

  await trx('rides').where({ id: ride.id }).update({ payment_status: 'PAID', updated_at: trx.fn.now() });
  await recordEvent(trx, {
    rideId: ride.id,
    poolId,
    actorId: driver.id,
    type: 'PAYMENT_CAPTURED',
    details: { method, amountPaisa: amount },
  });
}
