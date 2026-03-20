/**
 * TriangularArbitrageScanner.js
 *
 * Detects triangular arbitrage on Gate.io (globally accessible).
 * Each "triangle" is a cycle of 3 trades starting and ending in USDT:
 *   USDT → A → B → USDT   (forward)
 *   USDT → B → A → USDT   (reverse)
 *
 * Profit is calculated using live bid/ask prices so spread is accounted for.
 * Exchange fee: 0.1% per leg (0.3% total) — only surfaces net-positive results.
 */

import axios from 'axios';
import TriangularOpportunity from '../../models/TriangularOpportunity.js';

// ─── Pre-defined triangles (asset trios) ────────────────────────────────────
// We check both forward and reverse directions for each trio.
// All pairs must be available on Gate.io spot.
const TRIANGLES = [
  ['USDT', 'BTC',  'ETH'],
  ['USDT', 'BTC',  'BNB'],
  ['USDT', 'BTC',  'SOL'],
  ['USDT', 'BTC',  'XRP'],
  ['USDT', 'BTC',  'LTC'],
  ['USDT', 'BTC',  'DOGE'],
  ['USDT', 'BTC',  'ADA'],
  ['USDT', 'BTC',  'AVAX'],
  ['USDT', 'ETH',  'BNB'],
  ['USDT', 'ETH',  'SOL'],
  ['USDT', 'ETH',  'MATIC'],
  ['USDT', 'ETH',  'LINK'],
  ['USDT', 'ETH',  'DOT'],
  ['USDT', 'BNB',  'SOL'],
  ['USDT', 'BNB',  'XRP'],
];

const EXCHANGE   = 'gateio';
const FEE        = 0.001; // 0.1% per leg
const MIN_NET_PROFIT = 0.05; // 0.05% minimum net profit to surface
const GATE_BASE  = 'https://api.gateio.ws/api/v4';
const START_CAP  = 1000; // USDT simulation capital

// ─── In-memory cache ─────────────────────────────────────────────────────────
let _cache = [];
let _lastScan = null;
let _isScanning = false;
let _stats = { totalScans: 0, opportunitiesFound: 0, lastDuration: 0 };

// ─── Gate.io ticker fetch ─────────────────────────────────────────────────────
async function fetchTickers() {
  const res = await axios.get(`${GATE_BASE}/spot/tickers`, { timeout: 10000 });
  // Returns array of { currency_pair, highest_bid, lowest_ask, last, ... }
  const map = {};
  for (const t of res.data) {
    map[t.currency_pair] = {
      bid: parseFloat(t.highest_bid),
      ask: parseFloat(t.lowest_ask),
      last: parseFloat(t.last),
    };
  }
  return map;
}

// ─── Build Gate.io pair name ──────────────────────────────────────────────────
// Gate.io uses underscore: BTC_USDT, ETH_BTC, etc.
function gatePair(base, quote) {
  return `${base}_${quote}`;
}

// ─── Simulate one triangle cycle ─────────────────────────────────────────────
// Forward:  USDT →[buy A with USDT]→ A →[buy B with A]→ B →[sell B for USDT]→ USDT
// Reverse:  USDT →[buy B with USDT]→ B →[sell B for A]→ A →[sell A for USDT]→ USDT
function simulateTriangle(tickers, a, b, direction) {
  // Pairs needed (Gate.io format)
  const pairAUSDT = gatePair(a, 'USDT');
  const pairBA    = gatePair(b, a);
  const pairBUSDT = gatePair(b, 'USDT');

  const tAUSDT = tickers[pairAUSDT];
  const tBA    = tickers[pairBA];
  const tBUSDT = tickers[pairBUSDT];

  if (!tAUSDT || !tBA || !tBUSDT) return null;
  if (!tAUSDT.ask || !tBA.ask || !tBUSDT.bid) return null;

  let amount = START_CAP;
  let prices, pairs, dirs;

  if (direction === 'forward') {
    // Step 1: Buy A with USDT  → pay ask(A/USDT)
    const amtA = (amount / tAUSDT.ask) * (1 - FEE);
    // Step 2: Buy B with A     → pay ask(B/A)
    const amtB = (amtA  / tBA.ask)    * (1 - FEE);
    // Step 3: Sell B for USDT  → receive bid(B/USDT)
    const endUSDT = (amtB * tBUSDT.bid) * (1 - FEE);

    amount = endUSDT;
    prices = { step1: tAUSDT.ask, step2: tBA.ask, step3: tBUSDT.bid };
    pairs  = [`${a}/USDT`, `${b}/${a}`, `${b}/USDT`];
    dirs   = ['buy', 'buy', 'sell'];
  } else {
    // Reverse: USDT → B → A → USDT
    // Step 1: Buy B with USDT  → pay ask(B/USDT)
    const amtB2 = (amount / tBUSDT.ask) * (1 - FEE);
    // Step 2: Sell B for A     → receive bid(B/A)
    const amtA2 = (amtB2 * tBA.bid)     * (1 - FEE);
    // Step 3: Sell A for USDT  → receive bid(A/USDT)
    const endUSDT2 = (amtA2 * tAUSDT.bid) * (1 - FEE);

    if (!tBUSDT.ask || !tBA.bid || !tAUSDT.bid) return null;

    amount = endUSDT2;
    prices = { step1: tBUSDT.ask, step2: tBA.bid, step3: tAUSDT.bid };
    pairs  = [`${b}/USDT`, `${b}/${a}`, `${a}/USDT`];
    dirs   = ['buy', 'sell', 'sell'];
  }

  const grossProfit = ((amount - START_CAP) / START_CAP) * 100;
  // Net profit already includes fees in the simulation above, but label it clearly
  const netProfit   = grossProfit;
  // Gross (without fees) for display
  const grossNoFee  = (((amount / Math.pow(1 - FEE, 3)) - START_CAP) / START_CAP) * 100;

  return {
    exchange:           EXCHANGE,
    path:               direction === 'forward' ? ['USDT', a, b] : ['USDT', b, a],
    pairs,
    directions:         dirs,
    prices,
    grossProfitPercent: parseFloat(grossNoFee.toFixed(4)),
    netProfitPercent:   parseFloat(netProfit.toFixed(4)),
    feePerLegPercent:   FEE * 100,
    startCapital:       START_CAP,
    endCapital:         parseFloat(amount.toFixed(4)),
    direction,
  };
}

// ─── Main scan ────────────────────────────────────────────────────────────────
async function runScan(io) {
  if (_isScanning) return _cache;
  _isScanning = true;
  const t0 = Date.now();

  try {
    const tickers = await fetchTickers();
    const found   = [];

    for (const [, a, b] of TRIANGLES) {
      for (const dir of ['forward', 'reverse']) {
        const result = simulateTriangle(tickers, a, b, dir);
        if (result && result.netProfitPercent >= MIN_NET_PROFIT) {
          found.push(result);
        }
      }
    }

    // Sort by net profit descending
    found.sort((x, y) => y.netProfitPercent - x.netProfitPercent);

    // Persist notable opportunities (≥ 0.3% net) to DB
    const notable = found.filter(f => f.netProfitPercent >= 0.3);
    for (const opp of notable) {
      const oppId = `${opp.exchange}-${opp.path.join('-')}-${opp.direction}`;
      try {
        await TriangularOpportunity.findOneAndUpdate(
          { opportunityId: oppId },
          {
            $set: {
              ...opp,
              opportunityId: oppId,
              status:      'active',
              lastSeenAt:  new Date(),
            },
            $setOnInsert: { firstDetectedAt: new Date() },
          },
          { upsert: true, new: true }
        );
      } catch (dbErr) {
        if (dbErr.code !== 11000) console.warn('[TriArb] DB upsert error:', dbErr.message);
      }
    }

    // Mark DB records not seen this scan as cleared
    if (notable.length > 0) {
      const activeIds = notable.map(o => `${o.exchange}-${o.path.join('-')}-${o.direction}`);
      await TriangularOpportunity.updateMany(
        { status: 'active', opportunityId: { $nin: activeIds } },
        { $set: { status: 'cleared', clearedAt: new Date() } }
      ).catch(() => {});
    } else {
      await TriangularOpportunity.updateMany(
        { status: 'active' },
        { $set: { status: 'cleared', clearedAt: new Date() } }
      ).catch(() => {});
    }

    _cache = found;
    _lastScan = new Date();
    _stats.totalScans++;
    _stats.opportunitiesFound = found.length;
    _stats.lastDuration = Date.now() - t0;

    // Emit real-time update
    if (io && found.length > 0) {
      io.emit('triangular:update', {
        opportunities: found,
        lastScan:      _lastScan,
        count:         found.length,
      });
    }

    console.log(`[TriArb] Scan complete in ${_stats.lastDuration}ms — ${found.length} opportunit${found.length === 1 ? 'y' : 'ies'} found`);
    return found;
  } catch (err) {
    console.warn('[TriArb] Scan error:', err.message);
    return _cache;
  } finally {
    _isScanning = false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function getCachedTriangular() {
  return { opportunities: _cache, lastScan: _lastScan, isScanning: _isScanning, stats: _stats };
}

export async function initializeTriangularScanner(io) {
  console.log('[TriArb] Starting triangular arbitrage scanner...');
  await runScan(io);
  return runScan.bind(null, io);
}

export { runScan as runTriangularScan };
