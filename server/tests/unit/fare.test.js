import { describe, it, expect } from 'vitest';
import { calculateFare, estimateFare, isPooled } from '../../src/domain/fare.js';
import { distanceM } from '../../src/domain/zones.js';

// These are the hand-checkable numbers from docs/domain-rules.md §3.
describe('zone distances (Manhattan on the 500 m grid)', () => {
  it('Banani -> Mohakhali is 2000 m, Banani -> Gulshan 1 is 2500 m', () => {
    expect(distanceM('BANANI', 'MOHAKHALI')).toBe(2000);
    expect(distanceM('BANANI', 'GULSHAN_1')).toBe(2500);
    expect(distanceM('MOHAKHALI', 'GULSHAN_1')).toBe(1500);
  });

  it('is symmetric and zero for the same zone', () => {
    expect(distanceM('GULSHAN_1', 'BANANI')).toBe(distanceM('BANANI', 'GULSHAN_1'));
    expect(distanceM('BANANI', 'BANANI')).toBe(0);
  });
});

describe('fare model', () => {
  it("Nusrat's Banani -> Mohakhali: ৳70.00 solo, ৳60.00 pooled", () => {
    const { solo, pooled } = estimateFare({ pickup: 'BANANI', dropoff: 'MOHAKHALI', seats: 1 });
    expect(solo).toEqual({ distanceM: 2000, seats: 1, pooled: false, basePaisa: 3000, distancePaisa: 4000, discountPaisa: 0, totalPaisa: 7000 });
    expect(pooled).toMatchObject({ discountPaisa: 1000, totalPaisa: 6000 });
  });

  it("Rafiq's Banani -> Gulshan 1: ৳80.00 solo, ৳67.50 pooled (why we store paisa)", () => {
    const { solo, pooled } = estimateFare({ pickup: 'BANANI', dropoff: 'GULSHAN_1', seats: 1 });
    expect(solo.totalPaisa).toBe(8000);
    expect(pooled).toMatchObject({ basePaisa: 3000, distancePaisa: 5000, discountPaisa: 1250, totalPaisa: 6750 });
  });

  it('a full Bullet (Nusrat + Rafiq + Shirin, all pooled) earns ৳195.00', () => {
    const nusrat = calculateFare({ distanceM: 2000, seats: 1, pooled: true }).totalPaisa;
    const rafiq = calculateFare({ distanceM: 2500, seats: 1, pooled: true }).totalPaisa;
    const shirin = calculateFare({ distanceM: 2500, seats: 1, pooled: true }).totalPaisa;
    expect(nusrat + rafiq + shirin).toBe(19500);
  });

  it('multiplies the per-seat fare by seats and the parts always add up', () => {
    const f = calculateFare({ distanceM: 2500, seats: 2, pooled: true });
    expect(f).toMatchObject({ basePaisa: 6000, distancePaisa: 10000, discountPaisa: 2500, totalPaisa: 13500 });
    expect(f.basePaisa + f.distancePaisa - f.discountPaisa).toBe(f.totalPaisa);
  });

  it('only integers ever come out (no floating point money)', () => {
    for (const m of [500, 1000, 1500, 3500, 12500, 16000]) {
      for (const pooled of [true, false]) {
        const f = calculateFare({ distanceM: m, seats: 3, pooled });
        for (const v of [f.basePaisa, f.distancePaisa, f.discountPaisa, f.totalPaisa]) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it('rejects nonsense input', () => {
    expect(() => calculateFare({ distanceM: 0, seats: 1, pooled: false })).toThrow();
    expect(() => calculateFare({ distanceM: 2000, seats: 0, pooled: false })).toThrow();
  });

  it('counts a trip as pooled only with two or more bookings on board', () => {
    expect(isPooled(1)).toBe(false);
    expect(isPooled(2)).toBe(true);
  });
});
