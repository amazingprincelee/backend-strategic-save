/**
 * GateNewsService.js
 *
 * Fetches recent crypto news from Gate.io's flash-news feed and scores
 * sentiment per token using keyword analysis.
 *
 * Used by TechnicalAnalysisEngine as a soft pre-filter:
 *   - Strong negative news  → LONG signals suppressed
 *   - Strong positive news  → SHORT signals suppressed
 *   - Neutral / no news     → signal passes through unchanged
 *
 * Design principles:
 *   - Non-blocking: always resolves (never throws to caller)
 *   - Two-tier cache: global news list (5 min) + per-symbol result (5 min)
 *   - Graceful degradation: if Gate.io is unreachable, returns neutral
 *
 * Gate.io Flash News endpoint:
 *   GET https://api.gateio.ws/api/v4/flash_news
 *   Params: limit (int, max 100), type (string, optional)
 */

import axios from 'axios';

// ─── Constants ────────────────────────────────────────────────────────────────

const GATE_NEWS_URL  = 'https://api.gateio.ws/api/v4/flash_news';
const CACHE_TTL_MS   = 5 * 60_000;   // 5 minutes — matches signal sweep interval
const FETCH_LIMIT    = 100;           // max articles per request
const REQUEST_TIMEOUT = 8_000;        // 8 s — don't block a signal sweep

// Score thresholds for signal suppression
const SUPPRESS_LONG_BELOW  = -0.40;  // suppress LONG if sentiment ≤ this
const SUPPRESS_SHORT_ABOVE =  0.40;  // suppress SHORT if sentiment ≥ this

// ─── Sentiment keywords ───────────────────────────────────────────────────────

const BULLISH_KEYWORDS = [
  'surge', 'surges', 'rally', 'rallies', 'gain', 'gains', 'bullish', 'pump',
  'all-time high', 'ath', 'breakout', 'broke out', 'adoption', 'partnership',
  'upgrade', 'launch', 'listing', 'buy', 'long', 'support', 'recover',
  'recovery', 'rise', 'rises', 'rising', 'outperform', 'accumulate',
  'institutional', 'etf approval', 'mainstream', 'record high',
];

const BEARISH_KEYWORDS = [
  'crash', 'crashes', 'dump', 'bearish', 'hack', 'hacked', 'exploit',
  'exploited', 'scam', 'ban', 'banned', 'regulation', 'lawsuit', 'fraud',
  'investigation', 'sell', 'short', 'delisting', 'delisted', 'warning',
  'drop', 'drops', 'plunge', 'plunges', 'collapse', 'collapses', 'rug',
  'rug pull', 'ponzi', 'sec', 'crackdown', 'liquidation', 'liquidated',
  'insolvency', 'insolvent', 'bankruptcy', 'bankrupt', 'suspend',
];

// ─── In-memory caches ─────────────────────────────────────────────────────────

// Global: all articles from last fetch
let _globalCache = null; // { articles: [], ts: number }

// Per-symbol: computed sentiment results
const _symbolCache = new Map(); // coin → { score, sentiment, articles, ts }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip USDT/USDC/BTC suffix and return the base coin ticker.
 * e.g. 'BTCUSDT' → 'BTC',  'ETH/USDT' → 'ETH'
 */
function baseCoin(symbol) {
  return symbol.replace(/[/]?(USDT|USDC|BUSD|BTC|ETH)$/i, '').toUpperCase();
}

/**
 * Score a single piece of text. Returns a raw integer (positive = bullish).
 */
function scoreText(text) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const w of BULLISH_KEYWORDS) if (lower.includes(w)) score += 1;
  for (const w of BEARISH_KEYWORDS) if (lower.includes(w)) score -= 1;
  return score;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Fetch (or return cached) the raw list of recent flash-news articles.
 * Always resolves — returns [] on error, stale cache if available.
 */
async function fetchArticles() {
  if (_globalCache && Date.now() - _globalCache.ts < CACHE_TTL_MS) {
    return _globalCache.articles;
  }

  try {
    const { data } = await axios.get(GATE_NEWS_URL, {
      params:  { limit: FETCH_LIMIT },
      timeout: REQUEST_TIMEOUT,
    });

    // Gate.io v4 may return an array directly or wrap it in { data: [] }
    const articles = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)   ? data.data
      : Array.isArray(data?.items)  ? data.items
      : Array.isArray(data?.result) ? data.result
      : [];

    _globalCache = { articles, ts: Date.now() };
    console.log(`[GateNews] Fetched ${articles.length} articles`);
    return articles;
  } catch (err) {
    console.warn(`[GateNews] News fetch failed: ${err.message}`);
    // Return stale cache rather than nothing
    return _globalCache?.articles ?? [];
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get sentiment for a trading pair.
 *
 * @param {string} symbol  e.g. 'BTCUSDT' or 'ETH/USDT'
 * @returns {Promise<{
 *   coin:      string,
 *   score:     number,   // -1 (very bearish) to +1 (very bullish)
 *   sentiment: 'positive'|'negative'|'neutral',
 *   articles:  { title: string, time: string|null }[],
 *   suppresses: string|null,  // 'LONG' | 'SHORT' | null
 * }>}
 */
export async function getSentiment(symbol) {
  const coin = baseCoin(symbol);

  // Check per-symbol cache
  const cached = _symbolCache.get(coin);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached;
  }

  const articles = await fetchArticles();

  // Filter articles that mention this coin ticker
  const relevant = articles.filter(a => {
    const text = [a.title, a.content, a.summary, a.description]
      .filter(Boolean).join(' ').toUpperCase();
    // Match whole-word occurrence to avoid e.g. 'LINK' matching 'UNLINK'
    const re = new RegExp(`\\b${coin}\\b`);
    return re.test(text);
  });

  let normalized = 0;

  if (relevant.length > 0) {
    const rawTotal = relevant.reduce((sum, a) => {
      const text = [a.title, a.content, a.summary, a.description]
        .filter(Boolean).join(' ');
      return sum + scoreText(text);
    }, 0);

    const avg = rawTotal / relevant.length;
    // Clamp to -1 … +1 (raw score of ±3 → ±1)
    normalized = Math.max(-1, Math.min(1, avg / 3));
    normalized = parseFloat(normalized.toFixed(3));
  }

  const sentiment =
    normalized >= 0.20  ? 'positive' :
    normalized <= -0.20 ? 'negative' :
    'neutral';

  const suppresses =
    normalized <= SUPPRESS_LONG_BELOW  ? 'LONG'  :
    normalized >= SUPPRESS_SHORT_ABOVE ? 'SHORT' :
    null;

  const result = {
    coin,
    score:     normalized,
    sentiment,
    articles:  relevant.slice(0, 3).map(a => ({
      title: a.title || a.summary || 'No title',
      time:  a.created_time ?? a.timestamp ?? a.publish_time ?? null,
    })),
    suppresses,
    ts: Date.now(),
  };

  _symbolCache.set(coin, result);

  if (relevant.length > 0) {
    console.log(
      `[GateNews] ${coin}: sentiment=${sentiment} score=${normalized} ` +
      `(${relevant.length} article${relevant.length === 1 ? '' : 's'})` +
      (suppresses ? ` → suppresses ${suppresses}` : '')
    );
  }

  return result;
}

/**
 * Clear both caches (useful in tests or on-demand refresh).
 */
export function clearNewsCache() {
  _globalCache  = null;
  _symbolCache.clear();
}

export default { getSentiment, clearNewsCache };
