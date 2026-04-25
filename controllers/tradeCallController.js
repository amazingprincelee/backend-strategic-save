import TradeCall, { pairToCoingeckoId } from '../models/TradeCall.js';
import { priceMonitor } from '../services/tradeCallPriceMonitor.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function calcRR(direction, entry, sl, tp) {
  try {
    if (direction === 'long') {
      const risk = entry - sl;
      return risk > 0 ? Math.round((tp - entry) / risk * 100) / 100 : null;
    } else {
      const risk = sl - entry;
      return risk > 0 ? Math.round((entry - tp) / risk * 100) / 100 : null;
    }
  } catch { return null; }
}

// ── Public ─────────────────────────────────────────────────────────────────────

// GET /api/trade-calls
export const getPublicCalls = async (req, res) => {
  try {
    const { status, limit = 20, page = 1 } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;

    const [calls, total] = await Promise.all([
      TradeCall.find(filter)
        .sort({ openedAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit))
        .select('-createdBy')
        .lean(),
      TradeCall.countDocuments(filter),
    ]);

    res.json({ success: true, data: { calls, total } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/trade-calls/stats
export const getStats = async (req, res) => {
  try {
    const [wins, losses, open, tp1Hits] = await Promise.all([
      TradeCall.countDocuments({ status: 'win' }),
      TradeCall.countDocuments({ status: 'loss' }),
      TradeCall.countDocuments({ status: { $in: ['open', 'tp1_hit'] } }),
      TradeCall.countDocuments({ tp1Hit: true }),
    ]);

    const total   = wins + losses;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

    // Last 30 days
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const recent = await TradeCall.find({
      status: { $in: ['win', 'loss'] }, closedAt: { $gte: since },
    }).select('status closedAt').lean();

    const rWins  = recent.filter(c => c.status === 'win').length;
    const rTotal = recent.length;

    res.json({
      success: true,
      data: {
        wins, losses, open, tp1Hits,
        totalClosed: total,
        winRate,
        recentWinRate: rTotal > 0 ? Math.round((rWins / rTotal) * 100) : 0,
        recentTotal: rTotal,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin ──────────────────────────────────────────────────────────────────────

// POST /api/trade-calls
export const adminCreateCall = async (req, res) => {
  try {
    const { pair, direction, entryPrice, stopLoss, tp1, tp2, notes } = req.body;

    if (!pair || !direction || !entryPrice || !stopLoss || !tp1) {
      return res.status(400).json({ success: false, message: 'pair, direction, entryPrice, stopLoss, tp1 are required' });
    }

    const baseAsset   = pair.replace(/USDT$|BUSD$|USDC$|USD$/i, '').toUpperCase();
    const coingeckoId = pairToCoingeckoId(pair);
    const rr          = calcRR(direction, Number(entryPrice), Number(stopLoss), Number(tp1));

    const call = await TradeCall.create({
      pair:        pair.toUpperCase(),
      baseAsset,
      coingeckoId,
      direction,
      entryPrice:  Number(entryPrice),
      stopLoss:    Number(stopLoss),
      tp1:         Number(tp1),
      tp2:         tp2 ? Number(tp2) : null,
      riskReward:  rr,
      notes:       notes || '',
      createdBy:   req.user._id,
    });

    // Start monitoring this call immediately
    priceMonitor.addCall(call.toObject());

    res.json({ success: true, data: call });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/trade-calls/:id
export const adminUpdateCall = async (req, res) => {
  try {
    const allowed = ['entryPrice', 'stopLoss', 'tp1', 'tp2', 'notes', 'status', 'closingPrice'];
    const update  = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    // Auto-set closure fields when admin manually resolves
    if (['win', 'loss', 'cancelled'].includes(update.status)) {
      update.closedAt = new Date();
      if (update.status === 'win')   update.tp1Hit = true;
      if (update.status === 'tp1_hit') update.tp1Hit = true;
    }
    // Recalculate R/R if prices changed
    if (update.entryPrice || update.stopLoss || update.tp1) {
      const current = await TradeCall.findById(req.params.id);
      if (current) {
        const e  = update.entryPrice || current.entryPrice;
        const sl = update.stopLoss   || current.stopLoss;
        const t1 = update.tp1        || current.tp1;
        update.riskReward = calcRR(current.direction, e, sl, t1);
      }
    }

    const call = await TradeCall.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!call) return res.status(404).json({ success: false, message: 'Not found' });

    // Sync monitor: remove fully-closed calls, keep tp1_hit calls in watchlist
    if (['win', 'loss', 'cancelled'].includes(update.status)) {
      priceMonitor.removeCall(req.params.id);
    } else if (update.status === 'tp1_hit') {
      priceMonitor._markTp1Hit(req.params.id);
    }

    res.json({ success: true, data: call });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/trade-calls/:id
export const adminDeleteCall = async (req, res) => {
  try {
    await TradeCall.findByIdAndDelete(req.params.id);
    priceMonitor.removeCall(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// checkAndResolveOpenCalls removed — replaced by priceMonitor service (tradeCallPriceMonitor.js)
// which polls Binance every 5 s and CoinGecko every 30 s and runs 24/7 on the server.
