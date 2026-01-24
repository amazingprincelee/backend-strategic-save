import ccxt from "ccxt";

/**
 * Exchange Manager - Handles dynamic loading of CCXT exchanges
 */
class ExchangeManager {
  constructor() {
    this.exchanges = {};
    this.enabledExchangeIds = ['gateio', 'bigone']; // Default exchanges (removed lbank for now due to rate limits)
    this.initialized = false;
  }

  /**
   * Initialize exchanges based on provided list
   */
  initialize(exchangeIds = null) {
    const idsToLoad = exchangeIds || this.enabledExchangeIds;

    console.log(`\n🔄 Initializing ${idsToLoad.length} exchanges...`);

    // Clear existing exchanges
    this.exchanges = {};

    for (const id of idsToLoad) {
      try {
        const exchangeId = id.toLowerCase();

        // Check if exchange exists in CCXT
        if (!ccxt.exchanges.includes(exchangeId)) {
          console.warn(`⚠️  Exchange "${exchangeId}" not found in CCXT, skipping`);
          continue;
        }

        // Create exchange instance
        const ExchangeClass = ccxt[exchangeId];
        this.exchanges[exchangeId] = new ExchangeClass({
          enableRateLimit: true,  // Enable built-in rate limiting
          timeout: 30000,         // 30 second timeout
        });

        console.log(`   ✓ ${exchangeId} initialized`);
      } catch (error) {
        console.error(`   ✗ Failed to initialize ${id}:`, error.message);
      }
    }

    this.initialized = true;
    console.log(`✅ ${Object.keys(this.exchanges).length} exchanges ready\n`);

    return this.exchanges;
  }

  /**
   * Get current exchanges
   */
  getExchanges() {
    if (!this.initialized) {
      this.initialize();
    }
    return this.exchanges;
  }

  /**
   * Update enabled exchanges and reinitialize
   */
  setEnabledExchanges(exchangeIds) {
    this.enabledExchangeIds = exchangeIds.map(id => id.toLowerCase());
    return this.initialize(this.enabledExchangeIds);
  }

  /**
   * Add a single exchange
   */
  addExchange(exchangeId) {
    const id = exchangeId.toLowerCase();

    if (this.exchanges[id]) {
      console.log(`Exchange ${id} already exists`);
      return this.exchanges[id];
    }

    if (!ccxt.exchanges.includes(id)) {
      throw new Error(`Exchange "${id}" not found in CCXT`);
    }

    try {
      const ExchangeClass = ccxt[id];
      this.exchanges[id] = new ExchangeClass({
        enableRateLimit: true,
        timeout: 30000,
      });
      console.log(`✓ Added exchange: ${id}`);
      return this.exchanges[id];
    } catch (error) {
      console.error(`Failed to add exchange ${id}:`, error.message);
      throw error;
    }
  }

  /**
   * Remove an exchange
   */
  removeExchange(exchangeId) {
    const id = exchangeId.toLowerCase();
    if (this.exchanges[id]) {
      delete this.exchanges[id];
      console.log(`✓ Removed exchange: ${id}`);
      return true;
    }
    return false;
  }

  /**
   * Get list of enabled exchange IDs
   */
  getEnabledIds() {
    return Object.keys(this.exchanges);
  }

  /**
   * Get all available CCXT exchange IDs
   */
  static getAllAvailableExchanges() {
    return ccxt.exchanges;
  }

  /**
   * Check if an exchange ID is valid
   */
  static isValidExchange(exchangeId) {
    return ccxt.exchanges.includes(exchangeId.toLowerCase());
  }
}

// Create singleton instance
const exchangeManager = new ExchangeManager();

// Initialize with defaults
exchangeManager.initialize();

// Export for backward compatibility
export const exchanges = exchangeManager.getExchanges();

// Export manager for dynamic control
export { exchangeManager, ExchangeManager };

export default exchangeManager;
