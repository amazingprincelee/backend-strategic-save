import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getPlatformStats,
  getAllUsers,
  updateUser,
  deleteUser,
  sendBroadcastNotification,
  sendBroadcastEmail,
  getSystemHealth,
  grantFreeTrial,
  getRevenueAnalytics,
  getUserAnalytics,
  getPlatformAnalytics,
  getRealAuditLogs,
  sendTargetedEmail,
  updateAnnouncement,
  getActiveAnnouncement,
} from '../controllers/adminController.js';
import { adminActivatePremium } from '../controllers/paymentController.js';
import { listTransactions, getTransactionStats, getTransactionDetail } from '../controllers/transactionController.js';
import Subscription from '../models/Subscription.js';
import AppSettings, { getSettings } from '../models/AppSettings.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { invalidatePaymentKeyCache } from '../services/payment/paymentKeys.js';
import User from '../models/User.js';
import PartnerEarning from '../models/PartnerEarning.js';
import PartnerWithdrawal from '../models/PartnerWithdrawal.js';
import emailService from '../utils/emailService.js';

const router = express.Router();

const adminLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: { success: false, message: 'Too many admin requests, please try again later' },
  standardHeaders: true, legacyHeaders: false
});

const adminActionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many admin actions, please try again later' },
  standardHeaders: true, legacyHeaders: false
});

const broadcastLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many broadcast attempts, please try again later' },
  standardHeaders: true, legacyHeaders: false
});

// ── Public routes (BEFORE auth middleware) ───────────────────────────────────
router.get('/announcement/active', getActiveAnnouncement);

// Public plan info — returns only safe, non-sensitive fields
router.get('/public-settings', async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({
      success: true,
      data: {
        premiumPriceUSD:    settings.premiumPriceUSD,
        premiumDurationDays: settings.premiumDurationDays,
        referralRewardPercent: settings.referralRewardPercent,
        referralRewardUSD: Math.round((settings.premiumPriceUSD * (settings.referralRewardPercent ?? 25) / 100) * 100) / 100,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── All routes below require admin auth ───────────────────────────────────────
router.use(authenticate);
router.use(requireAdmin);

// Stats
router.get('/stats',          adminLimiter,       getPlatformStats);

// Users — no validateQuery middleware; controller handles params directly
router.get('/users',          adminLimiter,       getAllUsers);
router.put('/users/:userId',  adminActionLimiter, updateUser);
router.delete('/users/:userId', adminActionLimiter, deleteUser);

// Broadcast
router.post('/broadcast/notification',    broadcastLimiter, sendBroadcastNotification);
router.post('/broadcast/email',           broadcastLimiter, sendBroadcastEmail);
router.post('/broadcast/targeted-email',  broadcastLimiter, sendTargetedEmail);

// Health
router.get('/health', adminLimiter, getSystemHealth);

// Audit log (new real one)
router.get('/audit', adminLimiter, getRealAuditLogs);

// Settings
router.get('/settings', adminLimiter, async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({ success: true, data: settings });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.put('/settings', adminActionLimiter, async (req, res) => {
  try {
    const allowed = [
      'activePaymentProvider', 'premiumPriceUSD', 'premiumDurationDays',
      'referralRewardPercent', 'freeSignalsPerDay', 'freeSignalMaxConfidence',
      'freeArbitrageLimit', 'freeArbitrageMaxProfit', 'maintenanceMode',
      'freeTrialDays', 'minWithdrawalAmount', 'trade4me',
    ];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const doc = await AppSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: { ...update, updatedBy: req.user._id } },
      { new: true, upsert: true }
    );
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Subscriptions
router.get('/subscriptions', adminLimiter, async (req, res) => {
  try {
    const limit    = Math.min(parseInt(req.query.limit) || 50, 200);
    const skip     = parseInt(req.query.skip) || 0;
    const filter   = {};
    if (req.query.status)   filter.status   = req.query.status;
    if (req.query.provider) filter.provider = req.query.provider;

    const [subs, total] = await Promise.all([
      Subscription.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Subscription.countDocuments(filter),
    ]);
    res.json({ success: true, data: subs, meta: { total, limit, skip } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Premium activation / free trial
router.post('/activate-premium', adminActionLimiter, adminActivatePremium);
router.post('/grant-trial',      adminActionLimiter, grantFreeTrial);

// Analytics
router.get('/analytics/revenue',  adminLimiter, getRevenueAnalytics);
router.get('/analytics/users',    adminLimiter, getUserAnalytics);
router.get('/analytics/platform', adminLimiter, getPlatformAnalytics);

// Payment API Keys — write-only (never returned in plain text in GET /settings)
router.get('/payment-keys/status', adminLimiter, async (req, res) => {
  try {
    const s = await getSettings();
    // Return only whether each key is configured, not the actual values
    res.json({
      success: true,
      data: {
        nowpayments:  { apiKey: !!s.nowpaymentsApiKey, ipnSecret: !!s.nowpaymentsIpnSecret },
        coinbase:     { apiKey: !!s.coinbaseApiKey, webhookSecret: !!s.coinbaseWebhookSecret },
        cryptopay:    { apiKey: !!s.cryptopayApiKey, apiSecret: !!s.cryptopayApiSecret, callbackSecret: !!s.cryptopayCallbackSecret },
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.put('/payment-keys', adminActionLimiter, async (req, res) => {
  try {
    const allowed = [
      'nowpaymentsApiKey', 'nowpaymentsIpnSecret',
      'coinbaseApiKey', 'coinbaseWebhookSecret',
      'cryptopayApiKey', 'cryptopayApiSecret', 'cryptopayCallbackSecret',
    ];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined && req.body[key] !== '') {
        update[key] = req.body[key];
      }
    }
    await AppSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: { ...update, updatedBy: req.user._id } },
      { new: true, upsert: true }
    );
    invalidatePaymentKeyCache();
    res.json({ success: true, message: 'Payment keys updated successfully' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Announcement
router.put('/announcement', adminActionLimiter, updateAnnouncement);

// Transactions
router.get('/transactions',       adminLimiter, listTransactions);
router.get('/transactions/stats', adminLimiter, getTransactionStats);
router.get('/transactions/:id',   adminLimiter, getTransactionDetail);

// ─── Partner Management ──────────────────────────────────────────────────────

// List all partners with earnings summary
router.get('/partners', adminLimiter, authenticate, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 30, search = '' } = req.query;
    const query = { role: 'partner' };
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { fullName: { $regex: search, $options: 'i' } },
      ];
    }
    const [partners, total] = await Promise.all([
      User.find(query)
        .select('email fullName role referral partnerEarnings createdAt subscription')
        .sort({ 'partnerEarnings.totalEarned': -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      User.countDocuments(query),
    ]);
    const enriched = await Promise.all(partners.map(async p => {
      const referredCount      = await User.countDocuments({ 'referral.referredBy': p.referral?.code });
      const pendingWithdrawals = await PartnerWithdrawal.countDocuments({ partnerId: p._id, status: 'pending' });
      return { ...p, referredCount, pendingWithdrawals };
    }));
    res.json({ success: true, data: enriched, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Grant partner role to a user
router.post('/partners/:userId/grant', adminActionLimiter, authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { role: 'partner' },
      { new: true }
    ).select('email fullName role partnerEarnings referral');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    try {
      await emailService.sendEmail(
        user.email,
        '🎉 You are now a SmartStrategy Partner!',
        `<p>Hi ${user.fullName || 'there'},</p>
         <p>Congratulations! You have been approved as a SmartStrategy Partner.</p>
         <p>Your referral link: <strong>${process.env.CLIENT_URL}/register?ref=${user.referral?.code}</strong></p>
         <p>You earn a commission on every payment made by users who sign up through your link — not just the first one.</p>
         <p><a href="${process.env.CLIENT_URL}/partner">View your partner dashboard →</a></p>`,
        `You are now a SmartStrategy Partner. Referral link: ${process.env.CLIENT_URL}/register?ref=${user.referral?.code}`
      );
    } catch (_) { /* non-critical */ }
    res.json({ success: true, data: user, message: 'Partner role granted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Revoke partner role
router.post('/partners/:userId/revoke', adminActionLimiter, authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const newRole = user.subscription?.status === 'active' ? 'premium' : 'user';
    await User.findByIdAndUpdate(req.params.userId, { role: newRole });
    res.json({ success: true, message: `Partner role revoked. User is now '${newRole}'` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// List all partner withdrawal requests
router.get('/partners/withdrawals', adminLimiter, authenticate, requireAdmin, async (req, res) => {
  try {
    const { status = 'pending', page = 1, limit = 30 } = req.query;
    const query = status === 'all' ? {} : { status };
    const [withdrawals, total] = await Promise.all([
      PartnerWithdrawal.find(query)
        .populate('partnerId', 'email fullName referral partnerEarnings')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      PartnerWithdrawal.countDocuments(query),
    ]);
    res.json({ success: true, data: withdrawals, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Approve, reject, or mark a withdrawal as paid
router.put('/partners/withdrawals/:id', adminActionLimiter, authenticate, requireAdmin, async (req, res) => {
  try {
    const { action, adminNote = '', txHash = '' } = req.body;
    if (!['approve', 'reject', 'mark_paid'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }
    const withdrawal = await PartnerWithdrawal.findById(req.params.id).populate('partnerId');
    if (!withdrawal) return res.status(404).json({ success: false, message: 'Withdrawal not found' });

    if (action === 'reject') {
      await User.findByIdAndUpdate(withdrawal.partnerId._id, {
        $inc: { 'partnerEarnings.pendingBalance': withdrawal.amount },
      });
      Object.assign(withdrawal, { status: 'rejected', adminNote, processedAt: new Date() });
    } else if (action === 'approve') {
      Object.assign(withdrawal, { status: 'approved', adminNote, processedAt: new Date() });
    } else if (action === 'mark_paid') {
      await User.findByIdAndUpdate(withdrawal.partnerId._id, {
        $inc: { 'partnerEarnings.totalWithdrawn': withdrawal.amount },
      });
      await PartnerEarning.updateMany(
        { partnerId: withdrawal.partnerId._id, status: 'pending' },
        { status: 'paid', paidAt: new Date() }
      );
      Object.assign(withdrawal, { status: 'paid', txHash, adminNote, processedAt: new Date() });
      try {
        const partner = withdrawal.partnerId;
        await emailService.sendEmail(
          partner.email,
          `✅ Withdrawal of $${withdrawal.amount} sent!`,
          `<p>Hi ${partner.fullName || 'there'},</p>
           <p>Your withdrawal of <strong>$${withdrawal.amount}</strong> has been sent to your wallet.</p>
           ${txHash ? `<p>TX hash: <code>${txHash}</code></p>` : ''}
           <p><a href="${process.env.CLIENT_URL}/partner">View your partner dashboard →</a></p>`,
          `Your withdrawal of $${withdrawal.amount} has been sent.`
        );
      } catch (_) { /* non-critical */ }
    }

    await withdrawal.save();
    res.json({ success: true, data: withdrawal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
