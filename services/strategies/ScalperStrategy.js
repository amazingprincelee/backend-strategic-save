/**
 * ScalperStrategy - High-frequency ATR-based scalping
 * Very tight grid spacing (0.3-0.5%), small profit targets.
 * Best for highly liquid pairs with tight spreads (BTC/USDT, ETH/USDT).
 * Uses 5-minute candles.
 */
import { calculateATR, calculateRSI, calculateEMA } from '../bot/IndicatorEngine.js';
import riskEngine from '../bot/RiskEngine.js';

class ScalperStrategy {
  async analyze(bot, candles, openPositions) {
    if (candles.length < 20) return [];

    const signals = [];
    const params = bot.strategyParams;
    const closes = candles.map(c => c.close);
    const atr = calculateATR(candles, params.atrPeriod || 14);
    const rsi = calculateRSI(closes, 7); // Shorter RSI period for scalping
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);

    const lastIdx = closes.length - 1;
    const currentPrice = closes[lastIdx];
    const currentATR = atr[lastIdx];
    const currentRSI = rsi[lastIdx];
    const currentEma9 = ema9[lastIdx];
    const currentEma21 = ema21[lastIdx];

    if (!currentATR || !currentRSI) return [];

    const gridSpacing = params.scalperGridSpacing || 0.004; // 0.4%

    // Check exits for open positions
    for (const position of openPositions) {
      riskEngine.updateTrailingStop(position, currentPrice, {
        trailingStopActivationPercent: 0.3,
        trailingStopDistancePercent: 0.2
      });
      const exit = riskEngine.checkExitConditions(position, currentPrice);
      if (exit.shouldClose) {
        signals.push({ action: 'sell', positionId: position._id, portionIndex: position.portionIndex, reason: exit.reason });
      }
    }

    // Entry: price must be in uptrend (EMA9 > EMA21) and RSI not overbought
    const inUptrend = currentEma9 && currentEma21 && currentEma9 > currentEma21;
    const rsiNotOverbought = currentRSI < 65;

    const openPortionIndexes = new Set(openPositions.map(p => p.portionIndex));

    // Check if current price is far enough from all open positions (grid spacing)
    const existingPrices = openPositions.map(p => p.entryPrice);
    const tooClose = existingPrices.some(ep => Math.abs(currentPrice - ep) / ep < gridSpacing);

    if (inUptrend && rsiNotOverbought && !tooClose) {
      let portionIdx = -1;
      for (let i = 0; i < (params.portions || 5); i++) {
        if (!openPortionIndexes.has(i)) { portionIdx = i; break; }
      }

      if (portionIdx >= 0) {
        const portionSize = bot.capitalAllocation.totalCapital / (params.portions || 5);
        const amount = portionSize / currentPrice;
        const stopLossPrice = currentPrice * (1 - gridSpacing);
        const takeProfitPrice = currentPrice * (1 + gridSpacing);

        signals.push({
          action: 'buy',
          portionIndex: portionIdx,
          amount,
          takeProfitPrice,
          stopLossPrice,
          reason: 'entry'
        });
      }
    }

    return signals;
  }
}

export default new ScalperStrategy();
