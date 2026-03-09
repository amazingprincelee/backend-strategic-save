/**
 * SmartSignalStrategy
 *
 * Instead of running TA on a single fixed pair, this strategy reads from the
 * Signal collection (already populated by the 30-min sweep cron) and
 * automatically enters trades on the highest-confidence opportunities
 * available on the user's exchange — regardless of which pair they are.
 *
 * Configuration (bot.strategyParams):
 *   minConfidencePercent  (number, 70)  — minimum signal confidence to trade
 *   maxConcurrentTrades   (number, 2)   — max open positions at once
 *   riskPerTrade          (number, 2)   — % of totalCapital per trade
 *   leverage              (number, 3)   — futures leverage (ignored for spot)
 *   signalMaxAgeMinutes   (number, 120) — reject signals older than this (2 h covers restart gaps)
 */

import Signal from '../../models/Signal.js';

// Use a generous window by default — sweep runs every 15 min, so 6 h guarantees
// there is always coverage regardless of server restarts or sweep timing.
const DEFAULT_MAX_AGE_MIN = 360; // 6 hours

class SmartSignalStrategy {
  async analyze(bot, _candles, openPositions) {
    const params          = bot.strategyParams || {};
    const minConfidence   = (params.minConfidencePercent || 50) / 100;
    const maxConcurrent   = params.maxConcurrentTrades   || 3;
    const riskPct         = params.riskPerTrade          || 2;
    const leverage        = bot.marketType === 'futures' ? (params.leverage || 3) : 1;
    // Enforce a minimum of 60 min so the window is never too tight
    const ageMin          = Math.max(60, params.signalMaxAgeMinutes || DEFAULT_MAX_AGE_MIN);
    const maxAgeMs        = ageMin * 60 * 1000;
    const capital         = bot.capitalAllocation?.totalCapital || 100;

    const signals = [];

    // ── 1. Exit checks for all open positions ────────────────────────────────
    // currentPrice on each position is updated by BotEngine before analyze() runs.
    for (const pos of openPositions) {
      const price = pos.currentPrice;
      if (!price) continue;

      const isShort = pos.side === 'short';
      const hitTP = pos.takeProfitPrice && (
        isShort ? price <= pos.takeProfitPrice : price >= pos.takeProfitPrice
      );
      const hitSL = pos.stopLossPrice && (
        isShort ? price >= pos.stopLossPrice : price <= pos.stopLossPrice
      );

      if (hitTP) {
        signals.push({ action: 'sell', positionId: pos._id, portionIndex: pos.portionIndex, reason: 'take_profit' });
      } else if (hitSL) {
        signals.push({ action: 'sell', positionId: pos._id, portionIndex: pos.portionIndex, reason: 'stop_loss' });
      }
    }

    // Process exits first — don't open new positions in the same tick as a close
    if (signals.length > 0) return signals;

    // ── 2. Check capacity ────────────────────────────────────────────────────
    if (openPositions.length >= maxConcurrent) return signals;

    // ── 3. Query recent signals from DB ─────────────────────────────────────
    const cutoff    = new Date(Date.now() - maxAgeMs);
    const marketType = bot.marketType || 'spot';

    // Normalize open-position symbols to 'BTCUSDT' form for duplicate check
    const openPairs = new Set(openPositions.map(p => p.symbol.replace('/', '')));
    const slotsLeft = maxConcurrent - openPositions.length;

    // Futures bots trade both LONG and SHORT; spot bots are LONG-only
    const typeFilter = marketType === 'futures' ? { $in: ['LONG', 'SHORT'] } : 'LONG';

    // Do NOT filter by status — status field isn't reliably maintained across
    // all signal sources (HybridEngine upserts, TAEngine insertMany).
    // Time-based filtering is the reliable gate.
    const dbSignals = await Signal.find({
      timestamp:       { $gte: cutoff },
      confidenceScore: { $gte: minConfidence },
      type:            typeFilter,
      marketType,
    })
      .sort({ confidenceScore: -1, timestamp: -1 })
      .limit(50)
      .lean();

    console.log(
      `[SmartSignal] bot=${bot.name} market=${marketType} minConf=${(minConfidence * 100).toFixed(0)}% ` +
      `window=${ageMin}min → found ${dbSignals.length} candidate(s) in DB, ` +
      `openPositions=${openPositions.length}/${maxConcurrent}`
    );

    let filled = 0;
    for (const sig of dbSignals) {
      if (filled >= slotsLeft) break;

      // Skip signals with missing price levels
      if (!sig.entry || !sig.stopLoss || !sig.takeProfit) continue;

      // Normalize pair to 'BTCUSDT' format for both the symbol and dupe-check
      const tradeSymbol = sig.pair.replace('/', '');

      // Skip if we already have an open position in this pair
      if (openPairs.has(tradeSymbol)) continue;

      const amount = (capital * riskPct / 100 * leverage) / sig.entry;
      if (!isFinite(amount) || amount <= 0) continue;

      signals.push({
        action:          'buy',
        symbol:          tradeSymbol,
        side:            sig.type === 'SHORT' ? 'short' : 'long',
        portionIndex:    openPositions.length + filled,
        amount,
        takeProfitPrice: sig.takeProfit,
        stopLossPrice:   sig.stopLoss,
        reason:          'smart_signal',
        confidence:      sig.confidenceScore,
      });

      openPairs.add(tradeSymbol);
      filled++;
      console.log(
        `[SmartSignal] → queuing ${sig.type} ${tradeSymbol} @ ${sig.entry} ` +
        `conf=${(sig.confidenceScore * 100).toFixed(0)}%`
      );
    }

    if (filled === 0) {
      console.log(`[SmartSignal] bot=${bot.name} — no actionable signals this tick`);
    }

    return signals;
  }
}

export default new SmartSignalStrategy();
