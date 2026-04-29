/**
 * CryptoPanicAlertService.js
 * Fetches hot crypto news from CryptoPanic's free public API.
 * Scores articles by catalyst type and extracts coin tags.
 * Only surfaces articles that have at least one coin tag and a meaningful impact score.
 */

const CP_URL = 'https://cryptopanic.com/api/free/v1/posts/?filter=hot&kind=news&public=true';
const TTL    = 5 * 60 * 1000; // 5 min cache

let _cache   = null;
let _cacheTs = 0;

// Keyword groups for impact classification (checked against lower-cased title)
const RULES = [
  {
    type:      'exchange_listing',
    sentiment: 'bullish',
    score:     92,
    keywords:  ['listed on', 'listing on', 'now available on', 'trading on',
                 'goes live on', 'added to', 'upbit listing', 'binance listing',
                 'coinbase listing', 'kraken listing', 'bybit listing', 'okx listing',
                 'kucoin listing', 'now trading'],
  },
  {
    type:      'token_burn',
    sentiment: 'bullish',
    score:     78,
    keywords:  ['token burn', 'burns ', 'burned ', 'burnt ', 'buyback and burn',
                 'deflationary', 'supply reduction'],
  },
  {
    type:      'price_surge',
    sentiment: 'bullish',
    score:     72,
    keywords:  ['pumps ', 'surges ', 'soars ', 'rallies ', 'spikes ',
                 'moons ', '+100%', '+200%', '+300%', 'all-time high', 'new ath'],
  },
  {
    type:      'partnership',
    sentiment: 'bullish',
    score:     62,
    keywords:  ['partnership', 'integration with', 'collaboration with',
                 'agreement with', 'deal with', 'joins forces'],
  },
  {
    type:      'protocol_upgrade',
    sentiment: 'bullish',
    score:     58,
    keywords:  ['mainnet launch', 'mainnet upgrade', 'v2 launch', 'v3 launch',
                 'major upgrade', 'milestone', 'goes live'],
  },
  {
    type:      'risk_event',
    sentiment: 'bearish',
    score:     85,
    keywords:  ['hacked', 'exploit', 'rug pull', 'sec charges', 'lawsuit',
                 'suspended', 'delisted', 'banned', 'crash', 'plunges', 'dumps'],
  },
];

function classifyArticle(title) {
  const t = title.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some(kw => t.includes(kw))) {
      return { impactScore: rule.score, impactType: rule.type, sentiment: rule.sentiment };
    }
  }
  return { impactScore: 35, impactType: 'general', sentiment: 'neutral' };
}

export async function getNewsAlerts() {
  const now = Date.now();
  if (_cache && now - _cacheTs < TTL) return _cache;

  try {
    const r = await fetch(CP_URL, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`CryptoPanic → ${r.status}`);
    const json = await r.json();

    const alerts = (json.results || [])
      .filter(item => (item.currencies || []).length > 0)
      .map(item => {
        const { impactScore, impactType, sentiment } = classifyArticle(item.title);
        return {
          id:          item.id,
          title:       item.title,
          url:         item.url,
          source:      item.source?.title || item.domain || 'Unknown',
          publishedAt: item.published_at,
          coins:       (item.currencies || []).map(c => ({ code: c.code, name: c.title })),
          impactScore,
          impactType,
          sentiment,
          votes: {
            positive: item.votes?.positive || 0,
            negative: item.votes?.negative || 0,
          },
        };
      })
      .filter(a => a.impactScore >= 50)
      .sort((a, b) => b.impactScore - a.impactScore || new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 25);

    _cache   = alerts;
    _cacheTs = now;
    return _cache;
  } catch (err) {
    console.warn('[CryptoPanic] alerts error:', err.message);
    return _cache || [];
  }
}
