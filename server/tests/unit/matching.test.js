import { describe, it, expect } from 'vitest';
import { checkCompatibility, planRoute, isWithinDriverRadius } from '../../src/domain/matching.js';

const bulletPool = (seatsTaken = 1) => ({ pickupZone: 'BANANI', capacity: 3, seatsTaken });
const nusrat = { id: 'nusrat', dropoff: 'MOHAKHALI' };

describe('matching rule — Nusrat and Rafiq (overlapping, not identical)', () => {
  it('lets Rafiq (Banani -> Gulshan 1) join Nusrat (Banani -> Mohakhali)', () => {
    const result = checkCompatibility({
      pool: bulletPool(1),
      members: [nusrat],
      candidate: { id: 'rafiq', pickup: 'BANANI', dropoff: 'GULSHAN_1', seats: 1 },
    });
    expect(result.ok).toBe(true);
    // Mohakhali first (2000 m), then Gulshan 1 (+1500 m => Rafiq rides 3500 m <= 1.5 × 2500)
    expect(result.route.stops).toEqual([
      { id: 'nusrat', dropoff: 'MOHAKHALI', directM: 2000, inVehicleM: 2000, withinDetourLimit: true },
      { id: 'rafiq', dropoff: 'GULSHAN_1', directM: 2500, inVehicleM: 3500, withinDetourLimit: true },
    ]);
  });

  it('rejects a Gulshan 2 rider: near Banani but the opposite direction (Nusrat would ride 4000 m > 3000 m)', () => {
    const result = checkCompatibility({
      pool: bulletPool(1),
      members: [nusrat],
      candidate: { id: 'g2', pickup: 'BANANI', dropoff: 'GULSHAN_2', seats: 1 },
    });
    expect(result).toMatchObject({ ok: false, reason: 'DETOUR_TOO_LONG', violator: 'nusrat' });
  });

  it('requires the same pickup zone', () => {
    const result = checkCompatibility({
      pool: bulletPool(1),
      members: [nusrat],
      candidate: { id: 'x', pickup: 'GULSHAN_1', dropoff: 'MOHAKHALI', seats: 1 },
    });
    expect(result).toEqual({ ok: false, reason: 'PICKUP_MISMATCH' });
  });

  it("never lets seats exceed Bullet's capacity", () => {
    const shirin = { id: 'shirin', pickup: 'BANANI', dropoff: 'GULSHAN_1', seats: 1 };
    expect(checkCompatibility({ pool: bulletPool(2), members: [nusrat, { id: 'rafiq', dropoff: 'GULSHAN_1' }], candidate: shirin }).ok).toBe(true);
    expect(checkCompatibility({ pool: bulletPool(3), members: [nusrat], candidate: shirin })).toEqual({ ok: false, reason: 'NOT_ENOUGH_SEATS' });
    expect(checkCompatibility({ pool: bulletPool(2), members: [nusrat], candidate: { ...shirin, seats: 2 } })).toEqual({
      ok: false,
      reason: 'NOT_ENOUGH_SEATS',
    });
  });

  it('checks the detour for every passenger already on board, not just the newcomer', () => {
    const bad = checkCompatibility({
      pool: bulletPool(1),
      members: [{ id: 'airport', dropoff: 'AIRPORT' }], // 6500 m north
      candidate: { id: 'nusrat', pickup: 'BANANI', dropoff: 'MOHAKHALI', seats: 1 }, // 2000 m south
    });
    // Nusrat is fine (2000 m), but the Airport rider would ride 2000 + (500 + 8000) = 10500 m
    // against a limit of 1.5 × 6500 = 9750 m, so the member already on board "objects".
    expect(bad).toMatchObject({ ok: false, reason: 'DETOUR_TOO_LONG', violator: 'airport' });
  });

  it('also caps the detour at +2 km, so long trips are protected too', () => {
    // Uttara rider (12000 m direct) would ride 2000 + 13000 = 15000 m. That is within 1.5×
    // (18000 m) but 3000 m extra, so the absolute cap rejects it.
    const result = checkCompatibility({
      pool: bulletPool(1),
      members: [{ id: 'uttara', dropoff: 'UTTARA' }],
      candidate: { id: 'nusrat', pickup: 'BANANI', dropoff: 'MOHAKHALI', seats: 1 },
    });
    expect(result).toMatchObject({ ok: false, reason: 'DETOUR_TOO_LONG', violator: 'uttara' });
  });
});

describe('route planning', () => {
  it('orders drop-offs by direct distance and breaks ties deterministically', () => {
    const route = planRoute('BANANI', [
      { id: 'b', dropoff: 'GULSHAN_1' },
      { id: 'a', dropoff: 'GULSHAN_1' },
      { id: 'n', dropoff: 'MOHAKHALI' },
    ]);
    expect(route.stops.map((s) => s.id)).toEqual(['n', 'a', 'b']);
    expect(route.totalM).toBe(3500);
  });
});

describe('driver radius', () => {
  it('shows Banani requests to a Tesla in Gulshan 1 but not Uttara requests', () => {
    expect(isWithinDriverRadius('GULSHAN_1', 'BANANI')).toBe(true); // 2500 m
    expect(isWithinDriverRadius('GULSHAN_1', 'UTTARA')).toBe(false);
  });
});
