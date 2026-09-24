import { Router } from 'express';
import { ZONES } from '../domain/zones.js';

export const zonesRouter = Router();

zonesRouter.get('/', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ data: ZONES.map(({ code, name, lat, lng, x, y }) => ({ code, name, lat, lng, gridX: x, gridY: y })) });
});
