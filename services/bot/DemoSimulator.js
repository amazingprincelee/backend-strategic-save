import exchangeConnector from './ExchangeConnector.js';
import DemoAccount from '../../models/DemoAccount.js';

const TAKER_FEE_RATE = 0.001; // 0.1% simulated taker fee

/**
 * DemoSimulator - executes virtual orders using real live market prices.
 * No real trades are placed. Virtual balance is tracked in DemoAccount.
 */
class DemoSimulator {
  /**
   * Execute a virtual market order.
   * @param {string|ObjectId} userId
   * @param {{ exchange: string, symbol: string, side: 'buy'|'sell', amount: number }} params
   * @returns {Promise<{ price, amount, cost, fee, executedAt }>}
   */
  async executeOrder(userId, { exchange, symbol, side, amount }) {
    const publicExchange = exchangeConnector.getPublicInstance(exchange);

    let price;
    try {
      const ticker = await publicExchange.fetchTicker(symbol);
      // Use ask for buys (you pay more), bid for sells (you receive less) - realistic spread
      price = side === 'buy' ? (ticker.ask || ticker.last) : (ticker.bid || ticker.last);
    } catch {
      throw new Error(`Cannot fetch price for ${symbol} on ${exchange}`);
    }

    const cost = price * amount;
    const feeCost = cost * TAKER_FEE_RATE;

    // Update demo account balance
    const demoAccount = await DemoAccount.findOne({ userId });
    if (!demoAccount) {
      throw new Error('Demo account not found. Please initialize a demo account first.');
    }

    if (side === 'buy') {
      const totalDebit = cost + feeCost;
      if (demoAccount.virtualBalance < totalDebit) {
        throw new Error(
          `Insufficient virtual balance. Need $${totalDebit.toFixed(2)}, have $${demoAccount.virtualBalance.toFixed(2)}`
        );
      }
      demoAccount.virtualBalance -= totalDebit;
    } else {
      // Sell: add proceeds minus fee
      demoAccount.virtualBalance += cost - feeCost;
    }

    demoAccount.totalFeesPaid += feeCost;
    demoAccount.totalTrades += 1;
    if (demoAccount.virtualBalance > demoAccount.peakBalance) {
      demoAccount.peakBalance = demoAccount.virtualBalance;
    }
    await demoAccount.save();

    return {
      price,
      amount,
      cost,
      fee: {
        cost: feeCost,
        currency: 'USDT',
        rate: TAKER_FEE_RATE
      },
      executedAt: new Date()
    };
  }

  /**
   * Record a trade's P&L on the demo account (called when a sell trade closes a position)
   * @param {string|ObjectId} userId
   * @param {number} realizedPnL
   */
  async recordPnL(userId, realizedPnL) {
    await DemoAccount.findOneAndUpdate(
      { userId },
      {
        $inc: {
          totalRealizedPnL: realizedPnL,
          winningTrades: realizedPnL > 0 ? 1 : 0,
          losingTrades: realizedPnL < 0 ? 1 : 0
        }
      }
    );
  }

  /**
   * Fetch live price for a symbol (public API, no auth needed)
   */
  async getLivePrice(exchange, symbol) {
    const publicExchange = exchangeConnector.getPublicInstance(exchange);
    const ticker = await publicExchange.fetchTicker(symbol);
    return { bid: ticker.bid, ask: ticker.ask, last: ticker.last };
  }

  /**
   * Fetch OHLCV candles (public API)
   * @returns {Promise<{ timestamp, open, high, low, close, volume }[]>}
   */
  async getOHLCV(exchange, symbol, timeframe = '1h', limit = 250) {
    const publicExchange = exchangeConnector.getPublicInstance(exchange);
    const ohlcv = await publicExchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    return ohlcv.map(c => ({
      timestamp: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5]
    }));
  }

  /**
   * Get or create demo account for a user
   */
  async getOrCreate(userId) {
    let account = await DemoAccount.findOne({ userId });
    if (!account) {
      account = await DemoAccount.create({ userId });
    }
    return account;
  }

  /**
   * Reset demo account to initial $10,000 balance
   */
  async reset(userId) {
    const account = await DemoAccount.findOne({ userId });
    if (!account) return await DemoAccount.create({ userId });

    account.virtualBalance = account.initialBalance;
    account.peakBalance = account.initialBalance;
    account.totalRealizedPnL = 0;
    account.totalFeesPaid = 0;
    account.totalTrades = 0;
    account.winningTrades = 0;
    account.losingTrades = 0;
    account.balanceHistory = [];
    account.lastResetAt = new Date();
    await account.save();
    return account;
  }
}

export default new DemoSimulator();
