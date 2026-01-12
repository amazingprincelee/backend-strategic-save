// Controller: arbitrageController.js (CoinGecko Version)
// Uses CoinGecko FREE API - NO API KEY NEEDED!

import coinGeckoService from '../services/coinGeckoArbitrageService.js';

// Cache
let cachedOpportunities = [];
let cachedTopCoins = [];
let cacheTimestamp = null;
const CACHE_DURATION = 30000; // 30 seconds

/**
 * Get top coins by market cap
 */
export const getTopCoins = async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    
    console.log(`📊 Fetching top ${limit} coins by market cap...`);
    const coins = await coinGeckoService.getTopCoins(parseInt(limit));
    
    res.json({
      success: true,
      data: coins,
      count: coins.length,
      message: `Fetched top ${coins.length} coins`
    });
    
  } catch (error) {
    console.error('❌ Get top coins error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch top coins',
      error: error.message
    });
  }
};

/**
 * Get arbitrage opportunities using CoinGecko
 * Finds price differences across exchanges
 */
export const getArbitrageOpportunities = async (req, res) => {
  try {
    const { 
      minProfit = 0.1, 
      minVolume = 100, 
      topCoins = 20 // Lower default to avoid rate limits
    } = req.query;

    // Check cache
    if (cachedOpportunities.length > 0 && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_DURATION)) {
      console.log('✅ Returning cached arbitrage opportunities');
      
      return res.json({
        success: true,
        data: cachedOpportunities,
        timestamp: new Date(cacheTimestamp).toISOString(),
        cached: true,
        scannedCoins: cachedTopCoins.length,
        message: `Found ${cachedOpportunities.length} opportunities (cached)`
      });
    }

    console.log(`🔍 Scanning top ${topCoins} coins for arbitrage...`);
    console.log(`   Filters: minProfit=${minProfit}%, minVolume=$${minVolume}`);

    // Get top coins
    const coins = await coinGeckoService.getTopCoins(parseInt(topCoins));
    cachedTopCoins = coins;

    // Extract CoinGecko IDs
    const coinIds = coins.map(coin => coin.id);

    // Find arbitrage opportunities
    const opportunities = await coinGeckoService.findArbitrageOpportunities(coinIds, {
      minProfit: parseFloat(minProfit),
      minVolume: parseFloat(minVolume)
    });

    // Cache results
    cachedOpportunities = opportunities;
    cacheTimestamp = Date.now();

    console.log(`✅ Found ${opportunities.length} arbitrage opportunities`);

    res.json({
      success: true,
      data: opportunities,
      timestamp: new Date().toISOString(),
      cached: false,
      scannedCoins: coins.length,
      message: `Found ${opportunities.length} opportunities from ${coins.length} coins`
    });

  } catch (error) {
    console.error('❌ Get arbitrage opportunities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch arbitrage opportunities',
      error: error.message
    });
  }
};

/**
 * Force refresh arbitrage opportunities (clears cache)
 */
export const refreshArbitrageOpportunities = async (req, res) => {
  try {
    console.log('🔄 Force refreshing arbitrage opportunities...');

    // Clear cache
    cachedOpportunities = [];
    cacheTimestamp = null;
    coinGeckoService.clearCache();

    const { 
      minProfit = 0.1, 
      minVolume = 100, 
      topCoins = 20 // Lower default
    } = req.query;

    // Get top coins
    const coins = await coinGeckoService.getTopCoins(parseInt(topCoins));
    const coinIds = coins.map(coin => coin.id);

    // Find opportunities
    const opportunities = await coinGeckoService.findArbitrageOpportunities(coinIds, {
      minProfit: parseFloat(minProfit),
      minVolume: parseFloat(minVolume)
    });

    // Update cache
    cachedOpportunities = opportunities;
    cachedTopCoins = coins;
    cacheTimestamp = Date.now();

    res.json({
      success: true,
      data: opportunities,
      timestamp: new Date().toISOString(),
      cached: false,
      scannedCoins: coins.length,
      message: `Refreshed! Found ${opportunities.length} opportunities`
    });

  } catch (error) {
    console.error('❌ Refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh opportunities',
      error: error.message
    });
  }
};

/**
 * Get available exchanges (from CoinGecko data)
 */
export const getExchangeStatus = async (req, res) => {
  try {
    // CoinGecko shows prices from 50+ exchanges
    // We'll list the most common ones
    const exchanges = [
      { id: 'binance', name: 'Binance', connected: true, source: 'CoinGecko' },
      { id: 'coinbase-exchange', name: 'Coinbase', connected: true, source: 'CoinGecko' },
      { id: 'kraken', name: 'Kraken', connected: true, source: 'CoinGecko' },
      { id: 'kucoin', name: 'KuCoin', connected: true, source: 'CoinGecko' },
      { id: 'okx', name: 'OKX', connected: true, source: 'CoinGecko' },
      { id: 'bybit_spot', name: 'Bybit', connected: true, source: 'CoinGecko' },
      { id: 'gate', name: 'Gate.io', connected: true, source: 'CoinGecko' },
      { id: 'mexc', name: 'MEXC', connected: true, source: 'CoinGecko' },
      { id: 'huobi', name: 'HTX (Huobi)', connected: true, source: 'CoinGecko' },
      { id: 'bitget', name: 'Bitget', connected: true, source: 'CoinGecko' },
      { id: 'gemini', name: 'Gemini', connected: true, source: 'CoinGecko' },
      { id: 'bitfinex', name: 'Bitfinex', connected: true, source: 'CoinGecko' },
      { id: 'crypto_com', name: 'Crypto.com', connected: true, source: 'CoinGecko' }
    ];

    res.json({
      success: true,
      data: exchanges,
      message: 'CoinGecko provides data from 50+ exchanges'
    });

  } catch (error) {
    console.error('❌ Get exchange status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exchange status',
      error: error.message
    });
  }
};

/**
 * Get arbitrage history
 */
export const getArbitrageHistory = async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;

    // TODO: Implement database storage for trade history
    const history = [];
    const total = 0;

    res.json({
      success: true,
      data: {
        history,
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        total,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('❌ Get history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch history',
      error: error.message
    });
  }
};

/**
 * Get arbitrage statistics
 */
export const getArbitrageStats = async (req, res) => {
  try {
    const stats = {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalProfit: 0,
      totalVolume: 0,
      avgProfitMargin: 0,
      bestTrade: null,
      lastTrade: null
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('❌ Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stats',
      error: error.message
    });
  }
};

/**
 * Execute arbitrage trade
 */
export const executeArbitrageTrade = async (req, res) => {
  try {
    const { 
      coin, 
      amount, 
      buyExchange, 
      sellExchange,
      buyPrice,
      sellPrice 
    } = req.body;

    // Validate
    if (!coin || !amount || !buyExchange || !sellExchange) {
      return res.status(400).json({
        success: false,
        message: 'Missing required trade parameters'
      });
    }

    // Calculate profit
    const expectedProfit = (sellPrice - buyPrice) * amount;
    const profitMargin = ((sellPrice - buyPrice) / buyPrice) * 100;

    // Note: Actual trading requires user's exchange API keys
    // This is a mock response
    const trade = {
      id: `ARB-${Date.now()}`,
      userId: req.user.id,
      coin,
      amount,
      buyExchange,
      sellExchange,
      buyPrice,
      sellPrice,
      profit: expectedProfit,
      profitMargin,
      status: 'pending',
      message: 'Trade simulation - connect exchange API keys to execute real trades',
      executedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      message: 'Trade simulated successfully',
      data: trade
    });

  } catch (error) {
    console.error('❌ Execute trade error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to execute trade',
      error: error.message
    });
  }
};

export default {
  getTopCoins,
  getArbitrageOpportunities,
  refreshArbitrageOpportunities,
  getExchangeStatus,
  getArbitrageHistory,
  getArbitrageStats,
  executeArbitrageTrade
};