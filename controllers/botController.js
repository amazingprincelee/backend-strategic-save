import BotConfig from '../models/bot/BotConfig.js';
import Trade from '../models/bot/Trade.js';
import Position from '../models/bot/Position.js';
import ExchangeAccount from '../models/ExchangeAccount.js';
import botEngine from '../services/bot/BotEngine.js';
import demoSimulator from '../services/bot/DemoSimulator.js';

/**
 * GET /api/bots
 */
export const listBots = async (req, res) => {
  try {
    const bots = await BotConfig.find({ userId: req.user.id })
      .sort({ createdAt: -1 });

    // Enrich with open position counts
    const enriched = await Promise.all(bots.map(async (bot) => {
      const openPositions = await Position.countDocuments({ botId: bot._id, status: 'open' });
      const obj = bot.toObject();
      obj.openPositionsCount = openPositions;
      obj.isRunning = botEngine.isRunning(bot._id);
      return obj;
    }));

    res.json({ success: true, data: { bots: enriched, count: enriched.length } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/bots
 */
export const createBot = async (req, res) => {
  try {
    const {
      name, exchange, symbol, marketType, strategyId,
      strategyParams, capitalAllocation, riskParams,
      exchangeAccountId, isDemo
    } = req.body;

    if (!name || !exchange || !symbol || !strategyId || !capitalAllocation?.totalCapital) {
      return res.status(400).json({
        success: false,
        message: 'name, exchange, symbol, strategyId, and capitalAllocation.totalCapital are required'
      });
    }

    const demoMode = !!isDemo;

    // If live mode, validate exchange account belongs to user
    if (!demoMode) {
      if (!exchangeAccountId) {
        return res.status(400).json({ success: false, message: 'exchangeAccountId required for live trading' });
      }
      const account = await ExchangeAccount.findOne({ _id: exchangeAccountId, userId: req.user.id });
      if (!account) {
        return res.status(400).json({ success: false, message: 'Exchange account not found' });
      }
      if (!account.isValid) {
        return res.status(400).json({ success: false, message: 'Exchange account connection is not valid. Please test it first.' });
      }
    }

    const bot = await BotConfig.create({
      userId: req.user.id,
      name: name.trim(),
      exchange: exchange.toLowerCase(),
      symbol: symbol.toUpperCase(),
      marketType: marketType || 'spot',
      strategyId,
      strategyParams: strategyParams || {},
      capitalAllocation,
      riskParams: riskParams || {},
      exchangeAccountId: demoMode ? null : exchangeAccountId,
      isDemo: demoMode,
      'stats.startingCapital': capitalAllocation.totalCapital,
      'stats.currentCapital': capitalAllocation.totalCapital,
      'stats.peakCapital': capitalAllocation.totalCapital
    });

    // Ensure demo account exists
    if (demoMode) {
      await demoSimulator.getOrCreate(req.user.id);
    }

    res.status(201).json({ success: true, data: { bot } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/bots/:id
 */
export const getBotDetail = async (req, res) => {
  try {
    const bot = await BotConfig.findOne({ _id: req.params.id, userId: req.user.id });
    if (!bot) return res.status(404).json({ success: false, message: 'Bot not found' });

    const openPositions = await Position.find({ botId: bot._id, status: 'open' });
    const recentTrades = await Trade.find({ botId: bot._id })
      .sort({ executedAt: -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        bot: { ...bot.toObject(), isRunning: botEngine.isRunning(bot._id) },
        openPositions,
        recentTrades
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/bots/:id
 */
export const updateBot = async (req, res) => {
  try {
    const bot = await BotConfig.findOne({ _id: req.params.id, userId: req.user.id });
    if (!bot) return res.status(404).json({ success: false, message: 'Bot not found' });

    if (bot.status === 'running') {
      return res.status(400).json({ success: false, message: 'Stop the bot before editing' });
    }

    const allowed = ['name', 'strategyParams', 'capitalAllocation', 'riskParams'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) bot[key] = req.body[key];
    }
    await bot.save();

    res.json({ success: true, data: { bot } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/bots/:id
 */
export const deleteBot = async (req, res) => {
  try {
    const bot = await BotConfig.findOne({ _id: req.params.id, userId: req.user.id });
    if (!bot) return res.status(404).json({ success: false, message: 'Bot not found' });

    if (botEngine.isRunning(bot._id)) {
      await botEngine.stopBot(bot._id);
    }

    await BotConfig.deleteOne({ _id: bot._id });
    res.json({ success: true, message: 'Bot deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/bots/:id/start
 */
export const startBot = async (req, res) => {
  try {
    const bot = await BotConfig.findOne({ _id: req.params.id, userId: req.user.id });
    if (!bot) return res.status(404).json({ success: false, message: 'Bot not found' });

    if (botEngine.isRunning(bot._id)) {
      return res.status(400).json({ success: false, message: 'Bot is already running' });
    }

    await botEngine.startBot(bot._id);
    res.json({ success: true, message: `Bot "${bot.name}" started` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/bots/:id/stop
 */
export const stopBot = async (req, res) => {
  try {
    const bot = await BotConfig.findOne({ _id: req.params.id, userId: req.user.id });
    if (!bot) return res.status(404).json({ success: false, message: 'Bot not found' });

    await botEngine.stopBot(bot._id);
    res.json({ success: true, message: `Bot "${bot.name}" stopped` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/bots/:id/trades
 */
export const getBotTrades = async (req, res) => {
  try {
    const bot = await BotConfig.findOne({ _id: req.params.id, userId: req.user.id });
    if (!bot) return res.status(404).json({ success: false, message: 'Bot not found' });

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [trades, total] = await Promise.all([
      Trade.find({ botId: bot._id }).sort({ executedAt: -1 }).skip(skip).limit(limit),
      Trade.countDocuments({ botId: bot._id })
    ]);

    res.json({
      success: true,
      data: { trades, total, page, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/bots/:id/positions
 */
export const getBotPositions = async (req, res) => {
  try {
    const bot = await BotConfig.findOne({ _id: req.params.id, userId: req.user.id });
    if (!bot) return res.status(404).json({ success: false, message: 'Bot not found' });

    const status = req.query.status || 'open';
    const positions = await Position.find({ botId: bot._id, status })
      .sort({ openedAt: -1 })
      .limit(50);

    res.json({ success: true, data: { positions } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
