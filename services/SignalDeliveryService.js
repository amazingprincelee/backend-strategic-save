/**
 * SignalDeliveryService.js
 * Delivers signals over WebSocket and email.
 *
 * Monetisation model:
 *   Premium users → instant WebSocket push + email
 *   Free    users → signal delayed by FREE_DELAY_MS (5 min), entry price hidden
 *
 * Socket rooms:
 *   'signals:premium'   — premium subscribers
 *   'signals:free'      — free tier (receives delayed, partial data)
 *   'signals:all'       — every connected client (no entry/SL/TP until premium or delay)
 */

import User from '../models/User.js';
import emailService from '../utils/emailService.js';

const FREE_DELAY_MS = 5 * 60_000; // 5-minute delay for free users

class SignalDeliveryService {
  constructor() {
    this.io = null;
  }

  setIO(io) {
    this.io = io;
  }

  /**
   * Main entry — call this for every validated signal.
   * Returns immediately; emails are sent asynchronously.
   */
  async deliverSignal(signal) {
    if (!this.io) return;

    // ── Premium: instant full signal ─────────────────────────────────────
    this.io.to('signals:premium').emit('new-signal', this._buildPayload(signal, true));

    // ── Free: delayed, entry/SL/TP masked ────────────────────────────────
    setTimeout(() => {
      if (!this.io) return;
      this.io.to('signals:free').emit('new-signal', this._buildPayload(signal, false));
    }, FREE_DELAY_MS);

    // ── Email (premium only, async) ───────────────────────────────────────
    this._sendEmails(signal).catch(err =>
      console.error('[SignalDelivery] Email error:', err.message)
    );
  }

  // ─── WebSocket payloads ──────────────────────────────────────────────────

  _buildPayload(signal, isPremium) {
    if (isPremium) {
      return {
        ...signal,
        tier:      'premium',
        delayedBy: 0,
      };
    }

    // Free users see direction + confidence but not exact levels
    return {
      pair:            signal.pair,
      type:            signal.type,
      marketType:      signal.marketType,
      timeframe:       signal.timeframe,
      confidenceScore: signal.confidenceScore,
      aiSource:        signal.aiSource,
      reasons:         signal.reasons.slice(0, 2), // only 2 reasons visible
      timestamp:       signal.timestamp,
      tier:            'free',
      delayedBy:       FREE_DELAY_MS / 1000,
      // Exact levels hidden for free tier
      entry:      null,
      stopLoss:   null,
      takeProfit: null,
      leverage:   null,
    };
  }

  // ─── Email ───────────────────────────────────────────────────────────────

  async _sendEmails(signal) {
    let users;
    try {
      users = await User.find({
        'preferences.emailNotifications': true,
        isActive: true,
        role: { $in: ['premium', 'admin'] },
      }).select('email fullName').lean();
    } catch (err) {
      console.warn('[SignalDelivery] Could not query users for email:', err.message);
      return;
    }

    for (const user of users) {
      try {
        await emailService.sendEmail({
          to:      user.email,
          subject: this._emailSubject(signal),
          html:    this._emailBody(signal, user),
        });
      } catch (err) {
        console.error(`[SignalDelivery] Email to ${user.email} failed:`, err.message);
      }
    }
  }

  _emailSubject(signal) {
    const dir  = signal.type === 'LONG' ? '📈 LONG' : '📉 SHORT';
    const conf = (signal.confidenceScore * 100).toFixed(1);
    return `${dir} Signal: ${signal.pair} — ${conf}% confidence`;
  }

  _emailBody(signal, user) {
    const color  = signal.type === 'LONG' ? '#22c55e' : '#ef4444';
    const icon   = signal.type === 'LONG' ? '🟢' : '🔴';
    const rrStr  = signal.riskReward ? `1 : ${signal.riskReward}` : 'N/A';
    const levStr = signal.leverage   ? `${signal.leverage}×`       : 'Spot';
    const conf   = (signal.confidenceScore * 100).toFixed(1);

    const reasonsHtml = (signal.reasons ?? [])
      .map(r => `<li style="margin:4px 0;">${r}</li>`)
      .join('');

    const mtfHtml = signal.mtfAlignment
      ? Object.entries(signal.mtfAlignment)
          .map(([tf, v]) => `<span style="margin-right:8px;"><b>${tf}</b>: ${v}</span>`)
          .join('')
      : '';

    return `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:0;">
  <div style="max-width:580px;margin:30px auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">

    <!-- Header -->
    <div style="background:${color};padding:20px 24px;">
      <h2 style="margin:0;color:#fff;font-size:22px;">${icon} ${signal.type} Signal — ${signal.pair}</h2>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
        ${signal.marketType.toUpperCase()} · ${signal.exchange} · ${signal.timeframe} · ${new Date(signal.timestamp).toUTCString()}
      </p>
    </div>

    <!-- Body -->
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:15px;">Hello ${user.fullName ?? 'Trader'},</p>
      <p style="margin:0 0 20px;color:#94a3b8;">A new high-confidence signal was just generated:</p>

      <!-- Key levels -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr style="background:#0f172a;"><td style="padding:10px 12px;border-radius:6px 0 0 6px;color:#94a3b8;width:45%;">Entry</td><td style="padding:10px 12px;font-weight:bold;font-size:16px;">$${signal.entry}</td></tr>
        <tr><td style="padding:10px 12px;color:#94a3b8;">Stop Loss</td><td style="padding:10px 12px;color:#ef4444;font-weight:bold;">$${signal.stopLoss}</td></tr>
        <tr style="background:#0f172a;"><td style="padding:10px 12px;color:#94a3b8;">Take Profit</td><td style="padding:10px 12px;color:#22c55e;font-weight:bold;">$${signal.takeProfit}</td></tr>
        <tr><td style="padding:10px 12px;color:#94a3b8;">Risk : Reward</td><td style="padding:10px 12px;">${rrStr}</td></tr>
        <tr style="background:#0f172a;"><td style="padding:10px 12px;color:#94a3b8;">Leverage</td><td style="padding:10px 12px;">${levStr}</td></tr>
        <tr><td style="padding:10px 12px;color:#94a3b8;">Confidence</td><td style="padding:10px 12px;font-weight:bold;color:${color};">${conf}%</td></tr>
        <tr style="background:#0f172a;"><td style="padding:10px 12px;color:#94a3b8;">AI Source</td><td style="padding:10px 12px;text-transform:capitalize;">${signal.aiSource}</td></tr>
      </table>

      <!-- Reasons -->
      ${reasonsHtml ? `
      <div style="background:#0f172a;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
        <p style="margin:0 0 8px;font-weight:bold;font-size:13px;color:#94a3b8;">SIGNAL REASONS</p>
        <ul style="margin:0;padding-left:18px;font-size:14px;">${reasonsHtml}</ul>
      </div>` : ''}

      <!-- MTF alignment -->
      ${mtfHtml ? `
      <div style="background:#0f172a;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
        <p style="margin:0 0 8px;font-weight:bold;font-size:13px;color:#94a3b8;">TIMEFRAME ALIGNMENT</p>
        <p style="margin:0;font-size:14px;">${mtfHtml}</p>
      </div>` : ''}

      <p style="color:#475569;font-size:12px;margin:0;">
        ⚠️ This is not financial advice. Always manage your risk.
        Max recommended risk: 1-2% of portfolio per trade.
      </p>
    </div>
  </div>
</body>
</html>`;
  }
}

export default new SignalDeliveryService();
