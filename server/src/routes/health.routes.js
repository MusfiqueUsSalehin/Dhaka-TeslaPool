import { Router } from 'express';
import { db } from '../db/knex.js';

export const healthRouter = Router();

/**
 * Liveness + readiness in one: 200 only if the database answers.
 * Docker's HEALTHCHECK and the hosting platform both poll this.
 */
healthRouter.get('/', async (req, res) => {
  const started = Date.now();
  try {
    await db.raw('select 1');
    res.json({ data: { status: 'ok', db: 'ok', dbLatencyMs: Date.now() - started, uptimeS: Math.round(process.uptime()) } });
  } catch (err) {
    req.log.error({ err }, 'health check: database unreachable');
    res.status(503).json({ data: { status: 'degraded', db: 'unreachable' } });
  }
});
