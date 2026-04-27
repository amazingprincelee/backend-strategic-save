/**
 * One-off migration:
 *  1. All tp1_hit calls → win (TP was already reached, that's a win)
 *  2. Fix the BTC call entered with swapped TP1/TP2 — set tp1 = 79500, clear tp2
 *
 * Run: node --experimental-vm-modules backend/scripts/migrateTradeCallsTp.js
 * (or: node -r dotenv/config backend/scripts/migrateTradeCallsTp.js from project root)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) { console.error('❌  MONGO_URI not set'); process.exit(1); }

await mongoose.connect(MONGO_URI);
console.log('✅  Connected to MongoDB');

const TradeCall = mongoose.model('TradeCall', new mongoose.Schema({}, { strict: false }));

// ── 1. tp1_hit → win ────────────────────────────────────────────────────────
const tp1HitCalls = await TradeCall.find({ status: 'tp1_hit' });
console.log(`Found ${tp1HitCalls.length} tp1_hit call(s) to convert to win`);

for (const call of tp1HitCalls) {
  await TradeCall.findByIdAndUpdate(call._id, {
    status:       'win',
    closedAt:     call.closedAt || new Date(),
    closingPrice: call.closingPrice || call.tp1,
  });
  console.log(`  ✓ ${call.pair} tp1_hit → win`);
}

// ── 2. Fix BTC call (TP1 $80000 / TP2 $79500 → TP $79500) ──────────────────
const btcCall = await TradeCall.findOne({ pair: 'BTCUSDT', tp2: 79500 });
if (btcCall) {
  const entry = btcCall.entryPrice;   // 77469.70
  const tp    = 79500;
  const sl    = btcCall.stopLoss;     // 74841.53
  const rr    = parseFloat(((tp - entry) / (entry - sl)).toFixed(2));

  await TradeCall.findByIdAndUpdate(btcCall._id, {
    tp1:        tp,
    tp2:        null,
    tp1Hit:     false,
    tp2Hit:     false,
    riskReward: rr,
    status:     'open',
  });
  console.log(`  ✓ BTCUSDT — tp1 set to $79,500, tp2 cleared, R/R = 1:${rr}`);
} else {
  console.log('  ⚠  BTCUSDT call with tp2=79500 not found (already fixed or pair differs)');
}

await mongoose.disconnect();
console.log('✅  Migration complete');
