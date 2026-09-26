import { api } from './client.js';

/** One function per endpoint, so components never build URLs themselves. */
export const authApi = {
  me: () => api('/auth/me'),
  login: (phone, password) => api('/auth/login', { method: 'POST', body: { phone, password } }),
  signup: (input) => api('/auth/signup', { method: 'POST', body: input }),
  logout: () => api('/auth/logout', { method: 'POST' }),
};

export const metaApi = {
  zones: () => api('/zones'),
  estimate: ({ pickup, dropoff, seats }) => api('/fares/estimate', { query: { pickup, dropoff, seats } }),
};

export const ridesApi = {
  request: (input) => api('/rides', { method: 'POST', body: input }),
  active: () => api('/rides/active'),
  list: () => api('/rides'),
  get: (id) => api(`/rides/${id}`),
  cancel: (id, reason) => api(`/rides/${id}/cancel`, { method: 'POST', body: reason ? { reason } : {} }),
};

export const walletApi = {
  get: () => api('/wallet'),
  topUp: (amountPaisa) => api('/wallet/topup', { method: 'POST', body: { amountPaisa } }),
};

export const driverApi = {
  me: () => api('/driver/me'),
  online: (zone) => api('/driver/online', { method: 'POST', body: { zone } }),
  offline: () => api('/driver/offline', { method: 'POST' }),
  requests: () => api('/driver/requests'),
  accept: (rideId) => api(`/driver/requests/${rideId}/accept`, { method: 'POST' }),
  pools: () => api('/pools'),
  pool: (id) => api(`/pools/${id}`),
  arrive: (poolId) => api(`/pools/${poolId}/arrive`, { method: 'POST' }),
  start: (poolId) => api(`/pools/${poolId}/start`, { method: 'POST' }),
  dropOff: (poolId, rideId) => api(`/pools/${poolId}/rides/${rideId}/dropoff`, { method: 'POST' }),
  noShow: (poolId, rideId) => api(`/pools/${poolId}/rides/${rideId}/no-show`, { method: 'POST' }),
};
