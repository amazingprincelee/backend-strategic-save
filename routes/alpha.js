import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { getAlphaSignals, getAlphaStats } from '../controllers/alphaController.js';

const router = express.Router();

// Stats are public (shown on dashboard card)
router.get('/stats', getAlphaStats);

// Signal list requires auth (gating logic is inside the controller)
router.get('/', authenticate, getAlphaSignals);

export default router;
