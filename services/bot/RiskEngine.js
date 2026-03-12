import Position from '../../models/bot/Position.js';
import Trade from '../../models/bot/Trade.js';

/**
 * RiskEngine - enforces all risk rules for bots.
 */
class RiskEngine {
  /**
   * Check if a new position can be opened.
   * @param {Object} bot          - BotConfig document
   * @param {number} pendingOpens - buy signals already queued this tick (prevents race condition)
   * @returns {Promise<{ allowed: boolean, reason: string|null }>}
   */
  async checkCanOpenPosition(bot, pendingOpens = 0) {
    // 1. Max open positions check (atomic: includes positions opened this tick)
    const openCount = await Position.countDocuments({ botId: bot._id, status: 'open' });
    if (openCount + pendingOpens >= bot.capitalAllocation.maxOpenPositions) {
      return { allowed: false, reason: 'max_positions_reached' };
    }

    // 2. Global drawdown check
    const drawdown = this.calculateDrawdown(bot.stats.peakCapital, bot.stats.currentCapital);
    if (drawdown >= bot.riskParams.globalDrawdownLimitPercent) {
      return { allowed: false, reason: `global_drawdown_limit_${drawdown.toFixed(1)}pct` };
    }

    // 3. Daily loss limit check (UTC midnight — consistent across all server timezones)
    const dailyPnL = await this.getDailyPnL(bot._id);
    const dailyLossLimit = (bot.capitalAllocation.totalCapital * bot.riskParams.dailyLossLimitPercent) / 100;
    if (dailyPnL < -dailyLossLimit) {
      return { allowed: false, reason: 'daily_loss_limit_reached' };
    }

    // 4. Consecutive loss safeguard
    const maxConsecutive = bot.riskParams?.maxConsecutiveLosses || 5;
    if ((bot.stats?.consecutiveLosses || 0) >= maxConsecutive) {
      return { allowed: false, reason: `consecutive_losses_limit_${maxConsecutive}` };
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
   * Uses UTC midnight so the reset is consistent regardless of server timezone.
   */
  async getDailyPnL(botId) {
    const now = new Date();
    const utcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const result = await Trade.aggregate([
      {
        $match: {
          botId,
          side: 'sell',
          pnl: { $ne: null },
          executedAt: { $gte: utcMidnight }
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

    const maxConsecutive = bot.riskParams?.maxConsecutiveLosses || 5;
    const consecutive = bot.stats?.consecutiveLosses || 0;
    if (consecutive >= maxConsecutive) {
      return `${consecutive} consecutive losses — bot paused to protect capital`;
    }

    return null;
  }

  /**
   * Update trailing stop for an open position based on current price.
   *
   * For LONG positions:
   *   - Activates once price is up trailingStopActivationPercent from entry
   *   - Trails below the highest price seen since entry
   *
   * For SHORT positions:
   *   - Activates once price is DOWN trailingStopActivationPercent from entry
   *   - Trails above the lowest price seen since entry
   *
   * @param {Object} position       - Position document (mutated in-place)
   * @param {number} currentPrice
   * @param {Object} strategyParams
   * @returns {Object} updated position
   */
  updateTrailingStop(position, currentPrice, strategyParams) {
    const activationPct = strategyParams.trailingStopActivationPercent || 2.0;
    const distancePct   = strategyParams.trailingStopDistancePercent   || 0.5;
    const isShort       = position.side === 'short';

    // Gain percent relative to direction: positive = profit, negative = loss
    const gainPercent = isShort
      ? ((position.entryPrice - currentPrice) / position.entryPrice) * 100   // short profits when price falls
      : ((currentPrice - position.entryPrice)  / position.entryPrice) * 100; // long profits when price rises

    // Activate once the trade is sufficiently in profit
    if (!position.trailingStopActive && gainPercent >= activationPct) {
      position.trailingStopActive = true;
    }

    if (position.trailingStopActive) {
      if (isShort) {
        // SHORT: track lowest price since entry; trail stop ABOVE it
        if (!position.lowestPriceSinceEntry || currentPrice < position.lowestPriceSinceEntry) {
          position.lowestPriceSinceEntry = currentPrice;
        }
        // Trail stop: lowestPrice * (1 + distance%) — never move the stop DOWN (would widen it)
        const newTrailingStop = position.lowestPriceSinceEntry * (1 + distancePct / 100);
        if (!position.trailingStopPrice || newTrailingStop < position.trailingStopPrice) {
          position.trailingStopPrice = newTrailingStop;
        }
      } else {
        // LONG: track highest price since entry; trail stop BELOW it
        if (!position.highestPriceSinceEntry || currentPrice > position.highestPriceSinceEntry) {
          position.highestPriceSinceEntry = currentPrice;
        }
        // Trail stop: highestPrice * (1 - distance%) — never move the stop UP would widen it)
        const newTrailingStop = position.highestPriceSinceEntry * (1 - distancePct / 100);
        if (!position.trailingStopPrice || newTrailingStop > position.trailingStopPrice) {
          position.trailingStopPrice = newTrailingStop;
        }
      }
    }

    return position;
  }

  /**
   * Check all exit conditions for an open position.
   * Handles both LONG and SHORT direction correctly.
   * @returns {{ shouldClose: boolean, reason: string|null }}
   */
  checkExitConditions(position, currentPrice) {
    const isShort = position.side === 'short';

    // Stop loss: long SL fires when price falls to/below SL; short SL fires when price rises to/above SL
    const hitSL = isShort
      ? currentPrice >= position.stopLossPrice
      : currentPrice <= position.stopLossPrice;

    if (hitSL) return { shouldClose: true, reason: 'stop_loss' };

    // Trailing stop
    if (position.trailingStopActive && position.trailingStopPrice) {
      const hitTrail = isShort
        ? currentPrice >= position.trailingStopPrice  // short: close if price rises above trail
        : currentPrice <= position.trailingStopPrice; // long:  close if price falls below trail
      if (hitTrail) return { shouldClose: true, reason: 'trailing_stop' };
    }

    // Take profit: long TP fires when price rises to/above TP; short TP fires when price falls to/below TP
    if (position.takeProfitPrice) {
      const hitTP = isShort
        ? currentPrice <= position.takeProfitPrice
        : currentPrice >= position.takeProfitPrice;
      if (hitTP) return { shouldClose: true, reason: 'take_profit' };
    }

    return { shouldClose: false, reason: null };
  }
}

export default new RiskEngine();
