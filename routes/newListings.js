import express from 'express';
import { getCEXListings, getDEXListings, getCoinDetail, getCoinNews } from '../controllers/newListingsController.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many requests, please slow down' },
  standardHeaders: true, legacyHeaders: false,
});

router.get('/cex',         limiter, getCEXListings);
router.get('/dex',         limiter, getDEXListings);
router.get('/coin/:id',    limiter, getCoinDetail);
router.get('/news/:symbol', limiter, getCoinNews);

export default router;
