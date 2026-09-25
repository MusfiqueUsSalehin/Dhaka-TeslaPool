import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { tripSchema, uuidParam } from './schemas.js';
import * as rides from '../services/rideService.js';

export const ridesRouter = Router();
ridesRouter.use(requireAuth, requireRole('PASSENGER'));

const requestSchema = tripSchema.and(z.object({ paymentMethod: z.enum(['CASH', 'TESLAPAY']).default('CASH') }));
const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().datetime({ offset: true }).optional(),
});
const cancelSchema = z.object({ reason: z.string().trim().max(200).optional() });

ridesRouter.post(
  '/',
  validate({ body: requestSchema }),
  asyncHandler(async (req, res) => {
    const ride = await rides.requestRide(req.user, req.valid.body);
    res.status(201).json({ data: ride });
  }),
);

ridesRouter.get(
  '/',
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    res.json({ data: await rides.listRides(req.user, req.valid.query) });
  }),
);

ridesRouter.get(
  '/active',
  asyncHandler(async (req, res) => {
    res.json({ data: await rides.getActiveRide(req.user) });
  }),
);

ridesRouter.get(
  '/:rideId',
  validate({ params: uuidParam('rideId') }),
  asyncHandler(async (req, res) => {
    res.json({ data: await rides.getRide(req.user, req.valid.params.rideId) });
  }),
);

ridesRouter.post(
  '/:rideId/cancel',
  validate({ params: uuidParam('rideId'), body: cancelSchema }),
  asyncHandler(async (req, res) => {
    const ride = await rides.cancelRide(req.user, req.valid.params.rideId, req.valid.body.reason || undefined);
    res.json({ data: ride });
  }),
);
