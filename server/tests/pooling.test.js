import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, resetDb, loginAs } from './helpers.js';

beforeEach(resetDb);
afterAll(() => db.destroy());

const trips = {
  nusrat: { pickup: 'BANANI', dropoff: 'MOHAKHALI', seats: 1, paymentMethod: 'CASH' },
  rafiq: { pickup: 'BANANI', dropoff: 'GULSHAN_1', seats: 1, paymentMethod: 'CASH' },
  shirin: { pickup: 'BANANI', dropoff: 'GULSHAN_1', seats: 1, paymentMethod: 'CASH' },
};

async function bulletCollectingInBanani() {
  const jashim = await loginAs('jashim');
  await jashim.post('/api/driver/online').send({ zone: 'BANANI' }).expect(200);
  const nusrat = await loginAs('nusrat');
  const nusratRide = (await nusrat.post('/api/rides').send(trips.nusrat)).body.data;
  const pool = (await jashim.post(`/api/driver/requests/${nusratRide.id}/accept`)).body.data;
  return { jashim, nusrat, nusratRide, pool };
}

async function seatedSum(poolId) {
  const row = await db('rides').where({ pool_id: poolId }).whereIn('status', ['MATCHED', 'DRIVER_ARRIVED', 'STARTED']).sum({ s: 'seats' }).first();
  return Number(row.s ?? 0);
}

describe('the Banani rush-hour story', () => {
  it('Rafiq auto-joins Nusrat in Bullet; both get their own pooled fare', async () => {
    const { jashim, nusrat, nusratRide, pool } = await bulletCollectingInBanani();

    expect((await nusrat.get('/api/rides/active')).body.data.fare.current.totalPaisa).toBe(7000);

    const rafiq = await loginAs('rafiq');
    const rafiqRide = (await rafiq.post('/api/rides').send(trips.rafiq)).body.data;
    expect(rafiqRide).toMatchObject({ status: 'MATCHED', pool: { id: pool.id, otherBookings: 1, seatsTaken: 2, capacity: 3 } });
    expect(rafiqRide.fare.current.totalPaisa).toBe(6750);

    const nusratView = (await nusrat.get('/api/rides/active')).body.data;
    expect(nusratView.fare.current.totalPaisa).toBe(6000);
    expect(nusratView.pool.otherBookings).toBe(1);
    expect(JSON.stringify(nusratView)).not.toMatch(/Rafiq|GULSHAN_1|6750/);

    await jashim.post(`/api/pools/${pool.id}/arrive`).expect(200);
    const started = (await jashim.post(`/api/pools/${pool.id}/start`)).body.data;
    const fares = Object.fromEntries(started.members.map((m) => [m.passenger.name, m.fare.current]));
    expect(fares.Nusrat).toMatchObject({ pooled: true, basePaisa: 3000, distancePaisa: 4000, discountPaisa: 1000, totalPaisa: 6000 });
    expect(fares.Rafiq).toMatchObject({ pooled: true, basePaisa: 3000, distancePaisa: 5000, discountPaisa: 1250, totalPaisa: 6750 });
    expect(started.nextStops.map((s) => s.passenger)).toEqual(['Nusrat', 'Rafiq']);

    let after = (await jashim.post(`/api/pools/${pool.id}/rides/${nusratRide.id}/dropoff`)).body.data;
    expect(after.status).toBe('STARTED');
    expect((await nusrat.get(`/api/rides/${nusratRide.id}`)).body.data.status).toBe('COMPLETED');
    expect((await rafiq.get(`/api/rides/${rafiqRide.id}`)).body.data.status).toBe('STARTED');

    after = (await jashim.post(`/api/pools/${pool.id}/rides/${rafiqRide.id}/dropoff`)).body.data;
    expect(after).toMatchObject({ status: 'COMPLETED', earnedPaisa: 12750, earned: '৳127.50' });
  });

  it('Shirin takes the third seat; a fourth passenger waits for another Tesla', async () => {
    const { pool } = await bulletCollectingInBanani();
    const rafiq = await loginAs('rafiq');
    const shirin = await loginAs('shirin');
    await rafiq.post('/api/rides').send(trips.rafiq).expect(201);
    const shirinRide = (await shirin.post('/api/rides').send(trips.shirin)).body.data;
    expect(shirinRide).toMatchObject({ status: 'MATCHED', pool: { seatsTaken: 3, otherBookings: 2 } });

    const fourth = await (await import('supertest')).default.agent((await import('./helpers.js')).app);
    await fourth.post('/api/auth/signup').send({ name: 'Tanvir', phone: '01911000005', password: 'rickshaw99' }).expect(201);
    const tanvirRide = (await fourth.post('/api/rides').send(trips.rafiq)).body.data;
    expect(tanvirRide).toMatchObject({ status: 'REQUESTED', pool: null });

    const poolRow = await db('pools').where({ id: pool.id }).first();
    expect(poolRow.seats_taken).toBe(3);
    expect(await seatedSum(pool.id)).toBe(3);
  });

  it('a Gulshan 2 rider does not join (opposite direction) and is not offered to Jashim', async () => {
    const { jashim } = await bulletCollectingInBanani();
    const shirin = await loginAs('shirin');
    const ride = (await shirin.post('/api/rides').send({ ...trips.shirin, dropoff: 'GULSHAN_2' })).body.data;
    expect(ride.status).toBe('REQUESTED');

    const feed = (await jashim.get('/api/driver/requests')).body.data;
    expect(feed).toMatchObject({ mode: 'FILLING_POOL', requests: [] });

    const forced = await jashim.post(`/api/driver/requests/${ride.id}/accept`);
    expect(forced.status).toBe(409);
    expect(forced.body.error.code).toBe('DETOUR_TOO_LONG');
  });

  it('Jashim can add a compatible waiting request to his open pool from the feed', async () => {
    const rafiq = await loginAs('rafiq');
    const rafiqRide = (await rafiq.post('/api/rides').send(trips.rafiq)).body.data;
    expect(rafiqRide.status).toBe('REQUESTED');

    const { jashim, pool } = await bulletCollectingInBanani();
    const feed = (await jashim.get('/api/driver/requests')).body.data;
    expect(feed.mode).toBe('FILLING_POOL');
    expect(feed.requests.map((r) => r.passenger.name)).toEqual(['Rafiq']);

    const res = await jashim.post(`/api/driver/requests/${rafiqRide.id}/accept`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: pool.id, seatsTaken: 2 });
  });

  it("if Rafiq cancels before the start, Nusrat's estimate goes back to solo and his seat frees up", async () => {
    const { nusrat, pool } = await bulletCollectingInBanani();
    const rafiq = await loginAs('rafiq');
    const rafiqRide = (await rafiq.post('/api/rides').send(trips.rafiq)).body.data;
    await rafiq.post(`/api/rides/${rafiqRide.id}/cancel`).send({}).expect(200);

    const view = (await nusrat.get('/api/rides/active')).body.data;
    expect(view.fare.current.totalPaisa).toBe(7000);
    expect(view.pool).toMatchObject({ id: pool.id, status: 'OPEN', seatsTaken: 1, otherBookings: 0 });
  });

  it('nobody joins after the driver has arrived', async () => {
    const { jashim, pool } = await bulletCollectingInBanani();
    await jashim.post(`/api/pools/${pool.id}/arrive`).expect(200);
    const rafiq = await loginAs('rafiq');
    const ride = (await rafiq.post('/api/rides').send(trips.rafiq)).body.data;
    expect(ride.status).toBe('REQUESTED');
  });
});

describe("Bullet's capacity can never be exceeded", () => {
  it('the database rejects seats_taken > capacity even if the code is bypassed', async () => {
    const { pool } = await bulletCollectingInBanani();
    await expect(db('pools').where({ id: pool.id }).update({ seats_taken: 4 })).rejects.toMatchObject({
      code: '23514',
      constraint: 'pools_seats_within_capacity',
    });
  });

  it('a 2-seat booking cannot squeeze into 1 free seat', async () => {
    const { pool } = await bulletCollectingInBanani();
    const rafiq = await loginAs('rafiq');
    await rafiq.post('/api/rides').send({ ...trips.rafiq, seats: 2 }).expect(201);
    const shirin = await loginAs('shirin');
    const ride = (await shirin.post('/api/rides').send({ ...trips.shirin, seats: 2 })).body.data;
    expect(ride.status).toBe('REQUESTED');
    expect((await db('pools').where({ id: pool.id }).first()).seats_taken).toBe(3);
  });
});

describe('concurrency: Nusrat and Shirin race for the last seat', () => {
  it.each(Array.from({ length: 8 }, (_, i) => i + 1))('round %i: exactly one of them gets it, capacity stays consistent', async () => {
    const jashim = await loginAs('jashim');
    await jashim.post('/api/driver/online').send({ zone: 'BANANI' }).expect(200);
    const rafiq = await loginAs('rafiq');
    const rafiqRide = (await rafiq.post('/api/rides').send({ ...trips.rafiq, seats: 2 })).body.data;
    const pool = (await jashim.post(`/api/driver/requests/${rafiqRide.id}/accept`)).body.data;
    expect(pool.seatsTaken).toBe(2);

    const nusrat = await loginAs('nusrat');
    const shirin = await loginAs('shirin');
    const [a, b] = await Promise.all([nusrat.post('/api/rides').send(trips.nusrat), shirin.post('/api/rides').send(trips.shirin)]);

    expect([a.status, b.status]).toEqual([201, 201]);
    const statuses = [a.body.data.status, b.body.data.status].sort();
    expect(statuses).toEqual(['MATCHED', 'REQUESTED']);

    const poolRow = await db('pools').where({ id: pool.id }).first();
    expect(poolRow.seats_taken).toBe(3);
    expect(await seatedSum(pool.id)).toBe(3);
  });

  it('Jashim double-tapping accept opens exactly one pool', async () => {
    const jashim = await loginAs('jashim');
    await jashim.post('/api/driver/online').send({ zone: 'BANANI' }).expect(200);
    const nusrat = await loginAs('nusrat');
    const ride = (await nusrat.post('/api/rides').send(trips.nusrat)).body.data;

    const [a, b] = await Promise.all([
      jashim.post(`/api/driver/requests/${ride.id}/accept`),
      jashim.post(`/api/driver/requests/${ride.id}/accept`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await db('pools').count({ n: '*' }).first()).toEqual({ n: 1 });
  });

  it('a cancel racing an accept leaves a consistent state either way', async () => {
    const jashim = await loginAs('jashim');
    await jashim.post('/api/driver/online').send({ zone: 'BANANI' }).expect(200);
    const nusrat = await loginAs('nusrat');
    const ride = (await nusrat.post('/api/rides').send(trips.nusrat)).body.data;

    await Promise.all([jashim.post(`/api/driver/requests/${ride.id}/accept`), nusrat.post(`/api/rides/${ride.id}/cancel`).send({})]);

    const final = await db('rides').where({ id: ride.id }).first();
    const pools = await db('pools');
    if (final.status === 'CANCELLED') {
      for (const p of pools) expect(p.status).toBe('CANCELLED');
    } else {
      expect(final.status).toBe('MATCHED');
      expect(pools).toHaveLength(1);
      expect(pools[0].seats_taken).toBe(1);
    }
  });
});