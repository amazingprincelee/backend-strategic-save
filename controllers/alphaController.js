import { getSettings } from '../models/AppSettings.js';

// 15-minute in-memory cache — one shared set of signals for all users
let _signalCache = null;
let _signalCacheTs = 0;
const SIGNAL_TTL = 15 * 60 * 1000;

function scoreSignal(coin) {
  const h1  = coin.price_change_percentage_1h_in_currency  || 0;
  const h24 = coin.price_change_percentage_24h_in_currency || coin.price_change_percentage_24h || 0;
  const d7  = coin.price_change_percentage_7d_in_currency  || 0;
  const volMcap = coin.market_cap > 0 ? coin.total_volume / coin.market_cap : 0;

  const isBullish = h1 > 0.3 && h24 > 0;
  const isBearish = h1 < -0.3 && h24 < 0;
  if (!isBullish && !isBearish) return null;

  const momentumStrength = Math.min(Math.abs(h1) / 5, 0.25);
  const volumeBoost      = Math.min(volMcap * 2, 0.20);
  const trendConfirm     = Math.sign(h24) === Math.sign(d7) ? 0.10 : 0;
  const confidence       = Math.min(0.50 + momentumStrength + volumeBoost + trendConfirm, 0.97);

  const reasons = [];
  if (Math.abs(h1)  > 1)    reasons.push(`${Math.abs(h1).toFixed(1)}% move in 1h`);
  if (volMcap       > 0.05) reasons.push('elevated volume');
  if (Math.sign(h24) === Math.sign(d7)) reasons.push('multi-timeframe confirmation');
  if (Math.abs(h24) > 10)   reasons.push(`${Math.abs(h24).toFixed(0)}% daily momentum`);

  return {
    id:           coin.id,
    symbol:       coin.symbol.toUpperCase(),
    name:         coin.name,
    image:        coin.image,
    price:        coin.current_price,
    priceChange1h:  h1,
    priceChange24h: h24,
    priceChange7d:  d7,
    volume:       coin.total_volume,
    marketCap:    coin.market_cap,
    type:         isBullish ? 'BUY' : 'SELL',
    confidence,
    reason:       reasons.join(' · ') || 'momentum detected',
  };
}

async function buildSignals() {
  const r = await fetch(
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=100&page=1&sparkline=false&price_change_percentage=1h,24h,7d',
    { headers: { Accept: 'application/json' } },
  );
  if (!r.ok) throw new Error(`CoinGecko unavailable (${r.status})`);
  const coins = await r.json();

  return coins
    .map(scoreSignal)
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 30);
}

// GET /api/alpha/signals  (requires authenticate — uses req.user for gating)
export const getSignals = async (req, res) => {
  try {
    const now = Date.now();
    if (!_signalCache || now - _signalCacheTs > SIGNAL_TTL) {
      _signalCache   = await buildSignals();
      _signalCacheTs = now;
    }

    const isPremium =
      req.user?.subscriptionStatus === 'active' ||
      req.user?.role === 'admin';

    const settings   = await getSettings();
    const freeLimit  = settings.freeSignalsPerDay || 2;
    const total      = _signalCache.length;

    const signals    = isPremium ? _signalCache : _signalCache.slice(0, freeLimit);
    const lockedCount = isPremium ? 0 : Math.max(0, total - freeLimit);

    res.json({
      success: true,
      data: {
        signals,
        total,
        lockedCount,
        isPremium,
        freeLimit,
        nextRefreshMs: Math.max(0, SIGNAL_TTL - (now - _signalCacheTs)),
        generatedAt: new Date(_signalCacheTs).toISOString(),
      },
    });
  } catch (err) {
    console.error('[Alpha] signals error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
