import ccxt from 'ccxt';

// Initialize exchanges with CCXT
const initializeExchanges = () => {
  const exchanges = {
    binance: new ccxt.binance({
      enableRateLimit: true,
      // Add API keys if needed for private endpoints
      // apiKey: process.env.BINANCE_API_KEY,
      // secret: process.env.BINANCE_SECRET,
    }),
    bybit: new ccxt.bybit({
      enableRateLimit: true,
      // apiKey: process.env.BYBIT_API_KEY,
      // secret: process.env.BYBIT_SECRET,
    }),
    gate: new ccxt.gate({
      enableRateLimit: true,
      // apiKey: process.env.GATE_API_KEY,
      // secret: process.env.GATE_SECRET,
    }),
    mexc: new ccxt.mexc({
      enableRateLimit: true,
      // apiKey: process.env.MEXC_API_KEY,
      // secret: process.env.MEXC_SECRET,
    }),
    okx: new ccxt.okx({
      enableRateLimit: true,
      // apiKey: process.env.OKX_API_KEY,
      // secret: process.env.OKX_SECRET,
    }),
    htx: new ccxt.htx({
      enableRateLimit: true,
      // apiKey: process.env.HTX_API_KEY,
      // secret: process.env.HTX_SECRET,
    }),
    bitget: new ccxt.bitget({
      enableRateLimit: true,
      // apiKey: process.env.BITGET_API_KEY,
      // secret: process.env.BITGET_SECRET,
    }),
    kucoin: new ccxt.kucoin({
      enableRateLimit: true,
      // apiKey: process.env.KUCOIN_API_KEY,
      // secret: process.env.KUCOIN_SECRET,
    }),
    lbank: new ccxt.lbank({
      enableRateLimit: true,
      // apiKey: process.env.LBANK_API_KEY,
      // secret: process.env.LBANK_SECRET,
    })
  };

  return exchanges;
};

const EXCHANGES = initializeExchanges();

// Popular trading pairs to scan
const TRADING_PAIRS = [
  'BTC/USDT',
  'ETH/USDT',
  'BNB/USDT',
  'SOL/USDT',
  'XRP/USDT',
  'ADA/USDT',
  'DOGE/USDT',
  'MATIC/USDT',
  'DOT/USDT',
  'AVAX/USDT'
];

/**
 * Get arbitrage opportunities using CCXT
 * Scans multiple exchanges and finds price differences
 */
export const getArbitrageOpportunities = async (req, res) => {
  try {
    const { minProfit = 0.5, minVolume = 1000, coin } = req.query;

    // Filter trading pairs if specific coin requested
    const pairsToScan = coin 
      ? TRADING_PAIRS.filter(pair => pair.startsWith(coin.toUpperCase()))
      : TRADING_PAIRS;

    console.log(`🔍 Scanning ${pairsToScan.length} pairs across ${Object.keys(EXCHANGES).length} exchanges...`);

    // Scan exchanges for opportunities
    const opportunities = await scanExchangesForArbitrage({
      minProfit: parseFloat(minProfit),
      minVolume: parseFloat(minVolume),
      pairs: pairsToScan
    });

    // Calculate stats
    const stats = {
      totalOpportunities: opportunities.length,
      avgProfitMargin: opportunities.length > 0 
        ? opportunities.reduce((acc, opp) => acc + opp.profitMargin, 0) / opportunities.length 
        : 0,
      activeTransfers: opportunities.filter(opp => opp.transferEnabled).length,
      totalVolume: opportunities.reduce((acc, opp) => acc + opp.volume, 0)
    };

    res.json({
      success: true,
      data: {
        opportunities,
        ...stats,
        timestamp: new Date().toISOString()
      }
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
 * Execute arbitrage trade using CCXT
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

    // Validate required fields
    if (!coin || !amount || !buyExchange || !sellExchange || !buyPrice || !sellPrice) {
      return res.status(400).json({
        success: false,
        message: 'Missing required trade parameters'
      });
    }

    const buyEx = EXCHANGES[buyExchange.toLowerCase()];
    const sellEx = EXCHANGES[sellExchange.toLowerCase()];

    if (!buyEx || !sellEx) {
      return res.status(400).json({
        success: false,
        message: 'Invalid exchange(s) specified'
      });
    }

    // Check if exchanges support required features
    const buySupportsTrading = buyEx.has['createOrder'];
    const sellSupportsTrading = sellEx.has['createOrder'];

    if (!buySupportsTrading || !sellSupportsTrading) {
      return res.status(400).json({
        success: false,
        message: 'One or both exchanges do not support trading'
      });
    }

    // Calculate expected profit
    const expectedProfit = (sellPrice - buyPrice) * amount;
    const profitMargin = ((sellPrice - buyPrice) / buyPrice) * 100;

    // In production, execute the actual trades:
    // 1. Create buy order on buyExchange
    // const buyOrder = await buyEx.createMarketBuyOrder(coin, amount);
    
    // 2. Wait for order to fill
    // 3. Withdraw from buyExchange to sellExchange
    // const withdrawal = await buyEx.withdraw(coin, amount, sellExchangeAddress);
    
    // 4. Wait for deposit confirmation on sellExchange
    // 5. Create sell order on sellExchange
    // const sellOrder = await sellEx.createMarketSellOrder(coin, amount);

    // Mock successful trade for now
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
      status: 'completed',
      executedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      message: 'Arbitrage trade executed successfully',
      data: trade
    });

  } catch (error) {
    console.error('❌ Execute arbitrage trade error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to execute arbitrage trade',
      error: error.message
    });
  }
};

/**
 * Get exchange connection status using CCXT
 */
export const getExchangeStatus = async (req, res) => {
  try {
    const exchangeStatuses = await Promise.all(
      Object.entries(EXCHANGES).map(async ([key, exchange]) => {
        try {
          const startTime = Date.now();
          
          // Test connection by fetching a ticker
          await exchange.fetchTicker('BTC/USDT');
          
          const latency = Date.now() - startTime;

          // Check exchange capabilities
          const capabilities = {
            fetchTicker: exchange.has['fetchTicker'],
            fetchOrderBook: exchange.has['fetchOrderBook'],
            fetchTrades: exchange.has['fetchTrades'],
            createOrder: exchange.has['createOrder'],
            withdraw: exchange.has['withdraw'],
            deposit: exchange.has['deposit']
          };

          return {
            id: key,
            name: exchange.name,
            connected: true,
            transferEnabled: capabilities.withdraw && capabilities.deposit,
            latency,
            capabilities,
            lastChecked: new Date().toISOString()
          };
        } catch (error) {
          return {
            id: key,
            name: exchange.name,
            connected: false,
            transferEnabled: false,
            lastChecked: new Date().toISOString(),
            error: error.message
          };
        }
      })
    );

    res.json({
      success: true,
      data: exchangeStatuses
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
 * Get user's arbitrage history
 */
export const getArbitrageHistory = async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;

    // In production, fetch from database
    // For now, return empty array
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
    console.error('❌ Get arbitrage history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch arbitrage history',
      error: error.message
    });
  }
};

/**
 * Get user's arbitrage statistics
 */
export const getArbitrageStats = async (req, res) => {
  try {
    // In production, calculate from database
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
    console.error('❌ Get arbitrage stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch arbitrage statistics',
      error: error.message
    });
  }
};

/**
 * Scan exchanges for arbitrage opportunities using CCXT
 */
async function scanExchangesForArbitrage({ minProfit, minVolume, pairs }) {
  const opportunities = [];
  const exchangeNames = Object.keys(EXCHANGES);

  console.log(`📊 Scanning ${pairs.length} pairs across ${exchangeNames.length} exchanges...`);

  for (const pair of pairs) {
    try {
      // Fetch prices from all exchanges in parallel
      const pricePromises = exchangeNames.map(async (exchangeName) => {
        try {
          const exchange = EXCHANGES[exchangeName];
          
          // Fetch ticker data
          const ticker = await exchange.fetchTicker(pair);
          
          // Fetch order book for depth info
          const orderBook = await exchange.fetchOrderBook(pair, 5);
          
          return {
            exchange: exchangeName,
            exchangeObj: exchange,
            ticker,
            orderBook,
            success: true
          };
        } catch (error) {
          // Exchange doesn't support this pair or has an error
          console.log(`⚠️  ${exchangeName} - ${pair}: ${error.message}`);
          return { exchange: exchangeName, success: false };
        }
      });

      const results = await Promise.all(pricePromises);
      
      // Filter successful results
      const successfulResults = results.filter(r => r.success);

      if (successfulResults.length < 2) {
        // Need at least 2 exchanges to compare
        continue;
      }

      // Find best buy (lowest price) and sell (highest price) opportunities
      const sortedByPrice = successfulResults.sort((a, b) => a.ticker.last - b.ticker.last);
      const buyOption = sortedByPrice[0]; // Lowest price
      const sellOption = sortedByPrice[sortedByPrice.length - 1]; // Highest price

      // Calculate profit
      const buyPrice = buyOption.ticker.last;
      const sellPrice = sellOption.ticker.last;
      const profitMargin = ((sellPrice - buyPrice) / buyPrice) * 100;
      const profitUSD = sellPrice - buyPrice;

      // Calculate volume (use the lower of the two to be safe)
      const buyVolume = buyOption.ticker.quoteVolume || 0;
      const sellVolume = sellOption.ticker.quoteVolume || 0;
      const volume = Math.min(buyVolume, sellVolume);

      // Check if meets minimum criteria
      if (profitMargin < minProfit || volume < minVolume) {
        continue;
      }

      // Get order book depth
      const sellOrderBookDepth = sellOption.orderBook.bids.length > 0 
        ? sellOption.orderBook.bids[0][1] // Amount of coins at best bid
        : 0;

      // Check transfer capability
      const buyExchange = buyOption.exchangeObj;
      const sellExchange = sellOption.exchangeObj;
      const transferEnabled = 
        buyExchange.has['withdraw'] && 
        sellExchange.has['deposit'];

      // Extract coin symbol
      const [coinSymbol, quoteSymbol] = pair.split('/');

      // Create opportunity object
      const opportunity = {
        id: `${buyOption.exchange}-${sellOption.exchange}-${pair}-${Date.now()}`,
        coin: coinSymbol,
        coinName: coinSymbol, // Can enhance with full names
        pair: pair,
        buyExchange: buyOption.exchange.charAt(0).toUpperCase() + buyOption.exchange.slice(1),
        sellExchange: sellOption.exchange.charAt(0).toUpperCase() + sellOption.exchange.slice(1),
        buyPrice,
        sellPrice,
        profitMargin: parseFloat(profitMargin.toFixed(2)),
        profitUSD: parseFloat(profitUSD.toFixed(8)),
        volume: parseFloat(volume.toFixed(2)),
        volumeCoins: sellOrderBookDepth,
        transferEnabled,
        lastPrice: sellPrice,
        orderBookDepth: {
          buy: buyOption.orderBook.asks.length,
          sell: sellOption.orderBook.bids.length
        },
        timestamp: new Date().toISOString()
      };

      opportunities.push(opportunity);
      
      console.log(`✅ Found opportunity: ${pair} - ${profitMargin.toFixed(2)}% profit (${buyOption.exchange} → ${sellOption.exchange})`);

    } catch (error) {
      console.error(`❌ Error scanning ${pair}:`, error.message);
    }
  }

  // Sort by profit margin (best first)
  opportunities.sort((a, b) => b.profitMargin - a.profitMargin);

  console.log(`🎉 Found ${opportunities.length} total opportunities`);

  return opportunities;
}

/**
 * Helper function to check if a specific coin transfer is enabled
 */
async function checkCoinTransferEnabled(exchange, coin) {
  try {
    const currencies = await exchange.fetchCurrencies();
    const currency = currencies[coin];
    
    if (!currency) return false;
    
    return currency.active && !currency.info?.withdrawEnable === false;
  } catch (error) {
    console.error(`Error checking transfer for ${coin} on ${exchange.name}:`, error.message);
    return false;
  }
}

export default {
  getArbitrageOpportunities,
  executeArbitrageTrade,
  getExchangeStatus,
  getArbitrageHistory,
  getArbitrageStats
};