/**
 * VWAP (Volume Weighted Average Price) Calculator
 *
 * Calculates the true execution price when trading a specific amount
 * by walking through the order book levels.
 *
 * Why VWAP matters for arbitrage:
 * - Best bid/ask prices only show the TOP of the order book
 * - If you want to trade $10,000, you'll likely fill multiple price levels
 * - VWAP gives you the REAL average price you'd pay/receive
 * - This prevents "fake" arbitrage opportunities that disappear with size
 */

/**
 * Calculate VWAP for BUYING a specific amount of base currency
 * (Walking through ASK orders - we're taking liquidity)
 *
 * @param {Array} asks - Ask orders [{price, amount, total, cost}, ...]
 * @param {number} targetAmount - Amount of base currency to buy
 * @returns {Object} VWAP calculation result
 */
export function calculateBuyVWAP(asks, targetAmount) {
  if (!asks || asks.length === 0 || targetAmount <= 0) {
    return {
      canFill: false,
      vwap: 0,
      totalCost: 0,
      filledAmount: 0,
      levelsUsed: 0,
      slippage: 0,
      priceImpact: 0
    };
  }

  let filledAmount = 0;
  let totalCost = 0;
  let levelsUsed = 0;
  const bestAsk = asks[0].price;

  for (const order of asks) {
    const remainingToFill = targetAmount - filledAmount;

    if (remainingToFill <= 0) break;

    levelsUsed++;

    if (order.amount >= remainingToFill) {
      // This level can fill the remaining amount
      totalCost += remainingToFill * order.price;
      filledAmount += remainingToFill;
    } else {
      // Take all liquidity at this level and continue
      totalCost += order.amount * order.price;
      filledAmount += order.amount;
    }
  }

  const canFill = filledAmount >= targetAmount * 0.99; // Allow 1% tolerance
  const vwap = filledAmount > 0 ? totalCost / filledAmount : 0;

  // Slippage = how much worse than best price
  const slippage = bestAsk > 0 ? ((vwap - bestAsk) / bestAsk) * 100 : 0;

  // Price impact = how much the order moved the market
  const worstPrice = asks[levelsUsed - 1]?.price || bestAsk;
  const priceImpact = bestAsk > 0 ? ((worstPrice - bestAsk) / bestAsk) * 100 : 0;

  return {
    canFill,
    vwap,
    totalCost,
    filledAmount,
    levelsUsed,
    bestPrice: bestAsk,
    worstPrice,
    slippage,
    priceImpact,
    averageOrderSize: filledAmount / levelsUsed
  };
}

/**
 * Calculate VWAP for SELLING a specific amount of base currency
 * (Walking through BID orders - we're taking liquidity)
 *
 * @param {Array} bids - Bid orders [{price, amount, total, cost}, ...]
 * @param {number} targetAmount - Amount of base currency to sell
 * @returns {Object} VWAP calculation result
 */
export function calculateSellVWAP(bids, targetAmount) {
  if (!bids || bids.length === 0 || targetAmount <= 0) {
    return {
      canFill: false,
      vwap: 0,
      totalRevenue: 0,
      filledAmount: 0,
      levelsUsed: 0,
      slippage: 0,
      priceImpact: 0
    };
  }

  let filledAmount = 0;
  let totalRevenue = 0;
  let levelsUsed = 0;
  const bestBid = bids[0].price;

  for (const order of bids) {
    const remainingToFill = targetAmount - filledAmount;

    if (remainingToFill <= 0) break;

    levelsUsed++;

    if (order.amount >= remainingToFill) {
      // This level can fill the remaining amount
      totalRevenue += remainingToFill * order.price;
      filledAmount += remainingToFill;
    } else {
      // Take all liquidity at this level and continue
      totalRevenue += order.amount * order.price;
      filledAmount += order.amount;
    }
  }

  const canFill = filledAmount >= targetAmount * 0.99; // Allow 1% tolerance
  const vwap = filledAmount > 0 ? totalRevenue / filledAmount : 0;

  // Slippage = how much worse than best price (for sells, lower is worse)
  const slippage = bestBid > 0 ? ((bestBid - vwap) / bestBid) * 100 : 0;

  // Price impact
  const worstPrice = bids[levelsUsed - 1]?.price || bestBid;
  const priceImpact = bestBid > 0 ? ((bestBid - worstPrice) / bestBid) * 100 : 0;

  return {
    canFill,
    vwap,
    totalRevenue,
    filledAmount,
    levelsUsed,
    bestPrice: bestBid,
    worstPrice,
    slippage,
    priceImpact,
    averageOrderSize: filledAmount / levelsUsed
  };
}

/**
 * Calculate maximum fillable amount from order book
 *
 * @param {Array} orders - Order book orders
 * @returns {Object} Maximum fillable details
 */
export function calculateMaxFillable(orders) {
  if (!orders || orders.length === 0) {
    return { maxAmount: 0, maxValue: 0 };
  }

  const lastOrder = orders[orders.length - 1];
  return {
    maxAmount: lastOrder.total,
    maxValue: lastOrder.cost
  };
}

/**
 * Find the optimal trade size that maintains acceptable slippage
 *
 * @param {Array} orders - Order book orders
 * @param {number} maxSlippagePercent - Maximum acceptable slippage (e.g., 0.5 for 0.5%)
 * @param {boolean} isBuy - Whether this is a buy order
 * @returns {Object} Optimal trade size details
 */
export function findOptimalTradeSize(orders, maxSlippagePercent = 0.5, isBuy = true) {
  if (!orders || orders.length === 0) {
    return {
      optimalAmount: 0,
      optimalValue: 0,
      slippage: 0
    };
  }

  const bestPrice = orders[0].price;
  let optimalAmount = 0;
  let optimalValue = 0;
  let optimalSlippage = 0;

  // Binary search for optimal amount
  const { maxAmount } = calculateMaxFillable(orders);

  // Test different amounts
  const testAmounts = [];
  for (let pct = 0.01; pct <= 1; pct += 0.01) {
    testAmounts.push(maxAmount * pct);
  }

  for (const testAmount of testAmounts) {
    const result = isBuy
      ? calculateBuyVWAP(orders, testAmount)
      : calculateSellVWAP(orders, testAmount);

    if (result.slippage <= maxSlippagePercent && result.canFill) {
      optimalAmount = testAmount;
      optimalValue = isBuy ? result.totalCost : result.totalRevenue;
      optimalSlippage = result.slippage;
    } else {
      break; // Slippage exceeded, stop searching
    }
  }

  return {
    optimalAmount,
    optimalValue,
    slippage: optimalSlippage,
    maxSlippagePercent
  };
}

/**
 * Calculate VWAP-based arbitrage metrics between two exchanges
 *
 * @param {Object} buyOrderBook - Order book where we buy (asks)
 * @param {Object} sellOrderBook - Order book where we sell (bids)
 * @param {number} tradeAmount - Amount of base currency to trade
 * @returns {Object} Arbitrage metrics
 */
export function calculateArbitrageVWAP(buyOrderBook, sellOrderBook, tradeAmount) {
  const buyResult = calculateBuyVWAP(buyOrderBook.asks, tradeAmount);
  const sellResult = calculateSellVWAP(sellOrderBook.bids, tradeAmount);

  // Check if both sides can fill
  if (!buyResult.canFill || !sellResult.canFill) {
    return {
      canExecute: false,
      reason: !buyResult.canFill ? 'Insufficient buy liquidity' : 'Insufficient sell liquidity',
      buyVWAP: buyResult.vwap,
      sellVWAP: sellResult.vwap,
      tradeAmount,
      filledAmount: Math.min(buyResult.filledAmount, sellResult.filledAmount)
    };
  }

  const actualAmount = Math.min(buyResult.filledAmount, sellResult.filledAmount);
  const buyCost = buyResult.vwap * actualAmount;
  const sellRevenue = sellResult.vwap * actualAmount;
  const grossProfit = sellRevenue - buyCost;
  const grossProfitPercent = buyCost > 0 ? (grossProfit / buyCost) * 100 : 0;

  return {
    canExecute: true,
    buyExchange: buyOrderBook.exchange,
    sellExchange: sellOrderBook.exchange,
    tradeAmount: actualAmount,
    buyVWAP: buyResult.vwap,
    sellVWAP: sellResult.vwap,
    buyCost,
    sellRevenue,
    grossProfit,
    grossProfitPercent,
    buySlippage: buyResult.slippage,
    sellSlippage: sellResult.slippage,
    totalSlippage: buyResult.slippage + sellResult.slippage,
    buyLevelsUsed: buyResult.levelsUsed,
    sellLevelsUsed: sellResult.levelsUsed
  };
}

/**
 * Find the optimal trade amount for arbitrage between two order books
 * Maximizes profit while respecting slippage constraints
 *
 * @param {Object} buyOrderBook - Order book where we buy
 * @param {Object} sellOrderBook - Order book where we sell
 * @param {number} maxSlippagePercent - Maximum total slippage allowed
 * @returns {Object} Optimal arbitrage parameters
 */
export function findOptimalArbitrageSize(buyOrderBook, sellOrderBook, maxSlippagePercent = 1.0) {
  const buyMax = calculateMaxFillable(buyOrderBook.asks);
  const sellMax = calculateMaxFillable(sellOrderBook.bids);

  // Maximum possible trade is limited by smaller order book
  const maxPossibleAmount = Math.min(buyMax.maxAmount, sellMax.maxAmount);

  if (maxPossibleAmount <= 0) {
    return { optimalAmount: 0, maxProfit: 0, reason: 'No liquidity' };
  }

  let optimalAmount = 0;
  let maxProfit = 0;
  let optimalMetrics = null;

  // Test different trade sizes
  const steps = 50;
  for (let i = 1; i <= steps; i++) {
    const testAmount = (maxPossibleAmount / steps) * i;
    const metrics = calculateArbitrageVWAP(buyOrderBook, sellOrderBook, testAmount);

    if (!metrics.canExecute) continue;

    // Check slippage constraint
    if (metrics.totalSlippage > maxSlippagePercent) continue;

    // Check if profitable
    if (metrics.grossProfit > maxProfit) {
      maxProfit = metrics.grossProfit;
      optimalAmount = testAmount;
      optimalMetrics = metrics;
    }
  }

  return {
    optimalAmount,
    maxProfit,
    metrics: optimalMetrics,
    maxSlippagePercent
  };
}

export default {
  calculateBuyVWAP,
  calculateSellVWAP,
  calculateMaxFillable,
  findOptimalTradeSize,
  calculateArbitrageVWAP,
  findOptimalArbitrageSize
};
