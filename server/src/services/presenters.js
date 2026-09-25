import { calculateFare, isPooled } from '../domain/fare.js';
import { getZone } from '../domain/zones.js';
import { formatTaka } from '../lib/money.js';

/**
 * Turn DB rows into API shapes. Money goes out as integer paisa (for code) plus a
 * formatted string (for humans); nothing here does database work.
 */
export const zoneRef = (code) => (code ? { code, name: getZone(code).name } : null);

function withDisplay(f) {
  return {
    ...f,
    display: {
      base: formatTaka(f.basePaisa),
      distance: formatTaka(f.distancePaisa),
      discount: formatTaka(f.discountPaisa),
      total: formatTaka(f.totalPaisa),
    },
  };
}

/**
 * - FINAL: locked at trip start, read from the ride row.
 * - NOT_CHARGED: cancelled before the trip started.
 * - ESTIMATE: live, based on how many bookings share the pool right now.
 */
export function presentFare(ride, bookingsInPool = 0) {
  if (ride.fare_total_paisa !== null && ride.fare_total_paisa !== undefined) {
    return {
      status: 'FINAL',
      current: withDisplay({
        distanceM: ride.distance_m,
        seats: ride.seats,
        pooled: ride.pooled,
        basePaisa: ride.fare_base_paisa,
        distancePaisa: ride.fare_distance_paisa,
        discountPaisa: ride.fare_discount_paisa,
        totalPaisa: ride.fare_total_paisa,
      }),
    };
  }
  if (ride.status === 'CANCELLED') return { status: 'NOT_CHARGED' };

  const solo = calculateFare({ distanceM: ride.distance_m, seats: ride.seats, pooled: false });
  const pooled = calculateFare({ distanceM: ride.distance_m, seats: ride.seats, pooled: true });
  const current = ride.pool_id && isPooled(bookingsInPool) ? pooled : solo;
  return { status: 'ESTIMATE', current: withDisplay(current), solo: withDisplay(solo), pooled: withDisplay(pooled) };
}

/** Base query for a ride with its pool, Tesla and driver. Used by passenger endpoints. */
export function rideWithPoolQuery(q) {
  return q('rides as r')
    .leftJoin('pools as p', 'p.id', 'r.pool_id')
    .leftJoin('vehicles as v', 'v.id', 'p.vehicle_id')
    .leftJoin('users as d', 'd.id', 'p.driver_id')
    .select(
      'r.*',
      'p.status as pool_status',
      'p.seats_taken as pool_seats_taken',
      'p.capacity as pool_capacity',
      'v.name as vehicle_name',
      'v.plate as vehicle_plate',
      'd.name as driver_name',
      'd.phone as driver_phone',
      q.raw(
        `(SELECT count(*)::int FROM rides r2 WHERE r2.pool_id = r.pool_id
            AND r2.status IN ('MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED')) AS pool_bookings`,
      ),
    );
}

/**
 * What a passenger sees about their own ride. Other passengers in the pool are shown
 * only as a count — never their names, destinations or fares.
 */
export function presentRideForPassenger(row) {
  return {
    id: row.id,
    status: row.status,
    pickup: zoneRef(row.pickup_zone),
    dropoff: zoneRef(row.dropoff_zone),
    seats: row.seats,
    distanceM: row.distance_m,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    fare: presentFare(row, row.pool_bookings ?? 0),
    pool: row.pool_id
      ? {
          id: row.pool_id,
          status: row.pool_status,
          seatsTaken: row.pool_seats_taken,
          capacity: row.pool_capacity,
          otherBookings: Math.max(0, (row.pool_bookings ?? 1) - 1),
          vehicle: { name: row.vehicle_name, plate: row.vehicle_plate },
          driver: { name: row.driver_name, phone: row.driver_phone },
        }
      : null,
    cancelReason: row.cancel_reason,
    timestamps: {
      requestedAt: row.requested_at,
      matchedAt: row.matched_at,
      arrivedAt: row.arrived_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
    },
  };
}

/** What a driver sees about a passenger in their pool (needs fare to collect cash). */
export function presentRideForDriver(row) {
  return {
    id: row.id,
    status: row.status,
    passenger: { name: row.passenger_name, phone: row.passenger_phone },
    pickup: zoneRef(row.pickup_zone),
    dropoff: zoneRef(row.dropoff_zone),
    seats: row.seats,
    distanceM: row.distance_m,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    fare: presentFare(row, row.pool_bookings ?? 0),
    cancelReason: row.cancel_reason,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
  };
}
