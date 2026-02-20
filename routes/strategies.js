import express from 'express';
import { getStrategyCatalog, getStrategyById } from '../controllers/strategyController.js';

const router = express.Router();

// Public - no auth needed
router.get('/', getStrategyCatalog);
router.get('/:id', getStrategyById);

export default router;
