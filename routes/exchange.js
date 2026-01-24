import express from 'express';
import {
  syncExchangesFromCCXT,
  getAllExchanges,
  getArbitrageExchanges,
  updateExchange,
  toggleArbitrageExchange,
  bulkUpdateArbitrageExchanges,
  getExchangeStats
} from '../controllers/exchangeController.js';

const router = express.Router();

// Public routes
router.get('/', getAllExchanges);
router.get('/arbitrage', getArbitrageExchanges);
router.get('/stats', getExchangeStats);

// Admin routes (should add auth middleware in production)
router.post('/sync', syncExchangesFromCCXT);
router.put('/:exchangeId', updateExchange);
router.patch('/:exchangeId/toggle-arbitrage', toggleArbitrageExchange);
router.post('/bulk-update', bulkUpdateArbitrageExchanges);

export default router;
