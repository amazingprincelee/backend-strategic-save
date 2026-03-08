import mongoose from 'mongoose';

/**
 * Stores the USDT trading pairs for each exchange+market combination.
 * Refreshed on server startup (if stale) and once a month via cron.
 */
const ExchangePairsSchema = new mongoose.Schema({
  exchange:  { type: String, required: true },
  market:    { type: String, required: true, enum: ['spot', 'futures'] },
  pairs:     [String],
}, { timestamps: true });

ExchangePairsSchema.index({ exchange: 1, market: 1 }, { unique: true });

export default mongoose.model('ExchangePairs', ExchangePairsSchema);
