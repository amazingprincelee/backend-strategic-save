/**
 * Professional Rate Limiter with Token Bucket Algorithm
 *
 * Features:
 * - Per-exchange rate limiting with configurable limits
 * - Token bucket algorithm for smooth request distribution
 * - Exponential backoff with jitter for retries
 * - Automatic retry on rate limit errors (429)
 * - Request queuing to prevent bursts
 */

class ExchangeRateLimiter {
  constructor(config = {}) {
    this.exchangeLimits = new Map();
    this.requestQueues = new Map();
    this.defaultConfig = {
      requestsPerSecond: 3,        // Default: 3 requests/sec
      burstLimit: 5,               // Allow small bursts
      maxRetries: 3,               // Retry up to 3 times on rate limit
      baseBackoffMs: 1000,         // Start with 1 second backoff
      maxBackoffMs: 30000,         // Max 30 seconds backoff
      backoffMultiplier: 2,        // Double backoff each retry
      jitterFactor: 0.3,           // Add 30% random jitter
      ...config
    };

    // Track rate limit state per exchange
    this.exchangeState = new Map();
  }

  /**
   * Configure rate limits for a specific exchange
   */
  setExchangeLimit(exchangeName, config) {
    const mergedConfig = { ...this.defaultConfig, ...config };
    this.exchangeLimits.set(exchangeName, mergedConfig);

    // Initialize token bucket for this exchange
    if (!this.exchangeState.has(exchangeName)) {
      this.exchangeState.set(exchangeName, {
        tokens: mergedConfig.burstLimit,
        lastRefill: Date.now(),
        isRateLimited: false,
        rateLimitResetTime: null,
        consecutiveErrors: 0
      });
    }

    return this;
  }

  /**
   * Get config for an exchange (falls back to defaults)
   */
  getExchangeConfig(exchangeName) {
    return this.exchangeLimits.get(exchangeName) || this.defaultConfig;
  }

  /**
   * Get or initialize exchange state
   */
  getExchangeState(exchangeName) {
    if (!this.exchangeState.has(exchangeName)) {
      const config = this.getExchangeConfig(exchangeName);
      this.exchangeState.set(exchangeName, {
        tokens: config.burstLimit,
        lastRefill: Date.now(),
        isRateLimited: false,
        rateLimitResetTime: null,
        consecutiveErrors: 0
      });
    }
    return this.exchangeState.get(exchangeName);
  }

  /**
   * Refill tokens based on time elapsed (Token Bucket Algorithm)
   */
  refillTokens(exchangeName) {
    const state = this.getExchangeState(exchangeName);
    const config = this.getExchangeConfig(exchangeName);
    const now = Date.now();
    const elapsed = now - state.lastRefill;

    // Calculate tokens to add based on elapsed time
    const tokensToAdd = (elapsed / 1000) * config.requestsPerSecond;
    state.tokens = Math.min(config.burstLimit, state.tokens + tokensToAdd);
    state.lastRefill = now;

    return state.tokens;
  }

  /**
   * Wait for a token to become available
   */
  async acquireToken(exchangeName) {
    const state = this.getExchangeState(exchangeName);
    const config = this.getExchangeConfig(exchangeName);

    // Check if we're in a rate limit cooldown period
    if (state.isRateLimited && state.rateLimitResetTime) {
      const waitTime = state.rateLimitResetTime - Date.now();
      if (waitTime > 0) {
        await this.sleep(waitTime);
      }
      state.isRateLimited = false;
      state.rateLimitResetTime = null;
    }

    // Refill tokens
    this.refillTokens(exchangeName);

    // Wait if no tokens available
    while (state.tokens < 1) {
      const waitTime = (1 / config.requestsPerSecond) * 1000;
      await this.sleep(waitTime);
      this.refillTokens(exchangeName);
    }

    // Consume a token
    state.tokens -= 1;
  }

  /**
   * Calculate backoff time with exponential increase and jitter
   */
  calculateBackoff(retryCount, exchangeName) {
    const config = this.getExchangeConfig(exchangeName);

    // Exponential backoff: baseBackoff * (multiplier ^ retryCount)
    let backoff = config.baseBackoffMs * Math.pow(config.backoffMultiplier, retryCount);

    // Cap at max backoff
    backoff = Math.min(backoff, config.maxBackoffMs);

    // Add jitter to prevent thundering herd
    const jitter = backoff * config.jitterFactor * Math.random();
    backoff = backoff + jitter;

    return Math.floor(backoff);
  }

  /**
   * Handle rate limit error from exchange
   */
  handleRateLimitError(exchangeName, error) {
    const state = this.getExchangeState(exchangeName);
    state.consecutiveErrors++;
    state.isRateLimited = true;

    // Try to extract retry-after from error/headers
    let retryAfterMs = this.calculateBackoff(state.consecutiveErrors, exchangeName);

    // Check for Retry-After header in error
    if (error?.headers?.['retry-after']) {
      retryAfterMs = parseInt(error.headers['retry-after']) * 1000;
    } else if (error?.message?.includes('retry after')) {
      // Try to parse retry time from error message
      const match = error.message.match(/retry after (\d+)/i);
      if (match) {
        retryAfterMs = parseInt(match[1]) * 1000;
      }
    }

    state.rateLimitResetTime = Date.now() + retryAfterMs;

    return retryAfterMs;
  }

  /**
   * Reset consecutive errors on success
   */
  handleSuccess(exchangeName) {
    const state = this.getExchangeState(exchangeName);
    state.consecutiveErrors = 0;
    state.isRateLimited = false;
  }

  /**
   * Check if error is a rate limit error
   */
  isRateLimitError(error) {
    if (!error) return false;

    const message = error.message?.toLowerCase() || '';
    const name = error.name?.toLowerCase() || '';

    return (
      error.statusCode === 429 ||
      error.code === 429 ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('request limit') ||
      message.includes('throttl') ||
      name.includes('ratelimit') ||
      name === 'ddosprotection' ||
      name === 'exchangenotavailable'
    );
  }

  /**
   * Execute a request with rate limiting and automatic retry
   */
  async execute(exchangeName, requestFn, options = {}) {
    const config = this.getExchangeConfig(exchangeName);
    const maxRetries = options.maxRetries ?? config.maxRetries;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Wait for rate limit token
        await this.acquireToken(exchangeName);

        // Execute the request
        const result = await requestFn();

        // Success - reset error counter
        this.handleSuccess(exchangeName);

        return result;

      } catch (error) {
        lastError = error;

        if (this.isRateLimitError(error)) {
          const waitTime = this.handleRateLimitError(exchangeName, error);

          if (attempt < maxRetries) {
            console.log(`⚠️  [${exchangeName}] Rate limited. Retry ${attempt + 1}/${maxRetries} after ${waitTime}ms`);
            await this.sleep(waitTime);
            continue;
          }
        }

        // Non-rate-limit error or max retries exceeded
        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Execute multiple requests for the same exchange with rate limiting
   */
  async executeBatch(exchangeName, requestFns) {
    const results = [];

    for (const fn of requestFns) {
      try {
        const result = await this.execute(exchangeName, fn);
        results.push({ status: 'fulfilled', value: result });
      } catch (error) {
        results.push({ status: 'rejected', reason: error });
      }
    }

    return results;
  }

  /**
   * Get current rate limit status for all exchanges
   */
  getStatus() {
    const status = {};

    for (const [name, state] of this.exchangeState.entries()) {
      const config = this.getExchangeConfig(name);
      this.refillTokens(name);

      status[name] = {
        availableTokens: Math.floor(state.tokens * 100) / 100,
        maxTokens: config.burstLimit,
        requestsPerSecond: config.requestsPerSecond,
        isRateLimited: state.isRateLimited,
        consecutiveErrors: state.consecutiveErrors,
        rateLimitResetTime: state.rateLimitResetTime
          ? new Date(state.rateLimitResetTime).toISOString()
          : null
      };
    }

    return status;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Pre-configured exchange rate limits based on known API limits
// Using VERY CONSERVATIVE limits to avoid rate limiting
const EXCHANGE_RATE_LIMITS = {
  // Binance: Official limit is 1200/min but they rate limit aggressively
  // Use very conservative: 2 requests per second
  binance: {
    requestsPerSecond: 2,
    burstLimit: 3,
    baseBackoffMs: 5000,
    maxBackoffMs: 60000,
  },

  // Bybit: Despite high official limits, they rate limit quickly
  // Use very conservative: 2 requests per second
  bybit: {
    requestsPerSecond: 2,
    burstLimit: 3,
    baseBackoffMs: 5000,
    maxBackoffMs: 60000,
  },

  // KuCoin: Official 30/sec but be conservative
  kucoin: {
    requestsPerSecond: 3,
    burstLimit: 5,
    baseBackoffMs: 3000,
  },

  // OKX: 20 requests per 2 seconds = 10/sec, be conservative
  okx: {
    requestsPerSecond: 2,
    burstLimit: 4,
    baseBackoffMs: 5000,
  },

  // Gate.io: 900 requests per minute, be conservative
  gateio: {
    requestsPerSecond: 3,
    burstLimit: 5,
    baseBackoffMs: 3000,
  },

  // BigONE: 300 requests per minute = 5/sec
  bigone: {
    requestsPerSecond: 2,
    burstLimit: 4,
  },

  // LBank: Very strict rate limits
  lbank: {
    requestsPerSecond: 0.5,
    burstLimit: 2,
    maxRetries: 2,
    baseBackoffMs: 10000,
  },

  // Huobi: 100 requests per 10 seconds
  huobi: {
    requestsPerSecond: 2,
    burstLimit: 4,
  },

  // Kraken: 15 requests per second (tier 2)
  kraken: {
    requestsPerSecond: 3,
    burstLimit: 5,
  },

  // Coinbase: 10 requests per second
  coinbase: {
    requestsPerSecond: 2,
    burstLimit: 4,
  },

  // Poloniex: 6 requests per second
  poloniex: {
    requestsPerSecond: 2,
    burstLimit: 3,
  },

  // MEXC: Conservative
  mexc: {
    requestsPerSecond: 2,
    burstLimit: 3,
  },

  // Bitget: Conservative
  bitget: {
    requestsPerSecond: 2,
    burstLimit: 3,
  },

  // Default very conservative limits for unknown exchanges
  default: {
    requestsPerSecond: 1,
    burstLimit: 2,
    maxRetries: 3,
    baseBackoffMs: 5000,
    maxBackoffMs: 60000,
  }
};

// Create and export singleton instance
const rateLimiter = new ExchangeRateLimiter(EXCHANGE_RATE_LIMITS.default);

// Pre-configure known exchanges
Object.entries(EXCHANGE_RATE_LIMITS).forEach(([exchange, config]) => {
  if (exchange !== 'default') {
    rateLimiter.setExchangeLimit(exchange, config);
  }
});

export { ExchangeRateLimiter, EXCHANGE_RATE_LIMITS };
export default rateLimiter;
