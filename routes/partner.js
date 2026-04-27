/**
 * Partner routes — /api/partner/*
 * All routes require authenticate + requirePartner middleware.
 */
import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import PartnerEarning from '../models/PartnerEarning.js';
import PartnerWithdrawal from '../models/PartnerWithdrawal.js';
import Subscription from '../models/Subscription.js';
import { authenticate } from '../middleware/auth.js';
import { requirePartner } from '../middleware/auth.js';
import { getSettings } from '../models/AppSettings.js';

const router = express.Router();

// All partner routes require auth + partner role
router.use(authenticate, requirePartner);

// ─── GET /api/partner/summary ─────────────────────────────────────────────────
// Dashboard overview stats
router.get('/summary', async (req, res) => {
  try {
    const partnerId = req.user._id;
    const partner   = req.user;
    const settings  = await getSettings();

    // Count referred users
    const referredUsers = await User.find({
      'referral.referredBy': partner.referral?.code,
    }).select('_id email fullName subscription createdAt role');

    const referredIds = referredUsers.map(u => u._id);

    // Earnings summary
    const earnings = await PartnerEarning.aggregate([
      { $match: { partnerId: new mongoose.Types.ObjectId(partnerId) } },
      { $group: {
          _id: null,
          totalEarned:  { $sum: '$commissionUSD' },
          thisMonth:    { $sum: { $cond: [
            { $gte: ['$createdAt', new Date(new Date().setDate(1))] },
            '$commissionUSD', 0
          ]}},
          count: { $sum: 1 },
        }
      },
    ]);
    const earningsSummary = earnings[0] || { totalEarned: 0, thisMonth: 0, count: 0 };

    // Referred users breakdown
    const active  = referredUsers.filter(u => u.subscription?.status === 'active').length;
    const trial   = referredUsers.filter(u => u.subscription?.status === 'trial').length;
    const free    = referredUsers.filter(u => !['active','trial'].includes(u.subscription?.status)).length;

    // Pending withdrawal requests
    const pendingWithdrawals = await PartnerWithdrawal.countDocuments({ partnerId, status: 'pending' });

    // Conversion rate
    const conversionRate = referredUsers.length > 0
      ? Math.round((active / referredUsers.length) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        referralCode: partner.referral?.code,
        referralLink: `${process.env.CLIENT_URL}/register?ref=${partner.referral?.code}`,
        commissionRate: settings.partnerCommissionPercent ?? 35,
        minWithdrawal: settings.partnerMinWithdrawal ?? 20,
        pendingBalance:  partner.partnerEarnings?.pendingBalance ?? 0,
        totalEarned:     partner.partnerEarnings?.totalEarned ?? 0,
        totalWithdrawn:  partner.partnerEarnings?.totalWithdrawn ?? 0,
        thisMonthEarned: earningsSummary.thisMonth,
        totalPayments:   earningsSummary.count,
        referredCount:   referredUsers.length,
        activeCount:     active,
        trialCount:      trial,
        freeCount:       free,
        conversionRate,
        pendingWithdrawals,
      },
    });
  } catch (err) {
    console.error('[Partner] summary error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── GET /api/partner/referrals ───────────────────────────────────────────────
// Full list of referred users with their subscription activity
router.get('/referrals', async (req, res) => {
  try {
    const partner = req.user;
    const { page = 1, limit = 50 } = req.query;

    const referredUsers = await User.find({
      'referral.referredBy': partner.referral?.code,
    })
      .select('email fullName subscription createdAt role partnerEarnings referral')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await User.countDocuments({ 'referral.referredBy': partner.referral?.code });

    // For each referred user, fetch their payment attempts (subscriptions)
    const enriched = await Promise.all(referredUsers.map(async u => {
      const subs = await Subscription.find({ userId: u._id })
        .select('status amountUSD completedAt planStartAt planEndAt provider createdAt')
        .sort({ createdAt: -1 })
        .limit(5);

      const totalPaid = subs
        .filter(s => s.status === 'completed')
        .reduce((sum, s) => sum + (s.amountUSD || 0), 0);

      // Commission earned from this specific user
      const earned = await PartnerEarning.aggregate([
        { $match: { partnerId: new mongoose.Types.ObjectId(partner._id), referredUserId: u._id } },
        { $group: { _id: null, total: { $sum: '$commissionUSD' } } },
      ]);

      return {
        _id:          u._id,
        email:        u.email,
        fullName:     u.fullName,
        joinedAt:     u.createdAt,
        subscription: {
          status:    u.subscription?.status,
          expiresAt: u.subscription?.expiresAt,
          startedAt: u.subscription?.startedAt,
          plan:      u.subscription?.plan,
        },
        paymentHistory: subs,
        totalPaid,
        commissionEarned: earned[0]?.total ?? 0,
        paymentAttempts: subs.length,
      };
    }));

    res.json({ success: true, data: enriched, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error('[Partner] referrals error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── GET /api/partner/earnings ────────────────────────────────────────────────
// Paginated commission earning history
router.get('/earnings', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const partnerId = req.user._id;

    const [earnings, total] = await Promise.all([
      PartnerEarning.find({ partnerId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      PartnerEarning.countDocuments({ partnerId }),
    ]);

    res.json({ success: true, data: earnings, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error('[Partner] earnings error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── GET /api/partner/withdrawals ─────────────────────────────────────────────
router.get('/withdrawals', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const partnerId = req.user._id;

    const [withdrawals, total] = await Promise.all([
      PartnerWithdrawal.find({ partnerId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      PartnerWithdrawal.countDocuments({ partnerId }),
    ]);

    res.json({ success: true, data: withdrawals, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error('[Partner] withdrawals error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── POST /api/partner/withdrawals ───────────────────────────────────────────
// Request a withdrawal
router.post('/withdrawals', async (req, res) => {
  try {
    const partner  = await User.findById(req.user._id);
    const settings = await getSettings();
    const { amount, walletAddress, network = 'TRC20' } = req.body;

    const minAmount   = settings.partnerMinWithdrawal ?? 20;
    const available   = partner.partnerEarnings?.pendingBalance ?? 0;

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }
    if (Number(amount) < minAmount) {
      return res.status(400).json({ success: false, message: `Minimum withdrawal is $${minAmount}` });
    }
    if (Number(amount) > available) {
      return res.status(400).json({ success: false, message: `Insufficient balance. Available: $${available.toFixed(2)}` });
    }
    if (!walletAddress || walletAddress.trim().length < 10) {
      return res.status(400).json({ success: false, message: 'Valid wallet address is required' });
    }

    // Check no pending withdrawal already
    const pending = await PartnerWithdrawal.findOne({ partnerId: partner._id, status: 'pending' });
    if (pending) {
      return res.status(400).json({ success: false, message: 'You already have a pending withdrawal request' });
    }

    // Hold the balance (deduct from pending, it will be restored if rejected)
    await User.findByIdAndUpdate(partner._id, {
      $inc: { 'partnerEarnings.pendingBalance': -Number(amount) },
    });

    const withdrawal = await PartnerWithdrawal.create({
      partnerId:     partner._id,
      amount:        Number(amount),
      walletAddress: walletAddress.trim(),
      network,
      status:        'pending',
      requestedAt:   new Date(),
    });

    res.json({ success: true, data: withdrawal, message: 'Withdrawal request submitted' });
  } catch (err) {
    console.error('[Partner] withdrawal request error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
