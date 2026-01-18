import mongoose from "mongoose";

// ============================================
// 1. MARKET STRUCTURE SCHEMA for CCXT
// ============================================
const MarketSchema = new mongoose.Schema({
  exchangeId: {
    type: String,
    required: true,
    index: true,
    unique: true
  },
  markets: [{
    id: String,
    lowercaseId: String,
    symbol: String,
    base: String,
    quote: String,
    settle: String,
    baseId: String,
    quoteId: String,
    settleId: String,
    type: String,
    spot: Boolean,
    margin: Boolean,
    swap: Boolean,
    future: Boolean,
    option: Boolean,
    active: Boolean,
    contract: Boolean,
    taker: Number,
    maker: Number,
    contractSize: Number,
    expiry: Number,
    expiryDatetime: Date,
    strike: Number,
    optionType: String,
    precision: mongoose.Schema.Types.Mixed, // Changed from strict object to Mixed
    limits: mongoose.Schema.Types.Mixed,    // Changed from strict object to Mixed
    info: mongoose.Schema.Types.Mixed       // Raw exchange data
  }],
  totalPairs: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,  // This automatically manages createdAt and updatedAt
  strict: false      // Allow flexible schema for varying exchange data
});

// Index for fast queries
MarketSchema.index({ exchangeId: 1, updatedAt: -1 });
MarketSchema.index({ 'markets.symbol': 1 });

const Market = mongoose.model('Market', MarketSchema);

export default Market;