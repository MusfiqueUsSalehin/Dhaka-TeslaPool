import { describe, it, expect } from 'vitest';
import {
  canRideTransition,
  canPoolTransition,
  assertRideTransition,
  assertPassengerCanCancel,
} from '../../src/domain/stateMachine.js';

describe('ride state machine', () => {
  it('allows the happy path REQUESTED -> MATCHED -> DRIVER_ARRIVED -> STARTED -> COMPLETED', () => {
    const path = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED'];
    for (let i = 0; i < path.length - 1; i += 1) expect(canRideTransition(path[i], path[i + 1])).toBe(true);
  });

  it.each([
    ['REQUESTED', 'STARTED'], // cannot skip matching
    ['REQUESTED', 'COMPLETED'],
    ['MATCHED', 'STARTED'], // driver must arrive first
    ['STARTED', 'CANCELLED'], // a started ride ends with a drop-off
    ['COMPLETED', 'CANCELLED'], // terminal
    ['CANCELLED', 'MATCHED'], // terminal
    ['COMPLETED', 'STARTED'], // no going back
  ])('rejects %s -> %s', (from, to) => {
    expect(canRideTransition(from, to)).toBe(false);
    expect(() => assertRideTransition(from, to)).toThrowError(expect.objectContaining({ status: 409, code: 'INVALID_TRANSITION' }));
  });

  it('rejects unknown states', () => {
    expect(canRideTransition('TELEPORTED', 'COMPLETED')).toBe(false);
  });
});

describe('pool state machine', () => {
  it('allows OPEN -> DRIVER_ARRIVED -> STARTED -> COMPLETED and early cancellation', () => {
    expect(canPoolTransition('OPEN', 'DRIVER_ARRIVED')).toBe(true);
    expect(canPoolTransition('DRIVER_ARRIVED', 'STARTED')).toBe(true);
    expect(canPoolTransition('STARTED', 'COMPLETED')).toBe(true);
    expect(canPoolTransition('OPEN', 'CANCELLED')).toBe(true);
  });

  it('rejects starting before arriving and cancelling a started trip', () => {
    expect(canPoolTransition('OPEN', 'STARTED')).toBe(false);
    expect(canPoolTransition('STARTED', 'CANCELLED')).toBe(false);
  });
});

describe('passenger cancellation rules', () => {
  it('allows cancelling while REQUESTED or MATCHED', () => {
    expect(() => assertPassengerCanCancel('REQUESTED')).not.toThrow();
    expect(() => assertPassengerCanCancel('MATCHED')).not.toThrow();
  });

  it.each(['DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED'])('refuses once the ride is %s', (status) => {
    expect(() => assertPassengerCanCancel(status)).toThrowError(expect.objectContaining({ status: 409, code: 'CANNOT_CANCEL' }));
  });
});
