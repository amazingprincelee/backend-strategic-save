/**
 * CryptoPay (pay.cryptopay.io) service.
 * Docs: https://developers.cryptopay.me/
 *
 * Env vars required:
 *   CRYPTOPAY_API_KEY       — your CryptoPay API key
 *   CRYPTOPAY_API_SECRET    — your CryptoPay API secret
 *   CRYPTOPAY_CALLBACK_SECRET — webhook callback secret
 */

import crypto from 'crypto';
import { getPaymentKeys } from './paymentKeys.js';

const BASE_URL = 'https://business.cryptopay.me';

class CryptoPayService {
  _sign(apiSecret, method, path, body = '') {
    const message = `${method}\n${path}\n${body}`;
    return crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
  }

  async _request(method, path, body = null) {
    const { cryptopayApiKey, cryptopayApiSecret } = await getPaymentKeys();
    const bodyStr = body ? JSON.stringify(body) : '';
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type':         'application/json',
        'X-Access-Key':         cryptopayApiKey,
        'X-Signature':          this._sign(cryptopayApiSecret, method, path, bodyStr),
      },
      ...(body ? { body: bodyStr } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || `CryptoPay error ${res.status}`);
    return data;
  }

  /**
   * Create a CryptoPay invoice.
   * Returns { chargeId, paymentUrl }
   */
  async createCharge({ userId, userEmail, amountUSD, description }) {
    const invoice = await this._request('POST', '/invoices', {
      price_amount:    amountUSD,
      price_currency:  'USD',
      name:            'SmartStrategy Premium',
      description:     description || 'Monthly Premium Subscription',
      custom_id:       `user-${userId}`,
      success_redirect_url: `${process.env.CLIENT_URL}/payment/success`,
      unsuccess_redirect_url: `${process.env.CLIENT_URL}/pricing`,
      metadata: { userId: String(userId), email: userEmail },
    });

    return {
      chargeId:   String(invoice.data?.id),
      paymentUrl: invoice.data?.hosted_page_url,
    };
  }

  /**
   * Verify CryptoPay webhook signature.
   */
  async verifyWebhook(rawBody, signatureHeader) {
    const { cryptopayCallbackSecret } = await getPaymentKeys();
    if (!cryptopayCallbackSecret) throw new Error('Callback secret not configured');
    const sig = crypto
      .createHmac('sha256', cryptopayCallbackSecret)
      .update(rawBody, 'utf8')
      .digest('hex');
    if (sig !== signatureHeader) throw new Error('Invalid CryptoPay webhook signature');

    const payload  = JSON.parse(rawBody);
    const invoice  = payload.data || {};
    const metadata = invoice.metadata || {};
    const customId = invoice.custom_id || '';      // 'user-<userId>'
    const userId   = metadata.userId || customId.split('-')[1] || null;

    return {
      event:    payload.type,                        // 'invoice.completed'
      chargeId: String(invoice.id),
      userId,
      email:    metadata.email || null,
      status:   invoice.status,                      // 'completed'
    };
  }
}

export default new CryptoPayService();
