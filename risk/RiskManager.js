/**
 * RiskManager.js
 * ATR-based risk management for the signal engine.
 *
 * Rules enforced:
 *  - Stop loss placed at 1.5× ATR from entry
 *  - Take profit placed at 3.0× ATR (guarantees ≥ 1:2 R:R)
 *  - Max 2% portfolio risk per trade
 *  - Futures: stop loss must be hit BEFORE the liquidation price
 *  - Volatility filter: skip if ATR/price > 3% (market too wild)
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const ATR_SL_MULT    = 1.5;   // stop loss  = entry ± 1.5 × ATR
const ATR_TP_MULT    = 3.0;   // take profit = entry ± 3.0 × ATR  →  R:R = 2.0
const MIN_RR         = 2.0;   // minimum acceptable risk:reward
const MAX_RISK_PCT   = 0.02;  // 2% max risk per trade
const MAX_ATR_PCT    = 0.03;  // skip signal if ATR > 3% of price (too volatile)

// Liquidation safety margin — stop must be at least this far (%) from liquidation
const LIQ_SAFETY_MARGIN = 0.20; // 20 %

// ─── Class ────────────────────────────────────────────────────────────────────

class RiskManager {

  /**
   * Calculate all risk parameters for a potential trade.
   *
   * @param {{ type: 'LONG'|'SHORT', entry: number, atr: number,
   *           marketType: 'spot'|'futures', leverage?: number }} params
   * @returns {{ valid: boolean, reason?: string,
   *             stopLoss: number, takeProfit: number,
   *             riskReward: number, atrPct: number }}
   */
  calculateRiskParams({ type, entry, atr, marketType = 'spot', leverage = 1 }) {

    if (!entry || !atr || atr <= 0 || entry <= 0) {
      return { valid: false, reason: 'Invalid entry or ATR value' };
    }

    const isLong = type === 'LONG';

    // ── Volatility filter ─────────────────────────────────────────────────
    const atrPct = atr / entry;
    if (atrPct > MAX_ATR_PCT) {
      return {
        valid:  false,
        reason: `ATR too wide (${(atrPct * 100).toFixed(2)}% of price) — skipping volatile market`,
      };
    }

    // ── Stop loss & take profit ────────────────────────────────────────────
    const slDist = atr * ATR_SL_MULT;
    const tpDist = atr * ATR_TP_MULT;

    const stopLoss   = isLong
      ? parseFloat((entry - slDist).toFixed(8))
      : parseFloat((entry + slDist).toFixed(8));

    const takeProfit = isLong
      ? parseFloat((entry + tpDist).toFixed(8))
      : parseFloat((entry - tpDist).toFixed(8));

    // Edge case: stop below zero
    if (stopLoss <= 0) {
      return { valid: false, reason: 'Stop loss would be ≤ 0' };
    }

    // ── Risk : Reward ──────────────────────────────────────────────────────
    const risk   = Math.abs(entry - stopLoss);
    const reward = Math.abs(entry - takeProfit);
    const rr     = reward / risk;

    if (rr < MIN_RR) {
      return {
        valid:  false,
        reason: `R:R too low (${rr.toFixed(2)} < ${MIN_RR})`,
      };
    }

    // ── Futures liquidation distance check ────────────────────────────────
    if (marketType === 'futures' && leverage > 1) {
      // Simplified: with cross-margin, liquidation ≈ entry × (1 - 1/leverage)
      // For isolated margin it's essentially when full margin is lost.
      const liqPrice = isLong
        ? entry * (1 - 1 / leverage)
        : entry * (1 + 1 / leverage);

      const stopDistPct  = Math.abs(entry - stopLoss) / entry;
      const liqDistPct   = Math.abs(entry - liqPrice) / entry;

      if (stopDistPct >= liqDistPct * (1 - LIQ_SAFETY_MARGIN)) {
        return {
          valid:  false,
          reason: `Stop loss (${(stopDistPct * 100).toFixed(2)}%) is too close to liquidation (${(liqDistPct * 100).toFixed(2)}%)`,
        };
      }
    }

    return {
      valid:      true,
      stopLoss,
      takeProfit,
      riskReward: parseFloat(rr.toFixed(2)),
      atrPct:     parseFloat((atrPct * 100).toFixed(3)),
    };
  }

  /**
   * Calculate the appropriate position size so that a stop-loss hit
   * costs at most `riskPct` of total capital.
   *
   * @param {{ capital: number, entry: number, stopLoss: number, riskPct?: number }}
   * @returns {{ units: number, dollarSize: number, riskAmount: number }}
   */
  calculatePositionSize({ capital, entry, stopLoss, riskPct = MAX_RISK_PCT }) {
    const riskAmount = capital * riskPct;
    const stopDist   = Math.abs(entry - stopLoss);
    if (stopDist === 0) return { units: 0, dollarSize: 0, riskAmount: 0 };

    const units      = riskAmount / stopDist;
    const dollarSize = units * entry;

    return {
      units:      parseFloat(units.toFixed(8)),
      dollarSize: parseFloat(dollarSize.toFixed(2)),
      riskAmount: parseFloat(riskAmount.toFixed(2)),
    };
  }

  /**
   * Suggest a conservative leverage level based on AI confidence and ATR%.
   * Always ≤ 10× and respects 2% risk limit.
   */
  suggestLeverage(confidenceScore, atrPct) {
    // High volatility → low leverage
    if (atrPct > 0.02)       return 2;
    if (confidenceScore > 0.92) return 5;
    if (confidenceScore > 0.85) return 3;
    return 2;
  }

  /**
   * Quick boolean check — is the market's volatility acceptable?
   */
  isVolatilityAcceptable(atr, price) {
    return (atr / price) <= MAX_ATR_PCT;
  }
}

export default new RiskManager();
