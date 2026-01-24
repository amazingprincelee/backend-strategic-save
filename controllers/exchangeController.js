import ccxt from 'ccxt';
import Exchange from '../models/Exchange.js';

/**
 * Sync exchanges from CCXT to database
 * This should be run periodically or manually to keep exchanges updated
 */
export const syncExchangesFromCCXT = async (req, res) => {
  try {
    console.log('Starting exchange sync from CCXT...');

    const ccxtExchanges = ccxt.exchanges;
    let added = 0;
    let updated = 0;
    let errors = 0;

    for (const exchangeId of ccxtExchanges) {
      try {
        // Create a temporary instance to get exchange info
        const ExchangeClass = ccxt[exchangeId];
        const tempInstance = new ExchangeClass();

        // Extract exchange info
        const exchangeData = {
          exchangeId: exchangeId,
          name: tempInstance.name || exchangeId,
          countries: tempInstance.countries || [],
          url: tempInstance.urls?.www || tempInstance.urls?.web || null,
          apiDocsUrl: tempInstance.urls?.api || tempInstance.urls?.doc || null,
          features: {
            spot: tempInstance.has?.spot || false,
            margin: tempInstance.has?.margin || false,
            futures: tempInstance.has?.future || tempInstance.has?.futures || false,
            swap: tempInstance.has?.swap || false,
            publicAPI: true,
            privateAPI: tempInstance.has?.privateAPI !== false,
            fetchTicker: tempInstance.has?.fetchTicker || false,
            fetchOrderBook: tempInstance.has?.fetchOrderBook || false,
            fetchTrades: tempInstance.has?.fetchTrades || false,
            fetchOHLCV: tempInstance.has?.fetchOHLCV || false,
            fetchCurrencies: tempInstance.has?.fetchCurrencies || false,
            deposit: tempInstance.has?.deposit !== false,
            withdraw: tempInstance.has?.withdraw !== false
          },
          rateLimit: {
            requestsPerSecond: tempInstance.rateLimit ? Math.floor(1000 / tempInstance.rateLimit) : 3,
            burstLimit: 5
          },
          lastUpdated: new Date()
        };

        // Upsert (update if exists, insert if not)
        const result = await Exchange.findOneAndUpdate(
          { exchangeId: exchangeId },
          { $set: exchangeData },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        if (result.createdAt && result.createdAt.getTime() === result.updatedAt.getTime()) {
          added++;
        } else {
          updated++;
        }
      } catch (err) {
        console.warn(`Failed to process exchange ${exchangeId}:`, err.message);
        errors++;
      }
    }

    console.log(`Exchange sync complete: ${added} added, ${updated} updated, ${errors} errors`);

    res.json({
      success: true,
      message: 'Exchange sync complete',
      stats: {
        total: ccxtExchanges.length,
        added,
        updated,
        errors
      }
    });
  } catch (error) {
    console.error('Exchange sync failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Get all available exchanges
 */
export const getAllExchanges = async (req, res) => {
  try {
    const { active, arbitrage, search } = req.query;

    let query = {};

    if (active === 'true') {
      query.isActive = true;
    }

    if (arbitrage === 'true') {
      query.enabledForArbitrage = true;
    }

    if (search) {
      query.$or = [
        { exchangeId: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ];
    }

    const exchanges = await Exchange.find(query)
      .sort({ name: 1 })
      .select('-__v');

    // If no exchanges in DB, return CCXT list as fallback
    if (exchanges.length === 0) {
      const ccxtExchanges = ccxt.exchanges.map(id => ({
        exchangeId: id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
        isActive: true,
        enabledForArbitrage: false,
        features: {}
      }));

      return res.json({
        success: true,
        count: ccxtExchanges.length,
        source: 'ccxt_fallback',
        data: ccxtExchanges
      });
    }

    res.json({
      success: true,
      count: exchanges.length,
      source: 'database',
      data: exchanges
    });
  } catch (error) {
    console.error('Error fetching exchanges:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Get exchanges enabled for arbitrage
 */
export const getArbitrageExchanges = async (req, res) => {
  try {
    const exchanges = await Exchange.getActiveForArbitrage();

    res.json({
      success: true,
      count: exchanges.length,
      data: exchanges.map(e => ({
        exchangeId: e.exchangeId,
        name: e.name,
        logo: e.logo,
        features: e.features,
        rateLimit: e.rateLimit,
        fees: e.fees,
        lastSuccessfulConnection: e.lastSuccessfulConnection
      }))
    });
  } catch (error) {
    console.error('Error fetching arbitrage exchanges:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Update exchange settings (admin only)
 */
export const updateExchange = async (req, res) => {
  try {
    const { exchangeId } = req.params;
    const updates = req.body;

    // Prevent updating critical fields
    delete updates._id;
    delete updates.exchangeId;
    delete updates.createdAt;

    const exchange = await Exchange.findOneAndUpdate(
      { exchangeId },
      { $set: updates },
      { new: true }
    );

    if (!exchange) {
      return res.status(404).json({
        success: false,
        error: 'Exchange not found'
      });
    }

    res.json({
      success: true,
      data: exchange
    });
  } catch (error) {
    console.error('Error updating exchange:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Toggle exchange for arbitrage scanning
 */
export const toggleArbitrageExchange = async (req, res) => {
  try {
    const { exchangeId } = req.params;
    const { enabled } = req.body;

    const exchange = await Exchange.findOneAndUpdate(
      { exchangeId },
      { $set: { enabledForArbitrage: enabled } },
      { new: true }
    );

    if (!exchange) {
      return res.status(404).json({
        success: false,
        error: 'Exchange not found'
      });
    }

    res.json({
      success: true,
      message: `${exchange.name} arbitrage scanning ${enabled ? 'enabled' : 'disabled'}`,
      data: exchange
    });
  } catch (error) {
    console.error('Error toggling exchange:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Bulk update exchanges for arbitrage
 */
export const bulkUpdateArbitrageExchanges = async (req, res) => {
  try {
    const { exchanges } = req.body; // Array of { exchangeId, enabled }

    if (!Array.isArray(exchanges)) {
      return res.status(400).json({
        success: false,
        error: 'exchanges must be an array'
      });
    }

    const results = await Promise.all(
      exchanges.map(({ exchangeId, enabled }) =>
        Exchange.findOneAndUpdate(
          { exchangeId },
          { $set: { enabledForArbitrage: enabled } },
          { new: true }
        )
      )
    );

    const updated = results.filter(r => r !== null).length;

    res.json({
      success: true,
      message: `Updated ${updated} exchanges`,
      updated
    });
  } catch (error) {
    console.error('Error bulk updating exchanges:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Get exchange statistics
 */
export const getExchangeStats = async (req, res) => {
  try {
    const totalExchanges = await Exchange.countDocuments();
    const activeExchanges = await Exchange.countDocuments({ isActive: true });
    const arbitrageExchanges = await Exchange.countDocuments({
      isActive: true,
      enabledForArbitrage: true
    });
    const withTransferCheck = await Exchange.countDocuments({
      isActive: true,
      'features.fetchCurrencies': true
    });

    res.json({
      success: true,
      stats: {
        total: totalExchanges,
        active: activeExchanges,
        enabledForArbitrage: arbitrageExchanges,
        withTransferCheck,
        ccxtTotal: ccxt.exchanges.length
      }
    });
  } catch (error) {
    console.error('Error fetching exchange stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
