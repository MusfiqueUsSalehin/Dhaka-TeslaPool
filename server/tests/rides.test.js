import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, db, resetDb, loginAs } from './helpers.js';

beforeEach(resetDb);
afterAll(() => db.destroy());

const nusratTrip = { pickup: 'BANANI', dropoff: 'MOHAKHALI', seats: 1, paymentMethod: 'CASH' };

describe('fare estimate (public)', () => {
  it("quotes Nusrat's trip: ৳70.00 solo, ৳60.00 pooled", async () => {
    const res = await request(app).get('/api/fares/estimate').query({ pickup: 'BANANI', dropoff: 'MOHAKHALI', seats: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ distanceM: 2000, solo: { totalPaisa: 7000 }, pooled: { totalPaisa: 6000 } });
    expect(res.body.data.pooled.display.total).toBe('৳60.00');
  });

  it('rejects unknown zones and identical pickup/destination', async () => {
    const bad = await request(app).get('/api/fares/estimate').query({ pickup: 'NARNIA', dropoff: 'BANANI' });
    expect(bad.status).toBe(400);
    const same = await request(app).get('/api/fares/estimate').query({ pickup: 'BANANI', dropoff: 'BANANI' });
    expect(same.status).toBe(400);
    expect(same.body.error.details[0].message).toMatch(/different/);
  });
});

describe('passenger ride requests', () => {
  it('creates a REQUESTED ride with an estimate and an audit event', async () => {
    const nusrat = await loginAs('nusrat');
    const res = await nusrat.post('/api/rides').send(nusratTrip);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'REQUESTED',
      pickup: { code: 'BANANI', name: 'Banani' },
      dropoff: { code: 'MOHAKHALI', name: 'Mohakhali' },
      distanceM: 2000,
      pool: null,
      fare: { status: 'ESTIMATE', current: { totalPaisa: 7000 }, pooled: { totalPaisa: 6000 } },
    });

    const detail = await nusrat.get(`/api/rides/${res.body.data.id}`);
    expect(detail.body.data.timeline).toHaveLength(1);
    expect(detail.body.data.timeline[0]).toMatchObject({ type: 'RIDE_REQUESTED', to: 'REQUESTED', actor: { name: 'Nusrat' } });
  });

  it('allows only one active ride per passenger', async () => {
    const nusrat = await loginAs('nusrat');
    await nusrat.post('/api/rides').send(nusratTrip).expect(201);
    const second = await nusrat.post('/api/rides').send({ ...nusratTrip, dropoff: 'GULSHAN_1' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ACTIVE_RIDE_EXISTS');
  });

  it('the database itself refuses a second active ride even if the service check is bypassed', async () => {
    const nusrat = await loginAs('nusrat');
    await nusrat.post('/api/rides').send(nusratTrip).expect(201);
    await expect(
      db('rides').insert({ passenger_id: nusrat.user.id, pickup_zone: 'BANANI', dropoff_zone: 'GULSHAN_1', seats: 1, payment_method: 'CASH', distance_m: 2500 }),
    ).rejects.toMatchObject({ code: '23505', constraint: 'rides_one_active_per_passenger' });
  });

  it('validates seats (1-3) and payment method', async () => {
    const rafiq = await loginAs('rafiq');
    const res = await rafiq.post('/api/rides').send({ pickup: 'BANANI', dropoff: 'GULSHAN_1', seats: 4, paymentMethod: 'BKASH' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.path).sort()).toEqual(['paymentMethod', 'seats']);
  });

  it('refuses TeslaPay when the wallet cannot cover the solo fare', async () => {
    const shirin = await loginAs('shirin');
    await db('users').where({ id: shirin.user.id }).update({ wallet_balance_paisa: 5000 }); // ৳50 < ৳80
    const res = await shirin.post('/api/rides').send({ pickup: 'BANANI', dropoff: 'GULSHAN_1', seats: 1, paymentMethod: 'TESLAPAY' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('drivers cannot request rides', async () => {
    const jashim = await loginAs('jashim');
    const res = await jashim.post('/api/rides').send(nusratTrip);
    expect(res.status).toBe(403);
  });
});

describe('cancellation and ownership', () => {
  it('lets Nusrat cancel her waiting ride and then book again', async () => {
    const nusrat = await loginAs('nusrat');
    const { body } = await nusrat.post('/api/rides').send(nusratTrip);

    const cancel = await nusrat.post(`/api/rides/${body.data.id}/cancel`).send({ reason: 'Found a CNG' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data).toMatchObject({ status: 'CANCELLED', paymentStatus: 'NOT_CHARGED', cancelReason: 'Found a CNG', fare: { status: 'NOT_CHARGED' } });

    const again = await nusrat.post(`/api/rides/${body.data.id}/cancel`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CANNOT_CANCEL');

    await nusrat.post('/api/rides').send(nusratTrip).expect(201);
  });

  it("Rafiq can neither see nor cancel Nusrat's ride (404, not 403)", async () => {
    const nusrat = await loginAs('nusrat');
    const rafiq = await loginAs('rafiq');
    const { body } = await nusrat.post('/api/rides').send(nusratTrip);

    expect((await rafiq.get(`/api/rides/${body.data.id}`)).status).toBe(404);
    expect((await rafiq.post(`/api/rides/${body.data.id}/cancel`).send({})).status).toBe(404);

    const still = await nusrat.get(`/api/rides/${body.data.id}`);
    expect(still.body.data.status).toBe('REQUESTED');
  });

  it('rejects malformed ride ids with 400 instead of a database error', async () => {
    const nusrat = await loginAs('nusrat');
    const res = await nusrat.get('/api/rides/not-a-uuid');
    expect(res.status).toBe(400);
  });
});

describe('history', () => {
  it('lists only my rides, newest first, and exposes the active one', async () => {
    const nusrat = await loginAs('nusrat');
    const rafiq = await loginAs('rafiq');
    const first = await nusrat.post('/api/rides').send(nusratTrip);
    await nusrat.post(`/api/rides/${first.body.data.id}/cancel`).send({});
    const second = await nusrat.post('/api/rides').send({ ...nusratTrip, dropoff: 'GULSHAN_1' });
    await rafiq.post('/api/rides').send({ pickup: 'BANANI', dropoff: 'GULSHAN_1', seats: 1 });

    const list = await nusrat.get('/api/rides');
    expect(list.body.data.map((r) => r.id)).toEqual([second.body.data.id, first.body.data.id]);

    const active = await nusrat.get('/api/rides/active');
    expect(active.body.data.id).toBe(second.body.data.id);
  });
});
