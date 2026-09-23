/**
 * Errors the API is expected to return. Anything that is NOT an AppError is treated
 * as a bug: logged with its stack and returned to the client as a generic 500.
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
export const validationError = (details) => new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details);
export const unauthorized = (message = 'Please sign in') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You are not allowed to do this') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
export const serviceUnavailable = (message) => new AppError(503, 'SERVICE_UNAVAILABLE', message);
