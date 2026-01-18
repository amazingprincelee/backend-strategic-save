/**
 * Enhanced Arbitrage Opportunity Finder
 * Finds ALL arbitrage opportunities and provides filtering options
 */

// Default configuration
const DEFAULT_CONFIG = {
  minProfitPercent: 0.001,      // Show opportunities with even 0.001% profit
  minVolume: 0.0001,             // Minimum tradeable volume (in base currency)
  includeZeroVolume: false,      // Include exchanges with 0 volume
  sortBy: 'profitPercent',       // 'profitPercent' | 'profitDollar' | 'volume'
  sortOrder: 'desc',             // 'desc' | 'asc'
  requireTransferable: false     // Only show if both exchanges allow transfers
};

/**
 * Find all arbitrage opportunities from price data
 * @param {Object} allPricesData - Object with symbol as key and array of exchange data as value
 * @param {Object} config - Configuration options (optional)
 * @returns {Array} Array of opportunities sorted by profit
 */
export function findArbitrageOpportunities(allPricesData, config = {}) {
  // Merge user config with defaults
  const settings = { ...DEFAULT_CONFIG, ...config };
  
  const opportunities = [];
  let totalPairs = 0;
  let pairsWithData = 0;
  
  console.log('\n🔍 Analyzing arbitrage opportunities...');
  console.log(`   Min Profit Threshold: ${settings.minProfitPercent}%`);
  console.log(`   Min Volume: ${settings.minVolume}\n`);
  
  // Loop through each coin pair
  for (const [symbol, exchangePrices] of Object.entries(allPricesData)) {
    totalPairs++;
    
    if (exchangePrices.length < 2) continue; // Need at least 2 exchanges
    
    pairsWithData++;
    
    // Find the exchange with lowest ask (best buy price)
    // Find the exchange with highest bid (best sell price)
    let lowestAsk = { exchange: null, price: Infinity, volume: 0, data: null };
    let highestBid = { exchange: null, price: -Infinity, volume: 0, data: null };
    
    for (const exchangeData of exchangePrices) {
      // Skip if require transferable and this exchange doesn't support it
      if (settings.requireTransferable && !exchangeData.isFullyTransferable) {
        continue;
      }
      
      // Skip zero volume exchanges if configured
      if (!settings.includeZeroVolume && exchangeData.volume === 0) {
        continue;
      }
      
      // Check if we have valid bid/ask data
      const askPrice = exchangeData.asks?.[0]?.[0];
      const askVolume = exchangeData.asks?.[0]?.[1];
      const bidPrice = exchangeData.bids?.[0]?.[0];
      const bidVolume = exchangeData.bids?.[0]?.[1];
      
      // Track lowest ask (where we can buy cheapest)
      if (askPrice && askPrice < lowestAsk.price) {
        lowestAsk = {
          exchange: exchangeData.exchange,
          price: askPrice,
          volume: askVolume || 0,
          data: exchangeData
        };
      }
      
      // Track highest bid (where we can sell for most)
      if (bidPrice && bidPrice > highestBid.price) {
        highestBid = {
          exchange: exchangeData.exchange,
          price: bidPrice,
          volume: bidVolume || 0,
          data: exchangeData
        };
      }
    }
    
    // Skip if we don't have both buy and sell prices
    if (!lowestAsk.exchange || !highestBid.exchange) continue;
    
    // Skip if it's the same exchange
    if (lowestAsk.exchange === highestBid.exchange) continue;
    
    // Calculate profit
    const profitPerCoin = highestBid.price - lowestAsk.price;
    const profitPercent = (profitPerCoin / lowestAsk.price) * 100;
    
    // Skip if profit is below threshold
    if (profitPercent < settings.minProfitPercent) continue;
    
    const [coin, quote] = symbol.split('/'); // BTC/USDT -> BTC, USDT
    
    // Get the minimum volume available for trading
    const tradeableVolume = Math.min(lowestAsk.volume, highestBid.volume);
    
    // Skip if volume is below minimum
    if (tradeableVolume < settings.minVolume) continue;
    
    // Calculate potential profit metrics
    const profitDollar = profitPerCoin; // Profit per 1 coin
    const maxProfitDollar = tradeableVolume * profitPerCoin; // Max profit with available volume
    
    // Estimate if profitable after fees
    // Typical exchange fees: 0.1% - 0.25% per trade
    // Total round-trip: 0.2% - 0.5%
    const estimatedFeesPercent = 0.4; // Conservative estimate
    const netProfitPercent = profitPercent - estimatedFeesPercent;
    const isProfitableAfterFees = netProfitPercent > 0;
    
    opportunities.push({
      // Basic info
      coin: coin,
      quote: quote,
      symbol: symbol,
      
      // Exchange info
      buyExchange: lowestAsk.exchange,
      sellExchange: highestBid.exchange,
      
      // Prices
      buyPrice: lowestAsk.price,
      sellPrice: highestBid.price,
      
      // Profit metrics
      profitPercent: profitPercent,
      profitPerCoin: profitPerCoin,
      profitDollar: profitDollar,
      maxProfitDollar: maxProfitDollar,
      netProfitPercent: netProfitPercent,
      isProfitableAfterFees: isProfitableAfterFees,
      
      // Volume info
      tradeableVolume: tradeableVolume,
      buyVolume: lowestAsk.volume,
      sellVolume: highestBid.volume,
      totalVolume24h: Math.max(
        lowestAsk.data?.volume || 0, 
        highestBid.data?.volume || 0
      ),
      
      // Transfer status
      transferStatus: 
        lowestAsk.data?.isFullyTransferable && highestBid.data?.isFullyTransferable 
          ? 'Verified' 
          : lowestAsk.data?.isFullyTransferable === false || highestBid.data?.isFullyTransferable === false
            ? 'Blocked'
            : 'Unknown',
      
      buyTransferable: lowestAsk.data?.isFullyTransferable ?? null,
      sellTransferable: highestBid.data?.isFullyTransferable ?? null,
      
      // Risk assessment
      riskLevel: getRiskLevel(profitPercent, netProfitPercent, tradeableVolume, lowestAsk.data, highestBid.data),
      
      // Fee estimates
      fees: {
        estimatedPercent: estimatedFeesPercent,
        note: netProfitPercent > 0 
          ? `Net profit after fees: ~${netProfitPercent.toFixed(3)}%`
          : `May not cover fees (estimated -${Math.abs(netProfitPercent).toFixed(3)}%)`
      },
      
      // Metadata
      spread: profitPercent,
      spreadDollar: profitPerCoin,
      timestamp: new Date().toISOString(),
      
      // Additional details for reference
      buyOrderBook: lowestAsk.data?.asks?.slice(0, 3) || [],
      sellOrderBook: highestBid.data?.bids?.slice(0, 3) || []
    });
  }
  
  // Sort opportunities
  const sortedOpportunities = sortOpportunities(opportunities, settings.sortBy, settings.sortOrder);
  
  // Log summary
  console.log(`\n✅ Analysis Complete!`);
  console.log(`   Total Pairs Checked: ${totalPairs}`);
  console.log(`   Pairs with Data: ${pairsWithData}`);
  console.log(`   Opportunities Found: ${sortedOpportunities.length}\n`);
  
  if (sortedOpportunities.length > 0) {
    displayTopOpportunities(sortedOpportunities);
    displayStatistics(sortedOpportunities);
  } else {
    console.log('⚠️  No arbitrage opportunities found.');
    console.log('\nPossible reasons:');
    console.log('   • Profit threshold too high (current: ' + settings.minProfitPercent + '%)');
    console.log('   • Volume threshold too high (current: ' + settings.minVolume + ')');
    console.log('   • Markets are very efficient');
    console.log('   • Limited exchange coverage');
    console.log('\nTry adjusting the configuration settings.');
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  return sortedOpportunities;
}

/**
 * Determine risk level for an opportunity
 */
function getRiskLevel(profitPercent, netProfitPercent, volume, buyExchangeData, sellExchangeData) {
  // High risk factors
  if (netProfitPercent <= 0) return 'High';
  if (volume < 0.001) return 'High';
  if (buyExchangeData?.volume === 0 || sellExchangeData?.volume === 0) return 'High';
  
  // Medium risk factors
  if (profitPercent < 0.5) return 'Medium';
  if (volume < 0.01) return 'Medium';
  if (!buyExchangeData?.isFullyTransferable || !sellExchangeData?.isFullyTransferable) return 'Medium';
  
  // Low risk
  return 'Low';
}

/**
 * Sort opportunities by specified criteria
 */
function sortOpportunities(opportunities, sortBy, sortOrder) {
  const sorted = [...opportunities].sort((a, b) => {
    let comparison = 0;
    
    switch (sortBy) {
      case 'profitPercent':
        comparison = b.profitPercent - a.profitPercent;
        break;
      case 'profitDollar':
        comparison = b.maxProfitDollar - a.maxProfitDollar;
        break;
      case 'volume':
        comparison = b.tradeableVolume - a.tradeableVolume;
        break;
      default:
        comparison = b.profitPercent - a.profitPercent;
    }
    
    return sortOrder === 'desc' ? comparison : -comparison;
  });
  
  return sorted;
}

/**
 * Display top opportunities
 */
function displayTopOpportunities(opportunities, count = 5) {
  console.log(`📊 Top ${Math.min(count, opportunities.length)} Opportunities:\n`);
  
  opportunities.slice(0, count).forEach((opp, index) => {
    console.log(`${index + 1}. ${opp.symbol}`);
    console.log(`   Buy:  ${opp.buyExchange.padEnd(10)} @ $${opp.buyPrice.toFixed(6)}`);
    console.log(`   Sell: ${opp.sellExchange.padEnd(10)} @ $${opp.sellPrice.toFixed(6)}`);
    console.log(`   Profit: ${opp.profitPercent.toFixed(4)}% ($${opp.profitPerCoin.toFixed(6)} per ${opp.coin})`);
    console.log(`   Volume: ${opp.tradeableVolume.toFixed(6)} ${opp.coin} (Max profit: $${opp.maxProfitDollar.toFixed(2)})`);
    console.log(`   After Fees: ${opp.netProfitPercent > 0 ? '+' : ''}${opp.netProfitPercent.toFixed(4)}%`);
    console.log(`   Risk: ${opp.riskLevel} | Transfer: ${opp.transferStatus}`);
    console.log('');
  });
}

/**
 * Display statistics
 */
function displayStatistics(opportunities) {
  const profitable = opportunities.filter(o => o.isProfitableAfterFees);
  const avgProfit = opportunities.reduce((sum, o) => sum + o.profitPercent, 0) / opportunities.length;
  const maxProfit = opportunities[0]?.profitPercent || 0;
  const minProfit = opportunities[opportunities.length - 1]?.profitPercent || 0;
  
  console.log(`📈 Statistics:`);
  console.log(`   Total Opportunities: ${opportunities.length}`);
  console.log(`   Profitable After Fees: ${profitable.length} (${((profitable.length / opportunities.length) * 100).toFixed(1)}%)`);
  console.log(`   Average Profit: ${avgProfit.toFixed(4)}%`);
  console.log(`   Highest Profit: ${maxProfit.toFixed(4)}%`);
  console.log(`   Lowest Profit: ${minProfit.toFixed(4)}%`);
  
  // Group by risk level
  const byRisk = opportunities.reduce((acc, opp) => {
    acc[opp.riskLevel] = (acc[opp.riskLevel] || 0) + 1;
    return acc;
  }, {});
  
  console.log(`   Risk Breakdown: Low: ${byRisk.Low || 0} | Medium: ${byRisk.Medium || 0} | High: ${byRisk.High || 0}`);
}

/**
 * Filter opportunities by minimum profit threshold
 */
export function filterByProfit(opportunities, minProfitPercent) {
  return opportunities.filter(opp => opp.profitPercent >= minProfitPercent);
}

/**
 * Filter by profitable after fees
 */
export function filterProfitableAfterFees(opportunities) {
  return opportunities.filter(opp => opp.isProfitableAfterFees);
}

/**
 * Filter by transfer status
 */
export function filterByTransferStatus(opportunities, status = 'Verified') {
  return opportunities.filter(opp => opp.transferStatus === status);
}

/**
 * Filter by risk level
 */
export function filterByRiskLevel(opportunities, maxRisk = 'Medium') {
  const riskOrder = { 'Low': 1, 'Medium': 2, 'High': 3 };
  const maxRiskValue = riskOrder[maxRisk];
  return opportunities.filter(opp => riskOrder[opp.riskLevel] <= maxRiskValue);
}

/**
 * Filter by minimum volume
 */
export function filterByVolume(opportunities, minVolume) {
  return opportunities.filter(opp => opp.tradeableVolume >= minVolume);
}

/**
 * Get opportunities by specific coin
 */
export function getOpportunitiesByCoin(opportunities, coin) {
  return opportunities.filter(opp => 
    opp.coin.toLowerCase() === coin.toLowerCase()
  );
}

/**
 * Group opportunities by coin
 */
export function groupByCoin(opportunities) {
  return opportunities.reduce((acc, opp) => {
    if (!acc[opp.coin]) acc[opp.coin] = [];
    acc[opp.coin].push(opp);
    return acc;
  }, {});
}

/**
 * Calculate potential profit for a specific investment
 */
export function calculatePotentialProfit(opportunity, investmentAmount, customFeePercent = 0.4) {
  const coinsCanBuy = investmentAmount / opportunity.buyPrice;
  const tradeableCoins = Math.min(coinsCanBuy, opportunity.tradeableVolume);
  const actualInvestment = tradeableCoins * opportunity.buyPrice;
  const revenue = tradeableCoins * opportunity.sellPrice;
  const profitBeforeFees = revenue - actualInvestment;
  
  // Calculate fees
  const buyFee = actualInvestment * (customFeePercent / 100);
  const sellFee = revenue * (customFeePercent / 100);
  const totalFees = buyFee + sellFee;
  
  const profitAfterFees = profitBeforeFees - totalFees;
  const roi = (profitAfterFees / actualInvestment) * 100;
  
  return {
    // Input
    requestedInvestment: investmentAmount,
    feePercent: customFeePercent,
    
    // Calculation
    coinsCanBuy,
    tradeableCoins,
    volumeLimited: tradeableCoins < coinsCanBuy,
    actualInvestment,
    
    // Revenue
    revenue,
    profitBeforeFees,
    
    // Fees
    buyFee,
    sellFee,
    totalFees,
    
    // Final result
    profitAfterFees,
    roi,
    isWorthwhile: profitAfterFees > 0
  };
}

/**
 * Export default configuration
 */
export { DEFAULT_CONFIG };