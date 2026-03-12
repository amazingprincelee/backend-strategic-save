import AlphaSignal from '../models/AlphaSignal.js';

// Helper: is the user premium or admin?
const isPremiumUser = (req) => {
  const role = req.user?.role;
  if (role === 'admin') return true;
  if (role === 'premium') {
    const sub = req.user?.subscription;
    if (!sub) return true; // role set directly without subscription doc
    return sub.status === 'active' && (!sub.planEndAt || new Date(sub.planEndAt) > new Date());
  }
  return false;
};

/**
 * GET /api/alpha
 * Returns early alpha signals sorted by score descending.
 * Free users: limited to 3 results, score blurred, no reasons.
 */
export async function getAlphaSignals(req, res) {
  try {
    const page     = Math.max(1, parseInt(req.query.page)  || 1);
    const limit    = Math.min(50, parseInt(req.query.limit) || 20);
    const category = req.query.category; // optional filter
    const premium  = isPremiumUser(req);

    const filter = { isActive: true };
    if (category) filter.category = category;

    const [signals, total] = await Promise.all([
      AlphaSignal.find(filter)
        .sort({ score: -1, discoveredAt: -1 })
        .skip((page - 1) * limit)
        .limit(premium ? limit : 3)
        .lean(),
      AlphaSignal.countDocuments(filter),
    ]);

    // Mask sensitive alpha details for free users
    const data = signals.map(s => {
      if (premium) return s;
      return {
        _id:         s._id,
        symbol:      s.symbol,
        name:        s.name,
        category:    s.category,
        score:       null,        // hidden
        reasons:     [],          // hidden
        priceChange: s.priceChange,
        discoveredAt: s.discoveredAt,
        gated: true,
      };
    });

    res.json({
      success: true,
      data,
      meta: {
        total,
        page,
        limit,
        gated: !premium,
        visibleCount: data.length,
      }
    });
  } catch (err) {
    console.error('[alphaController] getAlphaSignals:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch alpha signals' });
  }
}

/**
 * GET /api/alpha/stats
 * Returns aggregate counts per category (useful for the dashboard chip).
 * Public — no auth required.
 */
export async function getAlphaStats(req, res) {
  try {
    const [byCategory, total] = await Promise.all([
      AlphaSignal.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$category', count: { $sum: 1 }, avgScore: { $avg: '$score' } } },
        { $sort: { count: -1 } },
      ]),
      AlphaSignal.countDocuments({ isActive: true }),
    ]);

    const topSignal = await AlphaSignal.findOne({ isActive: true }).sort({ score: -1 }).lean();

    res.json({
      success: true,
      data: {
        total,
        byCategory,
        topScore: topSignal?.score || 0,
        topSymbol: topSignal?.symbol || null,
      }
    });
  } catch (err) {
    console.error('[alphaController] getAlphaStats:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch alpha stats' });
  }
}
