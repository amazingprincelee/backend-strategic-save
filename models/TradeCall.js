import mongoose from 'mongoose';

// Maps common base asset symbols to CoinGecko coin IDs
export const COIN_ID_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana',
  XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', MATIC: 'matic-network',
  DOT: 'polkadot', LINK: 'chainlink', AVAX: 'avalanche-2', UNI: 'uniswap',
  LTC: 'litecoin', ATOM: 'cosmos', NEAR: 'near', FTM: 'fantom',
  OP: 'optimism', ARB: 'arbitrum', SUI: 'sui', APT: 'aptos',
  PEPE: 'pepe', WIF: 'dogwifcoin', BONK: 'bonk', SHIB: 'shiba-inu',
  TON: 'the-open-network', TRX: 'tron', XLM: 'stellar', VET: 'vechain',
  SAND: 'the-sandbox', MANA: 'decentraland', CRV: 'curve-dao-token',
  AAVE: 'aave', MKR: 'maker', SNX: 'havven', COMP: 'compound-governance-token',
  FIL: 'filecoin', ICP: 'internet-computer', HBAR: 'hedera-hashgraph',
  ZEC: 'zcash', XMR: 'monero', DASH: 'dash', ETC: 'ethereum-classic',
  BCH: 'bitcoin-cash', BSV: 'bitcoin-sv', LRC: 'loopring', ZIL: 'zilliqa',
  WAVES: 'waves', ALGO: 'algorand', EOS: 'eos', XTZ: 'tezos',
  CHZ: 'chiliz', ENJ: 'enjincoin', BAT: 'basic-attention-token',
  GRT: 'the-graph', '1INCH': 'the-1inch-network', SUSHI: 'sushi',
  YFI: 'yearn-finance', BAL: 'balancer', REN: 'republic-protocol',
  CAKE: 'pancakeswap-token', TWT: 'trust-wallet-token',
  INJ: 'injective-protocol', RNDR: 'render-token', RENDER: 'render-token',
  SEI: 'sei-network', TIA: 'celestia', PYTH: 'pyth-network',
  JUP: 'jupiter-exchange-solana', STRK: 'starknet', W: 'wormhole',
  NEIRO: 'neiro-on-eth', DOGS: 'dogs-token', NOT: 'notcoin',
};

export function pairToCoingeckoId(pair) {
  const base = pair.replace(/USDT$|BUSD$|USDC$|USD$/i, '').toUpperCase();
  return COIN_ID_MAP[base] || null;
}

const tradeCallSchema = new mongoose.Schema({
  pair:        { type: String, required: true, uppercase: true }, // e.g. BTCUSDT
  baseAsset:   { type: String, required: true, uppercase: true }, // e.g. BTC
  coingeckoId: { type: String, default: null },                   // e.g. bitcoin

  direction: { type: String, enum: ['long', 'short'], required: true },

  entryPrice: { type: Number, required: true },
  stopLoss:   { type: Number, required: true },
  tp1:        { type: Number, required: true },  // primary target (conservative)
  tp2:        { type: Number, default: null },   // secondary target (optional)

  riskReward: { type: Number, default: null },   // calculated vs TP1

  notes: { type: String, default: '' },

  status: {
    type: String,
    enum: ['open', 'tp1_hit', 'win', 'loss', 'cancelled'],
    default: 'open',
  },
  tp1Hit:  { type: Boolean, default: false },
  tp2Hit:  { type: Boolean, default: false },

  openedAt:     { type: Date,   default: Date.now },
  closedAt:     { type: Date,   default: null },
  closingPrice: { type: Number, default: null },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

tradeCallSchema.index({ status: 1, openedAt: -1 });
tradeCallSchema.index({ coingeckoId: 1, status: 1 });

export default mongoose.model('TradeCall', tradeCallSchema);
