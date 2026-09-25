import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { tripSchema } from './schemas.js';
import { estimateFare, FARE_RULES } from '../domain/fare.js';
import { formatTaka } from '../lib/money.js';

export const faresRouter = Router();

const show = (f) => ({ ...f, display: { total: formatTaka(f.totalPaisa), discount: formatTaka(f.discountPaisa) } });

/** Public: lets the request form show "৳70.00 solo / ৳60.00 if pooled" before booking. */
faresRouter.get('/estimate', validate({ query: tripSchema }), (req, res) => {
  const e = estimateFare(req.valid.query);
  res.json({ data: { distanceM: e.distanceM, solo: show(e.solo), pooled: show(e.pooled), rules: FARE_RULES } });
});
