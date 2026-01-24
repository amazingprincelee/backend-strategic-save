import express from 'express';
import {
  getUserSettings,
  updateArbitrageSettings,
  updateVaultSettings,
  updateUISettings,
  updateSelectedExchanges,
  resetSettings,
  getDefaultArbitrageConfig
} from '../controllers/settingsController.js';

const router = express.Router();

// Public route for default config
router.get('/defaults/arbitrage', getDefaultArbitrageConfig);

// User settings routes (should add auth middleware)
router.get('/', getUserSettings);
router.get('/:userId', getUserSettings);

// Update specific sections
router.put('/arbitrage', updateArbitrageSettings);
router.put('/:userId/arbitrage', updateArbitrageSettings);

router.put('/vault', updateVaultSettings);
router.put('/:userId/vault', updateVaultSettings);

router.put('/ui', updateUISettings);
router.put('/:userId/ui', updateUISettings);

// Exchange selection
router.put('/exchanges', updateSelectedExchanges);
router.put('/:userId/exchanges', updateSelectedExchanges);

// Reset settings
router.post('/reset/:section', resetSettings);
router.post('/:userId/reset/:section', resetSettings);

export default router;
