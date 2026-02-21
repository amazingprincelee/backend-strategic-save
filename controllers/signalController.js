import signalEngine from '../services/bot/SignalEngine.js';
import BotConfig from '../models/bot/BotConfig.js';

/**
 * GET /api/signals?type=spot|futures
 * Public endpoint — no authentication required.
 */
export const getSignals = async (req, res) => {
  try {
    const marketType = req.query.type === 'futures' ? 'futures' : 'spot';
    const signals    = await signalEngine.getSignals(marketType);

    res.json({
      success: true,
      data: signals,
      meta: {
        marketType,
        count:     signals.length,
        timeframe: '1h',
        cachedFor: '5 minutes',
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Signal fetch error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to generate signals' });
  }
};

/**
 * GET /api/signals/stats
 * Public endpoint — returns platform-level stats for the landing page.
 */
export const getStats = async (req, res) => {
  try {
    const [signalStats, totalBots, activeBots] = await Promise.all([
      signalEngine.getPlatformStats(),
      BotConfig.countDocuments().catch(() => 0),
      BotConfig.countDocuments({ status: 'running' }).catch(() => 0),
    ]);

    res.json({
      success: true,
      data: {
        ...signalStats,
        totalBots,
        activeBots,
      },
    });
  } catch (err) {
    console.error('Stats fetch error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get platform stats' });
  }
};
