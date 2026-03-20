import express from 'express';
import { optionalAuth } from '../middleware/auth.js';
import {
  fetchExchanges,
  getArbitrageOpportunities,
  refreshArbitrageOpportunities,
  getArbitrageStatus,
  updateEnabledExchanges,
  getEnabledExchanges,
  getPastOpportunities,
  getPastOpportunitiesSummary,
} from '../controllers/arbitragecontroller.js';
import {
  getTriangularOpportunities,
  getTriangularHistory,
  getTriangularSummary,
} from '../controllers/triangularArbitrageController.js';

const router = express.Router();

// Get all available exchanges from CCXT
router.get('/fetch-exchanges', fetchExchanges);

// Get cached arbitrage opportunities — optionalAuth so free-tier limits apply
router.get('/fetch-opportunity', optionalAuth, getArbitrageOpportunities);

// Get stored significant opportunities (≥0.20% net profit) — history + monitoring
// ?status=all|active|cleared  &limit=100
router.get('/past-opportunities', optionalAuth, getPastOpportunities);

// Aggregated summary stats for stat cards (total, active, cleared, best/avg profit)
router.get('/past-opportunities/summary', getPastOpportunitiesSummary);

// Get service status
router.get('/status', getArbitrageStatus);

// Get currently enabled exchanges for scanning
router.get('/exchanges', getEnabledExchanges);

// Update enabled exchanges for scanning
router.put('/exchanges', updateEnabledExchanges);

// Manual refresh (use sparingly - optional endpoint)
router.post('/refresh', refreshArbitrageOpportunities);

// ── Triangular Arbitrage ──────────────────────────────────────────────────────
router.get('/triangular',         optionalAuth, getTriangularOpportunities);
router.get('/triangular/history', optionalAuth, getTriangularHistory);
router.get('/triangular/summary', getTriangularSummary);

export default router;
