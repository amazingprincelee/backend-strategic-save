import mongoose from 'mongoose';

const demoAccountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  initialBalance: {
    type: Number,
    default: 10000
  },
  virtualBalance: {
    type: Number,
    default: 10000
  },
  peakBalance: {
    type: Number,
    default: 10000
  },
  totalRealizedPnL: { type: Number, default: 0 },
  totalFeesPaid: { type: Number, default: 0 },
  totalTrades: { type: Number, default: 0 },
  winningTrades: { type: Number, default: 0 },
  losingTrades: { type: Number, default: 0 },
  balanceHistory: [{
    date: { type: Date },
    balance: { type: Number },
    dailyPnL: { type: Number }
  }],
  lastResetAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

const DemoAccount = mongoose.model('DemoAccount', demoAccountSchema);
export default DemoAccount;
