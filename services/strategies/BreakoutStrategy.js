/**
 * BreakoutStrategy - N-Day High Breakout (Momentum)
 * Buys when price closes above the N-day high with volume confirmation.
 * Uses a measured-move projection for take profit.
 * Best for trending markets with clear momentum.
 */
import { calculateATR, calcVolumeMA } from '../bot/IndicatorEngine.js';
import riskEngine from '../bot/RiskEngine.js';

class BreakoutStrategy {
  async analyze(bot, candles, openPositions) {
    if (candles.length < (bot.strategyParams.breakoutLookbackDays || 20) + 5) return [];

    const signals = [];
    const params = bot.strategyParams;
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);
    const atr = calculateATR(candles, params.atrPeriod || 14);

    const lastIdx = closes.length - 1;
    const currentPrice = closes[lastIdx];
    const currentATR = atr[lastIdx];
    const currentVolume = volumes[lastIdx];

    if (!currentATR) return [];

    const lookback = params.breakoutLookbackDays || 20;

    // Check exits for open positions
    for (const position of openPositions) {
      riskEngine.updateTrailingStop(position, currentPrice, params);
      const exit = riskEngine.checkExitConditions(position, currentPrice);
      if (exit.shouldClose) {
        signals.push({ action: 'sell', positionId: position._id, portionIndex: position.portionIndex, reason: exit.reason });
      }
    }

    // Only look for new breakout if no open positions
    if (openPositions.length > 0) return signals;

    // Find N-day high (excluding current candle)
    const lookbackHighs = highs.slice(lastIdx - lookback, lastIdx);
    const nDayHigh = Math.max(...lookbackHighs);
    const nDayLow = Math.min(...lows.slice(lastIdx - lookback, lastIdx));

    // Volume confirmation: current volume > 1.5x 20-bar average
    const avgVolume = calcVolumeMA(volumes, 20);
    const volumeBreakout = currentVolume > avgVolume * 1.5;

    // Price breakout: current close above N-day high
    const priceBreakout = currentPrice > nDayHigh;

    if (priceBreakout && volumeBreakout) {
      const portionSize = bot.capitalAllocation.totalCapital / (params.portions || 5);
      // Use 2 portions for breakout (stronger conviction signal)
      const amount = (portionSize * 2) / currentPrice;

      // Stop loss: below the breakout candle low
      const breakoutCandleLow = lows[lastIdx];
      const stopLossPrice = Math.max(breakoutCandleLow - currentATR * 0.5, currentPrice * 0.97);

      // Take profit: measured move (breakout candle range projected up)
      const breakoutRange = nDayHigh - nDayLow;
      const takeProfitPrice = currentPrice + breakoutRange;

      signals.push({
        action: 'buy',
        portionIndex: 0,
        amount,
        takeProfitPrice,
        stopLossPrice,
        reason: 'entry'
      });
    }

    return signals;
  }
}

export default new BreakoutStrategy();
