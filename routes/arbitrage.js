import express from 'express';
import { 
  fetchExchanges, 
  getArbitrageOpportunities,
  refreshArbitrageOpportunities,
  getArbitrageStatus
} from '../controllers/arbitragecontroller.js';

const router = express.Router();

// Get all available exchanges
router.get('/fetch-exchanges', fetchExchanges);

// Get cached arbitrage opportunities (recommended endpoint)
router.get('/fetch-opportunity', getArbitrageOpportunities);

// Get service status
router.get('/status', getArbitrageStatus);

// Manual refresh (use sparingly - optional endpoint)
router.post('/refresh', refreshArbitrageOpportunities);

export default router;