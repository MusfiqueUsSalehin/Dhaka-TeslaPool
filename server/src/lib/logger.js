import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Structured JSON logs (one line per event) in production so they can be searched;
 * pretty, coloured logs in development. Set LOG_LEVEL=debug to see every matching
 * decision and state transition the services make.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'tesla-pool-api' },
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'password', '*.password', 'passwordHash'],
    censor: '[redacted]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' } }
      : undefined,
});
