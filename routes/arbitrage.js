import express from 'express';
import {
  getArbitrageOpportunities,
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
 * @desc    Get current arbitrage opportunities
 * @access  Private
 * @query   minProfit, minVolume, coin
 */
router.get('/opportunities', getArbitrageOpportunities);

/**
 * @route   POST /api/arbitrage/execute
 * @desc    Execute an arbitrage trade
 * @access  Private
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