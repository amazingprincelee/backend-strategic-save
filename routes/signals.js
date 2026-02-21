import express from 'express';
import { getSignals, getStats } from '../controllers/signalController.js';

const router = express.Router();

// Public endpoints — no authentication required
router.get('/', getSignals);        // GET /api/signals?type=spot|futures
router.get('/stats', getStats);     // GET /api/signals/stats

export default router;
