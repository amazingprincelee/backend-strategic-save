/**
 * Execution Simulator
 *
 * Simulates trade execution with real-world considerations:
 * - Order book consumption
 * - Market impact
 * - Execution timing
 * - Partial fills
 * - Network latency simulation
 *
 * This is used for:
 * 1. Paper trading mode
 * 2. Pre-trade validation before real execution
 * 3. Backtesting strategies
 */

import { fetchOrderBook } from './OrderBookService.js';
import { calculateBuyVWAP, calculateSellVWAP } from './VWAPCalculator.js';
import { getExchangeFee } from './LiquidityAnalyzer.js';

/**
 * Execution result structure
 * @typedef {Object} ExecutionResult
 * @property {boolean} success - Whether execution succeeded
 * @property {string} status - 'filled' | 'partial' | 'failed'
 * @property {number} requestedAmount - Amount requested to trade
 * @property {number} filledAmount - Amount actually filled
 * @property {number} avgPrice - Average execution price
 * @property {number} totalValue - Total value of the trade
 * @property {number} fees - Fees paid
 * @property {number} netValue - Value after fees
 * @property {number} slippage - Actual slippage experienced
 * @property {number} executionTimeMs - Simulated execution time
 * @property {string} reason - Failure reason if any
 */

/**
 * Simulate a BUY order execution
 *
 * @param {string} exchange - Exchange name
 * @param {string} symbol - Trading pair
 * @param {number} amount - Amount of base currency to buy
 * @param {Object} options - Execution options
 * @returns {Promise<ExecutionResult>}
 */
export async function simulateBuyOrder(exchange, symbol, amount, options = {}) {
  const {
    maxSlippage = 1.0,       // Max acceptable slippage %
    timeout = 5000,          // Max execution time ms
    simulateLatency = true,  // Add realistic latency
    orderBook = null         // Pre-fetched order book (optional)
  } = options;

  const startTime = Date.now();

  try {
    // Fetch fresh order book if not provided
    const ob = orderBook || await fetchOrderBook(exchange, symbol, 20);

    if (!ob || !ob.asks || ob.asks.length === 0) {
      return createFailedResult(amount, 'No order book data available');
    }

    // Calculate VWAP execution
    const vwapResult = calculateBuyVWAP(ob.asks, amount);

    if (!vwapResult.canFill) {
      return createFailedResult(
        amount,
        `Insufficient liquidity. Requested: ${amount}, Available: ${vwapResult.filledAmount}`
      );
    }

    // Check slippage
    if (vwapResult.slippage > maxSlippage) {
      return createFailedResult(
        amount,
        `Slippage too high: ${vwapResult.slippage.toFixed(3)}% > ${maxSlippage}%`
      );
    }

    // Calculate fees
    const feeRate = getExchangeFee(exchange);
    const fees = vwapResult.totalCost * feeRate;

    // Simulate execution latency
    let executionTimeMs = Date.now() - startTime;
    if (simulateLatency) {
      const latency = 50 + Math.random() * 200; // 50-250ms
      await new Promise(resolve => setTimeout(resolve, latency));
      executionTimeMs = Date.now() - startTime;
    }

    // Check timeout
    if (executionTimeMs > timeout) {
      return createFailedResult(amount, 'Execution timeout');
    }

    return {
      success: true,
      status: 'filled',
      side: 'buy',
      exchange,
      symbol,
      requestedAmount: amount,
      filledAmount: vwapResult.filledAmount,
      avgPrice: vwapResult.vwap,
      bestPrice: vwapResult.bestPrice,
      worstPrice: vwapResult.worstPrice,
      totalCost: vwapResult.totalCost,
      fees,
      netCost: vwapResult.totalCost + fees,
      slippage: vwapResult.slippage,
      priceImpact: vwapResult.priceImpact,
      levelsUsed: vwapResult.levelsUsed,
      executionTimeMs,
      timestamp: Date.now()
    };

  } catch (error) {
    return createFailedResult(amount, error.message);
  }
}

/**
 * Simulate a SELL order execution
 *
 * @param {string} exchange - Exchange name
 * @param {string} symbol - Trading pair
 * @param {number} amount - Amount of base currency to sell
 * @param {Object} options - Execution options
 * @returns {Promise<ExecutionResult>}
 */
export async function simulateSellOrder(exchange, symbol, amount, options = {}) {
  const {
    maxSlippage = 1.0,
    timeout = 5000,
    simulateLatency = true,
    orderBook = null
  } = options;

  const startTime = Date.now();

  try {
    const ob = orderBook || await fetchOrderBook(exchange, symbol, 20);

    if (!ob || !ob.bids || ob.bids.length === 0) {
      return createFailedResult(amount, 'No order book data available');
    }

    const vwapResult = calculateSellVWAP(ob.bids, amount);

    if (!vwapResult.canFill) {
      return createFailedResult(
        amount,
        `Insufficient liquidity. Requested: ${amount}, Available: ${vwapResult.filledAmount}`
      );
    }

    if (vwapResult.slippage > maxSlippage) {
      return createFailedResult(
        amount,
        `Slippage too high: ${vwapResult.slippage.toFixed(3)}% > ${maxSlippage}%`
      );
    }

    const feeRate = getExchangeFee(exchange);
    const fees = vwapResult.totalRevenue * feeRate;

    let executionTimeMs = Date.now() - startTime;
    if (simulateLatency) {
      const latency = 50 + Math.random() * 200;
      await new Promise(resolve => setTimeout(resolve, latency));
      executionTimeMs = Date.now() - startTime;
    }

    if (executionTimeMs > timeout) {
      return createFailedResult(amount, 'Execution timeout');
    }

    return {
      success: true,
      status: 'filled',
      side: 'sell',
      exchange,
      symbol,
      requestedAmount: amount,
      filledAmount: vwapResult.filledAmount,
      avgPrice: vwapResult.vwap,
      bestPrice: vwapResult.bestPrice,
      worstPrice: vwapResult.worstPrice,
      totalRevenue: vwapResult.totalRevenue,
      fees,
      netRevenue: vwapResult.totalRevenue - fees,
      slippage: vwapResult.slippage,
      priceImpact: vwapResult.priceImpact,
      levelsUsed: vwapResult.levelsUsed,
      executionTimeMs,
      timestamp: Date.now()
    };

  } catch (error) {
    return createFailedResult(amount, error.message);
  }
}

/**
 * Simulate complete arbitrage execution (buy on A, sell on B)
 *
 * @param {Object} opportunity - Arbitrage opportunity from ArbitrageEngine
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Arbitrage execution result
 */
export async function simulateArbitrageExecution(opportunity, options = {}) {
  const {
    tradeAmount = opportunity.optimalTradeAmount,
    maxSlippage = 0.5,
    timeout = 10000,
    simulateLatency = true
  } = options;

  const startTime = Date.now();
  const { symbol, buyExchange, sellExchange } = opportunity;

  console.log(`\n📊 Simulating Arbitrage Execution`);
  console.log(`   Symbol: ${symbol}`);
  console.log(`   Buy: ${buyExchange} → Sell: ${sellExchange}`);
  console.log(`   Amount: ${tradeAmount.toFixed(6)}`);

  // Step 1: Execute BUY order
  console.log(`\n1️⃣  Executing BUY on ${buyExchange}...`);
  const buyResult = await simulateBuyOrder(buyExchange, symbol, tradeAmount, {
    maxSlippage,
    timeout: timeout / 2,
    simulateLatency
  });

  if (!buyResult.success) {
    return {
      success: false,
      stage: 'buy',
      reason: buyResult.reason,
      buyResult,
      sellResult: null,
      totalExecutionTimeMs: Date.now() - startTime
    };
  }

  console.log(`   ✅ BUY filled: ${buyResult.filledAmount.toFixed(6)} @ ${buyResult.avgPrice.toFixed(6)}`);

  // Step 2: Execute SELL order with the amount we actually bought
  console.log(`\n2️⃣  Executing SELL on ${sellExchange}...`);
  const sellResult = await simulateSellOrder(sellExchange, symbol, buyResult.filledAmount, {
    maxSlippage,
    timeout: timeout / 2,
    simulateLatency
  });

  if (!sellResult.success) {
    return {
      success: false,
      stage: 'sell',
      reason: sellResult.reason,
      buyResult,
      sellResult,
      totalExecutionTimeMs: Date.now() - startTime,
      // Note: In real trading, we now own the asset and need to handle this
      warning: 'Buy executed but sell failed - position is now open!'
    };
  }

  console.log(`   ✅ SELL filled: ${sellResult.filledAmount.toFixed(6)} @ ${sellResult.avgPrice.toFixed(6)}`);

  // Calculate P&L
  const grossProfit = sellResult.netRevenue - buyResult.netCost;
  const grossProfitPercent = (grossProfit / buyResult.netCost) * 100;

  const totalFees = buyResult.fees + sellResult.fees;
  const totalSlippage = buyResult.slippage + sellResult.slippage;

  const executionTimeMs = Date.now() - startTime;

  console.log(`\n📈 Arbitrage Result:`);
  console.log(`   Gross Profit: $${grossProfit.toFixed(4)} (${grossProfitPercent.toFixed(4)}%)`);
  console.log(`   Total Fees: $${totalFees.toFixed(4)}`);
  console.log(`   Total Slippage: ${totalSlippage.toFixed(4)}%`);
  console.log(`   Execution Time: ${executionTimeMs}ms`);

  return {
    success: true,
    stage: 'complete',
    symbol,
    buyExchange,
    sellExchange,

    // Trade details
    tradedAmount: buyResult.filledAmount,
    buyPrice: buyResult.avgPrice,
    sellPrice: sellResult.avgPrice,

    // Costs
    buyCost: buyResult.netCost,
    sellRevenue: sellResult.netRevenue,
    buyFees: buyResult.fees,
    sellFees: sellResult.fees,
    totalFees,

    // Profit
    grossProfit,
    grossProfitPercent,

    // Slippage
    buySlippage: buyResult.slippage,
    sellSlippage: sellResult.slippage,
    totalSlippage,

    // Performance
    totalExecutionTimeMs: executionTimeMs,
    buyExecutionTimeMs: buyResult.executionTimeMs,
    sellExecutionTimeMs: sellResult.executionTimeMs,

    // Raw results
    buyResult,
    sellResult,

    // Metadata
    timestamp: Date.now(),
    executedAt: new Date().toISOString()
  };
}

/**
 * Validate if an opportunity is still executable
 * (Re-check order books before actual execution)
 *
 * @param {Object} opportunity - Opportunity to validate
 * @returns {Promise<Object>} Validation result
 */
export async function validateOpportunity(opportunity) {
  const { symbol, buyExchange, sellExchange, optimalTradeAmount } = opportunity;

  // Fetch fresh order books
  const [buyOB, sellOB] = await Promise.all([
    fetchOrderBook(buyExchange, symbol, 20),
    fetchOrderBook(sellExchange, symbol, 20)
  ]);

  if (!buyOB || !sellOB) {
    return {
      isValid: false,
      reason: 'Could not fetch order books'
    };
  }

  // Check if spread still exists
  if (sellOB.bestBid <= buyOB.bestAsk) {
    return {
      isValid: false,
      reason: 'Spread no longer exists',
      currentBestAsk: buyOB.bestAsk,
      currentBestBid: sellOB.bestBid
    };
  }

  // Calculate current VWAP
  const buyVWAP = calculateBuyVWAP(buyOB.asks, optimalTradeAmount);
  const sellVWAP = calculateSellVWAP(sellOB.bids, optimalTradeAmount);

  if (!buyVWAP.canFill || !sellVWAP.canFill) {
    return {
      isValid: false,
      reason: 'Insufficient liquidity',
      buyFillable: buyVWAP.filledAmount,
      sellFillable: sellVWAP.filledAmount,
      requested: optimalTradeAmount
    };
  }

  // Calculate current profit
  const buyFee = getExchangeFee(buyExchange);
  const sellFee = getExchangeFee(sellExchange);
  const totalCostPercent = (buyFee + sellFee) * 100 + buyVWAP.slippage + sellVWAP.slippage;

  const grossSpread = ((sellVWAP.vwap - buyVWAP.vwap) / buyVWAP.vwap) * 100;
  const netProfit = grossSpread - totalCostPercent;

  return {
    isValid: netProfit > 0,
    reason: netProfit > 0 ? 'Opportunity still valid' : 'No longer profitable',
    originalNetProfit: opportunity.netProfitPercent,
    currentNetProfit: netProfit,
    profitChange: netProfit - opportunity.netProfitPercent,
    currentBuyVWAP: buyVWAP.vwap,
    currentSellVWAP: sellVWAP.vwap,
    currentSlippage: buyVWAP.slippage + sellVWAP.slippage,
    timeSinceDetection: Date.now() - opportunity.timestamp
  };
}

/**
 * Create a failed execution result
 */
function createFailedResult(requestedAmount, reason) {
  return {
    success: false,
    status: 'failed',
    requestedAmount,
    filledAmount: 0,
    avgPrice: 0,
    totalValue: 0,
    fees: 0,
    netValue: 0,
    slippage: 0,
    executionTimeMs: 0,
    reason,
    timestamp: Date.now()
  };
}

/**
 * Paper trading tracker
 * Tracks simulated trades for testing strategies
 */
class PaperTradingTracker {
  constructor(initialBalanceUSD = 10000) {
    this.initialBalance = initialBalanceUSD;
    this.balance = initialBalanceUSD;
    this.trades = [];
    this.totalProfit = 0;
    this.winCount = 0;
    this.lossCount = 0;
  }

  recordTrade(executionResult) {
    if (!executionResult.success) {
      return { recorded: false, reason: 'Trade not successful' };
    }

    const profit = executionResult.grossProfit;
    this.balance += profit;
    this.totalProfit += profit;

    if (profit > 0) {
      this.winCount++;
    } else {
      this.lossCount++;
    }

    this.trades.push({
      ...executionResult,
      balanceAfter: this.balance,
      runningProfit: this.totalProfit
    });

    return { recorded: true, newBalance: this.balance };
  }

  getStats() {
    const totalTrades = this.winCount + this.lossCount;

    return {
      initialBalance: this.initialBalance,
      currentBalance: this.balance,
      totalProfit: this.totalProfit,
      profitPercent: ((this.balance - this.initialBalance) / this.initialBalance) * 100,
      totalTrades,
      winCount: this.winCount,
      lossCount: this.lossCount,
      winRate: totalTrades > 0 ? (this.winCount / totalTrades) * 100 : 0,
      avgProfitPerTrade: totalTrades > 0 ? this.totalProfit / totalTrades : 0,
      trades: this.trades
    };
  }

  reset() {
    this.balance = this.initialBalance;
    this.trades = [];
    this.totalProfit = 0;
    this.winCount = 0;
    this.lossCount = 0;
  }
}

// Create singleton paper trading tracker
export const paperTrader = new PaperTradingTracker();

export default {
  simulateBuyOrder,
  simulateSellOrder,
  simulateArbitrageExecution,
  validateOpportunity,
  paperTrader,
  PaperTradingTracker
};
