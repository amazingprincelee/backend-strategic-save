import Position from '../../models/bot/Position.js';
import Trade from '../../models/bot/Trade.js';

/**
 * RiskEngine - enforces all risk rules for bots.
 */
class RiskEngine {
  /**
   * Check if a new position can be opened.
   * @param {Object} bot - BotConfig document
   * @returns {Promise<{ allowed: boolean, reason: string|null }>}
   */
  async checkCanOpenPosition(bot) {
    // 1. Max open positions check
    const openCount = await Position.countDocuments({ botId: bot._id, status: 'open' });
    if (openCount >= bot.capitalAllocation.maxOpenPositions) {
      return { allowed: false, reason: 'max_positions_reached' };
    }

    // 2. Global drawdown check
    const drawdown = this.calculateDrawdown(bot.stats.peakCapital, bot.stats.currentCapital);
    if (drawdown >= bot.riskParams.globalDrawdownLimitPercent) {
      return { allowed: false, reason: `global_drawdown_limit_${drawdown.toFixed(1)}pct` };
    }

    // 3. Daily loss limit check
    const dailyPnL = await this.getDailyPnL(bot._id);
    const dailyLossLimit = (bot.capitalAllocation.totalCapital * bot.riskParams.dailyLossLimitPercent) / 100;
    if (dailyPnL < -dailyLossLimit) {
      return { allowed: false, reason: 'daily_loss_limit_reached' };
    }

    return { allowed: true, reason: null };
  }

  /**
   * Calculate portfolio drawdown percentage from peak.
   */
  calculateDrawdown(peakCapital, currentCapital) {
    if (!peakCapital || peakCapital <= 0) return 0;
    return ((peakCapital - currentCapital) / peakCapital) * 100;
  }

  /**
   * Sum today's realized P&L for a bot.
   */
  async getDailyPnL(botId) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const result = await Trade.aggregate([
      {
        $match: {
          botId,
          side: 'sell',
          pnl: { $ne: null },
          executedAt: { $gte: startOfDay }
        }
      },
      { $group: { _id: null, total: { $sum: '$pnl' } } }
    ]);
    return result[0]?.total ?? 0;
  }

  /**
   * Calculate the size of one capital portion in quote currency.
   */
  calculatePortionSize(bot) {
    return bot.capitalAllocation.totalCapital / bot.strategyParams.portions;
  }

  /**
   * Check if the bot should be paused due to risk limits.
   * @returns {string|null} pause reason or null
   */
  shouldPauseBot(bot) {
    const drawdown = this.calculateDrawdown(bot.stats.peakCapital, bot.stats.currentCapital);
    if (drawdown >= bot.riskParams.globalDrawdownLimitPercent) {
      return `Global drawdown limit reached: ${drawdown.toFixed(1)}%`;
    }
    return null;
  }

  /**
   * Update trailing stop for an open position based on current price.
   * Activates trailing stop once price is up trailingStopActivationPercent from entry.
   * Trails at trailingStopDistancePercent below the highest price since entry.
   * @param {Object} position - Position document (mutated in-place)
   * @param {number} currentPrice
   * @param {Object} strategyParams
   * @returns {Object} updated position
   */
  updateTrailingStop(position, currentPrice, strategyParams) {
    const activationPct = strategyParams.trailingStopActivationPercent || 2.0;
    const distancePct = strategyParams.trailingStopDistancePercent || 0.5;

    const gainPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    // Activate trailing stop once gain threshold is met
    if (!position.trailingStopActive && gainPercent >= activationPct) {
      position.trailingStopActive = true;
    }

    if (position.trailingStopActive) {
      // Track highest price since entry
      if (!position.highestPriceSinceEntry || currentPrice > position.highestPriceSinceEntry) {
        position.highestPriceSinceEntry = currentPrice;
      }
      // Move trailing stop up (never down)
      const newTrailingStop = position.highestPriceSinceEntry * (1 - distancePct / 100);
      if (!position.trailingStopPrice || newTrailingStop > position.trailingStopPrice) {
        position.trailingStopPrice = newTrailingStop;
      }
    }

    return position;
  }

  /**
   * Check all exit conditions for an open position.
   * @returns {{ shouldClose: boolean, reason: string|null }}
   */
  checkExitConditions(position, currentPrice) {
    // Stop loss
    if (currentPrice <= position.stopLossPrice) {
      return { shouldClose: true, reason: 'stop_loss' };
    }

    // Trailing stop
    if (position.trailingStopActive && position.trailingStopPrice && currentPrice <= position.trailingStopPrice) {
      return { shouldClose: true, reason: 'trailing_stop' };
    }

    // Take profit
    if (position.takeProfitPrice && currentPrice >= position.takeProfitPrice) {
      return { shouldClose: true, reason: 'take_profit' };
    }

    return { shouldClose: false, reason: null };
  }
}

export default new RiskEngine();
