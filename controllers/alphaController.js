import AlphaSignal from '../models/AlphaSignal.js';
import User from '../models/User.js';
import marketDataService from '../services/MarketDataService.js';

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
 * POST /api/alpha/favorite/:id
 * Toggle a signal in the authenticated user's favorites list.
 * Returns { favorited: true|false, favorites: [ids] }
 */
export async function toggleFavorite(req, res) {
  try {
    const signalId = req.params.id;
    const userId   = req.user._id;

    // Verify signal exists
    const signal = await AlphaSignal.findById(signalId).select('_id').lean();
    if (!signal) return res.status(404).json({ success: false, message: 'Signal not found' });

    const user = await User.findById(userId).select('alphaFavorites');
    const already = user.alphaFavorites.some(id => id.toString() === signalId);

    if (already) {
      user.alphaFavorites.pull(signalId);
    } else {
      user.alphaFavorites.addToSet(signalId);
    }
    await user.save();

    res.json({
      success:   true,
      favorited: !already,
      favorites: user.alphaFavorites.map(id => id.toString()),
    });
  } catch (err) {
    console.error('[alphaController] toggleFavorite:', err.message);
    res.status(500).json({ success: false, message: 'Failed to update favorites' });
  }
}

/**
 * GET /api/alpha/favorites
 * Returns the authenticated user's favorited alpha signals (full docs, sorted by score).
 */
export async function getFavorites(req, res) {
  try {
    const user = await User.findById(req.user._id).select('alphaFavorites').lean();
    const ids  = user?.alphaFavorites || [];

    const signals = await AlphaSignal.find({ _id: { $in: ids } })
      .sort({ score: -1 })
      .lean();

    res.json({
      success:   true,
      data:      signals,
      favorites: ids.map(id => id.toString()),
    });
  } catch (err) {
    console.error('[alphaController] getFavorites:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch favorites' });
  }
}

/**
 * GET /api/alpha/analyze/:id
 * Deep analysis for a single alpha signal:
 *  - Momentum since discovery (current price vs discovery price)
 *  - Whale detection (1h volume spike vs 20-bar avg)
 *  - Pattern score (historical same-category signal quality)
 *  - Entry timing (recent candle momentum → Wait / Possible / Strong)
 * Premium only.
 */
export async function analyzeAlphaSignal(req, res) {
  try {
    if (!isPremiumUser(req)) {
      return res.status(403).json({ success: false, message: 'Premium required' });
    }

    const signal = await AlphaSignal.findById(req.params.id).lean();
    if (!signal) return res.status(404).json({ success: false, message: 'Signal not found' });

    const symbol = signal.symbol; // e.g. "BTCUSDT"

    // ── 1. Fetch 1h candles ──────────────────────────────────────────────────
    let candles = [];
    try {
      candles = await marketDataService.fetchCandles(symbol, '1h', 'spot', 25);
    } catch {
      // Non-fatal — some new listings won't be on Gate.io
    }

    const lastCandle  = candles[candles.length - 1] || null;
    const currentPrice = lastCandle?.close || null;

    // ── 2. Momentum since discovery ─────────────────────────────────────────
    const discoveryPrice = signal.price || null;
    let momentum = null;
    if (currentPrice && discoveryPrice) {
      const gainPct = ((currentPrice - discoveryPrice) / discoveryPrice) * 100;
      const msElapsed = Date.now() - new Date(signal.discoveredAt).getTime();
      const hoursElapsed = msElapsed / (1000 * 60 * 60);
      momentum = {
        discoveryPrice,
        currentPrice,
        gainPercent: parseFloat(gainPct.toFixed(2)),
        hoursElapsed:  parseFloat(hoursElapsed.toFixed(1)),
        direction: gainPct > 0 ? 'up' : gainPct < 0 ? 'down' : 'flat',
        // What-if: $1000 invested at discovery
        whatIfPnl: parseFloat(((gainPct / 100) * 1000).toFixed(2)),
      };
    }

    // ── 3. Whale detection ───────────────────────────────────────────────────
    let whale = { detected: false, signal: 'None', volMulti: 0, priceChange1h: 0 };
    if (candles.length >= 22) {
      const recent   = candles.slice(-21);
      const lastC    = recent[recent.length - 1];
      const avgVol   = recent.slice(0, 20).reduce((s, c) => s + c.volume, 0) / 20;
      const volMulti = avgVol > 0 ? lastC.volume / avgVol : 0;
      const pc1h     = lastC.close > 0 ? ((lastC.close - lastC.open) / lastC.open) * 100 : 0;

      let whaleSignal = 'None';
      if      (volMulti >= 6 && pc1h > 1)  whaleSignal = 'Strong';
      else if (volMulti >= 3 && pc1h > 0.5) whaleSignal = 'Moderate';
      else if (volMulti >= 2)               whaleSignal = 'Elevated';

      whale = {
        detected:       whaleSignal !== 'None',
        signal:         whaleSignal,
        volMulti:       parseFloat(volMulti.toFixed(2)),
        priceChange1h:  parseFloat(pc1h.toFixed(2)),
        currentVolume:  parseFloat(lastC.volume.toFixed(2)),
        avgVolume20:    parseFloat(avgVol.toFixed(2)),
        reasons: [
          volMulti >= 2  && `Volume ${volMulti.toFixed(1)}× above 20-bar average`,
          pc1h > 0.5     && `+${pc1h.toFixed(2)}% price move in last 1h candle`,
          volMulti >= 6  && 'Extreme volume — likely whale accumulation',
        ].filter(Boolean),
      };
    }

    // ── 4. Pattern score ─────────────────────────────────────────────────────
    // Compare this signal against historical same-category signals (last 30 days).
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const historicalSigs = await AlphaSignal.find({
      category:    signal.category,
      discoveredAt: { $gte: cutoff },
      _id:         { $ne: signal._id },
    }).select('score reasons priceChange').lean();

    let patternScore = 50; // neutral default
    let historicalContext = null;

    if (historicalSigs.length > 0) {
      const avgScore    = historicalSigs.reduce((s, x) => s + x.score, 0) / historicalSigs.length;
      const strongCount = historicalSigs.filter(x => x.score >= 65).length;
      const positiveCount = historicalSigs.filter(x => (x.priceChange || 0) > 0).length;
      const winRate     = historicalSigs.length > 0 ? positiveCount / historicalSigs.length : 0;

      // Score this signal relative to its category peers
      const relativeScore = Math.min(100, Math.max(0, 50 + (signal.score - avgScore)));
      // Boost for many reasons (analyst confidence proxy)
      const reasonBonus   = Math.min(15, (signal.reasons?.length || 0) * 5);
      // Category reliability weights
      const catWeight = { whale_accumulation: 1.1, volume_spike: 1.05, trending: 1.0, new_listing: 0.95, social_spike: 0.90 };
      const weight    = catWeight[signal.category] || 1.0;

      patternScore = Math.min(100, Math.round((relativeScore + reasonBonus) * weight));

      historicalContext = {
        sampleSize:     historicalSigs.length,
        avgCategoryScore: parseFloat(avgScore.toFixed(1)),
        strongSignalRate: parseFloat(((strongCount / historicalSigs.length) * 100).toFixed(1)),
        positiveDiscoveryRate: parseFloat((winRate * 100).toFixed(1)),
        thisSignalVsAvg: parseFloat((signal.score - avgScore).toFixed(1)),
      };
    }

    // ── 5. Entry timing ──────────────────────────────────────────────────────
    let entryTiming = { recommendation: 'Insufficient Data', momentum: 'unknown', volumeTrend: 'unknown' };
    if (candles.length >= 8) {
      const last5  = candles.slice(-5);
      const prev3  = candles.slice(-8, -5);
      const greenCount = last5.filter(c => c.close > c.open).length;
      const redCount   = last5.length - greenCount;

      const recentAvgVol = last5.reduce((s, c) => s + c.volume, 0) / last5.length;
      const prevAvgVol   = prev3.reduce((s, c) => s + c.volume, 0) / prev3.length;
      const volumeTrend  = recentAvgVol > prevAvgVol * 1.2 ? 'increasing' : recentAvgVol < prevAvgVol * 0.8 ? 'decreasing' : 'stable';

      const priceMomentum = greenCount >= 4 ? 'strong_up' : greenCount === 3 ? 'up' : redCount >= 4 ? 'strong_down' : redCount === 3 ? 'down' : 'mixed';

      // Consecutive green candles into the latest
      let consecutiveGreen = 0;
      for (let i = last5.length - 1; i >= 0; i--) {
        if (last5[i].close > last5[i].open) consecutiveGreen++;
        else break;
      }

      let recommendation;
      if (priceMomentum === 'strong_up' && volumeTrend === 'increasing') {
        recommendation = 'Strong Entry';
      } else if ((priceMomentum === 'up' || priceMomentum === 'strong_up') && volumeTrend !== 'decreasing') {
        recommendation = 'Possible Entry';
      } else if (priceMomentum === 'strong_down' || (priceMomentum === 'down' && volumeTrend === 'increasing')) {
        recommendation = 'Caution';
      } else if (priceMomentum === 'mixed') {
        recommendation = 'Wait';
      } else {
        recommendation = 'Wait';
      }

      entryTiming = {
        recommendation,
        momentum:    priceMomentum,
        volumeTrend,
        consecutiveGreen,
        greenCount,
        redCount,
        currentCandle: lastCandle ? {
          open:   parseFloat(lastCandle.open.toFixed(6)),
          high:   parseFloat(lastCandle.high.toFixed(6)),
          low:    parseFloat(lastCandle.low.toFixed(6)),
          close:  parseFloat(lastCandle.close.toFixed(6)),
          volume: parseFloat(lastCandle.volume.toFixed(2)),
        } : null,
      };
    }

    res.json({
      success: true,
      symbol,
      signalId: signal._id,
      category: signal.category,
      score:    signal.score,
      momentum,
      whale,
      patternScore,
      historicalContext,
      entryTiming,
    });
  } catch (err) {
    console.error('[alphaController] analyzeAlphaSignal:', err.message);
    res.status(500).json({ success: false, message: 'Analysis failed' });
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
