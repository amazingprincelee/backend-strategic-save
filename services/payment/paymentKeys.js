/**
 * paymentKeys.js
 * Centralised loader for payment API keys.
 * Priority: DB (AppSettings) → process.env fallback.
 * Cached for 60 seconds to avoid DB hit on every request.
 */

import { getSettings } from '../../models/AppSettings.js';

let _cache = null;
let _cacheTs = 0;
const TTL = 60_000; // 60 s

export async function getPaymentKeys() {
  const now = Date.now();
  if (_cache && now - _cacheTs < TTL) return _cache;

  try {
    const s = await getSettings();
    _cache = {
      // NOWPayments
      nowpaymentsApiKey:       s.nowpaymentsApiKey    || process.env.NOWPAYMENTS_API_KEY        || '',
      nowpaymentsIpnSecret:    s.nowpaymentsIpnSecret || process.env.NOWPAYMENTS_IPN_SECRET     || '',
      // Coinbase Commerce
      coinbaseApiKey:          s.coinbaseApiKey           || process.env.COINBASE_COMMERCE_API_KEY          || '',
      coinbaseWebhookSecret:   s.coinbaseWebhookSecret    || process.env.COINBASE_COMMERCE_WEBHOOK_SECRET   || '',
      // CryptoPay
      cryptopayApiKey:         s.cryptopayApiKey          || process.env.CRYPTOPAY_API_KEY         || '',
      cryptopayApiSecret:      s.cryptopayApiSecret       || process.env.CRYPTOPAY_API_SECRET      || '',
      cryptopayCallbackSecret: s.cryptopayCallbackSecret  || process.env.CRYPTOPAY_CALLBACK_SECRET || '',
    };
  } catch {
    // Fall back to env vars if DB is unreachable
    _cache = {
      nowpaymentsApiKey:       process.env.NOWPAYMENTS_API_KEY               || '',
      nowpaymentsIpnSecret:    process.env.NOWPAYMENTS_IPN_SECRET            || '',
      coinbaseApiKey:          process.env.COINBASE_COMMERCE_API_KEY         || '',
      coinbaseWebhookSecret:   process.env.COINBASE_COMMERCE_WEBHOOK_SECRET  || '',
      cryptopayApiKey:         process.env.CRYPTOPAY_API_KEY                 || '',
      cryptopayApiSecret:      process.env.CRYPTOPAY_API_SECRET              || '',
      cryptopayCallbackSecret: process.env.CRYPTOPAY_CALLBACK_SECRET         || '',
    };
  }

  _cacheTs = Date.now();
  return _cache;
}

/** Call this after admin saves new keys so the next request picks them up immediately */
export function invalidatePaymentKeyCache() {
  _cache = null;
  _cacheTs = 0;
}
