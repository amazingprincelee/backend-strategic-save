/**
 * DynamicPairDiscovery.js
 *
 * Instead of a static coin list, this service discovers arbitrage-worthy pairs
 * dynamically by cross-referencing the actual market listings from all active
 * exchanges.
 *
 * Core insight:
 *   Pairs listed on FEWER exchanges = WIDER spreads = MORE arbitrage opportunity
 *   Because fewer bots are watching them and prices equilibrate slower.
 *
 * Scoring:
 *   2 exchanges  → score 100  (maximum opportunity — very few arbitrageurs)
 *   3 exchanges  → score 80
 *   4 exchanges  → score 60
 *   5 exchanges  → score 40
 *   6+ exchanges → score 20  (still possible but more competitive)
 *
 * Refreshes every hour so newly listed coins are picked up automatically.
 */

import { exchangeManager } from '../../config/Arbitrage/ccxtExchanges.js';
import { TOP_100_PAIRS } from '../../utils/top100Coins.js';

const CACHE_TTL_MS   = 60 * 60 * 1000; // refresh every 1 hour
const MIN_EXCHANGES  = 2;               // must be on at least 2 exchanges for arb
const MAX_PAIRS      = 150;             // max pairs to return per scan cycle

let cachedPairs     = null;
let cacheTimestamp  = 0;
let isDiscovering   = false;

/**
 * Score a pair based on how many exchanges list it.
 * Fewer = higher score = more arbitrage opportunity.
 */
function scorePair(exchangeCount) {
  return Math.max(10, 110 - (exchangeCount - 2) * 20);
}

/**
 * Fetch the market listing from one exchange and return a Set of USDT spot symbols.
 * Returns an empty Set on failure (never throws).
 */
async function getExchangeMarkets(name, exchange) {
  try {
    // loadMarkets() is cached internally by CCXT after first call
    if (!exchange.markets || Object.keys(exchange.markets).length === 0) {
      await exchange.loadMarkets();
    }

    const usdtPairs = new Set();
    for (const [symbol, market] of Object.entries(exchange.markets)) {
      if (!symbol.endsWith('/USDT')) continue;
      if (market.active === false) continue;
      // Skip non-spot markets (futures, options, etc.)
      if (market.type && market.type !== 'spot') continue;
      usdtPairs.add(symbol);
    }

    return usdtPairs;
  } catch (err) {
    console.warn(`[PairDiscovery] Could not load markets from ${name}: ${err.message}`);
    return new Set();
  }
}

/**
 * Main discovery function.
 * Returns an array of USDT pair symbols sorted by arbitrage potential.
 *
 * @returns {Promise<string[]>}
 */
export async function discoverArbitragePairs() {
  // Return cache if fresh
  if (cachedPairs && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedPairs;
  }

  // If another call already started discovery, return static fallback for now
  if (isDiscovering) {
    console.log('[PairDiscovery] Discovery in progress — returning static fallback');
    return TOP_100_PAIRS.slice(0, MAX_PAIRS);
  }

  isDiscovering = true;

  try {
    const exchanges     = exchangeManager.getExchanges();
    const exchangeNames = Object.keys(exchanges);

    if (exchangeNames.length < 2) {
      console.warn('[PairDiscovery] Less than 2 exchanges active — cannot discover pairs');
      return TOP_100_PAIRS.slice(0, MAX_PAIRS);
    }

    console.log(`\n[PairDiscovery] Loading markets from ${exchangeNames.length} exchanges...`);

    // Fetch markets from all exchanges in parallel
    const marketResults = await Promise.all(
      exchangeNames.map(name => getExchangeMarkets(name, exchanges[name]))
    );

    // Build map: symbol → Set of exchanges that list it
    const pairExchangeMap = new Map();

    for (let i = 0; i < exchangeNames.length; i++) {
      const name   = exchangeNames[i];
      const pairs  = marketResults[i];

      for (const symbol of pairs) {
        if (!pairExchangeMap.has(symbol)) {
          pairExchangeMap.set(symbol, new Set());
        }
        pairExchangeMap.get(symbol).add(name);
      }
    }

    // Score and filter pairs
    const scored = [];

    for (const [symbol, exchangeSet] of pairExchangeMap.entries()) {
      const count = exchangeSet.size;
      if (count < MIN_EXCHANGES) continue; // need at least 2 for arb

      scored.push({
        symbol,
        exchangeCount: count,
        exchanges: Array.from(exchangeSet),
        score: scorePair(count),
      });
    }

    // Sort: highest score first (fewest exchanges), then alphabetically for tie-breaking
    scored.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

    const result = scored.slice(0, MAX_PAIRS).map(p => p.symbol);

    // Stats
    const on2  = scored.filter(p => p.exchangeCount === 2).length;
    const on3  = scored.filter(p => p.exchangeCount === 3).length;
    const on4  = scored.filter(p => p.exchangeCount === 4).length;
    const on5p = scored.filter(p => p.exchangeCount >= 5).length;

    console.log(`[PairDiscovery] ✅ Discovered ${result.length} arbitrageable pairs:`);
    console.log(`   On exactly 2 exchanges: ${on2}  ← best spread opportunity`);
    console.log(`   On 3 exchanges:         ${on3}`);
    console.log(`   On 4 exchanges:         ${on4}`);
    console.log(`   On 5+ exchanges:        ${on5p}  ← most competitive`);

    if (result.length > 0) {
      console.log(`   Top 10: ${result.slice(0, 10).join(', ')}`);
    }

    // If discovery found very few pairs, blend with static list
    if (result.length < 20) {
      console.warn('[PairDiscovery] Too few pairs discovered — blending with static list');
      const merged = [...new Set([...result, ...TOP_100_PAIRS])].slice(0, MAX_PAIRS);
      cachedPairs    = merged;
      cacheTimestamp = Date.now();
      return merged;
    }

    cachedPairs    = result;
    cacheTimestamp = Date.now();
    return result;

  } catch (err) {
    console.error('[PairDiscovery] Discovery failed:', err.message);
    return TOP_100_PAIRS.slice(0, MAX_PAIRS);
  } finally {
    isDiscovering = false;
  }
}

/**
 * Force a fresh re-discovery on next call (e.g. after exchange list changes).
 */
export function invalidatePairCache() {
  cachedPairs    = null;
  cacheTimestamp = 0;
  console.log('[PairDiscovery] Cache invalidated — will re-discover on next scan');
}

/**
 * Get discovery stats without triggering a refresh.
 */
export function getPairDiscoveryStats() {
  return {
    cached:       cachedPairs !== null,
    pairCount:    cachedPairs?.length ?? 0,
    cacheAge:     cachedPairs ? Math.round((Date.now() - cacheTimestamp) / 1000) : null,
    cacheTTL:     CACHE_TTL_MS / 1000,
    nextRefresh:  cachedPairs
      ? new Date(cacheTimestamp + CACHE_TTL_MS).toISOString()
      : 'on next scan',
    isDiscovering,
  };
}

export default { discoverArbitragePairs, invalidatePairCache, getPairDiscoveryStats };
