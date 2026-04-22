import express from 'express';
import { getSignals } from '../controllers/alphaController.js';
import { authenticate } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many requests' },
  standardHeaders: true, legacyHeaders: false,
});

router.get('/signals', limiter, authenticate, getSignals);

export default router;
