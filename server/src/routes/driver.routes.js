import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uuidParam, zoneCode } from './schemas.js';
import * as drivers from '../services/driverService.js';
import * as pools from '../services/poolService.js';

/** /api/driver — the driver's availability, request feed and accept command. */
export const driverRouter = Router();
driverRouter.use(requireAuth, requireRole('DRIVER'));

driverRouter.get('/me', asyncHandler(async (req, res) => res.json({ data: await drivers.getDashboard(req.user) })));

driverRouter.post(
  '/online',
  validate({ body: z.object({ zone: zoneCode }) }),
  asyncHandler(async (req, res) => res.json({ data: await drivers.goOnline(req.user, req.valid.body.zone) })),
);

driverRouter.post('/offline', asyncHandler(async (req, res) => res.json({ data: await drivers.goOffline(req.user) })));

driverRouter.get('/requests', asyncHandler(async (req, res) => res.json({ data: await drivers.listRelevantRequests(req.user) })));

driverRouter.post(
  '/requests/:rideId/accept',
  validate({ params: uuidParam('rideId') }),
  asyncHandler(async (req, res) => res.json({ data: await drivers.acceptRequest(req.user, req.valid.params.rideId) })),
);

/** /api/pools — the Tesla trip lifecycle and history. */
export const poolsRouter = Router();
poolsRouter.use(requireAuth, requireRole('DRIVER'));

const poolParams = uuidParam('poolId');
const poolRideParams = z.object({ poolId: z.string().uuid('Invalid id'), rideId: z.string().uuid('Invalid id') });

poolsRouter.get(
  '/',
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }) }),
  asyncHandler(async (req, res) => res.json({ data: await pools.listPools(req.user, req.valid.query) })),
);

poolsRouter.get(
  '/:poolId',
  validate({ params: poolParams }),
  asyncHandler(async (req, res) => res.json({ data: await pools.getPool(req.user, req.valid.params.poolId) })),
);

poolsRouter.post(
  '/:poolId/arrive',
  validate({ params: poolParams }),
  asyncHandler(async (req, res) => res.json({ data: await pools.markArrived(req.user, req.valid.params.poolId) })),
);

poolsRouter.post(
  '/:poolId/start',
  validate({ params: poolParams }),
  asyncHandler(async (req, res) => res.json({ data: await pools.startTrip(req.user, req.valid.params.poolId) })),
);

poolsRouter.post(
  '/:poolId/rides/:rideId/dropoff',
  validate({ params: poolRideParams }),
  asyncHandler(async (req, res) => res.json({ data: await pools.dropOff(req.user, req.valid.params.poolId, req.valid.params.rideId) })),
);

poolsRouter.post(
  '/:poolId/rides/:rideId/no-show',
  validate({ params: poolRideParams }),
  asyncHandler(async (req, res) => res.json({ data: await pools.markNoShow(req.user, req.valid.params.poolId, req.valid.params.rideId) })),
);
