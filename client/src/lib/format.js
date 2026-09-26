/** Display helpers. Money arrives from the API as integer paisa + a formatted string. */
export function taka(paisa) {
  if (paisa === null || paisa === undefined) return '—';
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(paisa);
  return `${sign}৳${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

export function km(meters) {
  return `${(meters / 1000).toFixed(1)} km`;
}

export function time(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function dateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const RIDE_STATUS_LABEL = {
  REQUESTED: 'Waiting for a Tesla',
  MATCHED: 'Matched',
  DRIVER_ARRIVED: 'Driver arrived',
  STARTED: 'On the way',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const POOL_STATUS_LABEL = {
  OPEN: 'Collecting passengers',
  DRIVER_ARRIVED: 'At pickup',
  STARTED: 'Trip in progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const EVENT_LABEL = {
  RIDE_REQUESTED: 'Ride requested',
  RIDE_MATCHED: 'Matched to a Tesla',
  DRIVER_ARRIVED: 'Driver arrived at pickup',
  TRIP_STARTED: 'Trip started · fare locked',
  RIDE_COMPLETED: 'Dropped off',
  PAYMENT_CAPTURED: 'Payment captured',
  PAYMENT_FALLBACK_TO_CASH: 'TeslaPay failed · switched to cash',
  RIDE_CANCELLED: 'Cancelled',
  RIDE_NO_SHOW: 'Marked as no-show',
  POOL_OPENED: 'Pool opened',
  POOL_DRIVER_ARRIVED: 'Arrived at pickup',
  POOL_STARTED: 'Trip started',
  POOL_COMPLETED: 'Trip completed',
  POOL_CANCELLED: 'Pool cancelled',
};
