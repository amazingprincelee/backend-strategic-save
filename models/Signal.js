/**
 * Signal.js
 * MongoDB schema for persisted trading signals.
 * Includes outcome tracking so the backtester can evaluate live signal performance.
 */

import mongoose from 'mongoose';

const outcomeSchema = new mongoose.Schema({
  result:     { type: String, enum: ['hit_tp', 'hit_sl', 'expired'] },
  closePrice: Number,
  pnlPercent: Number,
  closedAt:   Date,
}, { _id: false });

const signalSchema = new mongoose.Schema(
  {
    // ── Core signal fields ─────────────────────────────────────────────────
    pair:    { type: String, required: true, index: true }, // 'BTC/USDT'
    type:    { type: String, enum: ['LONG', 'SHORT'], required: true },
    entry:   { type: Number, required: true },
    stopLoss:   { type: Number, required: true },
    takeProfit: { type: Number, required: true },
    leverage:   { type: Number, default: null },  // null = spot
    riskReward: { type: Number },
    atr:        { type: Number },

    // ── Classification ────────────────────────────────────────────────────
    marketType:      { type: String, enum: ['spot', 'futures'], required: true },
    exchange:        { type: String, default: 'binance' },
    timeframe:       { type: String, default: '1h' },
    confidenceScore: { type: Number, min: 0, max: 1, required: true },

    // ── AI model metadata ─────────────────────────────────────────────────
    aiProb: {
      buy:  Number,
      sell: Number,
      hold: Number,
    },
    aiSource: { type: String, enum: ['ai', 'rule-based'], default: 'rule-based' },

    // ── Rule engine reasons ───────────────────────────────────────────────
    reasons: [String],

    // ── Multi-timeframe alignment summary ─────────────────────────────────
    mtfAlignment: { type: mongoose.Schema.Types.Mixed },

    // ── Status ────────────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ['active', 'expired', 'hit_tp', 'hit_sl'],
      default: 'active',
      index:   true,
    },

    // ── Delivery tracking ─────────────────────────────────────────────────
    deliveredTo: {
      premium: { type: Boolean, default: false },
      free:    { type: Boolean, default: false },
    },

    // ── Outcome (filled later by a monitor job) ───────────────────────────
    outcome: { type: outcomeSchema, default: null },

    // ── Generation timestamp ──────────────────────────────────────────────
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// ── Compound indexes for common queries ────────────────────────────────────────
signalSchema.index({ pair: 1, timestamp: -1 });
signalSchema.index({ timestamp: -1, confidenceScore: -1 });
signalSchema.index({ marketType: 1, status: 1, timestamp: -1 });

// ── Prevent duplicate signal for same pair + type within 5 min ───────────────
signalSchema.index(
  { pair: 1, type: 1, timestamp: 1 },
  { unique: false } // we handle dedup in application layer via cooldown
);

// ── Auto-expire active signals after 24 h ────────────────────────────────────
// (requires a TTL index on a Date field that is the expiry, not the creation)
// Alternatively we run a cron to mark them expired — chosen approach here.

export default mongoose.model('Signal', signalSchema);
