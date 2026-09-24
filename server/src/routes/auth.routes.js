import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { SESSION_COOKIE, login, signToken, signUpPassenger, toPublicUser } from '../services/authService.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again in a few minutes' } },
});

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^\+?88/, ''))
  .pipe(z.string().regex(/^01[3-9]\d{8}$/, 'Use a Bangladeshi mobile number like 01711000002'));

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(60),
  phone,
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
});
const loginSchema = z.object({ phone, password: z.string().min(1, 'Password is required').max(72) });

function setSessionCookie(res, user) {
  res.cookie(SESSION_COOKIE, signToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

authRouter.post(
  '/signup',
  authLimiter,
  validate({ body: signupSchema }),
  asyncHandler(async (req, res) => {
    const user = await signUpPassenger(req.valid.body);
    setSessionCookie(res, user);
    res.status(201).json({ data: { user: toPublicUser(user) } });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const user = await login(req.valid.body);
    setSessionCookie(res, user);
    res.json({ data: { user: toPublicUser(user) } });
  }),
);

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ data: { ok: true } });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ data: { user: toPublicUser(req.user) } });
});