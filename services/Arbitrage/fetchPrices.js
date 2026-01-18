import { exchanges } from '../../config/Arbitrage/ccxtExchanges.js';
import { TOP_100_PAIRS } from '../../utils/top100Coins.js';
import { findArbitrageOpportunities } from './findArbitrage.js';

// Cache for storing opportunities
let cachedOpportunities = [];
let lastUpdateTime = null;
let isCurrentlyFetching = false;
let fetchError = null;

// Configuration
const UPDATE_INTERVAL = 30 * 60 * 1000; // 5 minutes
const RATE_LIMIT_DELAY = 2000; // 2 seconds between requests

async function checkTransferability(exchange, symbol) {
  try {
    const [base, quote] = symbol.split('/');
    const currencies = await exchange.fetchCurrencies();
    
    const baseCurrency = currencies[base];
    const quoteCurrency = currencies[quote];
    
    return {
      baseDeposit: baseCurrency?.deposit ?? true,
      baseWithdraw: baseCurrency?.withdraw ?? true,
      quoteDeposit: quoteCurrency?.deposit ?? true,
      quoteWithdraw: quoteCurrency?.withdraw ?? true,
      isFullyTransferable: 
        (baseCurrency?.deposit && baseCurrency?.withdraw && 
         quoteCurrency?.deposit && quoteCurrency?.withdraw) ?? false
    };
  } catch (err) {
    return {
      baseDeposit: null,
      baseWithdraw: null,
      quoteDeposit: null,
      quoteWithdraw: null,
      isFullyTransferable: null
    };
  }
}

// Fetches prices for ONE symbol from all exchanges
const fetchPrices = async (symbol) => { 
  const prices = [];
  
  for (const [name, exchange] of Object.entries(exchanges)) {
    try {
      const [ticker, orderBook, transferInfo] = await Promise.all([
        exchange.fetchTicker(symbol),
        exchange.fetchOrderBook(symbol, 10),
        checkTransferability(exchange, symbol)
      ]);
      
      prices.push({
        exchange: name,
        symbol: symbol,
        bids: orderBook.bids.slice(0, 2), 
        asks: orderBook.asks.slice(0, 2), 
        last: ticker.last,
        volume: ticker.quoteVolume || 0,
        canDepositBase: transferInfo.baseDeposit,
        canWithdrawBase: transferInfo.baseWithdraw,
        canDepositQuote: transferInfo.quoteDeposit,
        canWithdrawQuote: transferInfo.quoteWithdraw,
        isFullyTransferable: transferInfo.isFullyTransferable,
      });
    } catch (err) {
      // Silently skip errors
    }
  }
  
  return prices;
}

// Background fetch function
const fetchAllPriceData = async () => {
  if (isCurrentlyFetching) {
    console.log('⏳ Fetch already in progress, skipping...');
    return;
  }

  isCurrentlyFetching = true;
  fetchError = null;
  console.log(`\n🔄 Starting background fetch of ${TOP_100_PAIRS.length} pairs...`);
  console.log(`⏰ Started at: ${new Date().toLocaleString()}\n`);
  
  const allPricesData = {};
  
  try {
    for (let i = 0; i < TOP_100_PAIRS.length; i++) {
      const pair = TOP_100_PAIRS[i];
      
      console.log(`[${i + 1}/${TOP_100_PAIRS.length}] Fetching ${pair}...`);
      
      const prices = await fetchPrices(pair);
      
      if (prices.length > 0) {
        allPricesData[pair] = prices;
        console.log(`  ✓ Found on ${prices.length} exchanges`);
      } else {
        console.log(`  ✗ Not available`);
      }
      
      // Rate limiting
      if (i < TOP_100_PAIRS.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      }
    }
    
    console.log('\n✅ DONE FETCHING');
    console.log(`Successfully fetched ${Object.keys(allPricesData).length} pairs`);
    
    console.log('\n🔍 ANALYZING ARBITRAGE OPPORTUNITIES...\n');
    const opportunities = findArbitrageOpportunities(allPricesData);
    
    // Update cache
    cachedOpportunities = opportunities;
    lastUpdateTime = new Date();
    
    console.log(`✅ Cache updated with ${opportunities.length} opportunities`);
    console.log(`⏰ Next update in ${UPDATE_INTERVAL / 1000 / 60} minutes\n`);
    
  } catch (error) {
    console.error('❌ Error during background fetch:', error);
    fetchError = error.message;
  } finally {
    isCurrentlyFetching = false;
  }
}

// Get cached opportunities (for API endpoint)
export const getCachedOpportunities = () => {
  return {
    opportunities: cachedOpportunities,
    lastUpdate: lastUpdateTime,
    isLoading: isCurrentlyFetching,
    error: fetchError,
    nextUpdate: lastUpdateTime 
      ? new Date(lastUpdateTime.getTime() + UPDATE_INTERVAL)
      : null
  };
}

// Manual refresh trigger
export const refreshOpportunities = async () => {
  await fetchAllPriceData();
  return getCachedOpportunities();
}

// Initialize background fetching
export const initializeBackgroundFetch = () => {
  console.log('🚀 Initializing arbitrage background fetch service...');
  
  // Initial fetch
  fetchAllPriceData();
  
  // Schedule periodic updates
  setInterval(() => {
    console.log('\n⏰ Scheduled update triggered');
    fetchAllPriceData();
  }, UPDATE_INTERVAL);
  
  console.log(`✅ Background fetch service started (updates every ${UPDATE_INTERVAL / 1000 / 60} minutes)`);
}

// Check if cache is ready
export const isCacheReady = () => {
  return cachedOpportunities.length > 0 && lastUpdateTime !== null;
}

// Legacy function for backward compatibility (not recommended to use)
export const getAllPriceData = async () => {
  console.warn('⚠️  getAllPriceData() called - This is deprecated. Use getCachedOpportunities() instead.');
  
  if (isCacheReady()) {
    return cachedOpportunities;
  }
  
  // If cache is empty, do a blocking fetch (not recommended)
  await fetchAllPriceData();
  return cachedOpportunities;
}