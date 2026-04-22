// Simple in-memory cache — avoids hammering CoinGecko / GeckoTerminal free tiers
const cache = new Map();

const CG_BASE    = 'https://api.coingecko.com/api/v3';
const CG_HEADERS = { Accept: 'application/json' };

function getCached(key) {
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.ts > entry.ttl) { cache.delete(key); return null; }
  return entry.data;
}
function setCached(key, data, ttl) {
  cache.set(key, { data, ts: Date.now(), ttl });
}

const TTL_CEX  = 5  * 60 * 1000;
const TTL_DEX  = 3  * 60 * 1000;
const TTL_COIN = 10 * 60 * 1000;
const TTL_NEWS = 5  * 60 * 1000;

// GET /api/listings/cex
export const getCEXListings = async (req, res) => {
  try {
    const cacheKey = 'cex-new';
    let data = getCached(cacheKey);

    if (!data) {
      // Try the dedicated new-listings endpoint first
      const newCoinsRes = await fetch(`${CG_BASE}/coins/list/new`, { headers: CG_HEADERS });

      if (newCoinsRes.ok) {
        // Primary path — exact listing timestamps available
        const newCoins = await newCoinsRes.json();
        const ids = newCoins.slice(0, 50).map(c => c.id).join(',');
        const marketsRes = await fetch(
          `${CG_BASE}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h,7d`,
          { headers: CG_HEADERS },
        );
        const markets = marketsRes.ok ? await marketsRes.json() : [];
        const activatedMap = Object.fromEntries(newCoins.map(c => [c.id, c.activated_at]));
        data = (Array.isArray(markets) ? markets : [])
          .map(coin => ({ ...coin, listedAt: activatedMap[coin.id] || null }));
      } else {
        // Fallback — small-cap coins filtered by recent atl_date
        console.warn(`[Listings] /coins/list/new returned ${newCoinsRes.status}, using fallback`);
        const r = await fetch(
          `${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_asc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d`,
          { headers: CG_HEADERS },
        );
        if (!r.ok) throw new Error(`CoinGecko /coins/markets → ${r.status}`);
        const coins = await r.json();
        if (!Array.isArray(coins)) throw new Error('Unexpected CoinGecko response');

        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const recent = coins
          .filter(c => c.atl_date && new Date(c.atl_date) >= cutoff)
          .sort((a, b) => new Date(b.atl_date) - new Date(a.atl_date))
          .slice(0, 60);

        data = (recent.length >= 5 ? recent : coins.slice(0, 60))
          .map(c => ({ ...c, listedAt: c.atl_date || null }));
      }

      setCached(cacheKey, data, TTL_CEX);
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('[Listings] CEX error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/listings/dex?network=eth
export const getDEXListings = async (req, res) => {
  try {
    const network = req.query.network || 'all';
    const cacheKey = `dex-${network}`;
    let raw = getCached(cacheKey);

    if (!raw) {
      const url = network === 'all'
        ? 'https://api.geckoterminal.com/api/v2/networks/new_pools?include=base_token,quote_token,dex,network&page=1'
        : `https://api.geckoterminal.com/api/v2/networks/${network}/new_pools?include=base_token,quote_token,dex&page=1`;

      const r = await fetch(url, {
        headers: { Accept: 'application/json;version=20230302' },
      });
      if (!r.ok) throw new Error(`GeckoTerminal error ${r.status}`);
      raw = await r.json();
      setCached(cacheKey, raw, TTL_DEX);
    }

    // Flatten response for frontend convenience
    const included = raw.included || [];
    const tokenMap = Object.fromEntries(
      included
        .filter(i => i.type === 'token')
        .map(i => [i.id, { name: i.attributes?.name, symbol: i.attributes?.symbol, image: i.attributes?.image_url }]),
    );
    const dexMap = Object.fromEntries(
      included
        .filter(i => i.type === 'dex')
        .map(i => [i.id, i.attributes?.name]),
    );
    const netMap = Object.fromEntries(
      included
        .filter(i => i.type === 'network')
        .map(i => [i.id, i.attributes?.name]),
    );

    const pools = (raw.data || []).map(p => {
      const attr = p.attributes || {};
      const baseId  = p.relationships?.base_token?.data?.id;
      const quoteId = p.relationships?.quote_token?.data?.id;
      const dexId   = p.relationships?.dex?.data?.id;
      const netId   = p.relationships?.network?.data?.id;

      return {
        id:          p.id,
        address:     attr.address,
        name:        attr.name,
        dex:         dexMap[dexId] || dexId,
        network:     netMap[netId] || network,
        priceUSD:    parseFloat(attr.base_token_price_usd) || 0,
        fdvUSD:      parseFloat(attr.fdv_usd) || 0,
        liquidityUSD: parseFloat(attr.reserve_in_usd) || 0,
        volume24h:   parseFloat(attr.volume_usd?.h24) || 0,
        change1h:    parseFloat(attr.price_change_percentage?.h1) || 0,
        change24h:   parseFloat(attr.price_change_percentage?.h24) || 0,
        txBuys24h:   attr.transactions?.h24?.buys || 0,
        txSells24h:  attr.transactions?.h24?.sells || 0,
        createdAt:   attr.pool_created_at,
        baseToken:   tokenMap[baseId] || { symbol: '?', name: '?' },
        quoteToken:  tokenMap[quoteId] || { symbol: '?', name: '?' },
      };
    });

    res.json({ success: true, data: pools });
  } catch (err) {
    console.error('[Listings] DEX error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/listings/coin/:id
export const getCoinDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `coin-${id}`;
    let raw = getCached(cacheKey);

    if (!raw) {
      const r = await fetch(
        `${CG_BASE}/coins/${id}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false&sparkline=false`,
        { headers: CG_HEADERS },
      );
      if (!r.ok) return res.status(404).json({ success: false, message: 'Coin not found' });
      raw = await r.json();
      setCached(cacheKey, raw, TTL_COIN);
    }

    // Trim to what the frontend actually needs
    const detail = {
      id:           raw.id,
      symbol:       raw.symbol,
      name:         raw.name,
      image:        raw.image?.large,
      description:  raw.description?.en || '',
      genesisDate:  raw.genesis_date,
      marketCapRank: raw.market_cap_rank,
      publicNotice: raw.public_notice || null,
      price:        raw.market_data?.current_price?.usd,
      change24h:    raw.market_data?.price_change_percentage_24h,
      change7d:     raw.market_data?.price_change_percentage_7d,
      ath:          raw.market_data?.ath?.usd,
      atl:          raw.market_data?.atl?.usd,
      marketCap:    raw.market_data?.market_cap?.usd,
      volume24h:    raw.market_data?.total_volume?.usd,
      community: {
        twitterFollowers: raw.community_data?.twitter_followers || 0,
        redditSubscribers: raw.community_data?.reddit_subscribers || 0,
        telegramUsers: raw.community_data?.telegram_channel_user_count || 0,
      },
      links: {
        homepage:   (raw.links?.homepage || []).filter(Boolean)[0] || null,
        whitepaper: raw.links?.whitepaper || null,
        twitter:    raw.links?.twitter_screen_name
          ? `https://twitter.com/${raw.links.twitter_screen_name}` : null,
        telegram:   raw.links?.telegram_channel_identifier
          ? `https://t.me/${raw.links.telegram_channel_identifier}` : null,
        reddit:     raw.links?.subreddit_url || null,
        github:     (raw.links?.repos_url?.github || []).filter(Boolean)[0] || null,
        explorer:   (raw.links?.blockchain_site || []).filter(Boolean)[0] || null,
      },
      statusUpdates: (raw.status_updates || []).slice(0, 3),
    };

    res.json({ success: true, data: detail });
  } catch (err) {
    console.error('[Listings] coin detail error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/listings/news/:symbol
export const getCoinNews = async (req, res) => {
  try {
    const { symbol } = req.params;
    const cacheKey = `news-${symbol.toUpperCase()}`;
    let data = getCached(cacheKey);

    if (!data) {
      // CryptoPanic free public API — no key required for basic access
      const r = await fetch(
        `https://cryptopanic.com/api/free/v1/posts/?currencies=${symbol.toUpperCase()}&kind=news&public=true`,
        { headers: { Accept: 'application/json' } },
      );
      if (!r.ok) throw new Error(`CryptoPanic error ${r.status}`);
      const json = await r.json();
      data = (json.results || []).slice(0, 15).map(item => ({
        id:          item.id,
        title:       item.title,
        url:         item.url,
        source:      item.source?.title || item.domain,
        publishedAt: item.published_at,
        votes: {
          positive: item.votes?.positive || 0,
          negative: item.votes?.negative || 0,
        },
      }));
      setCached(cacheKey, data, TTL_NEWS);
    }

    res.json({ success: true, data });
  } catch (err) {
    // Return empty rather than error — news is supplementary
    res.json({ success: true, data: [] });
  }
};
