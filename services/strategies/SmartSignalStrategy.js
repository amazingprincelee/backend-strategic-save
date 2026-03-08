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
 *   signalMaxAgeMinutes   (number, 20)  — reject signals older than this
 */

import Signal from '../../models/Signal.js';

const DEFAULT_MAX_AGE_MIN = 20;

class SmartSignalStrategy {
  async analyze(bot, _candles, openPositions) {
    const params          = bot.strategyParams || {};
    const minConfidence   = (params.minConfidencePercent || 70) / 100;
    const maxConcurrent   = params.maxConcurrentTrades   || 2;
    const riskPct         = params.riskPerTrade          || 2;
    const leverage        = bot.marketType === 'futures' ? (params.leverage || 3) : 1;
    const maxAgeMs        = (params.signalMaxAgeMinutes  || DEFAULT_MAX_AGE_MIN) * 60 * 1000;
    const capital         = bot.capitalAllocation?.totalCapital || 100;

    const signals = [];

    // ── 1. Exit checks for all open positions ────────────────────────────────
    // currentPrice on each position is updated by BotEngine before analyze() runs.
    for (const pos of openPositions) {
      const price = pos.currentPrice;
      if (!price) continue;

      const hitTP = pos.takeProfitPrice && price >= pos.takeProfitPrice;
      const hitSL = pos.stopLossPrice   && price <= pos.stopLossPrice;

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

    // ── 3. Query fresh high-confidence signals from DB ───────────────────────
    const cutoff     = new Date(Date.now() - maxAgeMs);
    const openPairs  = new Set(openPositions.map(p => p.symbol));
    const slotsLeft  = maxConcurrent - openPositions.length;

    const freshSignals = await Signal.find({
      timestamp:       { $gte: cutoff },
      confidenceScore: { $gte: minConfidence },
      status:          'active',
      type:            'LONG',            // LONG only — futures SHORT support coming
      marketType:      bot.marketType || 'spot',
    })
      .sort({ confidenceScore: -1, timestamp: -1 })
      .limit(20)
      .lean();

    let filled = 0;
    for (const sig of freshSignals) {
      if (filled >= slotsLeft) break;

      // Skip pairs already in an open position
      if (openPairs.has(sig.pair)) continue;

      const amount = (capital * riskPct / 100 * leverage) / sig.entry;

      signals.push({
        action:          'buy',
        symbol:          sig.pair,               // ← multi-pair: signal carries its own pair
        portionIndex:    openPositions.length + filled,
        amount,
        takeProfitPrice: sig.takeProfit,
        stopLossPrice:   sig.stopLoss,
        reason:          'smart_signal',
        confidence:      sig.confidenceScore,
      });

      openPairs.add(sig.pair);
      filled++;
    }

    return signals;
  }
}

export default new SmartSignalStrategy();
