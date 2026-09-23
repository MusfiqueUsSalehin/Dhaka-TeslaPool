import { AppError } from '../lib/errors.js';

/** 404 for unknown /api routes (the SPA fallback handles everything else). */
export function apiNotFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` } });
}

/**
 * Single place where errors become HTTP responses.
 * - AppError: expected, returned as-is (and logged at debug/info).
 * - Postgres constraint violations that slipped past the services: mapped to 409 so a
 *   race that the DB caught is reported as a conflict, not a crash.
 * - Anything else: logged with stack, returned as a generic 500 (no internals leaked).
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const log = req.log ?? console;

  if (err instanceof AppError) {
    log[err.status >= 500 ? 'error' : 'info']({ code: err.code, status: err.status }, err.message);
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }

  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } });
  }

  // 23505 unique_violation, 23514 check_violation, 23503 foreign_key_violation
  if (err?.code === '23505' || err?.code === '23514') {
    log.warn({ pgCode: err.code, constraint: err.constraint }, 'database constraint rejected a write');
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'This change conflicts with the current state, please refresh', details: { constraint: err.constraint } },
    });
  }

  log.error({ err }, 'unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side' } });
}
