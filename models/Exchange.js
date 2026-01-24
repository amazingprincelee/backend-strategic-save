import mongoose from 'mongoose';

const exchangeSchema = new mongoose.Schema({
  // Exchange identifier (lowercase, e.g., 'binance', 'gateio')
  exchangeId: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },

  // Display name (e.g., 'Binance', 'Gate.io')
  name: {
    type: String,
    required: true,
    trim: true
  },

  // Exchange logo URL
  logo: {
    type: String,
    default: null
  },

  // Countries where exchange operates
  countries: [{
    type: String
  }],

  // Exchange website
  url: {
    type: String,
    default: null
  },

  // API documentation URL
  apiDocsUrl: {
    type: String,
    default: null
  },

  // Supported features
  features: {
    // Trading features
    spot: { type: Boolean, default: false },
    margin: { type: Boolean, default: false },
    futures: { type: Boolean, default: false },
    swap: { type: Boolean, default: false },

    // API capabilities
    publicAPI: { type: Boolean, default: true },
    privateAPI: { type: Boolean, default: true },
    fetchTicker: { type: Boolean, default: true },
    fetchOrderBook: { type: Boolean, default: true },
    fetchTrades: { type: Boolean, default: false },
    fetchOHLCV: { type: Boolean, default: false },
    fetchCurrencies: { type: Boolean, default: false },

    // Transfer capabilities
    deposit: { type: Boolean, default: true },
    withdraw: { type: Boolean, default: true }
  },

  // Rate limits
  rateLimit: {
    requestsPerSecond: { type: Number, default: 3 },
    burstLimit: { type: Number, default: 5 }
  },

  // Trading fees (default estimates)
  fees: {
    maker: { type: Number, default: 0.1 },  // 0.1%
    taker: { type: Number, default: 0.1 }   // 0.1%
  },

  // Status
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },

  // Whether this exchange is enabled for arbitrage scanning
  enabledForArbitrage: {
    type: Boolean,
    default: true,
    index: true
  },

  // Last time we successfully connected to this exchange
  lastSuccessfulConnection: {
    type: Date,
    default: null
  },

  // Connection error count (reset on success)
  connectionErrors: {
    type: Number,
    default: 0
  },

  // Number of trading pairs available
  pairCount: {
    type: Number,
    default: 0
  },

  // When the exchange was added to our system
  addedAt: {
    type: Date,
    default: Date.now
  },

  // Last update from CCXT
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for common queries
exchangeSchema.index({ isActive: 1, enabledForArbitrage: 1 });
exchangeSchema.index({ 'features.fetchCurrencies': 1 });

// Static method to get all active exchanges for arbitrage
exchangeSchema.statics.getActiveForArbitrage = function() {
  return this.find({
    isActive: true,
    enabledForArbitrage: true
  }).sort({ name: 1 });
};

// Static method to get exchanges with transfer capability check
exchangeSchema.statics.getWithTransferCheck = function() {
  return this.find({
    isActive: true,
    enabledForArbitrage: true,
    'features.fetchCurrencies': true
  }).sort({ name: 1 });
};

const Exchange = mongoose.model('Exchange', exchangeSchema);

export default Exchange;
