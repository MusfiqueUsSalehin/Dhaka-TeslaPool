import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, resetDb, loginAs } from './helpers.js';

beforeEach(resetDb);
afterAll(() => db.destroy());

async function ledgerSum(userId) {
  const row = await db('wallet_transactions').where({ user_id: userId }).sum({ s: 'amount_paisa' }).first();
  return Number(row.s ?? 0);
}

/** Nusrat (cash) + Rafiq (TeslaPay) share Bullet, then Jashim runs the trip to the end. */
async function pooledTripWithTeslaPay() {
  const jashim = await loginAs('jashim');
  await jashim.post('/api/driver/online').send({ zone: 'BANANI' }).expect(200);
  const nusrat = await loginAs('nusrat');
  const rafiq = await loginAs('rafiq');
  const nRide = (await nusrat.post('/api/rides').send({ pickup: 'BANANI', dropoff: 'MOHAKHALI', seats: 1, paymentMethod: 'CASH' })).body.data;
  const pool = (await jashim.post(`/api/driver/requests/${nRide.id}/accept`)).body.data;
  const rRide = (await rafiq.post('/api/rides').send({ pickup: 'BANANI', dropoff: 'GULSHAN_1', seats: 1, paymentMethod: 'TESLAPAY' })).body.data;
  expect(rRide.status).toBe('MATCHED');
  await jashim.post(`/api/pools/${pool.id}/arrive`).expect(200);
  await jashim.post(`/api/pools/${pool.id}/start`).expect(200);
  return { jashim, nusrat, rafiq, nRide, rRide, pool };
}

describe('TeslaPay wallet', () => {
  it('seeds opening balances through the ledger (৳500 / ৳300 / ৳150)', async () => {
    const nusrat = await loginAs('nusrat');
    const wallet = (await nusrat.get('/api/wallet')).body.data;
    expect(wallet).toMatchObject({ balancePaisa: 50000, balance: '৳500.00' });
    expect(wallet.transactions).toEqual([expect.objectContaining({ type: 'TOPUP', amountPaisa: 50000 })]);
  });

  it('tops up with validation and keeps balance == sum(ledger)', async () => {
    const shirin = await loginAs('shirin');
    const res = await shirin.post('/api/wallet/topup').send({ amountPaisa: 20000 });
    expect(res.status).toBe(200);
    expect(res.body.data.balance).toBe('৳350.00');
    expect(await ledgerSum(shirin.user.id)).toBe(35000);

    expect((await shirin.post('/api/wallet/topup').send({ amountPaisa: 999999 })).status).toBe(400);
    expect((await shirin.post('/api/wallet/topup').send({ amountPaisa: 10.5 })).status).toBe(400);
  });

  it('drivers cannot top up (they earn)', async () => {
    const jashim = await loginAs('jashim');
    expect((await jashim.post('/api/wallet/topup').send({ amountPaisa: 5000 })).status).toBe(403);
  });
});

describe('settlement at drop-off', () => {
  it("charges Rafiq's pooled ৳67.50 to TeslaPay and credits Jashim; Nusrat pays cash", async () => {
    const { jashim, nusrat, rafiq, nRide, rRide, pool } = await pooledTripWithTeslaPay();
    await jashim.post(`/api/pools/${pool.id}/rides/${nRide.id}/dropoff`).expect(200);
    await jashim.post(`/api/pools/${pool.id}/rides/${rRide.id}/dropoff`).expect(200);

    const rWallet = (await rafiq.get('/api/wallet')).body.data;
    expect(rWallet.balancePaisa).toBe(30000 - 6750);
    expect(rWallet.transactions[0]).toMatchObject({ type: 'RIDE_PAYMENT', amountPaisa: -6750, rideId: rRide.id });

    const jWallet = (await jashim.get('/api/wallet')).body.data;
    expect(jWallet.balancePaisa).toBe(6750); // Nusrat's ৳60 was cash in hand
    expect((await nusrat.get('/api/wallet')).body.data.balancePaisa).toBe(50000);

    const rView = (await rafiq.get(`/api/rides/${rRide.id}`)).body.data;
    expect(rView).toMatchObject({ paymentStatus: 'PAID', paymentMethod: 'TESLAPAY' });

    for (const who of [rafiq, jashim, nusrat]) {
      const bal = (await who.get('/api/wallet')).body.data.balancePaisa;
      expect(await ledgerSum(who.user.id)).toBe(bal);
    }
  });

  it('can never charge the same ride twice (ledger unique key)', async () => {
    const { jashim, rafiq, rRide, pool } = await pooledTripWithTeslaPay();
    await jashim.post(`/api/pools/${pool.id}/rides/${rRide.id}/dropoff`).expect(200);
    await expect(
      db('wallet_transactions').insert({ user_id: rafiq.user.id, ride_id: rRide.id, type: 'RIDE_PAYMENT', amount_paisa: -6750, balance_after_paisa: 0 }),
    ).rejects.toMatchObject({ code: '23505', constraint: 'wallet_tx_once_per_ride' });
  });

  it('falls back to cash instead of going negative if the wallet was drained', async () => {
    const { jashim, rafiq, rRide, pool } = await pooledTripWithTeslaPay();
    await db('users').where({ id: rafiq.user.id }).update({ wallet_balance_paisa: 100 }); // simulate a drained wallet
    await jashim.post(`/api/pools/${pool.id}/rides/${rRide.id}/dropoff`).expect(200);

    const view = (await rafiq.get(`/api/rides/${rRide.id}`)).body.data;
    expect(view).toMatchObject({ paymentMethod: 'CASH', paymentStatus: 'PAID' });
    expect(view.timeline.map((e) => e.type)).toContain('PAYMENT_FALLBACK_TO_CASH');
    expect((await db('users').where({ id: rafiq.user.id }).first()).wallet_balance_paisa).toBe(100);
  });

  it('the database refuses a negative balance outright', async () => {
    const rafiq = await loginAs('rafiq');
    await expect(db('users').where({ id: rafiq.user.id }).update({ wallet_balance_paisa: -1 })).rejects.toMatchObject({
      code: '23514',
      constraint: 'users_wallet_non_negative',
    });
  });
});
