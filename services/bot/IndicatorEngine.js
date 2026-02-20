/**
 * IndicatorEngine.js
 * Pure computation functions for technical indicators.
 * No I/O, no side effects - all functions are synchronous.
 * Candle format: { timestamp, open, high, low, close, volume }
 */

/**
 * Calculate Exponential Moving Average
 * @param {number[]} closes
 * @param {number} period
 * @returns {number[]} EMA values (null for first period-1 entries)
 */
export function calculateEMA(closes, period) {
  if (!closes || closes.length < period) return closes.map(() => null);
  const k = 2 / (period + 1);
  const result = new Array(closes.length).fill(null);

  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  result[period - 1] = sum / period;

  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * Calculate RSI (Wilder's smoothing method)
 * @param {number[]} closes
 * @param {number} period
 * @returns {number[]} RSI values (null for first period entries)
 */
export function calculateRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return closes.map(() => null);
  const result = new Array(closes.length).fill(null);

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result[period] = 100 - 100 / (1 + rs);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs2 = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result[i] = 100 - 100 / (1 + rs2);
  }
  return result;
}

/**
 * Calculate Average True Range
 * @param {Object[]} candles - array of { high, low, close }
 * @param {number} period
 * @returns {number[]} ATR values
 */
export function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return candles.map(() => null);
  const result = new Array(candles.length).fill(null);

  // Calculate True Ranges
  const trs = [null];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  // Seed ATR with SMA of first `period` TRs
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trs[i];
  result[period] = sum / period;

  // Wilder smoothing
  for (let i = period + 1; i < candles.length; i++) {
    result[i] = (result[i - 1] * (period - 1) + trs[i]) / period;
  }
  return result;
}

/**
 * Detect swing highs (local maximums)
 * @param {number[]} highs
 * @param {number} lookback - bars on each side
 * @returns {{ index: number, price: number }[]}
 */
export function detectSwingHighs(highs, lookback = 5) {
  const swings = [];
  for (let i = lookback; i < highs.length - lookback; i++) {
    let isHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && highs[j] >= highs[i]) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) swings.push({ index: i, price: highs[i] });
  }
  return swings;
}

/**
 * Detect swing lows (local minimums)
 * @param {number[]} lows
 * @param {number} lookback
 * @returns {{ index: number, price: number }[]}
 */
export function detectSwingLows(lows, lookback = 5) {
  const swings = [];
  for (let i = lookback; i < lows.length - lookback; i++) {
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && lows[j] <= lows[i]) {
        isLow = false;
        break;
      }
    }
    if (isLow) swings.push({ index: i, price: lows[i] });
  }
  return swings;
}

/**
 * Detect overall market trend using EMA + price structure
 * @param {Object[]} candles
 * @param {number} ema1Period - fast EMA (e.g. 50)
 * @param {number} ema2Period - slow EMA (e.g. 200)
 * @returns {'uptrend'|'downtrend'|'sideways'}
 */
export function detectTrend(candles, ema1Period = 50, ema2Period = 200) {
  if (candles.length < ema2Period) return 'sideways';

  const closes = candles.map(c => c.close);
  const ema1 = calculateEMA(closes, ema1Period);
  const ema2 = calculateEMA(closes, ema2Period);

  const last = candles.length - 1;
  const currentPrice = closes[last];
  const currentEma1 = ema1[last];
  const currentEma2 = ema2[last];

  if (!currentEma1 || !currentEma2) return 'sideways';

  // Check EMA structure
  const emaUptrend = currentEma1 > currentEma2 && currentPrice > currentEma1;
  const emaDowntrend = currentEma1 < currentEma2 && currentPrice < currentEma1;

  // Check Higher Highs / Lower Lows structure using recent 20 closes
  const recentCloses = closes.slice(-20);
  const midPoint = Math.floor(recentCloses.length / 2);
  const firstHalfAvg = recentCloses.slice(0, midPoint).reduce((a, b) => a + b, 0) / midPoint;
  const secondHalfAvg = recentCloses.slice(midPoint).reduce((a, b) => a + b, 0) / (recentCloses.length - midPoint);
  const structureUptrend = secondHalfAvg > firstHalfAvg * 1.005;
  const structureDowntrend = secondHalfAvg < firstHalfAvg * 0.995;

  if (emaUptrend && structureUptrend) return 'uptrend';
  if (emaDowntrend && structureDowntrend) return 'downtrend';
  if (emaUptrend || structureUptrend) return 'uptrend';
  if (emaDowntrend || structureDowntrend) return 'downtrend';
  return 'sideways';
}

/**
 * Find the nearest resistance level above current price
 * @param {number} currentPrice
 * @param {{ index: number, price: number }[]} swingHighs
 * @param {number} lookbackBars - only consider swings within this many bars
 * @returns {number|null}
 */
export function findNearestResistance(currentPrice, swingHighs, lookbackBars = 50) {
  const relevant = swingHighs
    .filter(s => s.price > currentPrice)
    .sort((a, b) => a.price - b.price);
  return relevant.length > 0 ? relevant[0].price : null;
}

/**
 * Find the nearest support level below current price
 * @param {number} currentPrice
 * @param {{ index: number, price: number }[]} swingLows
 * @returns {number|null}
 */
export function findNearestSupport(currentPrice, swingLows) {
  const relevant = swingLows
    .filter(s => s.price < currentPrice)
    .sort((a, b) => b.price - a.price);
  return relevant.length > 0 ? relevant[0].price : null;
}

/**
 * Calculate simple moving average of volumes
 * @param {number[]} volumes
 * @param {number} period
 * @returns {number}
 */
export function calcVolumeMA(volumes, period = 20) {
  const slice = volumes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/**
 * Check if EMA golden cross occurred in recent bars
 * @param {number[]} closes
 * @param {number} fastPeriod
 * @param {number} slowPeriod
 * @param {number} lookback - how many recent bars to check
 * @returns {boolean}
 */
export function isGoldenCross(closes, fastPeriod, slowPeriod, lookback = 3) {
  const fast = calculateEMA(closes, fastPeriod);
  const slow = calculateEMA(closes, slowPeriod);
  const last = closes.length - 1;
  if (!fast[last] || !slow[last]) return false;

  for (let i = last - lookback; i < last; i++) {
    if (fast[i] !== null && slow[i] !== null && fast[i] <= slow[i] && fast[last] > slow[last]) {
      return true;
    }
  }
  return false;
}

/**
 * Check if EMA death cross occurred in recent bars
 */
export function isDeathCross(closes, fastPeriod, slowPeriod, lookback = 3) {
  const fast = calculateEMA(closes, fastPeriod);
  const slow = calculateEMA(closes, slowPeriod);
  const last = closes.length - 1;
  if (!fast[last] || !slow[last]) return false;

  for (let i = last - lookback; i < last; i++) {
    if (fast[i] !== null && slow[i] !== null && fast[i] >= slow[i] && fast[last] < slow[last]) {
      return true;
    }
  }
  return false;
}
