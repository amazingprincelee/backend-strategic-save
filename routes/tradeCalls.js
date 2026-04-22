import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  getPublicCalls, getStats,
  adminCreateCall, adminUpdateCall, adminDeleteCall,
} from '../controllers/tradeCallController.js';

const router  = express.Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/',       limiter, getPublicCalls);
router.get('/stats',  limiter, getStats);

// ── Admin ─────────────────────────────────────────────────────────────────────
router.post('/',         limiter, authenticate, requireAdmin, adminCreateCall);
router.put('/:id',       limiter, authenticate, requireAdmin, adminUpdateCall);
router.delete('/:id',    limiter, authenticate, requireAdmin, adminDeleteCall);

export default router;
