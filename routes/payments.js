import express from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import * as ctrl from '../controllers/paymentController.js';

const router = express.Router();

// ── Authenticated user routes ──────────────────────────────────────────────────
router.use('/checkout', authenticate);
router.post('/checkout', ctrl.createCheckout);
router.get('/status',    authenticate, ctrl.getSubscriptionStatus);

// ── Webhooks — NO auth (provider calls these directly) ─────────────────────────
// Must receive raw body for signature verification — handled in server.js
router.post('/webhook/coinbase',     ctrl.coinbaseWebhook);
router.post('/webhook/nowpayments',  ctrl.nowpaymentsWebhook);
router.post('/webhook/cryptopay',    ctrl.cryptopayWebhook);

// ── Admin ──────────────────────────────────────────────────────────────────────
router.post('/admin/activate', authenticate, requireAdmin, ctrl.adminActivatePremium);

export default router;
