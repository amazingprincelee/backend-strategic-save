import UserSettings from '../models/UserSettings.js';

// Default settings for unauthenticated users
const DEFAULT_SETTINGS = {
  arbitrage: {
    filters: {
      minProfitPercent: 0.001,
      minVolume: 0.0001,
      includeZeroVolume: false,
      requireTransferable: false,
      maxRisk: 'High',
      showOnlyProfitable: false
    },
    display: {
      sortBy: 'profitPercent',
      sortOrder: 'desc',
      pageSize: 25,
      showOrderBookDepth: true,
      compactView: false
    },
    selectedExchanges: ['gateio', 'lbank', 'bigone'],
    favoriteCoins: [],
    notifications: {
      enableAlerts: false,
      minProfitForAlert: 1.0,
      alertFrequency: 'hourly'
    },
    customFees: []
  },
  vault: {
    defaultLockDuration: 30,
    autoCompound: false,
    notifications: {
      maturityReminder: true,
      reminderDaysBefore: 3
    }
  },
  ui: {
    theme: 'system',
    currency: 'USD',
    language: 'en',
    timezone: 'UTC'
  }
};

/**
 * Get user settings
 */
export const getUserSettings = async (req, res) => {
  try {
    const userId = req.user?.id || req.params.userId;

    // If no userId, return default settings
    if (!userId) {
      return res.json({
        success: true,
        data: DEFAULT_SETTINGS,
        isDefault: true
      });
    }

    const settings = await UserSettings.getOrCreate(userId);

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Error fetching user settings:', error);
    // Return defaults on error
    res.json({
      success: true,
      data: DEFAULT_SETTINGS,
      isDefault: true,
      error: error.message
    });
  }
};

/**
 * Update arbitrage settings
 */
export const updateArbitrageSettings = async (req, res) => {
  try {
    const userId = req.user?.id || req.params.userId;
    const { filters, display, selectedExchanges, favoriteCoins, notifications, customFees } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const settings = await UserSettings.getOrCreate(userId);

    // Update only provided fields
    if (filters) {
      Object.assign(settings.arbitrage.filters, filters);
    }
    if (display) {
      Object.assign(settings.arbitrage.display, display);
    }
    if (selectedExchanges !== undefined) {
      settings.arbitrage.selectedExchanges = selectedExchanges;
    }
    if (favoriteCoins !== undefined) {
      settings.arbitrage.favoriteCoins = favoriteCoins;
    }
    if (notifications) {
      Object.assign(settings.arbitrage.notifications, notifications);
    }
    if (customFees !== undefined) {
      settings.arbitrage.customFees = customFees;
    }

    await settings.save();

    res.json({
      success: true,
      message: 'Arbitrage settings updated',
      data: settings.arbitrage
    });
  } catch (error) {
    console.error('Error updating arbitrage settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Update vault settings
 */
export const updateVaultSettings = async (req, res) => {
  try {
    const userId = req.user?.id || req.params.userId;
    const vaultSettings = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const settings = await UserSettings.getOrCreate(userId);
    Object.assign(settings.vault, vaultSettings);
    await settings.save();

    res.json({
      success: true,
      message: 'Vault settings updated',
      data: settings.vault
    });
  } catch (error) {
    console.error('Error updating vault settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Update UI preferences
 */
export const updateUISettings = async (req, res) => {
  try {
    const userId = req.user?.id || req.params.userId;
    const uiSettings = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const settings = await UserSettings.getOrCreate(userId);
    Object.assign(settings.ui, uiSettings);
    await settings.save();

    res.json({
      success: true,
      message: 'UI settings updated',
      data: settings.ui
    });
  } catch (error) {
    console.error('Error updating UI settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Update selected exchanges for arbitrage
 */
export const updateSelectedExchanges = async (req, res) => {
  try {
    const userId = req.user?.id || req.params.userId;
    const { exchanges } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    if (!Array.isArray(exchanges)) {
      return res.status(400).json({
        success: false,
        error: 'exchanges must be an array'
      });
    }

    const settings = await UserSettings.getOrCreate(userId);
    settings.arbitrage.selectedExchanges = exchanges.map(e => e.toLowerCase());
    await settings.save();

    res.json({
      success: true,
      message: 'Selected exchanges updated',
      data: settings.arbitrage.selectedExchanges
    });
  } catch (error) {
    console.error('Error updating selected exchanges:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Reset settings to defaults
 */
export const resetSettings = async (req, res) => {
  try {
    const userId = req.user?.id || req.params.userId;
    const { section } = req.params; // 'arbitrage', 'vault', 'ui', or 'all'

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    if (section === 'all') {
      // Delete and recreate with defaults
      await UserSettings.findOneAndDelete({ userId });
      const settings = await UserSettings.getOrCreate(userId);

      return res.json({
        success: true,
        message: 'All settings reset to defaults',
        data: settings
      });
    }

    // Reset specific section
    const settings = await UserSettings.getOrCreate(userId);
    const defaultSettings = new UserSettings({ userId });

    if (section === 'arbitrage') {
      settings.arbitrage = defaultSettings.arbitrage;
    } else if (section === 'vault') {
      settings.vault = defaultSettings.vault;
    } else if (section === 'ui') {
      settings.ui = defaultSettings.ui;
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid section. Use: arbitrage, vault, ui, or all'
      });
    }

    await settings.save();

    res.json({
      success: true,
      message: `${section} settings reset to defaults`,
      data: settings
    });
  } catch (error) {
    console.error('Error resetting settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Get default arbitrage configuration (public)
 */
export const getDefaultArbitrageConfig = async (req, res) => {
  try {
    const defaultSettings = new UserSettings({});

    res.json({
      success: true,
      data: {
        filters: defaultSettings.arbitrage.filters,
        display: defaultSettings.arbitrage.display
      }
    });
  } catch (error) {
    console.error('Error fetching default config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
