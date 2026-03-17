import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { getAlphaSignals, getAlphaStats, toggleFavorite, getFavorites, analyzeAlphaSignal, getLivePrices } from '../controllers/alphaController.js';

const router = express.Router();

// Stats are public (shown on dashboard card)
router.get('/stats', getAlphaStats);

// Live prices for displayed symbols (auth required)
router.get('/live-prices', authenticate, getLivePrices);

// Favorites (auth required)
router.get('/favorites',       authenticate, getFavorites);
router.post('/favorite/:id',   authenticate, toggleFavorite);

// Deep analysis for a single signal (premium only)
router.get('/analyze/:id', authenticate, analyzeAlphaSignal);

// Signal list requires auth (gating logic is inside the controller)
router.get('/', authenticate, getAlphaSignals);

export default router;
