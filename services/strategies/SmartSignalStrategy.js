/**
 * SmartSignalStrategy
 *
 * Reads from the Signal collection (populated by the 30-min sweep cron) and
 * automatically enters trades on the highest-confidence opportunities
 * available on the user's exchange.
 *
 * Configuration (bot.strategyParams):
 *   minConfidencePercent  (number, 70)  — minimum signal confidence to trade
 *   maxConcurrentTrades   (number, 2)   — max open positions at once
 *   riskPerTrade          (number, 2)   — % of totalCapital per trade
 *   leverage              (number, 3)   — futures leverage (ignored for spot)
 *   signalMaxAgeMinutes   (number, 120) — reject signals older than this
 *
 * Safety features:
 *   - Uses LIVE market price for position sizing (not the (possibly stale) signal entry)
 *   - Skips signals where current price drifted >2% from signal entry (too stale to be safe)
 *   - Caps effectiveRisk = riskPerTrade * leverage at bot.riskParams.maxLeverageRiskPct (default 20%)
 */

import Signal from '../../models/Signal.js';
import marketDataService from '../MarketDataService.js';

// Generous window — sweep runs every 30 min, so 6 h covers restarts.
const DEFAULT_MAX_AGE_MIN = 360;

// If current market price has drifted more than this % from the signal's entry,
// the signal is too stale to enter safely.
const MAX_PRICE_DRIFT_PCT = 2.0;

class SmartSignalStrategy {
  async analyze(bot, _candles, openPositions) {
    const params        = bot.strategyParams || {};
    const minConfidence = (params.minConfidencePercent || 50) / 100;
    const maxConcurrent = params.maxConcurrentTrades   || 3;
    const riskPct       = params.riskPerTrade          || 2;
    const leverage      = bot.marketType === 'futures' ? (params.leverage || 3) : 1;
    const ageMin        = Math.max(60, params.signalMaxAgeMinutes || DEFAULT_MAX_AGE_MIN);
    const maxAgeMs      = ageMin * 60 * 1000;
    const capital       = bot.capitalAllocation?.totalCapital || 100;
    const marketType    = bot.marketType || 'spot';

    // Leverage safety cap: riskPerTrade × leverage cannot exceed maxLeverageRiskPct.
    // e.g. riskPerTrade=5%, leverage=10× → effectiveRisk=50% — too dangerous.
    // We cap riskPct down so effectiveRisk stays ≤ maxLeverageRiskPct.
    const maxEffectiveRisk = bot.riskParams?.maxLeverageRiskPct || 20;
    const cappedRiskPct    = Math.min(riskPct, maxEffectiveRisk / leverage);
    if (cappedRiskPct < riskPct) {
      console.warn(
        `[SmartSignal] bot=${bot.name} risk capped: ${riskPct}%×${leverage}lev ` +
        `would exceed ${maxEffectiveRisk}% → using ${cappedRiskPct.toFixed(2)}% risk instead`
      );
    }

    // ── Kelly Criterion position sizing (optional) ───────────────────────────
    // When the bot has ≥20 closed trades and useKellysizing is enabled, replace
    // the fixed riskPerTrade% with the Kelly formula:
    //   f* = W/A - (1-W)/B
    //   where W = win rate, A = avg loss (as fraction), B = avg win (as fraction)
    // Half-Kelly (f*/2) is used for safety — full Kelly is too aggressive.
    // Falls back to cappedRiskPct if Kelly < 0.5% or < 10 trades yet.
    const useKelly   = params.useKellySizing === true;
    const closedTrades = (bot.stats?.winningTrades || 0) + (bot.stats?.losingTrades || 0);
    let finalRiskPct = cappedRiskPct;

    if (useKelly && closedTrades >= 20) {
      const W    = (bot.stats.winRate || 0) / 100;                      // win rate 0–1
      const grossP = bot.stats.grossProfit || 0;
      const grossL = bot.stats.grossLoss   || 0;
      const wins   = bot.stats.winningTrades || 1;
      const losses = bot.stats.losingTrades  || 1;
      const avgWin  = wins   > 0 ? (grossP / wins)   / capital : 0.01; // avg win as fraction
      const avgLoss = losses > 0 ? (grossL / losses)  / capital : 0.01; // avg loss as fraction
      if (avgWin > 0 && avgLoss > 0) {
        const kellyFull = W / avgLoss - (1 - W) / avgWin;
        const halfKelly = kellyFull / 2;
        const kellyCapped = Math.min(Math.max(halfKelly * 100, 0.5), maxEffectiveRisk / leverage);
        if (kellyCapped > 0) {
          finalRiskPct = kellyCapped;
          console.log(
            `[SmartSignal] Kelly sizing: W=${(W*100).toFixed(0)}% avgWin=${(avgWin*100).toFixed(2)}% ` +
            `avgLoss=${(avgLoss*100).toFixed(2)}% → halfKelly=${(halfKelly*100).toFixed(2)}% ` +
            `(capped at ${finalRiskPct.toFixed(2)}%)`
          );
        }
      }
    }

    const signals = [];

    // ── 1. Exit checks for all open positions ────────────────────────────────
    // currentPrice on each position is updated by BotEngine before analyze() runs.
    for (const pos of openPositions) {
      const price = pos.currentPrice;
      if (!price) continue;

      const isShort = pos.side === 'short';

      // ── Ladder exit: TP1 (50% at 1:1 R:R) ──────────────────────────────
      // TP1 fires once. After TP1 hit, SL moves to breakeven and trailing
      // stop activates on the remaining 50%.
      if (pos.tp1Price && !pos.tp1Hit) {
        const hitTP1 = isShort ? price <= pos.tp1Price : price >= pos.tp1Price;
        if (hitTP1) {
          signals.push({
            action:            'partial_sell',
            positionId:        pos._id,
            portionIndex:      pos.portionIndex,
            portion:           0.5,
            reason:            'take_profit_1',
            moveSlToBreakeven: true,
          });
          continue; // don't also check TP2 this same tick
        }
      }

      // ── Full exit: TP2 / SL / Trailing stop ─────────────────────────────
      const hitTP = pos.takeProfitPrice && (
        isShort ? price <= pos.takeProfitPrice : price >= pos.takeProfitPrice
      );
      const hitSL = pos.stopLossPrice && (
        isShort ? price >= pos.stopLossPrice : price <= pos.stopLossPrice
      );
      // Trailing stop (activated after TP1 hits in ladder mode, or configured threshold)
      const hitTrail = pos.trailingStopActive && pos.trailingStopPrice && (
        isShort ? price >= pos.trailingStopPrice : price <= pos.trailingStopPrice
      );

      if (hitTP) {
        signals.push({ action: 'sell', positionId: pos._id, portionIndex: pos.portionIndex, reason: 'take_profit' });
      } else if (hitTrail) {
        signals.push({ action: 'sell', positionId: pos._id, portionIndex: pos.portionIndex, reason: 'trailing_stop' });
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
    const openPairs = new Set(openPositions.map(p => p.symbol.replace('/', '')));
    const slotsLeft = maxConcurrent - openPositions.length;
    const typeFilter = marketType === 'futures' ? { $in: ['LONG', 'SHORT'] } : 'LONG';

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
      `window=${ageMin}min → found ${dbSignals.length} candidate(s), ` +
      `openPositions=${openPositions.length}/${maxConcurrent}`
    );

    let filled = 0;
    for (const sig of dbSignals) {
      if (filled >= slotsLeft) break;

      // Skip signals with missing price levels
      if (!sig.entry || !sig.stopLoss || !sig.takeProfit) continue;

      const tradeSymbol = sig.pair.replace('/', '');

      // Skip if we already have an open position in this pair
      if (openPairs.has(tradeSymbol)) continue;

      // ── Fetch live price for accurate position sizing ────────────────────
      // Signal entry may be up to signalMaxAgeMinutes old. Using a stale price
      // for sizing means our actual risk % will be wrong. Use the live price.
      let livePrice = sig.entry; // fallback
      try {
        const ticker = await marketDataService.fetchTicker(tradeSymbol, marketType);
        livePrice = ticker.lastPrice;
      } catch {
        console.warn(`[SmartSignal] Could not fetch live price for ${tradeSymbol}, using signal entry`);
      }

      // ── Price drift guard ────────────────────────────────────────────────
      // If the market has moved more than MAX_PRICE_DRIFT_PCT from the signal's
      // entry, the TP/SL levels are based on a price that no longer reflects
      // current conditions. Skip to avoid entering at a bad risk:reward.
      const drift = Math.abs(livePrice - sig.entry) / sig.entry * 100;
      if (drift > MAX_PRICE_DRIFT_PCT) {
        console.log(
          `[SmartSignal] Skipping ${tradeSymbol} — price drifted ${drift.toFixed(2)}% ` +
          `from signal entry $${sig.entry} → live $${livePrice}`
        );
        continue;
      }

      // ── Position sizing using live price ────────────────────────────────
      const amount = (capital * finalRiskPct / 100 * leverage) / livePrice;
      if (!isFinite(amount) || amount <= 0) continue;

      // ── Ladder exit: compute TP1 at 1:1 R:R ─────────────────────────────
      // riskDist = distance from entry to stop loss
      // TP1 = entry ± riskDist (1:1 risk:reward — half position secured here)
      const isShortSig = sig.type === 'SHORT';
      const riskDist = isShortSig
        ? sig.stopLoss - sig.entry   // short SL is above entry
        : sig.entry - sig.stopLoss;  // long SL is below entry
      const tp1Price = riskDist > 0
        ? (isShortSig ? sig.entry - riskDist : sig.entry + riskDist)
        : null;

      signals.push({
        action:          'buy',
        symbol:          tradeSymbol,
        side:            isShortSig ? 'short' : 'long',
        portionIndex:    openPositions.length + filled,
        amount,
        takeProfitPrice: sig.takeProfit,
        stopLossPrice:   sig.stopLoss,
        tp1Price,
        reason:          'smart_signal',
        confidence:      sig.confidenceScore,
      });

      openPairs.add(tradeSymbol);
      filled++;
      console.log(
        `[SmartSignal] → queuing ${sig.type} ${tradeSymbol} ` +
        `entry=$${sig.entry} live=$${livePrice} drift=${drift.toFixed(2)}% ` +
        `amount=${amount.toFixed(6)} conf=${(sig.confidenceScore * 100).toFixed(0)}%`
      );
    }

    if (filled === 0) {
      console.log(`[SmartSignal] bot=${bot.name} — no actionable signals this tick`);
    }

    return signals;
  }
}

export default new SmartSignalStrategy();
