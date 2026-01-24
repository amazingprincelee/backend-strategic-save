import { exchangeManager } from '../../config/Arbitrage/ccxtExchanges.js';
import { TOP_100_PAIRS } from '../../utils/top100Coins.js';
import { findArbitrageOpportunities } from './findArbitrage.js';
import rateLimiter from '../../utils/RateLimiter.js';

// Get exchanges dynamically from manager
const getExchanges = () => exchangeManager.getExchanges();

// Cache for storing opportunities
let cachedOpportunities = [];
let lastUpdateTime = null;
let isCurrentlyFetching = false;
let fetchError = null;

// Configuration
const UPDATE_INTERVAL = 30 * 60 * 1000; // 30 minutes
const CONCURRENCY_LIMIT = 5; // Process 5 pairs at a time (conservative with rate limiting)
const BATCH_DELAY_MS = 50; // Minimal delay between batches

// Cache for currency data (doesn't change frequently)
const currencyCache = new Map();
const CURRENCY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Track fetch statistics
let fetchStats = {
  totalRequests: 0,
  successfulRequests: 0,
  rateLimitHits: 0,
  lastFetchDuration: 0
};

// Get cached currencies for an exchange (with rate limiting)
async function getCachedCurrencies(exchangeName, exchange) {
  const cacheKey = exchangeName;
  const cached = currencyCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CURRENCY_CACHE_TTL) {
    return cached.data;
  }

  try {
    // Use rate limiter for the API call
    const currencies = await rateLimiter.execute(
      exchangeName,
      () => exchange.fetchCurrencies()
    );
    currencyCache.set(cacheKey, { data: currencies, timestamp: Date.now() });
    fetchStats.successfulRequests++;
    return currencies;
  } catch (err) {
    if (err.message?.includes('rate') || err.statusCode === 429) {
      fetchStats.rateLimitHits++;
    }
    return cached?.data || null;
  }
}

/**
 * Extract deposit/withdraw status from CCXT currency object
 * Different exchanges return data in different formats:
 * - Some use: { deposit: true, withdraw: true }
 * - Some use: { active: true }
 * - Some use: { networks: { ETH: { deposit: true, withdraw: true } } }
 * - Some use: { info: { depositEnable: true, withdrawEnable: true } }
 */
function extractTransferStatus(currency) {
  if (!currency) {
    return { deposit: null, withdraw: null };
  }

  let depositEnabled = null;
  let withdrawEnabled = null;

  // Method 1: Direct deposit/withdraw boolean (most common)
  if (typeof currency.deposit === 'boolean') {
    depositEnabled = currency.deposit;
  }
  if (typeof currency.withdraw === 'boolean') {
    withdrawEnabled = currency.withdraw;
  }

  // Method 2: Check 'active' field (some exchanges use this for both)
  if (depositEnabled === null && typeof currency.active === 'boolean') {
    depositEnabled = currency.active;
  }
  if (withdrawEnabled === null && typeof currency.active === 'boolean') {
    withdrawEnabled = currency.active;
  }

  // Method 3: Check nested 'info' object (Binance, etc.)
  if (currency.info) {
    if (depositEnabled === null) {
      depositEnabled = currency.info.depositEnable ??
                       currency.info.depositAllEnable ??
                       currency.info.isDepositEnabled ??
                       currency.info.deposit_enabled ??
                       depositEnabled;
    }
    if (withdrawEnabled === null) {
      withdrawEnabled = currency.info.withdrawEnable ??
                        currency.info.withdrawAllEnable ??
                        currency.info.isWithdrawEnabled ??
                        currency.info.withdraw_enabled ??
                        withdrawEnabled;
    }
  }

  // Method 4: Check networks object (for multi-chain tokens)
  if (currency.networks && Object.keys(currency.networks).length > 0) {
    const networks = Object.values(currency.networks);
    // If ANY network supports deposit/withdraw, consider it enabled
    if (depositEnabled === null) {
      depositEnabled = networks.some(n => n.deposit === true || n.active === true);
    }
    if (withdrawEnabled === null) {
      withdrawEnabled = networks.some(n => n.withdraw === true || n.active === true);
    }
  }

  // Convert string "true"/"false" to boolean if needed
  if (typeof depositEnabled === 'string') {
    depositEnabled = depositEnabled.toLowerCase() === 'true';
  }
  if (typeof withdrawEnabled === 'string') {
    withdrawEnabled = withdrawEnabled.toLowerCase() === 'true';
  }

  return {
    deposit: depositEnabled,
    withdraw: withdrawEnabled
  };
}

async function checkTransferability(exchangeName, exchange, symbol) {
  try {
    const [base, quote] = symbol.split('/');
    const currencies = await getCachedCurrencies(exchangeName, exchange);

    if (!currencies) {
      return {
        baseDeposit: null,
        baseWithdraw: null,
        quoteDeposit: null,
        quoteWithdraw: null,
        isFullyTransferable: null,
        statusSource: 'unavailable'
      };
    }

    const baseCurrency = currencies[base];
    const quoteCurrency = currencies[quote];

    const baseStatus = extractTransferStatus(baseCurrency);
    const quoteStatus = extractTransferStatus(quoteCurrency);

    // Determine overall transferability
    // For arbitrage: we need to WITHDRAW base from buy exchange and DEPOSIT to sell exchange
    // We need to be able to deposit/withdraw the base currency
    const isFullyTransferable =
      baseStatus.deposit === true &&
      baseStatus.withdraw === true &&
      quoteStatus.deposit === true &&
      quoteStatus.withdraw === true;

    // If we have explicit false values, it's blocked
    // If we have nulls, it's unknown
    const hasBlockedStatus =
      baseStatus.deposit === false ||
      baseStatus.withdraw === false ||
      quoteStatus.deposit === false ||
      quoteStatus.withdraw === false;

    return {
      baseDeposit: baseStatus.deposit,
      baseWithdraw: baseStatus.withdraw,
      quoteDeposit: quoteStatus.deposit,
      quoteWithdraw: quoteStatus.withdraw,
      isFullyTransferable: hasBlockedStatus ? false : (isFullyTransferable || null),
      statusSource: baseCurrency || quoteCurrency ? 'exchange_api' : 'not_found'
    };
  } catch (err) {
    console.warn(`[${exchangeName}] Transfer check failed for ${symbol}:`, err.message);
    return {
      baseDeposit: null,
      baseWithdraw: null,
      quoteDeposit: null,
      quoteWithdraw: null,
      isFullyTransferable: null,
      statusSource: 'error'
    };
  }
}

// Fetches data from a single exchange with rate limiting
async function fetchFromExchange(name, exchange, symbol) {
  fetchStats.totalRequests++;

  // Execute all API calls through the rate limiter
  const [ticker, orderBook, transferInfo] = await Promise.all([
    rateLimiter.execute(name, () => exchange.fetchTicker(symbol)),
    rateLimiter.execute(name, () => exchange.fetchOrderBook(symbol, 10)),
    checkTransferability(name, exchange, symbol)
  ]);

  fetchStats.successfulRequests++;

  return {
    exchange: name,
    symbol: symbol,
    bids: orderBook.bids.slice(0, 5),  // Top 5 bids for order book depth
    asks: orderBook.asks.slice(0, 5),  // Top 5 asks for order book depth
    last: ticker.last,
    volume: ticker.quoteVolume || 0,
    canDepositBase: transferInfo.baseDeposit,
    canWithdrawBase: transferInfo.baseWithdraw,
    canDepositQuote: transferInfo.quoteDeposit,
    canWithdrawQuote: transferInfo.quoteWithdraw,
    isFullyTransferable: transferInfo.isFullyTransferable,
    statusSource: transferInfo.statusSource,
  };
}

// Fetches prices for ONE symbol from all exchanges IN PARALLEL (with rate limiting)
const fetchPrices = async (symbol) => {
  // Get exchanges dynamically (allows runtime updates)
  const exchanges = getExchanges();
  const exchangeEntries = Object.entries(exchanges);

  // Fetch from ALL exchanges in parallel - rate limiter handles per-exchange limits
  const results = await Promise.allSettled(
    exchangeEntries.map(([name, exchange]) =>
      fetchFromExchange(name, exchange, symbol)
    )
  );

  // Filter out failed requests and extract successful values
  return results
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value);
}

// Process pairs in parallel batches with concurrency control
const processPairsInBatches = async (pairs, batchSize) => {
  const allPricesData = {};
  const totalBatches = Math.ceil(pairs.length / batchSize);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const start = batchIndex * batchSize;
    const end = Math.min(start + batchSize, pairs.length);
    const batch = pairs.slice(start, end);

    console.log(`📦 Batch ${batchIndex + 1}/${totalBatches}: Fetching ${batch.length} pairs in parallel...`);

    // Fetch all pairs in this batch simultaneously
    const batchResults = await Promise.allSettled(
      batch.map(async (pair) => {
        const prices = await fetchPrices(pair);
        return { pair, prices };
      })
    );

    // Process results
    let successCount = 0;
    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value.prices.length > 0) {
        allPricesData[result.value.pair] = result.value.prices;
        successCount++;
      }
    }

    console.log(`   ✓ Batch complete: ${successCount}/${batch.length} pairs found`);

    // Small delay between batches (rate limiter handles per-exchange limits)
    if (batchIndex < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  return allPricesData;
};

// Background fetch function - OPTIMIZED with parallel processing and rate limiting
const fetchAllPriceData = async () => {
  if (isCurrentlyFetching) {
    console.log('⏳ Fetch already in progress, skipping...');
    return;
  }

  isCurrentlyFetching = true;
  fetchError = null;
  const startTime = Date.now();

  // Reset stats for this fetch cycle
  fetchStats = {
    totalRequests: 0,
    successfulRequests: 0,
    rateLimitHits: 0,
    lastFetchDuration: 0
  };

  // Get current exchanges
  const currentExchanges = Object.keys(getExchanges());

  console.log(`\n🔄 Starting PARALLEL fetch of ${TOP_100_PAIRS.length} pairs...`);
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log(`📊 Concurrency: ${CONCURRENCY_LIMIT} pairs per batch`);
  console.log(`🏦 Exchanges: ${currentExchanges.join(', ')} (${currentExchanges.length} total)`);
  console.log(`🛡️  Rate limiting: ENABLED (per-exchange limits)\n`);

  try {
    // Process all pairs in parallel batches
    const allPricesData = await processPairsInBatches(TOP_100_PAIRS, CONCURRENCY_LIMIT);

    const fetchTime = ((Date.now() - startTime) / 1000).toFixed(1);
    fetchStats.lastFetchDuration = parseFloat(fetchTime);

    console.log(`\n✅ DONE FETCHING in ${fetchTime}s`);
    console.log(`📈 Stats: ${fetchStats.successfulRequests}/${fetchStats.totalRequests} requests succeeded`);
    if (fetchStats.rateLimitHits > 0) {
      console.log(`⚠️  Rate limit hits: ${fetchStats.rateLimitHits} (handled with retry)`);
    }
    console.log(`Successfully fetched ${Object.keys(allPricesData).length} pairs`);

    // Log rate limiter status
    const rateLimitStatus = rateLimiter.getStatus();
    console.log('\n📊 Exchange Rate Limit Status:');
    for (const [exchange, status] of Object.entries(rateLimitStatus)) {
      console.log(`   ${exchange}: ${status.availableTokens}/${status.maxTokens} tokens | ${status.requestsPerSecond}/sec`);
    }

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
      : null,
    stats: {
      lastFetchDuration: fetchStats.lastFetchDuration,
      totalRequests: fetchStats.totalRequests,
      successRate: fetchStats.totalRequests > 0
        ? ((fetchStats.successfulRequests / fetchStats.totalRequests) * 100).toFixed(1) + '%'
        : 'N/A'
    }
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

// Get fetch statistics and rate limiter status
export const getServiceStats = () => {
  return {
    fetchStats: { ...fetchStats },
    rateLimitStatus: rateLimiter.getStatus(),
    cacheStatus: {
      opportunityCount: cachedOpportunities.length,
      lastUpdate: lastUpdateTime,
      isLoading: isCurrentlyFetching,
      currencyCacheSize: currencyCache.size
    }
  };
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