/**
 * Predefined Dhaka zones. `x`/`y` are metres east/north of Banani on a 500 m grid
 * (see docs/domain-rules.md for how they were derived). lat/lng are for display only;
 * every calculation uses the grid.
 *
 * This list is the single source of truth: the zones migration inserts it into the
 * `zones` table (so rides/pools can reference zones with foreign keys) and the domain
 * code reads it directly (so fare/matching are pure functions with no DB access).
 */
export const ZONES = Object.freeze([
  { code: 'UTTARA', name: 'Uttara', lat: 23.8759, lng: 90.3795, x: -3000, y: 9000 },
  { code: 'AIRPORT', name: 'Airport', lat: 23.8513, lng: 90.4086, x: 0, y: 6500 },
  { code: 'BASHUNDHARA', name: 'Bashundhara R/A', lat: 23.8193, lng: 90.4526, x: 4500, y: 3000 },
  { code: 'MIRPUR', name: 'Mirpur 10', lat: 23.8069, lng: 90.3687, x: -4000, y: 1500 },
  { code: 'GULSHAN_2', name: 'Gulshan 2', lat: 23.7948, lng: 90.4144, x: 1000, y: 0 },
  { code: 'BANANI', name: 'Banani', lat: 23.7937, lng: 90.4066, x: 0, y: 0 },
  { code: 'BADDA', name: 'Badda', lat: 23.7806, lng: 90.4265, x: 2000, y: -1500 },
  { code: 'GULSHAN_1', name: 'Gulshan 1', lat: 23.7806, lng: 90.4163, x: 1000, y: -1500 },
  { code: 'MOHAKHALI', name: 'Mohakhali', lat: 23.7781, lng: 90.4, x: -500, y: -1500 },
  { code: 'TEJGAON', name: 'Tejgaon', lat: 23.7639, lng: 90.393, x: -1500, y: -3500 },
  { code: 'FARMGATE', name: 'Farmgate', lat: 23.7577, lng: 90.3897, x: -1500, y: -4000 },
  { code: 'DHANMONDI', name: 'Dhanmondi', lat: 23.7461, lng: 90.3742, x: -3500, y: -5500 },
  { code: 'MOTIJHEEL', name: 'Motijheel', lat: 23.733, lng: 90.4172, x: 1000, y: -6500 },
]);

const BY_CODE = new Map(ZONES.map((z) => [z.code, z]));

export const ZONE_CODES = Object.freeze(ZONES.map((z) => z.code));

export function getZone(code) {
  const zone = BY_CODE.get(code);
  if (!zone) throw new Error(`Unknown zone: ${code}`);
  return zone;
}

export function isZone(code) {
  return BY_CODE.has(code);
}

/** Manhattan distance on the grid, in metres. Always a multiple of 500. */
export function distanceM(fromCode, toCode) {
  const a = getZone(fromCode);
  const b = getZone(toCode);
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
