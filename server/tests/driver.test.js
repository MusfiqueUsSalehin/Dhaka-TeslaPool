import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, resetDb, loginAs } from './helpers.js';

beforeEach(resetDb);
afterAll(() => db.destroy());

const nusratTrip = { pickup: 'BANANI', dropoff: 'MOHAKHALI', seats: 1, paymentMethod: 'CASH' };

async function jashimOnline(zone = 'BANANI') {
  const jashim = await loginAs('jashim');
  await jashim.post('/api/driver/online').send({ zone }).expect(200);
  return jashim;
}

describe('driver availability and request feed', () => {
  it('shows Jashim his Tesla, Bullet, with 3 seats', async () => {
    const jashim = await loginAs('jashim');
    const res = await jashim.get('/api/driver/me');
    expect(res.body.data.vehicle).toMatchObject({ name: 'Bullet', capacity: 3, isOnline: false });
    expect(res.body.data.activePool).toBeNull();
  });

  it('shows nothing while offline, nearby requests (nearest first) while online', async () => {
    const nusrat = await loginAs('nusrat');
    const shirin = await loginAs('shirin');
    await nusrat.post('/api/rides').send(nusratTrip).expect(201);
    await shirin.post('/api/rides').send({ pickup: 'UTTARA', dropoff: 'AIRPORT', seats: 1 }).expect(201); // 12 km away

    const jashim = await loginAs('jashim');
    expect((await jashim.get('/api/driver/requests')).body.data).toEqual({ mode: 'OFFLINE', requests: [] });

    await jashim.post('/api/driver/online').send({ zone: 'GULSHAN_1' }).expect(200);
    const feed = (await jashim.get('/api/driver/requests')).body.data;
    expect(feed.mode).toBe('IDLE');
    expect(feed.requests).toHaveLength(1);
    expect(feed.requests[0]).toMatchObject({
      passenger: { name: 'Nusrat' },
      pickup: { code: 'BANANI' },
      pickupDistanceM: 2500,
      estimate: { solo: '৳70.00', pooled: '৳60.00' },
    });
  });

  it('only drivers can use driver endpoints', async () => {
    const rafiq = await loginAs('rafiq');
    expect((await rafiq.get('/api/driver/me')).status).toBe(403);
  });
});

describe('solo trip lifecycle: Nusrat alone in Bullet', () => {
  it('goes REQUESTED -> MATCHED -> DRIVER_ARRIVED -> STARTED -> COMPLETED with a ৳70.00 solo fare', async () => {
    const nusrat = await loginAs('nusrat');
    const ride = (await nusrat.post('/api/rides').send(nusratTrip)).body.data;
    const jashim = await jashimOnline();

    const accepted = await jashim.post(`/api/driver/requests/${ride.id}/accept`);
    expect(accepted.status).toBe(200);
    const pool = accepted.body.data;
    expect(pool).toMatchObject({ status: 'OPEN', pickup: { code: 'BANANI' }, seatsTaken: 1, seatsFree: 2 });

    let mine = (await nusrat.get('/api/rides/active')).body.data;
    expect(mine).toMatchObject({ status: 'MATCHED', pool: { vehicle: { name: 'Bullet' }, driver: { name: 'Jashim' }, otherBookings: 0 } });

    await jashim.post(`/api/pools/${pool.id}/arrive`).expect(200);
    expect((await nusrat.get('/api/rides/active')).body.data.status).toBe('DRIVER_ARRIVED');

    const started = (await jashim.post(`/api/pools/${pool.id}/start`)).body.data;
    expect(started.status).toBe('STARTED');
    expect(started.members[0].fare).toMatchObject({ status: 'FINAL', current: { pooled: false, totalPaisa: 7000 } });

    const done = (await jashim.post(`/api/pools/${pool.id}/rides/${ride.id}/dropoff`)).body.data;
    expect(done.status).toBe('COMPLETED');
    expect(done.earned).toBe('৳70.00');

    mine = (await nusrat.get(`/api/rides/${ride.id}`)).body.data;
    expect(mine).toMatchObject({ status: 'COMPLETED', paymentStatus: 'PAID', fare: { status: 'FINAL', current: { totalPaisa: 7000 } } });
    expect(mine.timeline.map((e) => e.type)).toEqual([
      'RIDE_REQUESTED',
      'RIDE_MATCHED',
      'DRIVER_ARRIVED',
      'TRIP_STARTED',
      'RIDE_COMPLETED',
      'PAYMENT_CAPTURED',
    ]);

    // Bullet is free again, parked where it dropped Nusrat off.
    const me = (await jashim.get('/api/driver/me')).body.data;
    expect(me.activePool).toBeNull();
    expect(me.vehicle.currentZone.code).toBe('MOHAKHALI');
    expect(me.stats).toMatchObject({ completedRides: 1, earned: '৳70.00' });
  });
});

describe('invalid transitions are rejected', () => {
  async function openPool() {
    const nusrat = await loginAs('nusrat');
    const ride = (await nusrat.post('/api/rides').send(nusratTrip)).body.data;
    const jashim = await jashimOnline();
    const pool = (await jashim.post(`/api/driver/requests/${ride.id}/accept`)).body.data;
    return { nusrat, jashim, ride, pool };
  }

  it('cannot start before arriving, or drop off before starting', async () => {
    const { jashim, pool, ride } = await openPool();
    const start = await jashim.post(`/api/pools/${pool.id}/start`);
    expect(start.status).toBe(409);
    expect(start.body.error.code).toBe('INVALID_TRANSITION');
    expect((await jashim.post(`/api/pools/${pool.id}/rides/${ride.id}/dropoff`)).status).toBe(409);
  });

  it('cannot arrive twice or drop the same passenger off twice', async () => {
    const { jashim, pool, ride } = await openPool();
    await jashim.post(`/api/pools/${pool.id}/arrive`).expect(200);
    expect((await jashim.post(`/api/pools/${pool.id}/arrive`)).status).toBe(409);
    await jashim.post(`/api/pools/${pool.id}/start`).expect(200);
    await jashim.post(`/api/pools/${pool.id}/rides/${ride.id}/dropoff`).expect(200);
    expect((await jashim.post(`/api/pools/${pool.id}/rides/${ride.id}/dropoff`)).status).toBe(409);
  });

  it('cannot accept a request that was already taken', async () => {
    const { jashim, ride } = await openPool();
    const again = await jashim.post(`/api/driver/requests/${ride.id}/accept`);
    expect(again.status).toBe(409);
  });

  it('cannot go offline with passengers assigned', async () => {
    const { jashim } = await openPool();
    const res = await jashim.post('/api/driver/offline');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACTIVE_POOL');
  });
});

describe('cancellation rules with a driver involved', () => {
  it('Nusrat can cancel while MATCHED: seats return and the empty pool is cancelled', async () => {
    const nusrat = await loginAs('nusrat');
    const ride = (await nusrat.post('/api/rides').send(nusratTrip)).body.data;
    const jashim = await jashimOnline();
    const pool = (await jashim.post(`/api/driver/requests/${ride.id}/accept`)).body.data;

    await nusrat.post(`/api/rides/${ride.id}/cancel`).send({}).expect(200);
    const after = (await jashim.get(`/api/pools/${pool.id}`)).body.data;
    expect(after).toMatchObject({ status: 'CANCELLED', seatsTaken: 0 });
    expect((await jashim.get('/api/driver/me')).body.data.activePool).toBeNull();
  });

  it('after the driver arrives Nusrat cannot cancel; Jashim can mark her a no-show', async () => {
    const nusrat = await loginAs('nusrat');
    const ride = (await nusrat.post('/api/rides').send(nusratTrip)).body.data;
    const jashim = await jashimOnline();
    const pool = (await jashim.post(`/api/driver/requests/${ride.id}/accept`)).body.data;
    await jashim.post(`/api/pools/${pool.id}/arrive`).expect(200);

    const cancel = await nusrat.post(`/api/rides/${ride.id}/cancel`).send({});
    expect(cancel.status).toBe(409);
    expect(cancel.body.error.code).toBe('CANNOT_CANCEL');

    await jashim.post(`/api/pools/${pool.id}/rides/${ride.id}/no-show`).expect(200);
    const mine = (await nusrat.get(`/api/rides/${ride.id}`)).body.data;
    expect(mine).toMatchObject({ status: 'CANCELLED', cancelReason: 'No-show at pickup', paymentStatus: 'NOT_CHARGED' });
    expect((await jashim.get(`/api/pools/${pool.id}`)).body.data.status).toBe('CANCELLED');
  });

  it('nobody can cancel a started ride', async () => {
    const nusrat = await loginAs('nusrat');
    const ride = (await nusrat.post('/api/rides').send(nusratTrip)).body.data;
    const jashim = await jashimOnline();
    const pool = (await jashim.post(`/api/driver/requests/${ride.id}/accept`)).body.data;
    await jashim.post(`/api/pools/${pool.id}/arrive`).expect(200);
    await jashim.post(`/api/pools/${pool.id}/start`).expect(200);

    expect((await nusrat.post(`/api/rides/${ride.id}/cancel`).send({})).status).toBe(409);
    expect((await jashim.post(`/api/pools/${pool.id}/rides/${ride.id}/no-show`)).status).toBe(409);
  });
});