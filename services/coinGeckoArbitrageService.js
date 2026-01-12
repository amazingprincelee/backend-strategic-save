// Service: services/coinGeckoArbitrageService.js
// Uses CoinGecko FREE API to find arbitrage opportunities
// NO API KEY NEEDED!

import axios from 'axios';

class CoinGeckoArbitrageService {
  constructor() {
    this.baseUrl = 'https://api.coingecko.com/api/v3';
    this.cache = new Map();
    this.cacheDuration = 30000; // 30 seconds cache
    
    // Map CoinGecko IDs to common symbols
    this.coinMap = {
      'bitcoin': 'BTC',
      'ethereum': 'ETH',
      'binancecoin': 'BNB',
      'solana': 'SOL',
      'ripple': 'XRP',
      'cardano': 'ADA',
      'dogecoin': 'DOGE',
      'polygon': 'MATIC',
      'polkadot': 'DOT',
      'avalanche-2': 'AVAX',
      'chainlink': 'LINK',
      'uniswap': 'UNI',
      'litecoin': 'LTC',
      'cosmos': 'ATOM',
      'tron': 'TRX',
      'near': 'NEAR',
      'arbitrum': 'ARB',
      'optimism': 'OP',
      'aptos': 'APT',
      'sui': 'SUI'
    };
  }

  /**
   * Get top N coins by market cap
   * @param {number} limit - Number of top coins (max 250 per call)
   * @returns {Promise<Array>} - Array of coin data with CoinGecko IDs
   */
  async getTopCoins(limit = 100) {
    try {
      const cacheKey = `top_coins_${limit}`;
      const cached = this.cache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < 3600000) { // 1 hour cache
        return cached.data;
      }

      console.log(`🔍 Fetching top ${limit} coins from CoinGecko...`);

      const pages = Math.ceil(limit / 250);
      let allCoins = [];

      for (let page = 1; page <= pages; page++) {
        const response = await axios.get(`${this.baseUrl}/coins/markets`, {
          params: {
            vs_currency: 'usd',
            order: 'market_cap_desc',
            per_page: 250,
            page: page,
            sparkline: false
          }
        });
        allCoins = [...allCoins, ...response.data];
      }

      const topCoins = allCoins.slice(0, limit).map((coin, index) => ({
        rank: index + 1,
        id: coin.id, // CoinGecko ID (needed for tickers API)
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        marketCap: coin.market_cap,
        price: coin.current_price,
        volume24h: coin.total_volume,
        image: coin.image
      }));

      this.cache.set(cacheKey, {
        data: topCoins,
        timestamp: Date.now()
      });

      console.log(`✅ Fetched ${topCoins.length} top coins`);
      return topCoins;

    } catch (error) {
      console.error('❌ CoinGecko API error:', error.message);
      throw error;
    }
  }

  /**
   * Get prices for a coin across ALL exchanges
   * This is the MAGIC endpoint for arbitrage!
   * @param {string} coinId - CoinGecko coin ID (e.g., 'bitcoin')
   * @returns {Promise<Array>} - Array of exchange prices
   */
  async getCoinTickers(coinId) {
    try {
      const response = await axios.get(`${this.baseUrl}/coins/${coinId}/tickers`, {
        params: {
          depth: true // Include order book depth
        }
      });

      const tickers = response.data.tickers || [];
      
      // Filter for USDT pairs and trusted exchanges
      const usdtTickers = tickers
        .filter(ticker => 
          ticker.target === 'USDT' && 
          ticker.trust_score === 'green' &&
          ticker.last > 0
        )
        .map(ticker => ({
          exchange: ticker.market.name,
          exchangeId: ticker.market.identifier,
          price: ticker.last,
          volume: ticker.converted_volume.usd || ticker.volume,
          bidAskSpread: ticker.bid_ask_spread_percentage,
          lastUpdated: ticker.last_traded_at,
          tradeUrl: ticker.trade_url
        }));

      return usdtTickers;

    } catch (error) {
      console.error(`❌ Error fetching tickers for ${coinId}:`, error.message);
      return [];
    }
  }

  /**
   * Find arbitrage opportunities for multiple coins
   * @param {Array} coinIds - Array of CoinGecko coin IDs
   * @param {Object} filters - { minProfit, minVolume }
   * @returns {Promise<Array>} - Array of arbitrage opportunities
   */
  async findArbitrageOpportunities(coinIds, filters = {}) {
    const { minProfit = 0.1, minVolume = 100 } = filters;
    const opportunities = [];

    console.log(`🔍 Scanning ${coinIds.length} coins for arbitrage opportunities...`);
    console.log(`⏱️  Rate limit: ~${Math.ceil(coinIds.length * 2 / 60)} minutes (CoinGecko: 30 calls/minute)`);

    for (let i = 0; i < coinIds.length; i++) {
      const coinId = coinIds[i];
      
      try {
        // Progress indicator
        if (i % 5 === 0) {
          console.log(`📊 Progress: ${i}/${coinIds.length} coins scanned...`);
        }

        // Get prices from all exchanges for this coin
        const tickers = await this.getCoinTickers(coinId);

        if (tickers.length < 2) {
          console.log(`  ${coinId}: Only ${tickers.length} exchanges, skipping`);
          continue;
        }

        // Sort by price to find lowest and highest
        const sortedByPrice = [...tickers].sort((a, b) => a.price - b.price);
        const lowestPrice = sortedByPrice[0];
        const highestPrice = sortedByPrice[sortedByPrice.length - 1];

        // Calculate profit
        const profitMargin = ((highestPrice.price - lowestPrice.price) / lowestPrice.price) * 100;
        const profitUSD = highestPrice.price - lowestPrice.price;

        // Check if meets criteria
        if (profitMargin < minProfit) {
          continue;
        }

        const minExchangeVolume = Math.min(lowestPrice.volume, highestPrice.volume);
        if (minExchangeVolume < minVolume) {
          continue;
        }

        // Get symbol
        const symbol = this.coinMap[coinId] || coinId.toUpperCase();

        // Create opportunity
        const opportunity = {
          id: `${coinId}-${lowestPrice.exchangeId}-${highestPrice.exchangeId}-${Date.now()}`,
          coin: symbol,
          coinName: this.getCoinName(symbol),
          coinId: coinId,
          buyExchange: lowestPrice.exchange,
          sellExchange: highestPrice.exchange,
          buyPrice: lowestPrice.price,
          sellPrice: highestPrice.price,
          profitMargin: parseFloat(profitMargin.toFixed(2)),
          profitUSD: parseFloat(profitUSD.toFixed(8)),
          volume: minExchangeVolume,
          volumeCoins: minExchangeVolume / lowestPrice.price,
          buyBidAskSpread: lowestPrice.bidAskSpread || 0,
          sellBidAskSpread: highestPrice.bidAskSpread || 0,
          transferEnabled: true,
          lastPrice: highestPrice.price,
          buyTradeUrl: lowestPrice.tradeUrl,
          sellTradeUrl: highestPrice.tradeUrl,
          exchangeCount: tickers.length,
          timestamp: new Date().toISOString()
        };

        opportunities.push(opportunity);
        console.log(`✅ ${symbol}: ${profitMargin.toFixed(2)}% profit (${lowestPrice.exchange} → ${highestPrice.exchange})`);

        // Rate limiting: CoinGecko FREE tier = 30 calls/minute (with demo key) or 10-50 calls/minute
        // To be safe, we do 2 seconds between calls = 30 calls/minute
        await this.sleep(2000); // 2 seconds = 30 calls per minute

      } catch (error) {
        if (error.response?.status === 429) {
          console.log(`⚠️  Rate limit hit at coin ${i + 1}/${coinIds.length}. Waiting 60 seconds...`);
          await this.sleep(60000); // Wait 1 minute
          i--; // Retry this coin
          continue;
        }
        console.error(`❌ Error processing ${coinId}:`, error.message);
      }
    }

    // Sort by profit margin
    opportunities.sort((a, b) => b.profitMargin - a.profitMargin);

    console.log(`🎉 Found ${opportunities.length} arbitrage opportunities`);
    return opportunities;
  }

  /**
   * Get coin name from symbol
   */
  getCoinName(symbol) {
    const names = {
      BTC: 'Bitcoin',
      ETH: 'Ethereum',
      BNB: 'Binance Coin',
      SOL: 'Solana',
      XRP: 'Ripple',
      ADA: 'Cardano',
      DOGE: 'Dogecoin',
      MATIC: 'Polygon',
      DOT: 'Polkadot',
      AVAX: 'Avalanche',
      LINK: 'Chainlink',
      UNI: 'Uniswap',
      LTC: 'Litecoin',
      ATOM: 'Cosmos',
      TRX: 'Tron',
      NEAR: 'Near',
      ARB: 'Arbitrum',
      OP: 'Optimism',
      APT: 'Aptos',
      SUI: 'Sui'
    };
    return names[symbol] || symbol;
  }

  /**
   * Sleep helper for rate limiting
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

export default new CoinGeckoArbitrageService();