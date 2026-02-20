import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as ctrl from '../controllers/exchangeAccountController.js';

const router = express.Router();

// Public - no auth needed
router.get('/supported', ctrl.getSupportedExchanges);

// Authenticated routes
router.use(authenticate);
router.get('/', ctrl.listAccounts);
router.post('/', ctrl.addAccount);
router.put('/:id', ctrl.updateAccount);
router.delete('/:id', ctrl.deleteAccount);
router.post('/:id/test', ctrl.testAccount);

export default router;
