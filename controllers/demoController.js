import demoSimulator from '../services/bot/DemoSimulator.js';
import Trade from '../models/bot/Trade.js';
import Position from '../models/bot/Position.js';
import BotConfig from '../models/bot/BotConfig.js';

/**
 * GET /api/demo
 * Get or create demo account for the authenticated user.
 */
export const getDemoAccount = async (req, res) => {
  try {
    const account = await demoSimulator.getOrCreate(req.user.id);

    // Calculate win rate
    const winRate = account.totalTrades > 0
      ? ((account.winningTrades / account.totalTrades) * 100).toFixed(1)
      : 0;

    const pnlPercent = ((account.virtualBalance - account.initialBalance) / account.initialBalance * 100).toFixed(2);

    res.json({
      success: true,
      data: {
        account: {
          virtualBalance: account.virtualBalance,
          initialBalance: account.initialBalance,
          peakBalance: account.peakBalance,
          totalRealizedPnL: account.totalRealizedPnL,
          totalFeesPaid: account.totalFeesPaid,
          totalTrades: account.totalTrades,
          winningTrades: account.winningTrades,
          losingTrades: account.losingTrades,
          winRate: parseFloat(winRate),
          pnlPercent: parseFloat(pnlPercent),
          lastResetAt: account.lastResetAt,
          updatedAt: account.updatedAt
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/demo/reset
 * Reset virtual balance to $10,000.
 */
export const resetDemoAccount = async (req, res) => {
  try {
    // Stop all running demo bots first
    const demoBots = await BotConfig.find({
      userId: req.user.id,
      isDemo: true,
      status: 'running'
    });
    const botEngine = (await import('../services/bot/BotEngine.js')).default;
    for (const bot of demoBots) {
      await botEngine.stopBot(bot._id);
    }

    const account = await demoSimulator.reset(req.user.id);

    res.json({
      success: true,
      message: 'Demo account reset to $10,000',
      data: {
        virtualBalance: account.virtualBalance,
        lastResetAt: account.lastResetAt
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/demo/performance
 * Get balance history for chart display.
 */
export const getDemoPerformance = async (req, res) => {
  try {
    const account = await demoSimulator.getOrCreate(req.user.id);

    // Get recent demo trades for chart data
    const demoBotIds = await BotConfig.find({ userId: req.user.id, isDemo: true }).distinct('_id');

    const trades = await Trade.find({
      botId: { $in: demoBotIds },
      side: 'sell',
      pnl: { $ne: null }
    })
      .sort({ executedAt: 1 })
      .select('pnl executedAt symbol botId')
      .limit(500);

    // Build daily P&L series
    const dailyMap = new Map();
    for (const trade of trades) {
      const dayKey = trade.executedAt.toISOString().split('T')[0];
      dailyMap.set(dayKey, (dailyMap.get(dayKey) || 0) + (trade.pnl || 0));
    }

    const dailyPnL = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, pnl]) => ({ date, pnl: parseFloat(pnl.toFixed(2)) }));

    // Build cumulative balance line
    let runningBalance = account.initialBalance;
    const balanceLine = dailyPnL.map(({ date, pnl }) => {
      runningBalance += pnl;
      return { date, balance: parseFloat(runningBalance.toFixed(2)), dailyPnL: pnl };
    });

    // Get best and worst trades
    const allTrades = await Trade.find({ botId: { $in: demoBotIds }, side: 'sell', pnl: { $ne: null } })
      .sort({ pnl: -1 })
      .select('pnl symbol executedAt');
    const bestTrade = allTrades[0] || null;
    const worstTrade = allTrades[allTrades.length - 1] || null;

    res.json({
      success: true,
      data: {
        balanceLine,
        dailyPnL,
        bestTrade: bestTrade ? { pnl: bestTrade.pnl, symbol: bestTrade.symbol, date: bestTrade.executedAt } : null,
        worstTrade: worstTrade ? { pnl: worstTrade.pnl, symbol: worstTrade.symbol, date: worstTrade.executedAt } : null
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
