import mongoose from 'mongoose';

const positionSchema = new mongoose.Schema({
  botId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BotConfig',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isDemo: { type: Boolean, default: false },
  exchange: { type: String, required: true },
  symbol: { type: String, required: true },
  portionIndex: { type: Number, required: true },
  side: { type: String, enum: ['long', 'short'], default: 'long' },
  entryPrice: { type: Number, required: true },
  amount: { type: Number, required: true },
  cost: { type: Number, required: true },
  entryFee: { type: Number, default: 0 },
  takeProfitPrice: { type: Number, default: null },
  stopLossPrice: { type: Number, required: true },
  trailingStopActive: { type: Boolean, default: false },
  trailingStopPrice: { type: Number, default: null },
  highestPriceSinceEntry: { type: Number, default: null }, // LONG: for trailing stop
  lowestPriceSinceEntry:  { type: Number, default: null }, // SHORT: for trailing stop
  // ── Ladder exit fields ────────────────────────────────────────────────────
  tp1Price:         { type: Number,  default: null  }, // 1:1 R:R target (50% close)
  tp1Hit:           { type: Boolean, default: false }, // has TP1 been taken
  remainingAmount:  { type: Number,  default: null  }, // open size after partial closes
  currentPrice: { type: Number, default: null },
  unrealizedPnL: { type: Number, default: 0 },
  unrealizedPnLPercent: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['open', 'closed'],
    default: 'open',
    index: true
  },
  closeReason: {
    type: String,
    enum: ['take_profit', 'take_profit_1', 'stop_loss', 'trailing_stop', 'manual', 'drawdown_limit'],
    default: null
  },
  closePrice: { type: Number, default: null },
  realizedPnL: { type: Number, default: null },
  openedAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null }
}, {
  timestamps: true
});

positionSchema.index({ botId: 1, status: 1 });
positionSchema.index({ botId: 1, portionIndex: 1, status: 1 });

const Position = mongoose.model('Position', positionSchema);
export default Position;
