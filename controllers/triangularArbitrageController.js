/**
 * triangularArbitrageController.js
 * Handles GET /api/arbitrage/triangular and history endpoints.
 */
import { getCachedTriangular } from '../services/Arbitrage/TriangularArbitrageScanner.js';
import TriangularOpportunity from '../models/TriangularOpportunity.js';

// ─── Free-tier gate ───────────────────────────────────────────────────────────
function isPremiumUser(req) {
  const u = req.user;
  if (!u) return false;
  if (u.role === 'admin') return true;
  if (u.role === 'premium') {
    const expiry = u.subscription?.expiresAt;
    if (!expiry) return true;
    return new Date() < new Date(expiry);
  }
  return false;
}

function maskOpportunity(opp) {
  return {
    ...opp,
    pairs:      ['***', '***', '***'],
    prices:     { step1: null, step2: null, step3: null },
    path:       [opp.path?.[0] ?? 'USDT', '???', '???'],
    endCapital: null,
    gated:      true,
  };
}

// GET /api/arbitrage/triangular
export const getTriangularOpportunities = async (req, res) => {
  try {
    const { opportunities, lastScan, isScanning, stats } = getCachedTriangular();
    const premium = isPremiumUser(req);

    let data = opportunities;

    // Free tier: show only first 3, mask details beyond the profit %
    if (!premium) {
      data = data.slice(0, 3).map(maskOpportunity);
    }

    // If cache is empty, pull last 10 from DB as stale fallback
    let isStale = false;
    if (data.length === 0 && !isScanning) {
      const recent = await TriangularOpportunity
        .find({})
        .sort({ lastSeenAt: -1 })
        .limit(10)
        .lean();

      if (recent.length > 0) {
        isStale = true;
        data = premium
          ? recent.map(r => ({ ...r, isStale: true }))
          : recent.slice(0, 3).map(r => maskOpportunity({ ...r, isStale: true }));
      }
    }

    return res.json({
      success: true,
      count: data.length,
      data,
      metadata: {
        lastScan,
        isScanning,
        isStale,
        gated: !premium,
        stats,
      },
    });
  } catch (err) {
    console.error('[TriArb] getTriangularOpportunities error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/arbitrage/triangular/history
export const getTriangularHistory = async (req, res) => {
  try {
    const premium = isPremiumUser(req);
    const limit   = Math.min(parseInt(req.query.limit) || 50, 200);
    const status  = req.query.status || 'all';

    const query = status === 'all' ? {} : { status };

    const records = await TriangularOpportunity
      .find(query)
      .sort({ firstDetectedAt: -1 })
      .limit(limit)
      .lean();

    const data = premium
      ? records
      : records.slice(0, 5).map(r => maskOpportunity(r));

    return res.json({
      success: true,
      count: data.length,
      data,
      gated: !premium,
    });
  } catch (err) {
    console.error('[TriArb] getTriangularHistory error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/arbitrage/triangular/summary
export const getTriangularSummary = async (req, res) => {
  try {
    const [total, active, best] = await Promise.all([
      TriangularOpportunity.countDocuments({}),
      TriangularOpportunity.countDocuments({ status: 'active' }),
      TriangularOpportunity.findOne({}).sort({ netProfitPercent: -1 }).lean(),
    ]);

    const avgResult = await TriangularOpportunity.aggregate([
      { $group: { _id: null, avg: { $avg: '$netProfitPercent' } } },
    ]);

    return res.json({
      success: true,
      data: {
        total,
        active,
        cleared: total - active,
        bestProfitPercent:  best?.netProfitPercent ?? 0,
        avgProfitPercent:   avgResult[0]?.avg ?? 0,
        exchange:           'Gate.io',
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
