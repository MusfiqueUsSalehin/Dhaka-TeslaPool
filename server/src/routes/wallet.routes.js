import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { TOPUP_LIMITS, getWallet, topUp } from '../services/walletService.js';

export const walletRouter = Router();
walletRouter.use(requireAuth);

// Both roles have a wallet: passengers pay from it, Jashim receives TeslaPay fares into it.
walletRouter.get('/', asyncHandler(async (req, res) => res.json({ data: await getWallet(req.user) })));

const topUpSchema = z.object({
  amountPaisa: z
    .number()
    .int('Amount must be whole paisa')
    .min(TOPUP_LIMITS.MIN_PAISA, 'Minimum top-up is ৳10')
    .max(TOPUP_LIMITS.MAX_PAISA, 'Maximum top-up is ৳5,000'),
});

// Simulated: no payment gateway, the money simply appears (and is recorded in the ledger).
walletRouter.post(
  '/topup',
  requireRole('PASSENGER'),
  validate({ body: topUpSchema }),
  asyncHandler(async (req, res) => res.json({ data: await topUp(req.user, req.valid.body.amountPaisa) })),
);
