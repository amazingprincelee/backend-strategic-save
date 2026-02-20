/**
 * Order Book Service
 * Fetches and manages order book data from exchanges
 *
 * Key Features:
 * - Fetches order books with configurable depth
 * - Caches order books to reduce API calls
 * - Normalizes data across different exchanges
 */

import { exchangeManager } from '../../config/Arbitrage/ccxtExchanges.js';
import rateLimiter from '../../utils/RateLimiter.js';

// Order book cache with TTL
const orderBookCache = new Map();
const CACHE_TTL_MS = 5000; // 5 seconds - order books change rapidly

/**
 * Order Book Entry structure
 * @typedef {Object} OrderBookEntry
 * @property {number} price - Price level
 * @property {number} amount - Amount available at this price
 * @property {number} total - Cumulative amount up to this level
 * @property {number} cost - Cost to fill up to this level (price * cumulative amount)
 */

/**
 * Normalized Order Book structure
 * @typedef {Object} NormalizedOrderBook
 * @property {string} exchange - Exchange name
 * @property {string} symbol - Trading pair (e.g., 'BTC/USDT')
 * @property {number} timestamp - When the order book was fetched
 * @property {OrderBookEntry[]} bids - Buy orders (highest first)
 * @property {OrderBookEntry[]} asks - Sell orders (lowest first)
 * @property {number} bestBid - Best bid price
 * @property {number} bestAsk - Best ask price
 * @property {number} spread - Bid-ask spread
 * @property {number} spreadPercent - Spread as percentage
 * @property {number} midPrice - Mid-market price
 */

/**
 * Generate cache key for order book
 */
function getCacheKey(exchange, symbol) {
  return `${exchange}:${symbol}`;
}

/**
 * Check if cached order book is still valid
 */
function isCacheValid(cacheEntry) {
  if (!cacheEntry) return false;
  return Date.now() - cacheEntry.timestamp < CACHE_TTL_MS;
}

/**
 * Normalize order book data with cumulative totals
 * @param {Array} orders - Raw order book orders [[price, amount], ...]
 * @returns {OrderBookEntry[]} Normalized orders with cumulative data
 */
function normalizeOrders(orders) {
  let cumulativeAmount = 0;
  let cumulativeCost = 0;

  return orders.map(([price, amount]) => {
    cumulativeAmount += amount;
    cumulativeCost += price * amount;

    return {
      price: parseFloat(price),
      amount: parseFloat(amount),
      total: cumulativeAmount,
      cost: cumulativeCost
    };
  });
}

/**
 * Fetch order book from a single exchange
 * @param {string} exchangeName - Exchange identifier
 * @param {string} symbol - Trading pair
 * @param {number} depth - Number of order book levels (default: 20)
 * @returns {Promise<NormalizedOrderBook|null>}
 */
export async function fetchOrderBook(exchangeName, symbol, depth = 20) {
  const cacheKey = getCacheKey(exchangeName, symbol);

  // Check cache first
  const cached = orderBookCache.get(cacheKey);
  if (isCacheValid(cached)) {
    return cached.data;
  }

  try {
    const exchanges = exchangeManager.getExchanges();
    const exchange = exchanges[exchangeName];

    if (!exchange) {
      console.warn(`Exchange ${exchangeName} not initialized`);
      return null;
    }

    // Fetch order book with rate limiting
    const rawOrderBook = await rateLimiter.execute(
      exchangeName,
      () => exchange.fetchOrderBook(symbol, depth)
    );

    if (!rawOrderBook || !rawOrderBook.bids || !rawOrderBook.asks) {
      return null;
    }

    // Normalize the order book
    const bids = normalizeOrders(rawOrderBook.bids.slice(0, depth));
    const asks = normalizeOrders(rawOrderBook.asks.slice(0, depth));

    const bestBid = bids[0]?.price || 0;
    const bestAsk = asks[0]?.price || 0;
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;

    const normalizedOrderBook = {
      exchange: exchangeName,
      symbol,
      timestamp: Date.now(),
      bids,
      asks,
      bestBid,
      bestAsk,
      spread,
      spreadPercent: midPrice > 0 ? (spread / midPrice) * 100 : 0,
      midPrice
    };

    // Cache the result
    orderBookCache.set(cacheKey, {
      data: normalizedOrderBook,
      timestamp: Date.now()
    });

    return normalizedOrderBook;

  } catch (error) {
    // Don't log every error - some pairs don't exist on all exchanges
    if (!error.message?.includes('not found') &&
        !error.message?.includes('does not have')) {
      console.warn(`[${exchangeName}] Order book fetch failed for ${symbol}:`, error.message);
    }
    return null;
  }
}

/**
 * Fetch order books from multiple exchanges for a single symbol
 * @param {string} symbol - Trading pair
 * @param {string[]} exchangeNames - List of exchanges to query
 * @param {number} depth - Order book depth
 * @returns {Promise<Map<string, NormalizedOrderBook>>}
 */
export async function fetchOrderBooksForSymbol(symbol, exchangeNames = null, depth = 20) {
  const exchanges = exchangeNames || Object.keys(exchangeManager.getExchanges());
  const orderBooks = new Map();

  // Fetch from all exchanges in parallel
  const results = await Promise.allSettled(
    exchanges.map(async (exchangeName) => {
      const orderBook = await fetchOrderBook(exchangeName, symbol, depth);
      return { exchangeName, orderBook };
    })
  );

  // Collect successful results
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.orderBook) {
      orderBooks.set(result.value.exchangeName, result.value.orderBook);
    }
  }

  return orderBooks;
}

/**
 * Fetch order books for multiple symbols from all exchanges
 * @param {string[]} symbols - List of trading pairs
 * @param {number} depth - Order book depth
 * @returns {Promise<Map<string, Map<string, NormalizedOrderBook>>>}
 */
export async function fetchAllOrderBooks(symbols, depth = 20) {
  const allOrderBooks = new Map();

  // Process symbols sequentially to avoid overwhelming exchanges
  for (const symbol of symbols) {
    const orderBooks = await fetchOrderBooksForSymbol(symbol, null, depth);
    if (orderBooks.size >= 2) { // Need at least 2 exchanges for arbitrage
      allOrderBooks.set(symbol, orderBooks);
    }
  }

  return allOrderBooks;
}

/**
 * Get total liquidity available in order book up to a price level
 * @param {OrderBookEntry[]} orders - Normalized orders
 * @param {number} maxPrice - Maximum price to consider (for asks) or minimum (for bids)
 * @param {boolean} isBid - Whether these are bid orders
 * @returns {{amount: number, cost: number}}
 */
export function getLiquidityUpToPrice(orders, maxPrice, isBid = false) {
  let totalAmount = 0;
  let totalCost = 0;

  for (const order of orders) {
    if (isBid ? order.price >= maxPrice : order.price <= maxPrice) {
      totalAmount += order.amount;
      totalCost += order.price * order.amount;
    } else {
      break; // Orders are sorted, so we can stop early
    }
  }

  return { amount: totalAmount, cost: totalCost };
}

/**
 * Clear order book cache
 */
export function clearOrderBookCache() {
  orderBookCache.clear();
}

/**
 * Get cache statistics
 */
export function getOrderBookCacheStats() {
  let validEntries = 0;
  let expiredEntries = 0;

  for (const [, entry] of orderBookCache) {
    if (isCacheValid(entry)) {
      validEntries++;
    } else {
      expiredEntries++;
    }
  }

  return {
    totalEntries: orderBookCache.size,
    validEntries,
    expiredEntries,
    cacheTTL: CACHE_TTL_MS
  };
}

export default {
  fetchOrderBook,
  fetchOrderBooksForSymbol,
  fetchAllOrderBooks,
  getLiquidityUpToPrice,
  clearOrderBookCache,
  getOrderBookCacheStats
};
