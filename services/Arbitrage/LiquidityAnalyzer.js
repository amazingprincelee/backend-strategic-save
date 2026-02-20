/**
 * Liquidity Analyzer Service
 *
 * Analyzes order book depth and provides liquidity metrics
 * Essential for determining if an arbitrage opportunity is truly executable
 *
 * Key Metrics:
 * - Liquidity Score: Overall health of the order book
 * - Depth Analysis: How much can be traded at various price levels
 * - Imbalance: Buy vs sell pressure
 * - Stability: How likely prices are to move
 */

/**
 * Exchange-specific trading fees (taker fees - we're taking liquidity)
 * These are default fees; VIP levels have lower fees
 */
export const EXCHANGE_FEES = {
  binance: 0.001,     // 0.1%
  kucoin: 0.001,      // 0.1%
  gateio: 0.002,      // 0.2%
  bybit: 0.001,       // 0.1%
  okx: 0.001,         // 0.1%
  mexc: 0.002,        // 0.2%
  huobi: 0.002,       // 0.2%
  kraken: 0.0026,     // 0.26%
  coinbase: 0.006,    // 0.6% (highest)
  bitget: 0.001,      // 0.1%
  poloniex: 0.00155,  // 0.155%
  bigone: 0.002,      // 0.2%
  default: 0.002      // 0.2% default assumption
};

/**
 * Get trading fee for an exchange
 * @param {string} exchangeName - Exchange identifier
 * @returns {number} Fee as decimal (e.g., 0.001 for 0.1%)
 */
export function getExchangeFee(exchangeName) {
  return EXCHANGE_FEES[exchangeName.toLowerCase()] || EXCHANGE_FEES.default;
}

/**
 * Analyze liquidity depth at various USD levels
 * @param {Object} orderBook - Normalized order book
 * @param {number[]} usdLevels - USD amounts to analyze (default: [100, 500, 1000, 5000, 10000])
 * @returns {Object} Depth analysis
 */
export function analyzeDepth(orderBook, usdLevels = [100, 500, 1000, 5000, 10000]) {
  const { asks, bids, midPrice } = orderBook;

  const analysis = {
    symbol: orderBook.symbol,
    exchange: orderBook.exchange,
    midPrice,
    buyDepth: {},  // How much can we BUY at each USD level
    sellDepth: {}, // How much can we SELL at each USD level
  };

  for (const usdAmount of usdLevels) {
    // Analyze buy side (asks) - how much base currency can we buy for $X
    const baseAmountToBuy = midPrice > 0 ? usdAmount / midPrice : 0;
    let buyFillable = 0;
    let buyCost = 0;

    for (const ask of asks) {
      const remaining = baseAmountToBuy - buyFillable;
      if (remaining <= 0) break;

      const fillAtLevel = Math.min(ask.amount, remaining);
      buyFillable += fillAtLevel;
      buyCost += fillAtLevel * ask.price;
    }

    analysis.buyDepth[usdAmount] = {
      requestedUSD: usdAmount,
      fillableAmount: buyFillable,
      actualCost: buyCost,
      fillPercent: baseAmountToBuy > 0 ? (buyFillable / baseAmountToBuy) * 100 : 0,
      avgPrice: buyFillable > 0 ? buyCost / buyFillable : 0,
      slippage: midPrice > 0 && buyFillable > 0
        ? (((buyCost / buyFillable) - midPrice) / midPrice) * 100
        : 0
    };

    // Analyze sell side (bids) - how much USD can we get for selling $X worth of base
    const baseAmountToSell = midPrice > 0 ? usdAmount / midPrice : 0;
    let sellFillable = 0;
    let sellRevenue = 0;

    for (const bid of bids) {
      const remaining = baseAmountToSell - sellFillable;
      if (remaining <= 0) break;

      const fillAtLevel = Math.min(bid.amount, remaining);
      sellFillable += fillAtLevel;
      sellRevenue += fillAtLevel * bid.price;
    }

    analysis.sellDepth[usdAmount] = {
      requestedUSD: usdAmount,
      fillableAmount: sellFillable,
      actualRevenue: sellRevenue,
      fillPercent: baseAmountToSell > 0 ? (sellFillable / baseAmountToSell) * 100 : 0,
      avgPrice: sellFillable > 0 ? sellRevenue / sellFillable : 0,
      slippage: midPrice > 0 && sellFillable > 0
        ? ((midPrice - (sellRevenue / sellFillable)) / midPrice) * 100
        : 0
    };
  }

  return analysis;
}

/**
 * Calculate order book imbalance
 * Positive = more buy pressure, Negative = more sell pressure
 *
 * @param {Object} orderBook - Normalized order book
 * @param {number} levels - Number of levels to analyze
 * @returns {Object} Imbalance metrics
 */
export function calculateImbalance(orderBook, levels = 5) {
  const { bids, asks } = orderBook;

  const topBids = bids.slice(0, levels);
  const topAsks = asks.slice(0, levels);

  const bidVolume = topBids.reduce((sum, b) => sum + b.amount, 0);
  const askVolume = topAsks.reduce((sum, a) => sum + a.amount, 0);
  const totalVolume = bidVolume + askVolume;

  // Imbalance ratio: 1 = all bids, -1 = all asks, 0 = balanced
  const imbalanceRatio = totalVolume > 0
    ? (bidVolume - askVolume) / totalVolume
    : 0;

  // Volume ratio: >1 means more bids than asks
  const volumeRatio = askVolume > 0 ? bidVolume / askVolume : 0;

  return {
    bidVolume,
    askVolume,
    totalVolume,
    imbalanceRatio,
    volumeRatio,
    pressure: imbalanceRatio > 0.2 ? 'buy' : imbalanceRatio < -0.2 ? 'sell' : 'neutral',
    levelsAnalyzed: levels
  };
}

/**
 * Calculate liquidity score (0-100)
 * Higher score = better liquidity = safer to trade
 *
 * @param {Object} orderBook - Normalized order book
 * @param {number} targetTradeUSD - Target trade size in USD
 * @returns {Object} Liquidity score and breakdown
 */
export function calculateLiquidityScore(orderBook, targetTradeUSD = 1000) {
  const { spread, spreadPercent, midPrice, bids, asks } = orderBook;

  let score = 100;
  const factors = {};

  // Factor 1: Spread (max 30 points deduction)
  // Good spread < 0.1%, Bad spread > 1%
  const spreadScore = Math.max(0, 30 - (spreadPercent * 30));
  factors.spread = {
    value: spreadPercent,
    score: spreadScore,
    maxScore: 30
  };
  score -= (30 - spreadScore);

  // Factor 2: Depth (max 30 points deduction)
  // Check if we can fill target trade size
  const depthAnalysis = analyzeDepth(orderBook, [targetTradeUSD]);
  const buyFillPercent = depthAnalysis.buyDepth[targetTradeUSD]?.fillPercent || 0;
  const sellFillPercent = depthAnalysis.sellDepth[targetTradeUSD]?.fillPercent || 0;
  const avgFillPercent = (buyFillPercent + sellFillPercent) / 2;

  const depthScore = Math.min(30, avgFillPercent * 0.3);
  factors.depth = {
    buyFillPercent,
    sellFillPercent,
    score: depthScore,
    maxScore: 30
  };
  score -= (30 - depthScore);

  // Factor 3: Order book levels (max 20 points deduction)
  // More levels = better liquidity
  const levelCount = Math.min(bids.length, asks.length);
  const levelScore = Math.min(20, levelCount * 2);
  factors.levels = {
    bidLevels: bids.length,
    askLevels: asks.length,
    score: levelScore,
    maxScore: 20
  };
  score -= (20 - levelScore);

  // Factor 4: Balance (max 20 points deduction)
  // Balanced order book = healthier market
  const imbalance = calculateImbalance(orderBook);
  const balanceScore = 20 - (Math.abs(imbalance.imbalanceRatio) * 20);
  factors.balance = {
    imbalanceRatio: imbalance.imbalanceRatio,
    score: balanceScore,
    maxScore: 20
  };
  score -= (20 - balanceScore);

  // Determine liquidity grade
  let grade;
  if (score >= 80) grade = 'Excellent';
  else if (score >= 60) grade = 'Good';
  else if (score >= 40) grade = 'Fair';
  else if (score >= 20) grade = 'Poor';
  else grade = 'Very Poor';

  return {
    score: Math.max(0, Math.round(score)),
    grade,
    factors,
    targetTradeUSD,
    recommendation: score >= 60
      ? 'Safe to trade'
      : score >= 40
        ? 'Trade with caution'
        : 'Avoid large trades'
  };
}

/**
 * Analyze arbitrage feasibility between two order books
 *
 * @param {Object} buyOrderBook - Order book where we'll buy (use asks)
 * @param {Object} sellOrderBook - Order book where we'll sell (use bids)
 * @param {number} tradeAmountUSD - Target trade amount in USD
 * @returns {Object} Feasibility analysis
 */
export function analyzeArbitrageFeasibility(buyOrderBook, sellOrderBook, tradeAmountUSD = 1000) {
  const buyExchange = buyOrderBook.exchange;
  const sellExchange = sellOrderBook.exchange;

  // Get fees
  const buyFee = getExchangeFee(buyExchange);
  const sellFee = getExchangeFee(sellExchange);
  const totalFees = buyFee + sellFee;

  // Calculate liquidity scores
  const buyLiquidity = calculateLiquidityScore(buyOrderBook, tradeAmountUSD);
  const sellLiquidity = calculateLiquidityScore(sellOrderBook, tradeAmountUSD);

  // Calculate depth analysis
  const buyDepth = analyzeDepth(buyOrderBook, [tradeAmountUSD]);
  const sellDepth = analyzeDepth(sellOrderBook, [tradeAmountUSD]);

  // Check if both sides can fill
  const buyFillPercent = buyDepth.buyDepth[tradeAmountUSD]?.fillPercent || 0;
  const sellFillPercent = sellDepth.sellDepth[tradeAmountUSD]?.fillPercent || 0;

  const canFill = buyFillPercent >= 95 && sellFillPercent >= 95;

  // Calculate expected slippage
  const buySlippage = buyDepth.buyDepth[tradeAmountUSD]?.slippage || 0;
  const sellSlippage = sellDepth.sellDepth[tradeAmountUSD]?.slippage || 0;
  const totalSlippage = buySlippage + sellSlippage;

  // Calculate minimum spread needed to be profitable
  const minProfitableSpread = (totalFees * 100) + totalSlippage;

  // Calculate actual spread
  const actualSpread = sellOrderBook.bestBid > buyOrderBook.bestAsk
    ? ((sellOrderBook.bestBid - buyOrderBook.bestAsk) / buyOrderBook.bestAsk) * 100
    : 0;

  // Is it profitable?
  const isProfitable = actualSpread > minProfitableSpread;
  const expectedProfitPercent = actualSpread - minProfitableSpread;

  return {
    buyExchange,
    sellExchange,
    symbol: buyOrderBook.symbol,
    tradeAmountUSD,

    // Liquidity
    buyLiquidityScore: buyLiquidity.score,
    sellLiquidityScore: sellLiquidity.score,
    avgLiquidityScore: (buyLiquidity.score + sellLiquidity.score) / 2,

    // Fill ability
    canFill,
    buyFillPercent,
    sellFillPercent,

    // Costs
    buyFeePercent: buyFee * 100,
    sellFeePercent: sellFee * 100,
    totalFeesPercent: totalFees * 100,

    // Slippage
    buySlippage,
    sellSlippage,
    totalSlippage,

    // Profitability
    actualSpread,
    minProfitableSpread,
    isProfitable,
    expectedProfitPercent: isProfitable ? expectedProfitPercent : 0,
    expectedProfitUSD: isProfitable ? (expectedProfitPercent / 100) * tradeAmountUSD : 0,

    // Recommendation
    recommendation: !canFill
      ? 'Cannot fill - insufficient liquidity'
      : !isProfitable
        ? `Not profitable - need ${minProfitableSpread.toFixed(3)}% spread, have ${actualSpread.toFixed(3)}%`
        : `Profitable - expected ${expectedProfitPercent.toFixed(3)}% profit`,

    feasibilityScore: canFill && isProfitable
      ? Math.min(100, (buyLiquidity.score + sellLiquidity.score) / 2 + (expectedProfitPercent * 10))
      : 0
  };
}

export default {
  EXCHANGE_FEES,
  getExchangeFee,
  analyzeDepth,
  calculateImbalance,
  calculateLiquidityScore,
  analyzeArbitrageFeasibility
};
