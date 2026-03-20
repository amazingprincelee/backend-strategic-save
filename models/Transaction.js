import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema({
  status:    { type: String, required: true },
  message:   { type: String },
  raw:       { type: mongoose.Schema.Types.Mixed }, // raw webhook payload snapshot
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const transactionSchema = new mongoose.Schema({
  // ── Who ──────────────────────────────────────────────────────────────────
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  userEmail: { type: String, index: true },
  userName:  { type: String },

  // ── What ─────────────────────────────────────────────────────────────────
  plan:            { type: String, default: 'premium' },
  planDurationDays:{ type: Number, default: 30 },
  amountUSD:       { type: Number, required: true },
  cryptoAmount:    { type: Number },
  cryptoCurrency:  { type: String },

  // ── Provider ─────────────────────────────────────────────────────────────
  provider:    { type: String, enum: ['coinbase_commerce', 'nowpayments', 'cryptopay', 'admin'], required: true },
  chargeId:    { type: String, index: true },   // provider's reference ID
  checkoutUrl: { type: String },

  // ── Status ───────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['initiated', 'pending', 'processing', 'completed', 'failed', 'expired', 'refunded'],
    default: 'initiated',
    index: true,
  },
  failReason: { type: String },

  // ── Timeline ─────────────────────────────────────────────────────────────
  events: [eventSchema],

  // ── Meta ─────────────────────────────────────────────────────────────────
  ipAddress:   { type: String },
  completedAt: { type: Date },
  failedAt:    { type: Date },
  expiredAt:   { type: Date },
}, { timestamps: true });

// Helper to push an event and update status atomically
transactionSchema.methods.addEvent = function(status, message, raw) {
  this.status = status;
  this.events.push({ status, message, raw: raw ? JSON.parse(JSON.stringify(raw)) : undefined });
  if (status === 'completed') this.completedAt = new Date();
  if (status === 'failed')    this.failedAt    = new Date();
  if (status === 'expired')   this.expiredAt   = new Date();
  return this.save();
};

export default mongoose.model('Transaction', transactionSchema);
