import { distanceM } from './zones.js';

/**
 * Matching rule (see docs/domain-rules.md §2). Pure functions: the caller loads the
 * pool and its current members (after locking the pool row) and asks whether one more
 * request fits.
 */
export const MATCHING_RULES = Object.freeze({
  // A passenger may ride at most 1.5× their direct distance because of pooling.
  // Kept as a fraction so the comparison is exact integer math: inVehicle × 2 ≤ direct × 3.
  MAX_DETOUR_NUM: 3,
  MAX_DETOUR_DEN: 2,
  // ...and never more than 2 km extra in absolute terms (otherwise a long Uttara trip
  // would "tolerate" a 3 km detour to Mohakhali just because 1.5 × 12 km is large).
  MAX_EXTRA_M: 2000,
  // Driver feed: waiting requests within this distance of the Tesla's current zone.
  DRIVER_RADIUS_M: 4000,
});

/**
 * Plan the drop-off order for everyone in the Tesla.
 * Drop-offs are visited by direct distance from the pickup (ties by zone code, then id)
 * and each rider's in-vehicle distance is measured along that route.
 *
 * @param {string} pickup zone code
 * @param {{ id: string, dropoff: string }[]} riders
 */
export function planRoute(pickup, riders) {
  const withDirect = riders.map((r) => ({ ...r, directM: distanceM(pickup, r.dropoff) }));
  withDirect.sort((a, b) => a.directM - b.directM || a.dropoff.localeCompare(b.dropoff) || String(a.id).localeCompare(String(b.id)));

  let position = pickup;
  let travelled = 0;
  const legs = [];
  for (const rider of withDirect) {
    const leg = distanceM(position, rider.dropoff);
    travelled += leg;
    position = rider.dropoff;
    legs.push({
      id: rider.id,
      dropoff: rider.dropoff,
      directM: rider.directM,
      inVehicleM: travelled,
      withinDetourLimit:
        travelled * MATCHING_RULES.MAX_DETOUR_DEN <= rider.directM * MATCHING_RULES.MAX_DETOUR_NUM &&
        travelled - rider.directM <= MATCHING_RULES.MAX_EXTRA_M,
    });
  }
  return { pickup, totalM: travelled, stops: legs };
}

/**
 * Can `candidate` join a pool that currently holds `members`?
 *
 * @param {object} args
 * @param {{ pickupZone: string, capacity: number, seatsTaken: number }} args.pool
 * @param {{ id: string, dropoff: string }[]} args.members active members already in the pool
 * @param {{ id: string, pickup: string, dropoff: string, seats: number }} args.candidate
 * @returns {{ ok: boolean, reason?: string, route?: object }}
 */
export function checkCompatibility({ pool, members, candidate }) {
  if (candidate.pickup !== pool.pickupZone) {
    return { ok: false, reason: 'PICKUP_MISMATCH' };
  }
  if (pool.seatsTaken + candidate.seats > pool.capacity) {
    return { ok: false, reason: 'NOT_ENOUGH_SEATS' };
  }
  const route = planRoute(pool.pickupZone, [...members, { id: candidate.id, dropoff: candidate.dropoff }]);
  const violator = route.stops.find((s) => !s.withinDetourLimit);
  if (violator) {
    return { ok: false, reason: 'DETOUR_TOO_LONG', route, violator: violator.id };
  }
  return { ok: true, route };
}

/** Is a waiting request near enough to a Tesla parked in `vehicleZone` to show it? */
export function isWithinDriverRadius(vehicleZone, pickupZone) {
  return distanceM(vehicleZone, pickupZone) <= MATCHING_RULES.DRIVER_RADIUS_M;
}
