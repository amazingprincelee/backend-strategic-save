import express from 'express';
import {
  getArbitrageOpportunities,
  refreshArbitrageOpportunities,
  executeArbitrageTrade,
  getExchangeStatus,
  getArbitrageHistory,
  getArbitrageStats
} from '../controllers/arbitragecontroller.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All arbitrage routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/arbitrage/opportunities
 * @desc    Get current arbitrage opportunities (uses cache for 10 seconds)
 * @access  Private
 * @query   minProfit, minVolume, coin
 * 
 * Uses CCXT to fetch live data from exchanges via FREE public APIs
 * NO API KEYS NEEDED for viewing opportunities
 */
router.get('/opportunities', getArbitrageOpportunities);

/**
 * @route   POST /api/arbitrage/refresh
 * @desc    Force refresh arbitrage opportunities (clears cache)
 * @access  Private
 * @query   minProfit, minVolume, coin
 * 
 * Bypasses cache and fetches fresh data from all exchanges
 */
router.post('/refresh', refreshArbitrageOpportunities);

/**
 * @route   POST /api/arbitrage/execute
 * @desc    Execute an arbitrage trade
 * @access  Private
 * 
 * REQUIRES user's exchange API keys to be set up
 * User API keys are stored encrypted in database
 */
router.post('/execute', executeArbitrageTrade);

/**
 * @route   GET /api/arbitrage/exchanges/status
 * @desc    Get status of all exchanges (API connectivity, transfer status)
 * @access  Private
 */
router.get('/exchanges/status', getExchangeStatus);

/**
 * @route   GET /api/arbitrage/history
 * @desc    Get user's arbitrage trade history
 * @access  Private
 * @query   limit, page
 */
router.get('/history', getArbitrageHistory);

/**
 * @route   GET /api/arbitrage/stats
 * @desc    Get user's arbitrage statistics
 * @access  Private
 */
router.get('/stats', getArbitrageStats);

export default router;