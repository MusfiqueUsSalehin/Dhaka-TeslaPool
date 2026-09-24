import { conflict } from '../lib/errors.js';

/**
 * Two state machines (see docs/architecture.md §4):
 *  - ride: one passenger's booking, including their own drop-off
 *  - pool: one Tesla trip shared by several rides
 * Services must call assertRideTransition / assertPoolTransition before writing a new
 * status, and must do so on a row they have locked, so the check cannot go stale.
 */
export const RIDE_STATUS = Object.freeze({
  REQUESTED: 'REQUESTED',
  MATCHED: 'MATCHED',
  DRIVER_ARRIVED: 'DRIVER_ARRIVED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

export const POOL_STATUS = Object.freeze({
  OPEN: 'OPEN',
  DRIVER_ARRIVED: 'DRIVER_ARRIVED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

const RIDE_TRANSITIONS = Object.freeze({
  REQUESTED: ['MATCHED', 'CANCELLED'],
  MATCHED: ['DRIVER_ARRIVED', 'CANCELLED'],
  DRIVER_ARRIVED: ['STARTED', 'CANCELLED'], // CANCELLED here only as a driver no-show
  STARTED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
});

const POOL_TRANSITIONS = Object.freeze({
  OPEN: ['DRIVER_ARRIVED', 'CANCELLED'],
  DRIVER_ARRIVED: ['STARTED', 'CANCELLED'],
  STARTED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
});

export const ACTIVE_RIDE_STATUSES = Object.freeze(['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED']);
export const ACTIVE_POOL_STATUSES = Object.freeze(['OPEN', 'DRIVER_ARRIVED', 'STARTED']);
/** Rides that occupy seats in a pool. */
export const SEATED_RIDE_STATUSES = Object.freeze(['MATCHED', 'DRIVER_ARRIVED', 'STARTED']);
/** A passenger may cancel only before the driver has arrived. */
export const PASSENGER_CANCELLABLE = Object.freeze(['REQUESTED', 'MATCHED']);

export function canRideTransition(from, to) {
  return RIDE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canPoolTransition(from, to) {
  return POOL_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertRideTransition(from, to) {
  if (!canRideTransition(from, to)) {
    throw conflict('INVALID_TRANSITION', `A ride cannot go from ${from} to ${to}`, { from, to });
  }
}

export function assertPoolTransition(from, to) {
  if (!canPoolTransition(from, to)) {
    throw conflict('INVALID_TRANSITION', `A pool cannot go from ${from} to ${to}`, { from, to });
  }
}

export function assertPassengerCanCancel(status) {
  if (!PASSENGER_CANCELLABLE.includes(status)) {
    const why =
      status === 'DRIVER_ARRIVED'
        ? 'The driver is already waiting at the pickup point; ask the driver to release you'
        : `A ${status.toLowerCase()} ride can no longer be cancelled`;
    throw conflict('CANNOT_CANCEL', why, { status });
  }
}
