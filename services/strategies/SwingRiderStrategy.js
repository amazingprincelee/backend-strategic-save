/**
 * SwingRiderStrategy
 *
 * Identifies market structure (swing highs/lows), classifies trend direction,
 * then enters trades at high-probability support zones and exits at the next
 * structural resistance — adapting targets to the current trend.
 *
 * Uptrend  : Buy near Higher Low (HL),  target next projected Higher High (HH)
 * Downtrend: Buy near Lower Low  (LL),  target Lower High (LH) — realistic exit
 * Ranging  : Buy near support,          target resistance
 *
 * Scale-in : If price drops further after first entry (scaleInAtrMultiplier × ATR),
 *            opens a second position up to maxScaleIns total.
 *
 * Configuration (bot.strategyParams):
 *   swingLookback         (number, 5)   — candles each side to confirm a swing point
 *   maxScaleIns           (number, 2)   — max concurrent entries
 *   scaleInAtrMultiplier  (number, 1.5) — ATR multiples below entry to add a position
 *   riskPerEntry          (number, 1)   — % of totalCapital risked per entry
 *   minRR                 (number, 1.5) — skip entry if reward:risk < this
 *   leverage              (number, 3)   — futures leverage (ignored for spot)
 */

const ATR_PERIOD = 14;

class SwingRiderStrategy {
  // ─── Public API ───────────────────────────────────────────────────────────

  async analyze(bot, candles, openPositions) {
    const params = bot.strategyParams || {};
    const lookback          = params.swingLookback        || 5;
    const maxScaleIns       = params.maxScaleIns          || 2;
    const scaleInMult       = params.scaleInAtrMultiplier || 1.5;
    const riskPct           = params.riskPerEntry         || 1;
    const minRR             = params.minRR                || 1.5;
    const leverage          = bot.marketType === 'futures' ? (params.leverage || 3) : 1;
    const capital           = bot.capitalAllocation?.totalCapital || 100;

    const signals = [];
    if (!candles || candles.length < lookback * 2 + 20) return signals;

    const atr          = this._calcATR(candles);
    const currentPrice = candles[candles.length - 1].close;

    // ── 1. Exit checks ───────────────────────────────────────────────────────
    for (const pos of openPositions) {
      const price = pos.currentPrice || currentPrice;
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
    if (signals.length > 0) return signals;

    // ── 2. Swing structure ───────────────────────────────────────────────────
    const { swingHighs, swingLows } = this._findSwings(candles, lookback);
    const trend = this._detectTrend(swingHighs, swingLows);

    if (swingLows.length === 0 || swingHighs.length === 0) return signals;

    const lastSwingLow  = swingLows[swingLows.length - 1];
    const lastSwingHigh = swingHighs[swingHighs.length - 1];

    // ── 3. Scale-in on existing longs ────────────────────────────────────────
    const openLongs = openPositions.filter(p => p.side !== 'short');

    if (openLongs.length > 0 && openLongs.length < maxScaleIns) {
      const lastEntry   = openLongs[openLongs.length - 1];
      const scaleInLine = lastEntry.entryPrice - atr * scaleInMult;

      if (currentPrice <= scaleInLine) {
        const tp = this._calcTP(trend, swingHighs, swingLows, currentPrice, atr);
        const sl = Math.min(lastSwingLow.price - atr * 0.3, currentPrice - atr * 1.5);
        const rr = (tp - currentPrice) / (currentPrice - sl);

        if (tp > currentPrice && rr >= minRR) {
          const amount = (capital * riskPct / 100 * leverage) / currentPrice;
          signals.push({
            action:          'buy',
            symbol:          bot.symbol,
            portionIndex:    openLongs.length,
            amount,
            takeProfitPrice: parseFloat(tp.toFixed(8)),
            stopLossPrice:   parseFloat(sl.toFixed(8)),
            reason:          'scale_in',
          });
        }
      }
      return signals;
    }

    // ── 4. New entry — only when no open longs ───────────────────────────────
    if (openLongs.length >= maxScaleIns) return signals;

    // 1.5× ATR zone around the swing low — wide enough to catch approaches, not just exact touches
    const nearSupport = Math.abs(currentPrice - lastSwingLow.price) <= atr * 1.5;
    if (!nearSupport) return signals;

    let entryReason;
    if (trend === 'uptrend')   entryReason = 'structure_long_uptrend';
    else if (trend === 'downtrend') entryReason = 'structure_long_downtrend';
    else                       entryReason = 'range_support';

    const tp = this._calcTP(trend, swingHighs, swingLows, currentPrice, atr);
    const sl = lastSwingLow.price - atr * 0.3;
    const rr = (tp - currentPrice) / Math.max(currentPrice - sl, atr * 0.1);

    // Gate: price must be above SL, TP above price, R:R acceptable
    if (tp <= currentPrice)    return signals;
    if (sl >= currentPrice)    return signals;
    if (rr < minRR)            return signals;

    const amount = (capital * riskPct / 100 * leverage) / currentPrice;

    signals.push({
      action:          'buy',
      symbol:          bot.symbol,
      portionIndex:    0,
      amount,
      takeProfitPrice: parseFloat(tp.toFixed(8)),
      stopLossPrice:   parseFloat(sl.toFixed(8)),
      reason:          entryReason,
    });

    return signals;
  }

  // ─── Swing detection ─────────────────────────────────────────────────────

  _findSwings(candles, lookback) {
    const swingHighs = [];
    const swingLows  = [];

    // We need lookback candles before + after — don't go to the very last candle
    // (it doesn't have "after" candles yet). Leave a 2-candle buffer.
    const end = candles.length - 2;

    for (let i = lookback; i <= end - lookback; i++) {
      const high = candles[i].high;
      const low  = candles[i].low;

      // Swing high: highest in the window
      const isSwingHigh =
        candles.slice(i - lookback, i).every(c => c.high <= high) &&
        candles.slice(i + 1, i + lookback + 1).every(c => c.high <= high);

      // Swing low: lowest in the window
      const isSwingLow =
        candles.slice(i - lookback, i).every(c => c.low >= low) &&
        candles.slice(i + 1, i + lookback + 1).every(c => c.low >= low);

      if (isSwingHigh) swingHighs.push({ price: high, index: i });
      if (isSwingLow)  swingLows.push({ price: low,  index: i });
    }

    return { swingHighs, swingLows };
  }

  // ─── Trend classification ────────────────────────────────────────────────

  _detectTrend(swingHighs, swingLows) {
    if (swingHighs.length < 2 || swingLows.length < 2) return 'ranging';

    const [sh1, sh2] = swingHighs.slice(-2);
    const [sl1, sl2] = swingLows.slice(-2);

    const higherHighs = sh2.price > sh1.price;
    const higherLows  = sl2.price > sl1.price;
    const lowerHighs  = sh2.price < sh1.price;
    const lowerLows   = sl2.price < sl1.price;

    if (higherHighs && higherLows) return 'uptrend';
    if (lowerHighs  && lowerLows)  return 'downtrend';
    return 'ranging';
  }

  // ─── Take-profit calculation ─────────────────────────────────────────────

  _calcTP(trend, swingHighs, swingLows, currentPrice, atr) {
    if (trend === 'uptrend' && swingHighs.length >= 1) {
      const lastHH = swingHighs[swingHighs.length - 1].price;
      if (swingHighs.length >= 2) {
        // Project next HH conservatively (70% of last HH-to-HH move)
        const move = swingHighs[swingHighs.length - 1].price - swingHighs[swingHighs.length - 2].price;
        const projected = lastHH + move * 0.7;
        return Math.max(projected, lastHH);
      }
      return lastHH;
    }

    if (trend === 'downtrend' && swingHighs.length >= 1) {
      // In downtrend: target last Lower High minus a small buffer (be conservative)
      const lh = swingHighs[swingHighs.length - 1].price;
      return lh * 0.995;
    }

    // Ranging: target last swing high
    if (swingHighs.length >= 1) {
      return swingHighs[swingHighs.length - 1].price;
    }

    // Fallback: ATR × 2 above entry
    return currentPrice + atr * 2;
  }

  // ─── ATR ─────────────────────────────────────────────────────────────────

  _calcATR(candles, period = ATR_PERIOD) {
    if (candles.length < 2) return candles[0]?.close * 0.01 || 0.001;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const h  = candles[i].high;
      const l  = candles[i].low;
      const pc = candles[i - 1].close;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    const recent = trs.slice(-Math.min(period, trs.length));
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }
}

export default new SwingRiderStrategy();
