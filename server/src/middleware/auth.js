import { SESSION_COOKIE, findUserById, verifyToken } from '../services/authService.js';
import { forbidden, unauthorized } from '../lib/errors.js';

/**
 * Accepts the JWT from the httpOnly session cookie (browser) or an
 * `Authorization: Bearer` header (curl / API clients). The user row is re-loaded on
 * every request so a deleted user or changed role takes effect immediately.
 */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization;
    const token = req.cookies?.[SESSION_COOKIE] || (header?.startsWith('Bearer ') ? header.slice(7) : null);
    if (!token) throw unauthorized();

    const claims = verifyToken(token);
    if (!claims?.sub) throw unauthorized('Your session has expired, please sign in again');

    const user = await findUserById(claims.sub);
    if (!user) throw unauthorized('Your session has expired, please sign in again');

    req.user = user;
    req.log = req.log.child({ userId: user.id, role: user.role });
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole = (role) => (req, _res, next) => {
  if (req.user?.role !== role) return next(forbidden(`This action is only for ${role.toLowerCase()}s`));
  return next();
};
