import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { apiNotFound, errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { zonesRouter } from './routes/zones.routes.js';
import { faresRouter } from './routes/fares.routes.js';
import { ridesRouter } from './routes/rides.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.headers['x-request-id'] || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'info' : 'debug'),
    }),
  );
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/zones', zonesRouter);
  app.use('/api/fares', faresRouter);
  app.use('/api/rides', ridesRouter);
  app.use('/api', apiNotFound);

  if (env.CLIENT_DIST_DIR && fs.existsSync(env.CLIENT_DIST_DIR)) {
    const dist = path.resolve(env.CLIENT_DIST_DIR);
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    logger.info({ dist }, 'serving client build');
  }

  app.use(errorHandler);
  return app;
}