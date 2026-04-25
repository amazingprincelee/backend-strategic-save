import TradeCall, { pairToCoingeckoId } from '../models/TradeCall.js';

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

    res.json({ success: true, data: call });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/trade-calls/:id
export const adminDeleteCall = async (req, res) => {
  try {
    await TradeCall.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Price check (called from cron + Socket.IO) ─────────────────────────────────

export const checkAndResolveOpenCalls = async (io) => {
  try {
    const openCalls = await TradeCall.find({ status: { $in: ['open', 'tp1_hit'] } }).lean();
    if (!openCalls.length) return;

    // Unified pair → price map populated across sources
    const pairPriceMap = {};

    // 1. CoinGecko: batch-fetch for calls that have a coingeckoId
    const cgIds = [...new Set(openCalls.map(c => c.coingeckoId).filter(Boolean))];
    if (cgIds.length) {
      try {
        const r = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(',')}&vs_currencies=usd`,
          { headers: { Accept: 'application/json' } },
        );
        if (r.ok) {
          const priceData = await r.json();
          for (const call of openCalls) {
            if (call.coingeckoId && priceData[call.coingeckoId]?.usd) {
              pairPriceMap[call.pair] = priceData[call.coingeckoId].usd;
            }
          }
        }
      } catch (e) {
        console.warn('[TradeCall] CoinGecko fetch failed:', e.message);
      }
    }

    // 2. Binance fallback: fetch prices for any pairs still missing (individually
    //    to avoid one bad symbol killing the whole batch request)
    const missingPairs = [...new Set(
      openCalls.filter(c => !pairPriceMap[c.pair]).map(c => c.pair),
    )];
    if (missingPairs.length) {
      await Promise.all(missingPairs.map(async (symbol) => {
        try {
          const r = await fetch(
            `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
            { headers: { Accept: 'application/json' } },
          );
          if (!r.ok) return;
          const { price } = await r.json();
          if (price) pairPriceMap[symbol] = parseFloat(price);
        } catch {
          // symbol not on Binance — skip silently
        }
      }));
    }

    // Broadcast live prices to all connected clients
    if (io && Object.keys(pairPriceMap).length) {
      io.emit('tradecall:prices', pairPriceMap);
    }

    // Check and resolve open calls
    for (const call of openCalls) {
      const price = pairPriceMap[call.pair];
      if (!price) continue;

      const isLong = call.direction === 'long';
      let update   = null;

      if (isLong) {
        if (price <= call.stopLoss) {
          update = { status: 'loss', closedAt: new Date(), closingPrice: price };
        } else if (!call.tp1Hit && price >= call.tp1) {
          update = call.tp2
            ? { status: 'tp1_hit', tp1Hit: true }
            : { status: 'win', tp1Hit: true, closedAt: new Date(), closingPrice: price };
        } else if (call.tp1Hit && call.tp2 && price >= call.tp2) {
          update = { status: 'win', tp2Hit: true, closedAt: new Date(), closingPrice: price };
        }
      } else {
        if (price >= call.stopLoss) {
          update = { status: 'loss', closedAt: new Date(), closingPrice: price };
        } else if (!call.tp1Hit && price <= call.tp1) {
          update = call.tp2
            ? { status: 'tp1_hit', tp1Hit: true }
            : { status: 'win', tp1Hit: true, closedAt: new Date(), closingPrice: price };
        } else if (call.tp1Hit && call.tp2 && price <= call.tp2) {
          update = { status: 'win', tp2Hit: true, closedAt: new Date(), closingPrice: price };
        }
      }

      if (update) {
        await TradeCall.findByIdAndUpdate(call._id, update);
        console.log(`[TradeCall] ${call.pair} → ${update.status} @ $${price}`);
        if (io) io.emit('tradecall:resolved', { _id: String(call._id), pair: call.pair, ...update });
      }
    }
  } catch (err) {
    console.error('[TradeCall] Price check error:', err.message);
  }
};
