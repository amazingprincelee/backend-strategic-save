/**
 * FeatureEngineering.js
 * Computes and normalizes all technical indicators needed for the AI model
 * and the rule-based confirmation layer.
 *
 * Input:  candles[] = [{ timestamp, open, high, low, close, volume }]
 * Output: featureVector[] aligned 1:1 with candles
 */

import {
  calculateEMA,
  calculateRSI,
  calculateATR,
} from '../services/bot/IndicatorEngine.js';

// ─── MACD ────────────────────────────────────────────────────────────────────

/**
 * Calculate MACD (12, 26, 9 defaults).
 * Returns { macdLine[], signalLine[], histogram[] } aligned to closes.
 */
export function computeMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const fastEMA = calculateEMA(closes, fast);
  const slowEMA = calculateEMA(closes, slow);

  const macdLine = closes.map((_, i) =>
    fastEMA[i] !== null && slowEMA[i] !== null
      ? fastEMA[i] - slowEMA[i]
      : null
  );

  // Signal line = EMA of MACD line (only over valid values)
  const validIndices = macdLine.reduce((acc, v, i) => {
    if (v !== null) acc.push(i);
    return acc;
  }, []);
  const validMacd     = validIndices.map(i => macdLine[i]);
  const signalValues  = calculateEMA(validMacd, signalPeriod);

  const signalLine = new Array(closes.length).fill(null);
  validIndices.forEach((origIdx, k) => {
    signalLine[origIdx] = signalValues[k] ?? null;
  });

  const histogram = closes.map((_, i) =>
    macdLine[i] !== null && signalLine[i] !== null
      ? macdLine[i] - signalLine[i]
      : null
  );

  return { macdLine, signalLine, histogram };
}

// ─── Volume metrics ──────────────────────────────────────────────────────────

/**
 * For each candle compute:
 *   ratio    = volume / MA(volume, period)
 *   change   = (volume - MA) / MA
 *   spikeScore = clamped 0-1 indicator of a volume spike
 */
export function computeVolumeMetrics(volumes, period = 20) {
  const result = [];
  for (let i = 0; i < volumes.length; i++) {
    if (i < period) {
      result.push({ change: 0, ratio: 1, spikeScore: 0 });
      continue;
    }
    const slice = volumes.slice(i - period, i);
    const avg   = slice.reduce((a, b) => a + b, 0) / period;
    const ratio = avg > 0 ? volumes[i] / avg : 1;
    const change = avg > 0 ? (volumes[i] - avg) / avg : 0;
    result.push({
      ratio,
      change,
      spikeScore: Math.min(1, Math.max(0, (ratio - 1) / 2)),
    });
  }
  return result;
}

// ─── Master feature builder ──────────────────────────────────────────────────

/**
 * Compute all indicator values for every candle in the array.
 * Requires at least 220 candles (EMA200 needs 200, plus warmup).
 *
 * Returns an array aligned to candles:
 *   null at positions where indicators are not yet warm.
 *   Otherwise an object with:
 *     raw indicators  (for the rule engine)
 *     normalized[]    (10-feature vector for the AI model, all ∈ ~[-1, 1])
 */
export function computeAllFeatures(candles) {
  if (!candles || candles.length < 220) return null;

  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const ema20  = calculateEMA(closes, 20);
  const ema50  = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi    = calculateRSI(closes, 14);
  const atr    = calculateATR(candles, 14);
  const macd   = computeMACD(closes);
  const volMet = computeVolumeMetrics(volumes, 20);

  return candles.map((c, i) => {
    const price = c.close;

    // Gate: need all indicators warmed up
    if (
      ema20[i]  === null ||
      ema50[i]  === null ||
      rsi[i]    === null ||
      atr[i]    === null ||
      macd.macdLine[i]   === null
    ) return null;

    // ── Raw values (for rule-based confirmation) ──────────────────────────
    const raw = {
      ema20:         ema20[i],
      ema50:         ema50[i],
      ema200:        ema200[i],
      rsi:           rsi[i],
      macdLine:      macd.macdLine[i],
      macdSignal:    macd.signalLine[i],
      macdHistogram: macd.histogram[i],
      atr:           atr[i],
      volumeRatio:   volMet[i].ratio,
      volumeChange:  volMet[i].change,
      spikeScore:    volMet[i].spikeScore,
    };

    // ── Normalized feature vector (10 features, for the AI model) ─────────
    const normalized = [
      // 0 — distance of price from EMA20  (captures short-term deviation)
      ema20[i]  ? clamp((price - ema20[i])  / price, -0.1, 0.1) / 0.1 : 0,
      // 1 — distance of price from EMA50  (captures medium-term trend)
      ema50[i]  ? clamp((price - ema50[i])  / price, -0.1, 0.1) / 0.1 : 0,
      // 2 — distance of price from EMA200 (macro trend filter)
      ema200[i] ? clamp((price - ema200[i]) / price, -0.2, 0.2) / 0.2 : 0,
      // 3 — RSI normalised to [-1, +1]  (50 → 0)
      (rsi[i] - 50) / 50,
      // 4 — MACD line relative to price
      clamp(macd.macdLine[i] / price, -0.01, 0.01) / 0.01,
      // 5 — MACD histogram (momentum acceleration)
      macd.histogram[i] !== null
        ? clamp(macd.histogram[i] / price, -0.01, 0.01) / 0.01
        : 0,
      // 6 — ATR relative to price (volatility measure)
      clamp(atr[i] / price, 0, 0.05) / 0.05,
      // 7 — Volume ratio capped at 3× average
      Math.min(1, (volMet[i].ratio - 1) / 2),
      // 8 — Volume change percentage
      clamp(volMet[i].change, -1, 1),
      // 9 — Candle body directional ratio: +1 = full bullish, -1 = full bearish
      (c.high - c.low) > 0
        ? (c.close - c.open) / (c.high - c.low)
        : 0,
    ];

    return { ...raw, normalized };
  });
}

/**
 * Return only the last computed feature vector (most recent candle).
 */
export function extractLastFeatures(candles) {
  const all = computeAllFeatures(candles);
  if (!all) return null;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i] !== null) return all[i];
  }
  return null;
}

// ─── Training dataset builder ─────────────────────────────────────────────────

/**
 * Build supervised learning dataset from a candle array.
 * Label: price movement 5 candles ahead relative to threshold.
 *
 * Returns { X: number[][], y: number[][] }  (one-hot [buy, sell, hold])
 */
export function buildTrainingData(candles) {
  const features  = computeAllFeatures(candles);
  if (!features)  return null;

  const X          = [];
  const y          = [];
  const LOOKAHEAD  = 5;
  const THRESHOLD  = 0.004; // 0.4% move = actionable

  for (let i = 0; i < features.length - LOOKAHEAD; i++) {
    const feat = features[i];
    if (!feat || !feat.normalized) continue;

    const currentClose = candles[i].close;
    const futureClose  = candles[i + LOOKAHEAD].close;
    const pctChange    = (futureClose - currentClose) / currentClose;

    let label;
    if      (pctChange >  THRESHOLD) label = [1, 0, 0]; // Buy
    else if (pctChange < -THRESHOLD) label = [0, 1, 0]; // Sell
    else                             label = [0, 0, 1]; // Hold

    X.push(feat.normalized);
    y.push(label);
  }

  return { X, y };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
