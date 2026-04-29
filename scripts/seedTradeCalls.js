/**
 * Seed trade call history with ~2 months of realistic data.
 * Coins: BTC, ETH, BNB, SOL, TRUMP, XRP, LINK
 * Win rate: ~90%
 *
 * Run from project root:
 *   node backend/scripts/seedTradeCalls.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI not set'); process.exit(1); }

// ── TradeCall schema inline ────────────────────────────────────────────────────
const tradeCallSchema = new mongoose.Schema({
  pair:        { type: String, required: true, uppercase: true },
  baseAsset:   { type: String, required: true, uppercase: true },
  coingeckoId: { type: String, default: null },
  direction:   { type: String, enum: ['long', 'short'], required: true },
  entryPrice:  { type: Number, required: true },
  stopLoss:    { type: Number, required: true },
  tp1:         { type: Number, required: true },
  riskReward:  { type: Number, default: null },
  notes:       { type: String, default: '' },
  status:      { type: String, enum: ['open', 'win', 'loss', 'cancelled'], default: 'open' },
  openedAt:    { type: Date, default: Date.now },
  closedAt:    { type: Date, default: null },
  closingPrice: { type: Number, default: null },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

const TradeCall = mongoose.model('TradeCall', tradeCallSchema);

// ── Helpers ────────────────────────────────────────────────────────────────────
function rnd(min, max, dp = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(dp));
}

// Returns a Date somewhere between startDaysAgo and endDaysAgo from now
function randomDate(startDaysAgo, endDaysAgo) {
  const nowMs   = Date.now();
  const start   = nowMs - startDaysAgo * 86_400_000;
  const end     = nowMs - endDaysAgo   * 86_400_000;
  return new Date(start + Math.random() * (end - start));
}

// Build a realistic trade entry: entry → sl/tp with realistic R:R
function buildTrade({ pair, baseAsset, cgId, direction, entry, slPct, tpPct, note, openedAt, win }) {
  const slDist = entry * (slPct / 100);
  const tpDist = entry * (tpPct / 100);
  const sl = direction === 'long' ? entry - slDist : entry + slDist;
  const tp = direction === 'long' ? entry + tpDist : entry - tpDist;
  const rr = parseFloat((tpDist / slDist).toFixed(2));

  const closedAt    = new Date(openedAt.getTime() + rnd(4, 96) * 3_600_000);
  const closingPrice = win ? tp : sl;
  const status       = win ? 'win' : 'loss';

  const dp = entry < 0.01 ? 6 : entry < 1 ? 4 : entry < 100 ? 3 : 2;

  return {
    pair,
    baseAsset,
    coingeckoId: cgId,
    direction,
    entryPrice:  parseFloat(entry.toFixed(dp)),
    stopLoss:    parseFloat(sl.toFixed(dp)),
    tp1:         parseFloat(tp.toFixed(dp)),
    riskReward:  rr,
    notes:       note,
    status,
    openedAt,
    closedAt,
    closingPrice: parseFloat(closingPrice.toFixed(dp)),
  };
}

// ── Trade call definitions ─────────────────────────────────────────────────────
// 72 total: 65 wins (90.3%), 7 losses
// Spread across Feb 28 – Apr 28 (60 days ago to 1 day ago)

const records = [];

// ────────────── BTC  (15 trades, 1 loss) ──────────────────────────────────────
const btcLevels = [
  { entry: 81200, sl: 2.1, tp: 4.2, dir: 'long',  note: 'BTC bounced off 80K support, EMA20 reclaim, bullish engulfing on 4h' },
  { entry: 83500, sl: 1.8, tp: 3.8, dir: 'long',  note: 'BTC breakout above 82K resistance zone, volume surge confirmed' },
  { entry: 85000, sl: 2.0, tp: 4.0, dir: 'long',  note: 'BTC range expansion — 85K breakout, MACD cross on daily' },
  { entry: 88400, sl: 2.3, tp: 4.5, dir: 'long',  note: 'BTC 88K breakout — higher high structure, RSI 62' },
  { entry: 90000, sl: 2.2, tp: 4.2, dir: 'long',  note: 'BTC testing 90K psychological — tight accumulation, low sell pressure' },
  { entry: 91500, sl: 1.9, tp: 4.0, dir: 'long',  note: 'BTC retested 90K as support, weekly close strong' },
  { entry: 87200, sl: 2.0, tp: 4.1, dir: 'long',  note: 'BTC dip buy at 87K — EMA50 support on daily, RSI neutral' },
  { entry: 84300, sl: 2.4, tp: 4.8, dir: 'long',  note: 'BTC consolidation breakout, 84K was key pivot' },
  { entry: 86000, sl: 1.8, tp: 3.9, dir: 'long',  note: 'BTC morning star on 1D — 86K reclaim after 3-day pullback' },
  { entry: 92000, sl: 2.1, tp: 4.3, dir: 'long',  note: 'BTC 92K new leg up — dominance rising, altcoin pressure easing' },
  { entry: 89500, sl: 2.5, tp: 5.0, dir: 'short', note: 'BTC exhaustion candle at 90K, RSI 76 overbought on 4h' },
  { entry: 93000, sl: 2.0, tp: 4.0, dir: 'long',  note: 'BTC 93K push — spot ETF inflows, strong on-chain accumulation' },
  { entry: 78500, sl: 2.2, tp: 4.5, dir: 'long',  note: 'BTC macro dip buy — 78K historical support, fear index extreme' },
  { entry: 80000, sl: 2.0, tp: 3.8, dir: 'long',  note: 'BTC 80K reclaim after 3-week correction — high conviction entry' },
  { entry: 94500, sl: 2.3, tp: 4.6, dir: 'long',  note: 'BTC 94K breakout — continuation toward 100K, open interest rising' },
];
const btcWins = [true,true,true,true,true,true,true,true,true,true,true,true,true,false,true]; // 14W 1L
btcLevels.forEach((t, i) => {
  records.push(buildTrade({
    pair: 'BTCUSDT', baseAsset: 'BTC', cgId: 'bitcoin',
    direction: t.dir, entry: t.entry, slPct: t.sl, tpPct: t.tp,
    note: t.note, win: btcWins[i],
    openedAt: randomDate(60, 1),
  }));
});

// ────────────── ETH  (13 trades, 2 losses) ───────────────────────────────────
const ethLevels = [
  { entry: 1850, sl: 2.5, tp: 5.0, dir: 'long',  note: 'ETH 1850 support hold — weekly close above EMA200, dip buy' },
  { entry: 2050, sl: 2.2, tp: 4.5, dir: 'long',  note: 'ETH breakout above 2K psychological — EMA crossover on 4h' },
  { entry: 1920, sl: 2.3, tp: 4.8, dir: 'long',  note: 'ETH RSI oversold bounce at 1920, Bollinger lower band tag' },
  { entry: 2200, sl: 2.0, tp: 4.1, dir: 'long',  note: 'ETH 2200 breakout — ETF net inflows positive for 5 days' },
  { entry: 2380, sl: 2.1, tp: 4.2, dir: 'long',  note: 'ETH 2350 range breakout, volume 2x average, MACD bullish' },
  { entry: 2150, sl: 2.4, tp: 4.8, dir: 'long',  note: 'ETH pullback entry — held above 2100 support, strong buy wall' },
  { entry: 1780, sl: 2.8, tp: 5.5, dir: 'long',  note: 'ETH extreme dip buy 1780 — fear & greed 15, capitulation candle' },
  { entry: 2300, sl: 2.0, tp: 4.0, dir: 'long',  note: 'ETH continuation — above all EMAs on daily, 2300 flip support' },
  { entry: 2450, sl: 2.5, tp: 5.0, dir: 'short', note: 'ETH overbought — RSI 78 on daily, potential double top 2450 zone' },
  { entry: 1990, sl: 2.2, tp: 4.5, dir: 'long',  note: 'ETH below 2K but bouncing — key demand zone 1950-2000' },
  { entry: 2100, sl: 2.0, tp: 4.2, dir: 'long',  note: 'ETH 2100 breakout retested as support, scalp to 2200' },
  { entry: 2500, sl: 2.3, tp: 4.8, dir: 'long',  note: 'ETH 2500 reclaim — strong momentum, L2 activity elevated' },
  { entry: 2280, sl: 2.1, tp: 4.3, dir: 'long',  note: 'ETH 4h higher low structure — consolidation breakout play' },
];
const ethWins = [true,true,true,true,true,true,true,true,false,true,true,true,false]; // 11W 2L
ethLevels.forEach((t, i) => {
  records.push(buildTrade({
    pair: 'ETHUSDT', baseAsset: 'ETH', cgId: 'ethereum',
    direction: t.dir, entry: t.entry, slPct: t.sl, tpPct: t.tp,
    note: t.note, win: ethWins[i],
    openedAt: randomDate(60, 1),
  }));
});

// ────────────── BNB  (10 trades, 1 loss) ─────────────────────────────────────
const bnbLevels = [
  { entry: 580, sl: 2.2, tp: 4.5, dir: 'long',  note: 'BNB 580 support — BNB Chain TVL growing, consistent buy pressure' },
  { entry: 610, sl: 2.0, tp: 4.0, dir: 'long',  note: 'BNB 600 breakout continuation — daily EMA alignment bullish' },
  { entry: 545, sl: 2.5, tp: 5.0, dir: 'long',  note: 'BNB dip buy — 540 zone major support, RSI 32 oversold' },
  { entry: 635, sl: 2.1, tp: 4.2, dir: 'long',  note: 'BNB 635 new high — BNB burns quarterly still deflationary' },
  { entry: 598, sl: 2.3, tp: 4.5, dir: 'long',  note: 'BNB retrace to EMA50 on 4h — clean pullback in uptrend' },
  { entry: 660, sl: 2.0, tp: 4.0, dir: 'long',  note: 'BNB 660 range breakout — open interest increase, spot premium' },
  { entry: 622, sl: 2.4, tp: 4.8, dir: 'short', note: 'BNB RSI 77 on 4h — shooting star candle at 625 resistance' },
  { entry: 570, sl: 2.2, tp: 4.3, dir: 'long',  note: 'BNB demand zone — weekly support confluence, strong bounce' },
  { entry: 648, sl: 2.0, tp: 4.2, dir: 'long',  note: 'BNB breakout confirmation — held above 640 for 2 days' },
  { entry: 590, sl: 2.1, tp: 4.5, dir: 'long',  note: 'BNB double bottom at 585 — strong reversal signal on 1D' },
];
const bnbWins = [true,true,true,true,true,true,true,false,true,true]; // 9W 1L
bnbLevels.forEach((t, i) => {
  records.push(buildTrade({
    pair: 'BNBUSDT', baseAsset: 'BNB', cgId: 'binancecoin',
    direction: t.dir, entry: t.entry, slPct: t.sl, tpPct: t.tp,
    note: t.note, win: bnbWins[i],
    openedAt: randomDate(60, 1),
  }));
});

// ────────────── SOL  (12 trades, 1 loss) ─────────────────────────────────────
const solLevels = [
  { entry: 128, sl: 2.5, tp: 5.0, dir: 'long',  note: 'SOL 125-130 demand zone — Solana ecosystem activity strong, dip buy' },
  { entry: 148, sl: 2.2, tp: 4.5, dir: 'long',  note: 'SOL 145 breakout — memecoin season on Solana driving fees' },
  { entry: 135, sl: 2.3, tp: 4.8, dir: 'long',  note: 'SOL RSI reset to 45 — uptrend intact, buying retrace' },
  { entry: 158, sl: 2.0, tp: 4.2, dir: 'long',  note: 'SOL 155 range breakout — MACD cross on daily, bullish structure' },
  { entry: 162, sl: 2.1, tp: 4.4, dir: 'long',  note: 'SOL higher low on 4h — continuation from 155 breakout' },
  { entry: 118, sl: 2.8, tp: 5.5, dir: 'long',  note: 'SOL macro support 115-120 — high conviction buy after correction' },
  { entry: 143, sl: 2.4, tp: 4.8, dir: 'long',  note: 'SOL EMA20 support bounce on daily — volume confirmation' },
  { entry: 172, sl: 2.5, tp: 5.0, dir: 'short', note: 'SOL RSI 80 overbought — key resistance 170-175, take profit zone' },
  { entry: 132, sl: 2.2, tp: 4.3, dir: 'long',  note: 'SOL demand zone reclaim — 130 support tested 3 times, strong base' },
  { entry: 155, sl: 2.0, tp: 4.1, dir: 'long',  note: 'SOL 150 flip — held as support, next leg continuation' },
  { entry: 140, sl: 2.3, tp: 4.5, dir: 'long',  note: 'SOL pullback to EMA50 — clean setup, 3-day consolidation' },
  { entry: 168, sl: 2.0, tp: 4.0, dir: 'long',  note: 'SOL 165 breakout — ETH/SOL ratio turning, rotation play' },
];
const solWins = [true,true,true,true,true,true,true,true,false,true,true,true]; // 11W 1L
solLevels.forEach((t, i) => {
  records.push(buildTrade({
    pair: 'SOLUSDT', baseAsset: 'SOL', cgId: 'solana',
    direction: t.dir, entry: t.entry, slPct: t.sl, tpPct: t.tp,
    note: t.note, win: solWins[i],
    openedAt: randomDate(60, 1),
  }));
});

// ────────────── TRUMP  (8 trades, 1 loss) ────────────────────────────────────
const trumpLevels = [
  { entry: 11.20, sl: 3.5, tp: 7.0, dir: 'long',  note: 'TRUMP 11 support — political narrative catalyst, high momentum' },
  { entry: 14.80, sl: 3.0, tp: 6.2, dir: 'long',  note: 'TRUMP breakout above 14 — news catalyst, volume 5x average' },
  { entry: 18.50, sl: 3.2, tp: 6.5, dir: 'long',  note: 'TRUMP 18 reclaim — sentiment shift, large wallet accumulation' },
  { entry: 22.00, sl: 3.8, tp: 7.5, dir: 'short', note: 'TRUMP RSI 85 overbought — parabolic extension, fade the pump' },
  { entry: 15.60, sl: 3.0, tp: 6.0, dir: 'long',  note: 'TRUMP dip buy 15.50 — support zone, sentiment recovering' },
  { entry: 20.40, sl: 3.5, tp: 7.0, dir: 'long',  note: 'TRUMP 20 psychological breakout — strong holder base' },
  { entry: 12.80, sl: 4.0, tp: 8.0, dir: 'long',  note: 'TRUMP macro dip — extreme fear, major holders not selling' },
  { entry: 17.20, sl: 3.2, tp: 6.5, dir: 'long',  note: 'TRUMP range breakout — daily structure improving, momentum buy' },
];
const trumpWins = [true,true,true,true,true,true,false,true]; // 7W 1L
trumpLevels.forEach((t, i) => {
  records.push(buildTrade({
    pair: 'TRUMPUSDT', baseAsset: 'TRUMP', cgId: 'official-trump',
    direction: t.dir, entry: t.entry, slPct: t.sl, tpPct: t.tp,
    note: t.note, win: trumpWins[i],
    openedAt: randomDate(60, 1),
  }));
});

// ────────────── XRP  (7 trades, 1 loss) ──────────────────────────────────────
const xrpLevels = [
  { entry: 2.12, sl: 2.4, tp: 4.8, dir: 'long',  note: 'XRP 2.10 support — SEC clarity positive for XRP, spot demand' },
  { entry: 2.45, sl: 2.2, tp: 4.5, dir: 'long',  note: 'XRP 2.40 breakout — institutional adoption narrative, daily EMA bullish' },
  { entry: 1.95, sl: 2.8, tp: 5.5, dir: 'long',  note: 'XRP macro dip buy at 2.00 — huge support zone, RSI 30' },
  { entry: 2.70, sl: 2.5, tp: 5.0, dir: 'long',  note: 'XRP 2.70 breakout — clearing key resistance, RLUSD tailwind' },
  { entry: 2.35, sl: 2.3, tp: 4.6, dir: 'long',  note: 'XRP retrace to EMA20 on daily — higher low structure intact' },
  { entry: 2.85, sl: 3.0, tp: 6.0, dir: 'short', note: 'XRP RSI 74 — near 3.00 psychological resistance, scalp short' },
  { entry: 2.20, sl: 2.2, tp: 4.5, dir: 'long',  note: 'XRP 2.20 reclaim after dip — Ripple ODL volume growing' },
];
const xrpWins = [true,true,true,true,false,true,true]; // 6W 1L
xrpLevels.forEach((t, i) => {
  records.push(buildTrade({
    pair: 'XRPUSDT', baseAsset: 'XRP', cgId: 'ripple',
    direction: t.dir, entry: t.entry, slPct: t.sl, tpPct: t.tp,
    note: t.note, win: xrpWins[i],
    openedAt: randomDate(60, 1),
  }));
});

// ────────────── LINK  (7 trades, 0 losses) ───────────────────────────────────
const linkLevels = [
  { entry: 13.80, sl: 2.5, tp: 5.0, dir: 'long',  note: 'LINK 13.50 support — CCIP adoption growing, low supply on exchanges' },
  { entry: 15.20, sl: 2.2, tp: 4.5, dir: 'long',  note: 'LINK 15 breakout — above EMA50 on daily, volume spike' },
  { entry: 17.40, sl: 2.0, tp: 4.2, dir: 'long',  note: 'LINK 17 range breakout — DeFi TVL rising, LINK feeds demand up' },
  { entry: 14.50, sl: 2.4, tp: 4.8, dir: 'long',  note: 'LINK dip buy — held above 14 support, RSI 42 neutral-bullish' },
  { entry: 19.20, sl: 2.3, tp: 4.5, dir: 'long',  note: 'LINK 19 push — key resistance cleared, target 21' },
  { entry: 16.80, sl: 2.2, tp: 4.4, dir: 'long',  note: 'LINK pullback to EMA20 on 4h — EMA stack bullish, buy dip' },
  { entry: 21.00, sl: 2.5, tp: 5.0, dir: 'long',  note: 'LINK 21 breakout — multi-month resistance cleared, measured move' },
];
const linkWins = [true,true,true,true,true,true,true]; // 7W 0L
linkLevels.forEach((t, i) => {
  records.push(buildTrade({
    pair: 'LINKUSDT', baseAsset: 'LINK', cgId: 'chainlink',
    direction: t.dir, entry: t.entry, slPct: t.sl, tpPct: t.tp,
    note: t.note, win: linkWins[i],
    openedAt: randomDate(60, 1),
  }));
});

// ── Run ────────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`📊 Connecting to MongoDB…`);
  await mongoose.connect(MONGO_URI);

  const wins   = records.filter(r => r.status === 'win').length;
  const losses = records.filter(r => r.status === 'loss').length;
  const total  = records.length;
  const rate   = ((wins / total) * 100).toFixed(1);

  console.log(`📋 Prepared ${total} records: ${wins} wins, ${losses} losses (${rate}% win rate)`);
  console.log('💾 Inserting…');

  const result = await TradeCall.insertMany(records, { ordered: false });
  console.log(`✅ Inserted ${result.length} trade calls successfully`);

  const stats = await TradeCall.aggregate([
    { $group: { _id: '$pair', count: { $sum: 1 }, wins: { $sum: { $cond: [{ $eq: ['$status','win'] }, 1, 0] } } } },
    { $sort: { _id: 1 } },
  ]);
  console.log('\nPer-coin summary:');
  stats.forEach(s => {
    const wr = ((s.wins / s.count) * 100).toFixed(0);
    console.log(`  ${s._id.padEnd(12)} ${s.count} trades  ${s.wins}W / ${s.count - s.wins}L  (${wr}%)`);
  });

  await mongoose.disconnect();
  console.log('\n✅ Done');
}

run().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
