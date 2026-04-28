import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  getPublicCalls, getStats,
  adminCreateCall, adminUpdateCall, adminDeleteCall,
} from '../controllers/tradeCallController.js';
import { analyzeSymbol } from '../services/TechnicalAnalysisEngine.js';

const router  = express.Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/',       limiter, getPublicCalls);
router.get('/stats',  limiter, getStats);

// ── Admin ─────────────────────────────────────────────────────────────────────
router.post('/',         limiter, authenticate, requireAdmin, adminCreateCall);
router.put('/:id',       limiter, authenticate, requireAdmin, adminUpdateCall);
router.delete('/:id',    limiter, authenticate, requireAdmin, adminDeleteCall);

// POST /api/trade-calls/generate-notes — generate analysis notes from live TA
router.post('/generate-notes', limiter, authenticate, requireAdmin, async (req, res) => {
  try {
    const { pair, direction, entryPrice, stopLoss, tp1 } = req.body;
    if (!pair || !direction || !entryPrice) {
      return res.status(400).json({ success: false, message: 'pair, direction and entryPrice are required' });
    }

    const entry = Number(entryPrice);
    const sl    = Number(stopLoss)  || null;
    const tp    = Number(tp1)       || null;
    const dir   = String(direction).toUpperCase();

    // Compute setup metrics
    const profitPct = tp && entry
      ? (((dir === 'LONG' ? tp - entry : entry - tp) / entry) * 100)
      : null;
    const riskPct = sl && entry
      ? (((dir === 'LONG' ? entry - sl : sl - entry) / entry) * 100)
      : null;
    const rr = (profitPct !== null && riskPct !== null && riskPct > 0)
      ? (profitPct / riskPct).toFixed(2)
      : null;

    // Fetch live TA for the pair
    let reasons = [];
    let rsiVal  = null;
    let trend   = null;
    let sentiment = null;
    try {
      const sym = pair.replace('/', '').toUpperCase();
      const ta  = await analyzeSymbol(sym, '1h', 'spot');
      reasons   = ta?.reasons   || [];
      rsiVal    = ta?.indicators?.rsi ?? null;
      sentiment = ta?.newsSentiment?.sentiment ?? null;
      // Summarise trend from EMA alignment
      const ind = ta?.indicators;
      if (ind) {
        const p = ta.currentPrice || entry;
        if (ind.ema20 && ind.ema50) {
          trend = ind.ema20 > ind.ema50
            ? (p > (ind.ema200 || 0) ? 'macro uptrend' : 'short-term bullish')
            : (p < (ind.ema200 || Infinity) ? 'macro downtrend' : 'short-term bearish');
        }
      }
    } catch {
      // TA unavailable — still build a note from the setup metrics
    }

    // Build the note
    const lines = [];

    // Line 1 — setup summary
    const setupParts = [`${dir} ${pair.toUpperCase()} at $${entry.toLocaleString()}`];
    if (sl)          setupParts.push(`SL $${sl.toLocaleString()} (${riskPct   !== null ? `-${Math.abs(riskPct).toFixed(2)}%` : '—'})`);
    if (tp)          setupParts.push(`TP $${tp.toLocaleString()} (${profitPct !== null ? `+${profitPct.toFixed(2)}%`         : '—'})`);
    if (rr)          setupParts.push(`R:R ${rr}`);
    lines.push(setupParts.join(' | ') + '.');

    // Line 2 — technical context
    const techParts = [];
    if (rsiVal !== null) techParts.push(`RSI ${rsiVal.toFixed(1)} (${rsiVal < 40 ? 'oversold' : rsiVal > 60 ? 'overbought' : 'neutral'})`);
    if (trend)           techParts.push(trend);
    if (reasons.length)  techParts.push(...reasons.slice(0, 3));
    if (techParts.length) lines.push('Technical: ' + techParts.join(', ') + '.');

    // Line 3 — news sentiment (only if not neutral)
    if (sentiment && sentiment !== 'neutral') {
      lines.push(`News sentiment is ${sentiment}.`);
    }

    res.json({ success: true, data: { notes: lines.join(' ') } });
  } catch (err) {
    console.error('[TradeCall] generate-notes error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
