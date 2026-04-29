import express from 'express';
import { getSignals } from '../controllers/alphaController.js';
import { authenticate } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';
import { getRecentUpbitListings } from '../services/UpbitListingService.js';
import { getNewsAlerts } from '../services/CryptoPanicAlertService.js';

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many requests' },
  standardHeaders: true, legacyHeaders: false,
});

router.get('/signals', limiter, authenticate, getSignals);

// GET /api/alpha/feed — Upbit listings + news catalysts (shared 5-min cache)
router.get('/feed', limiter, authenticate, async (req, res) => {
  try {
    const [upbitListings, newsAlerts] = await Promise.allSettled([
      getRecentUpbitListings(),
      getNewsAlerts(),
    ]);

    res.json({
      success: true,
      data: {
        upbitListings: upbitListings.status === 'fulfilled' ? upbitListings.value : [],
        newsAlerts:    newsAlerts.status    === 'fulfilled' ? newsAlerts.value    : [],
      },
    });
  } catch (err) {
    console.error('[Alpha] feed error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
