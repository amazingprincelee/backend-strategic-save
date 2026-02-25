/**
 * BacktestEngine.js
 * Simulates the HybridSignalEngine strategy on historical OHLCV data.
 *
 * Metrics produced:
 *   winRate       — % of trades that hit take-profit
 *   maxDrawdown   — largest peak-to-trough decline (%)
 *   sharpeRatio   — annualised Sharpe (per-trade returns, √252 scaling)
 *   profitFactor  — gross profit / gross loss
 *   avgWin / avgLoss  — average P&L of winning/losing trades
 *
 * Usage (via API):
 *   POST /api/signals/backtest
 *   { symbol, marketType, timeframe, initialCapital, riskPerTrade }
 */

import marketData   from '../services/MarketDataService.js';
import signalModel  from '../ai/SignalModel.js';
import riskManager  from '../risk/RiskManager.js';
import { computeAllFeatures } from '../ai/FeatureEngineering.js';
import { calculateEMA, calculateRSI } from '../services/bot/IndicatorEngine.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_CONFIDENCE      = 0.75;
const MIN_RULE_SCORE      = 0.40;
const TRAIN_SPLIT_PCT     = 0.70; // use first 70% of candles for training check only
const DEFAULT_RISK        = 0.02; // 2% per trade
const DEFAULT_CAPITAL     = 10_000;

// ─── Engine ───────────────────────────────────────────────────────────────────

class BacktestEngine {

  /**
   * Run a full backtest.
   *
   * @param {{
   *   symbol:         string,
   *   marketType?:    'spot'|'futures',
   *   timeframe?:     string,
   *   initialCapital?: number,
   *   riskPerTrade?:  number,   (0-1, e.g. 0.02 = 2%)
   * }} opts
   */
  async runBacktest({
    symbol,
    marketType    = 'spot',
    timeframe     = '1h',
    initialCapital = DEFAULT_CAPITAL,
    riskPerTrade   = DEFAULT_RISK,
  }) {
    console.log(`[Backtest] ${symbol} ${timeframe} ${marketType}`);

    // ── Fetch history ──────────────────────────────────────────────────────
    const candles = await marketData.fetchHistoricalCandles(
      symbol, timeframe, 1000, marketType
    );

    if (!candles || candles.length < 260) {
      throw new Error('Insufficient historical data (need ≥ 260 candles)');
    }

    // ── Compute features for every candle ─────────────────────────────────
    const features = computeAllFeatures(candles);
    if (!features) {
      throw new Error('Feature computation failed — candle array may be too short');
    }

    // ── Simulation state ──────────────────────────────────────────────────
    const trades    = [];
    let capital     = initialCapital;
    let peakCapital = initialCapital;
    let maxDD       = 0;
    let openTrade   = null;

    // Iterate candles starting from index 220 (indicators warm)
    for (let i = 220; i < candles.length - 1; i++) {
      const feat       = features[i];
      const candle     = candles[i];
      const nextCandle = candles[i + 1];

      if (!feat || !feat.normalized) continue;

      // ── Check for open trade exit ──────────────────────────────────────
      if (openTrade) {
        const closed = this._checkExit(openTrade, nextCandle);
        if (closed) {
          const pnl = this._calcPnl(openTrade, closed.closePrice, capital);
          capital  += pnl;
          peakCapital = Math.max(peakCapital, capital);
          const dd  = (peakCapital - capital) / peakCapital;
          maxDD     = Math.max(maxDD, dd);

          trades.push({
            entry:     openTrade.entry,
            exit:      closed.closePrice,
            type:      openTrade.type,
            reason:    closed.reason,
            pnlPct:    (pnl / initialCapital) * 100,
            pnl,
            capital:   parseFloat(capital.toFixed(2)),
            entryTime: openTrade.entryTime,
            exitTime:  nextCandle.timestamp,
          });
          openTrade = null;
        }
      }

      // Skip if already in a trade
      if (openTrade) continue;

      // ── Generate signal ────────────────────────────────────────────────
      const prediction = await signalModel.predict(feat.normalized);
      const { buyProb, sellProb } = prediction;
      const maxProb   = Math.max(buyProb, sellProb);

      if (maxProb < MIN_CONFIDENCE) continue;

      const direction = buyProb > sellProb ? 'LONG' : 'SHORT';

      // Basic rule gate (simplified for speed — full engine uses more checks)
      if (!this._quickRuleCheck(feat, direction)) continue;

      // Risk params
      const entry      = candle.close;
      const atr        = feat.atr;
      const riskParams = riskManager.calculateRiskParams({
        type: direction, entry, atr, marketType, leverage: 1,
      });
      if (!riskParams.valid) continue;

      // Position size (% risk)
      const posSize = riskManager.calculatePositionSize({
        capital,
        entry,
        stopLoss: riskParams.stopLoss,
        riskPct:  riskPerTrade,
      });

      openTrade = {
        type:       direction,
        entry,
        stopLoss:   riskParams.stopLoss,
        takeProfit: riskParams.takeProfit,
        dollarSize: Math.min(posSize.dollarSize, capital),
        entryTime:  candle.timestamp,
      };
    }

    // ── Compute metrics ────────────────────────────────────────────────────
    const metrics = this._computeMetrics(trades, initialCapital, maxDD);

    return {
      symbol,
      timeframe,
      marketType,
      initialCapital,
      finalCapital:   parseFloat(capital.toFixed(2)),
      netPnl:         parseFloat((capital - initialCapital).toFixed(2)),
      netPnlPct:      parseFloat(((capital - initialCapital) / initialCapital * 100).toFixed(2)),
      totalTrades:    trades.length,
      candlesAnalysed: candles.length,
      ...metrics,
      recentTrades:   trades.slice(-30), // last 30 trades for UI table
    };
  }

  // ─── Exit check ──────────────────────────────────────────────────────────

  _checkExit(trade, candle) {
    const { type, stopLoss, takeProfit } = trade;

    if (type === 'LONG') {
      if (candle.low  <= stopLoss)   return { closePrice: stopLoss,   reason: 'stop_loss'   };
      if (candle.high >= takeProfit) return { closePrice: takeProfit, reason: 'take_profit' };
    } else {
      if (candle.high >= stopLoss)   return { closePrice: stopLoss,   reason: 'stop_loss'   };
      if (candle.low  <= takeProfit) return { closePrice: takeProfit, reason: 'take_profit' };
    }
    return null;
  }

  // ─── P&L calculation ─────────────────────────────────────────────────────

  _calcPnl(trade, closePrice, capital) {
    const { type, entry, dollarSize } = trade;
    const units = dollarSize / entry;
    const pnl   = type === 'LONG'
      ? (closePrice - entry) * units
      : (entry - closePrice) * units;
    return pnl;
  }

  // ─── Quick rule gate (lightweight version for backtesting speed) ──────────

  _quickRuleCheck(feat, direction) {
    const { rsi, ema20, ema50, macdLine } = feat;
    if (macdLine === null) return false;

    if (direction === 'LONG') {
      return rsi < 60 && ema20 >= ema50 * 0.98;
    } else {
      return rsi > 40 && ema20 <= ema50 * 1.02;
    }
  }

  // ─── Metrics ─────────────────────────────────────────────────────────────

  _computeMetrics(trades, initialCapital, maxDD) {
    if (trades.length === 0) {
      return {
        winRate: 0, maxDrawdown: 0, sharpeRatio: 0,
        profitFactor: 0, avgWin: 0, avgLoss: 0,
        totalWins: 0, totalLosses: 0, expectancy: 0,
      };
    }

    const winners = trades.filter(t => t.pnl > 0);
    const losers  = trades.filter(t => t.pnl <= 0);

    const winRate     = winners.length / trades.length;
    const grossProfit = winners.reduce((a, t) => a + t.pnl, 0);
    const grossLoss   = Math.abs(losers.reduce((a, t) => a + t.pnl, 0));

    const profitFactor = grossLoss > 0
      ? grossProfit / grossLoss
      : grossProfit > 0 ? 999 : 0;

    const avgWin  = winners.length > 0 ? grossProfit / winners.length : 0;
    const avgLoss = losers.length  > 0 ? -grossLoss  / losers.length  : 0;

    // Expectancy per trade (in dollar terms)
    const expectancy = (winRate * avgWin) + ((1 - winRate) * avgLoss);

    // Sharpe ratio — using per-trade % returns, annualised with √252
    const returns   = trades.map(t => t.pnlPct / 100);
    const avgRet    = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance  = returns.reduce((s, r) => s + Math.pow(r - avgRet, 2), 0) / returns.length;
    const stdDev    = Math.sqrt(variance);
    const sharpe    = stdDev > 0 ? (avgRet / stdDev) * Math.sqrt(252) : 0;

    return {
      winRate:      parseFloat((winRate * 100).toFixed(2)),
      maxDrawdown:  parseFloat((maxDD   * 100).toFixed(2)),
      sharpeRatio:  parseFloat(sharpe.toFixed(2)),
      profitFactor: parseFloat(profitFactor.toFixed(2)),
      avgWin:       parseFloat(avgWin.toFixed(2)),
      avgLoss:      parseFloat(avgLoss.toFixed(2)),
      expectancy:   parseFloat(expectancy.toFixed(2)),
      totalWins:    winners.length,
      totalLosses:  losers.length,
    };
  }
}

export default new BacktestEngine();
