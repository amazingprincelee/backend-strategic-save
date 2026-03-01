/**
 * MarketDataService.js
 * Fetches multi-timeframe OHLCV data from Binance REST API.
 * Supports Spot and Futures.  Uses in-memory TTL cache per (symbol, tf, market).
 * Falls back to Bybit via CCXT when Binance is geo-blocked (403/451).
 *
 * Candle format returned: { timestamp, open, high, low, close, volume }
 */

import axios from 'axios';
import ccxt  from 'ccxt';

// Binance primary + fallback API hosts (tried in order on timeout/error)
const BINANCE_SPOT_HOSTS = [
  'https://api.binance.com/api/v3',
  'https://api1.binance.com/api/v3',
  'https://api2.binance.com/api/v3',
  'https://api3.binance.com/api/v3',
];
const BINANCE_FUTURES_HOSTS = [
  'https://fapi.binance.com/fapi/v1',
];

// Keep top-level vars for compatibility
const BINANCE_SPOT    = BINANCE_SPOT_HOSTS[0];
const BINANCE_FUTURES = BINANCE_FUTURES_HOSTS[0];

// How many candles to fetch per timeframe (enough to warm all indicators)
const CANDLE_LIMITS = {
  '1m':  120,  // 2 hours of 1-min candles
  '5m':  120,  // 10 hours of 5-min candles
  '15m': 120,  // 30 hours of 15-min candles
  '1h':  260,  // ~11 days  — covers EMA200 warmup
};

// Cache TTL per timeframe (refresh no sooner than one candle close)
const CACHE_TTL = {
  '1m':  55_000,         // just under 1 minute
  '5m':  4 * 60_000,     // 4 minutes
  '15m': 14 * 60_000,    // 14 minutes
  '1h':  55 * 60_000,    // 55 minutes
};

const FUNDING_CACHE_TTL = 5 * 60_000; // 5 minutes

const http = axios.create({ timeout: 15_000 });

// Retry a GET through all fallback hosts for Binance
async function fetchWithFallback(hosts, path, params) {
  let lastErr;
  for (const base of hosts) {
    try {
      const res = await http.get(`${base}${path}`, { params });
      return res;
    } catch (err) {
      lastErr = err;
      const code = err.response?.status;
      // Only retry on timeout or 5xx — not on 4xx (bad params won't be fixed by changing host)
      if (code && code < 500) throw err;
    }
  }
  throw lastErr;
}

// ─── Bybit fallback (used when Binance is geo-blocked 403/451) ────────────────

const _bybitCache = {};

function getBybitExchange(marketType) {
  const key = marketType === 'futures' ? 'futures' : 'spot';
  if (!_bybitCache[key]) {
    _bybitCache[key] = new ccxt.bybit({
      enableRateLimit: true,
      options: { defaultType: marketType === 'futures' ? 'linear' : 'spot' },
    });
  }
  return _bybitCache[key];
}

// Convert Binance symbol format to CCXT: BTCUSDT → BTC/USDT (spot) or BTC/USDT:USDT (futures)
function toCcxtSymbol(symbol, marketType) {
  const base = symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol.slice(0, -4);
  return marketType === 'futures' ? `${base}/USDT:USDT` : `${base}/USDT`;
}

async function fetchFromBybit(symbol, timeframe, limit, marketType) {
  const exchange   = getBybitExchange(marketType);
  const ccxtSymbol = toCcxtSymbol(symbol, marketType);
  const ohlcv      = await exchange.fetchOHLCV(ccxtSymbol, timeframe, undefined, limit);
  return ohlcv.map(k => ({
    timestamp: k[0],
    open:      k[1],
    high:      k[2],
    low:       k[3],
    close:     k[4],
    volume:    k[5],
  }));
}

// ─── Service ─────────────────────────────────────────────────────────────────

class MarketDataService {
  constructor() {
    /** @type {Map<string, { candles: object[], ts: number }>} */
    this._candleCache  = new Map();
    /** @type {Map<string, { rate: number, ts: number }>} */
    this._fundingCache = new Map();
    /** @type {Map<string, { data: object, ts: number }>} */
    this._tickerCache  = new Map();
  }

  // ─── Candles ─────────────────────────────────────────────────────────────

  /**
   * Fetch OHLCV for one (symbol, timeframe, market) combination.
   * Returns cached data if still fresh.
   *
   * @param {string} symbol      e.g. 'BTCUSDT'
   * @param {string} timeframe   '1m' | '5m' | '15m' | '1h'
   * @param {'spot'|'futures'} marketType
   * @param {number} [limit]     override default candle count
   */
  async fetchCandles(symbol, timeframe, marketType = 'spot', limit = null) {
    const key    = `${symbol}:${timeframe}:${marketType}`;
    const cached = this._candleCache.get(key);
    const ttl    = CACHE_TTL[timeframe] ?? 60_000;

    if (cached && Date.now() - cached.ts < ttl) return cached.candles;

    const hosts = marketType === 'futures' ? BINANCE_FUTURES_HOSTS : BINANCE_SPOT_HOSTS;
    const lim   = limit ?? CANDLE_LIMITS[timeframe] ?? 120;

    let candles;
    try {
      const { data } = await fetchWithFallback(hosts, '/klines', { symbol, interval: timeframe, limit: lim });
      candles = data.map(k => ({
        timestamp: k[0],
        open:      parseFloat(k[1]),
        high:      parseFloat(k[2]),
        low:       parseFloat(k[3]),
        close:     parseFloat(k[4]),
        volume:    parseFloat(k[5]),
      }));
    } catch (err) {
      const code = err.response?.status;
      if (code === 403 || code === 451) {
        console.warn(`[MarketData] Binance geo-blocked (${code}), falling back to Bybit for ${symbol} ${timeframe}…`);
        candles = await fetchFromBybit(symbol, timeframe, lim, marketType);
      } else {
        throw err;
      }
    }

    this._candleCache.set(key, { candles, ts: Date.now() });
    return candles;
  }

  /**
   * Fetch candles for ALL timeframes simultaneously.
   * Returns { '1m': [...], '5m': [...], '15m': [...], '1h': [...] }
   * A timeframe entry is [] if the request failed.
   */
  async fetchMultiTimeframe(symbol, marketType = 'spot') {
    const timeframes = ['1m', '5m', '15m', '1h'];
    const results    = await Promise.allSettled(
      timeframes.map(tf => this.fetchCandles(symbol, tf, marketType))
    );

    const out = {};
    timeframes.forEach((tf, i) => {
      out[tf] = results[i].status === 'fulfilled' ? results[i].value : [];
    });
    return out;
  }

  // ─── Ticker ──────────────────────────────────────────────────────────────

  /**
   * Fetch 24-hour ticker stats.
   * Cached for 30 seconds.
   */
  async fetchTicker(symbol, marketType = 'spot') {
    const key    = `ticker:${symbol}:${marketType}`;
    const cached = this._tickerCache.get(key);
    if (cached && Date.now() - cached.ts < 30_000) return cached.data;

    const hosts  = marketType === 'futures' ? BINANCE_FUTURES_HOSTS : BINANCE_SPOT_HOSTS;

    let ticker;
    try {
      const { data } = await fetchWithFallback(hosts, '/ticker/24hr', { symbol });
      ticker = {
        lastPrice:          parseFloat(data.lastPrice),
        priceChangePercent: parseFloat(data.priceChangePercent),
        volume:             parseFloat(data.volume),
        quoteVolume:        parseFloat(data.quoteVolume),
        high24h:            parseFloat(data.highPrice),
        low24h:             parseFloat(data.lowPrice),
      };
    } catch (err) {
      const code = err.response?.status;
      if (code === 403 || code === 451) {
        console.warn(`[MarketData] Binance geo-blocked (${code}), falling back to Bybit ticker for ${symbol}…`);
        const exchange   = getBybitExchange(marketType);
        const ccxtSymbol = toCcxtSymbol(symbol, marketType);
        const t          = await exchange.fetchTicker(ccxtSymbol);
        ticker = {
          lastPrice:          t.last        ?? 0,
          priceChangePercent: t.percentage  ?? 0,
          volume:             t.baseVolume  ?? 0,
          quoteVolume:        t.quoteVolume ?? 0,
          high24h:            t.high        ?? 0,
          low24h:             t.low         ?? 0,
        };
      } else {
        throw err;
      }
    }

    this._tickerCache.set(key, { data: ticker, ts: Date.now() });
    return ticker;
  }

  // ─── Funding rate (futures only) ─────────────────────────────────────────

  /**
   * Returns the latest funding rate for a futures pair.
   * Positive = longs pay shorts (bearish pressure).
   * Negative = shorts pay longs (bullish pressure).
   */
  async fetchFundingRate(symbol) {
    const cached = this._fundingCache.get(symbol);
    if (cached && Date.now() - cached.ts < FUNDING_CACHE_TTL) return cached.rate;

    try {
      const { data } = await http.get(`${BINANCE_FUTURES}/premiumIndex`, {
        params: { symbol },
      });
      const rate = parseFloat(data.lastFundingRate ?? 0);
      this._fundingCache.set(symbol, { rate, ts: Date.now() });
      return rate;
    } catch {
      return 0;
    }
  }

  // ─── Extended history (for AI training / backtesting) ────────────────────

  /**
   * Fetch up to 1000 historical candles for training or backtesting.
   * NOT cached (intended for one-off background use).
   */
  async fetchHistoricalCandles(symbol, timeframe = '1h', limit = 1000, marketType = 'spot') {
    const hosts  = marketType === 'futures' ? BINANCE_FUTURES_HOSTS : BINANCE_SPOT_HOSTS;

    try {
      const { data } = await fetchWithFallback(hosts, '/klines', { symbol, interval: timeframe, limit });
      return data.map(k => ({
        timestamp: k[0],
        open:      parseFloat(k[1]),
        high:      parseFloat(k[2]),
        low:       parseFloat(k[3]),
        close:     parseFloat(k[4]),
        volume:    parseFloat(k[5]),
      }));
    } catch (err) {
      const code = err.response?.status;
      if (code === 403 || code === 451) {
        console.warn(`[MarketData] Binance geo-blocked (${code}), falling back to Bybit historical for ${symbol}…`);
        return await fetchFromBybit(symbol, timeframe, limit, marketType);
      }
      throw err;
    }
  }

  // ─── Cache management ─────────────────────────────────────────────────────

  clearCache(symbol = null) {
    if (symbol) {
      for (const key of this._candleCache.keys()) {
        if (key.startsWith(symbol)) this._candleCache.delete(key);
      }
    } else {
      this._candleCache.clear();
      this._tickerCache.clear();
      this._fundingCache.clear();
    }
  }
}

export default new MarketDataService();
