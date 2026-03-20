/**
 * TriangularOpportunity.js
 * Persists triangular arbitrage opportunities found on a single exchange.
 * Example path: USDT → BTC → ETH → USDT
 */
import mongoose from 'mongoose';

const TriangularOpportunitySchema = new mongoose.Schema(
  {
    // e.g. "gateio-USDT-BTC-ETH"
    opportunityId: { type: String, required: true, unique: true },

    exchange: { type: String, required: true },

    // The three assets in order, e.g. ['USDT', 'BTC', 'ETH']
    path: { type: [String], required: true },

    // The three trading pairs used, e.g. ['BTC/USDT', 'ETH/BTC', 'ETH/USDT']
    pairs: { type: [String], required: true },

    // The three individual prices used for the calculation
    prices: {
      step1: Number, // price of pair 1 (buy)
      step2: Number, // price of pair 2 (buy)
      step3: Number, // price of pair 3 (sell)
    },

    // Direction of each leg: 'buy' or 'sell'
    directions: { type: [String], required: true },

    // Profit before fees (gross spread)
    grossProfitPercent: { type: Number, required: true },

    // Profit after 3 × fee legs deducted
    netProfitPercent: { type: Number, required: true },

    // Fee assumption used (e.g. 0.1% per leg)
    feePerLegPercent: { type: Number, default: 0.1 },

    // Starting capital used for simulation
    startCapital: { type: Number, default: 1000 },

    // Final capital after simulation
    endCapital: { type: Number },

    // Lifecycle
    status: {
      type: String,
      enum: ['active', 'cleared'],
      default: 'active',
      index: true,
    },
    firstDetectedAt: { type: Date, default: Date.now, index: true },
    lastSeenAt:      { type: Date, default: Date.now },
    clearedAt:       Date,
  },
  { timestamps: true }
);

TriangularOpportunitySchema.index({ status: 1, firstDetectedAt: -1 });
TriangularOpportunitySchema.index({ exchange: 1, status: 1 });

export default mongoose.model('TriangularOpportunity', TriangularOpportunitySchema);
