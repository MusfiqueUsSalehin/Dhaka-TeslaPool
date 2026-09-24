import { distanceM } from './zones.js';

/**
 * Fare model (see docs/domain-rules.md §3). All values are integer paisa.
 *
 *   distanceCharge = distance_m × PER_KM / 1000          (৳20/km => 2 paisa per metre)
 *   poolDiscount   = round(distanceCharge × 25 / 100)     only if the ride is pooled
 *   farePerSeat    = BASE + distanceCharge − poolDiscount
 *   passengerFare  = farePerSeat × seats
 */
export const FARE_RULES = Object.freeze({
  BASE_PAISA: 3000, // ৳30
  PER_KM_PAISA: 2000, // ৳20 per km
  POOL_DISCOUNT_PERCENT: 25, // of the distance charge
});

/** Integer percentage with round-half-up, no floating point involved. */
function percentOf(amountPaisa, percent) {
  return Math.floor((amountPaisa * percent + 50) / 100);
}

/**
 * @param {{ distanceM: number, seats: number, pooled: boolean }} input
 * @returns breakdown whose parts always add up: base + distance − discount = total
 */
export function calculateFare({ distanceM: meters, seats, pooled }) {
  if (!Number.isInteger(meters) || meters <= 0) throw new Error(`distanceM must be a positive integer, got ${meters}`);
  if (!Number.isInteger(seats) || seats < 1) throw new Error(`seats must be a positive integer, got ${seats}`);

  const distancePerSeat = Math.round((meters * FARE_RULES.PER_KM_PAISA) / 1000);
  const discountPerSeat = pooled ? percentOf(distancePerSeat, FARE_RULES.POOL_DISCOUNT_PERCENT) : 0;
  const perSeat = FARE_RULES.BASE_PAISA + distancePerSeat - discountPerSeat;

  return {
    distanceM: meters,
    seats,
    pooled: Boolean(pooled),
    basePaisa: FARE_RULES.BASE_PAISA * seats,
    distancePaisa: distancePerSeat * seats,
    discountPaisa: discountPerSeat * seats,
    totalPaisa: perSeat * seats,
  };
}

/** What the passenger sees before booking: the solo price and the price if pooled. */
export function estimateFare({ pickup, dropoff, seats }) {
  const meters = distanceM(pickup, dropoff);
  return {
    distanceM: meters,
    solo: calculateFare({ distanceM: meters, seats, pooled: false }),
    pooled: calculateFare({ distanceM: meters, seats, pooled: true }),
  };
}

/** A trip counts as pooled when two or more separate bookings share the Tesla at start. */
export function isPooled(bookingsOnBoard) {
  return bookingsOnBoard >= 2;
}
