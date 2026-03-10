import demoSimulator from './DemoSimulator.js';
import exchangeConnector from './ExchangeConnector.js';
import ExchangeAccount from '../../models/ExchangeAccount.js';
import Trade from '../../models/bot/Trade.js';
import Position from '../../models/bot/Position.js';
import BotConfig from '../../models/bot/BotConfig.js';

/**
 * OrderManager - routes orders to demo or live execution.
 * Creates Trade records and manages Position lifecycle in DB.
 */
class OrderManager {
  /**
   * Place a buy order and open a new position.
   * @param {Object} bot - BotConfig document
   * @param {{ portionIndex, amount, takeProfitPrice, stopLossPrice, triggerReason }} signal
   * @returns {Promise<{ trade, position }>}
   */
  async openPosition(bot, { portionIndex, amount, takeProfitPrice, stopLossPrice, triggerReason = 'entry', reason, side: signalSide }, symbolOverride) {
    const symbol       = symbolOverride || bot.symbol;
    const positionSide = signalSide || 'long';
    // 'short' entry passes 'short' to DemoSimulator (no balance debit); long uses 'buy'
    const execSide     = positionSide === 'short' ? 'short' : 'buy';
    const execution    = await this._executeOrder(bot, execSide, amount, symbol);

    // Create trade record
    const trade = await Trade.create({
      botId: bot._id,
      userId: bot.userId,
      isDemo: bot.isDemo,
      exchange: bot.exchange,
      symbol,
      side: positionSide === 'short' ? 'sell' : 'buy',
      type: 'market',
      price: execution.price,
      amount: execution.amount,
      cost: execution.cost,
      fee: execution.fee,
      status: 'closed',
      orderId: execution.orderId || null,
      portionIndex,
      triggerReason
    });

    // Create position record
    const position = await Position.create({
      botId: bot._id,
      userId: bot.userId,
      isDemo: bot.isDemo,
      exchange: bot.exchange,
      symbol,
      portionIndex,
      side: positionSide,
      entryPrice: execution.price,
      amount: execution.amount,
      cost: execution.cost,
      entryFee: execution.fee?.cost || 0,
      takeProfitPrice: takeProfitPrice || null,
      stopLossPrice,
      currentPrice: execution.price
    });

    // Link trade to position
    await Trade.findByIdAndUpdate(trade._id, { positionId: position._id });

    // Update bot stats
    await BotConfig.findByIdAndUpdate(bot._id, {
      $inc: { 'stats.totalTrades': 1 },
      'stats.lastTradeAt': new Date()
    });

    return { trade, position };
  }

  /**
   * Close an open position with a sell order.
   * @param {Object} bot - BotConfig document
   * @param {Object} position - Position document
   * @param {string} closeReason
   * @returns {Promise<{ trade, realizedPnL }>}
   */
  async closePosition(bot, position, closeReason) {
    const isShort  = position.side === 'short';
    // Cover short = buy back; close long = sell
    const execSide = isShort ? 'buy' : 'sell';
    const execution = await this._executeOrder(bot, execSide, position.amount, position.symbol);

    const fees = position.entryFee + (execution.fee?.cost || 0);
    const realizedPnL = isShort
      ? (position.entryPrice - execution.price) * position.amount - fees
      : (execution.price - position.entryPrice) * position.amount - fees;

    // Create closing trade record
    const trade = await Trade.create({
      botId: bot._id,
      userId: bot.userId,
      positionId: position._id,
      isDemo: bot.isDemo,
      exchange: bot.exchange,
      symbol: position.symbol,   // use actual traded pair (bot.symbol may be 'MULTI')
      side: 'sell',
      type: 'market',
      price: execution.price,
      amount: execution.amount,
      cost: execution.cost,
      fee: execution.fee,
      status: 'closed',
      orderId: execution.orderId || null,
      portionIndex: position.portionIndex,
      pnl: realizedPnL,
      triggerReason: closeReason
    });

    // Close position record
    await Position.findByIdAndUpdate(position._id, {
      status: 'closed',
      closePrice: execution.price,
      closeReason,
      closedAt: new Date(),
      realizedPnL,
      currentPrice: execution.price
    });

    // Update bot stats
    const isWin = realizedPnL > 0;
    await BotConfig.findByIdAndUpdate(bot._id, {
      $inc: {
        'stats.totalTrades': 1,
        'stats.totalPnL': realizedPnL,
        'stats.winningTrades': isWin ? 1 : 0,
        'stats.losingTrades': !isWin ? 1 : 0
      },
      'stats.lastTradeAt': new Date()
    });

    // Record P&L on demo account if applicable
    if (bot.isDemo) {
      await demoSimulator.recordPnL(bot.userId, realizedPnL);
    }

    return { trade, realizedPnL };
  }

  /**
   * Internal: route order to demo or live exchange.
   */
  async _executeOrder(bot, side, amount, symbolOverride) {
    const symbol = symbolOverride || bot.symbol;

    if (bot.isDemo) {
      return await demoSimulator.executeOrder(bot.userId, {
        exchange:   bot.exchange,
        symbol,
        side,
        amount,
        marketType: bot.marketType || 'spot',
      });
    }

    // Live order via CCXT
    const exchangeAccount = await ExchangeAccount
      .findById(bot.exchangeAccountId)
      .select('+apiKeyEncrypted +apiSecretEncrypted +apiPassphraseEncrypted');

    if (!exchangeAccount) {
      throw new Error('Exchange account not found or no longer valid');
    }

    const exchange = await exchangeConnector.getConnection(exchangeAccount);

    // Set market type for futures
    if (bot.marketType === 'futures') {
      exchange.options = { ...exchange.options, defaultType: 'future' };
    }

    // Resolve CCXT market symbol: after loadMarkets(), markets are keyed as 'BTC/USDT'.
    // SmartSignal stores pairs as 'BTCUSDT' (no slash) — look up the canonical symbol.
    const market = exchange.marketsById?.[symbol] || exchange.markets?.[symbol];
    const ccxtSymbol = market?.symbol || symbol;

    // CCXT only accepts 'buy' or 'sell' — map futures-short entry 'short' → 'sell'
    const ccxtSide = side === 'short' ? 'sell' : side;

    const order = await exchange.createMarketOrder(ccxtSymbol, ccxtSide, amount);

    return {
      price: order.average || order.price || order.fills?.[0]?.price,
      amount: order.filled || amount,
      cost: order.cost || (order.price * amount),
      fee: order.fee || { cost: 0, currency: 'USDT', rate: 0 },
      orderId: order.id,
      executedAt: order.timestamp ? new Date(order.timestamp) : new Date()
    };
  }
}

export default new OrderManager();
