/**
 * UpbitListingService.js
 * Polls Upbit's public market API every 5 minutes.
 * Detects newly listed KRW markets and enriches them with live ticker data.
 * KRW markets are used because Upbit KRW pairs drive the sharpest listing pumps.
 */

const UPBIT_MARKET_URL = 'https://api.upbit.com/v1/market/all';
const UPBIT_TICKER_URL = 'https://api.upbit.com/v1/ticker';
const POLL_TTL         = 5  * 60 * 1000; // re-poll markets every 5 min
const TICKER_TTL       = 60 * 1000;       // re-fetch tickers every 60 s
const KEEP_DAYS        = 7;               // surface listings up to 7 days old

let _knownMarkets  = null;            // Set<string> of market codes seen so far
let _recentListings = [];             // [{market, symbol, name, discoveredAt}]
let _lastPoll      = 0;
const _tickerCache = new Map();       // market → {ts, ...ticker fields}

async function fetchAllMarkets() {
  const r = await fetch(UPBIT_MARKET_URL, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Upbit /market/all → ${r.status}`);
  return r.json();
}

async function fetchTickers(markets) {
  if (!markets.length) return [];
  const r = await fetch(
    `${UPBIT_TICKER_URL}?markets=${encodeURIComponent(markets.join(','))}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!r.ok) return [];
  return r.json();
}

async function enrichWithTickers(listings) {
  if (!listings.length) return listings;
  const now      = Date.now();
  const needFetch = listings
    .map(l => l.market)
    .filter(m => { const c = _tickerCache.get(m); return !c || now - c.ts > TICKER_TTL; });

  if (needFetch.length) {
    try {
      const tickers = await fetchTickers(needFetch);
      for (const t of tickers) {
        _tickerCache.set(t.market, {
          ts:        now,
          priceKRW:  t.trade_price,
          change24h: +(t.signed_change_rate * 100).toFixed(2), // percent
          volume24h: t.acc_trade_price_24h,                    // KRW volume
          high24h:   t.high_price,
          low24h:    t.low_price,
        });
      }
    } catch (e) {
      console.warn('[Upbit] ticker fetch error:', e.message);
    }
  }

  return listings.map(l => ({ ...l, ticker: _tickerCache.get(l.market) || null }));
}

export async function getRecentUpbitListings() {
  const now = Date.now();

  if (_knownMarkets !== null && now - _lastPoll < POLL_TTL) {
    return enrichWithTickers(_recentListings);
  }

  try {
    const all     = await fetchAllMarkets();
    const krw     = all.filter(m => m.market.startsWith('KRW-'));
    const current = new Set(krw.map(m => m.market));

    if (_knownMarkets === null) {
      // First run — snapshot the known market list; nothing is "new" yet
      _knownMarkets = current;
    } else {
      for (const market of current) {
        if (!_knownMarkets.has(market)) {
          const info = krw.find(m => m.market === market);
          _recentListings.unshift({
            market,
            symbol:      market.replace('KRW-', ''),
            name:        info?.english_name || market.replace('KRW-', ''),
            discoveredAt: new Date().toISOString(),
          });
          _knownMarkets.add(market);
          console.log(`[Upbit] New KRW listing detected: ${market}`);
        }
      }

      const cutoff = now - KEEP_DAYS * 86_400_000;
      _recentListings = _recentListings
        .filter(l => new Date(l.discoveredAt).getTime() > cutoff)
        .slice(0, 25);
    }

    _lastPoll = now;
  } catch (err) {
    console.warn('[Upbit] market poll error:', err.message);
  }

  return enrichWithTickers(_recentListings);
}
