import { db, withTransaction } from '../db/knex.js';
import { formatTaka } from '../lib/money.js';
import { logger } from '../lib/logger.js';

export const TOPUP_LIMITS = Object.freeze({ MIN_PAISA: 1000, MAX_PAISA: 500000 }); // ৳10 .. ৳5,000

/**
 * Move money in or out of one user's wallet and write the ledger row, in the caller's
 * transaction. Debits are conditional (balance >= amount) so a wallet can never go
 * negative; returns null if the debit was refused.
 */
export async function applyWalletChange(trx, { userId, amountPaisa, type, rideId = null }) {
  const q = trx('users').where({ id: userId });
  if (amountPaisa < 0) q.andWhere('wallet_balance_paisa', '>=', -amountPaisa);
  const [user] = await q
    .update({ wallet_balance_paisa: trx.raw('wallet_balance_paisa + ?', [amountPaisa]) })
    .returning(['id', 'wallet_balance_paisa']);
  if (!user) return null;

  await trx('wallet_transactions').insert({
    user_id: userId,
    ride_id: rideId,
    type,
    amount_paisa: amountPaisa,
    balance_after_paisa: user.wallet_balance_paisa,
  });
  logger.debug({ userId, type, amountPaisa, balanceAfter: user.wallet_balance_paisa, rideId }, 'wallet updated');
  return user.wallet_balance_paisa;
}

export async function topUp(user, amountPaisa) {
  const balance = await withTransaction((trx) => applyWalletChange(trx, { userId: user.id, amountPaisa, type: 'TOPUP' }), { label: 'topUp' });
  logger.info({ userId: user.id, amountPaisa, balance }, 'TeslaPay top-up');
  return getWallet({ ...user, wallet_balance_paisa: balance });
}

export async function getWallet(user, { limit = 30 } = {}) {
  const fresh = await db('users').where({ id: user.id }).first('wallet_balance_paisa');
  const rows = await db('wallet_transactions as w')
    .leftJoin('rides as r', 'r.id', 'w.ride_id')
    .where('w.user_id', user.id)
    .orderBy('w.id', 'desc')
    .limit(limit)
    .select('w.*', 'r.pickup_zone', 'r.dropoff_zone');
  return {
    balancePaisa: fresh.wallet_balance_paisa,
    balance: formatTaka(fresh.wallet_balance_paisa),
    transactions: rows.map((t) => ({
      id: t.id,
      type: t.type,
      amountPaisa: t.amount_paisa,
      amount: formatTaka(t.amount_paisa),
      balanceAfter: formatTaka(t.balance_after_paisa),
      rideId: t.ride_id,
      trip: t.ride_id ? { pickup: t.pickup_zone, dropoff: t.dropoff_zone } : null,
      at: t.created_at,
    })),
  };
}