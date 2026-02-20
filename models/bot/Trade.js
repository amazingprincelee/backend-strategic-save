import mongoose from 'mongoose';

const tradeSchema = new mongoose.Schema({
  botId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BotConfig',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  positionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Position',
    default: null
  },
  isDemo: { type: Boolean, default: false },
  exchange: { type: String, required: true },
  symbol: { type: String, required: true },
  side: {
    type: String,
    enum: ['buy', 'sell'],
    required: true
  },
  type: {
    type: String,
    enum: ['market', 'limit'],
    default: 'market'
  },
  price: { type: Number, required: true },
  amount: { type: Number, required: true },
  cost: { type: Number, required: true },
  fee: {
    cost: { type: Number, default: 0 },
    currency: { type: String, default: 'USDT' },
    rate: { type: Number, default: 0 }
  },
  status: {
    type: String,
    enum: ['open', 'closed', 'cancelled'],
    default: 'closed'
  },
  orderId: { type: String, default: null },
  portionIndex: { type: Number, default: 0 },
  pnl: { type: Number, default: null },
  triggerReason: {
    type: String,
    enum: ['entry', 'take_profit', 'stop_loss', 'trailing_stop', 'dca', 'manual'],
    default: 'entry'
  },
  executedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

tradeSchema.index({ botId: 1, executedAt: -1 });
tradeSchema.index({ userId: 1, executedAt: -1 });
tradeSchema.index({ botId: 1, portionIndex: 1 });

const Trade = mongoose.model('Trade', tradeSchema);
export default Trade;
