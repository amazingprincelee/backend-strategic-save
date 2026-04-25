import TradeCall from '../models/TradeCall.js';

/**
 * TradeCallPriceMonitor — runs on server startup, independent of user traffic.
 *
 * Sources (in priority order):
 *  1. Binance REST  — polled every 5 s, covers 95%+ of USDT pairs
 *  2. CoinGecko REST — polled every 30 s, fallback for coins Binance rejects
 *
 * On every price tick it:
 *  - Emits `tradecall:prices` { pair: price } to all Socket.IO clients
 *  - Checks TP1 / SL conditions and auto-resolves the call in MongoDB
 *  - Emits `tradecall:resolved` when a call closes
 */
class TradeCallPriceMonitor {
  constructor() {
    this.io           = null;
    this.openCalls    = [];          // live cache of open/tp1_hit calls
    this.pairPriceMap = {};          // pair → latest known price
    this.cgFallback   = new Set();   // pairs rejected by Binance → use CoinGecko
    this.resolvingIds = new Set();   // guard against double-resolution race
    this.binanceTimer = null;
    this.cgTimer      = null;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async start(io) {
    this.io = io;
    await this._loadOpenCalls();
    this._startBinanceLoop();
    this._startCoinGeckoLoop();
    console.log(`[PriceMonitor] ✅ Started — watching ${this.openCalls.length} open call(s)`);
  }

  stop() {
    if (this.binanceTimer) clearInterval(this.binanceTimer);
    if (this.cgTimer)      clearInterval(this.cgTimer);
    console.log('[PriceMonitor] Stopped');
  }

  // ── Open-call cache management ───────────────────────────────────────────────

  async _loadOpenCalls() {
    this.openCalls = await TradeCall.find({ status: { $in: ['open', 'tp1_hit'] } }).lean();
  }

  /** Call after admin creates a new trade call */
  addCall(call) {
    if (!this.openCalls.find(c => String(c._id) === String(call._id))) {
      this.openCalls.push(call);
      console.log(`[PriceMonitor] Added ${call.pair} to watchlist`);
    }
  }

  /** Call when a call reaches tp1_hit so the local cache reflects tp1Hit=true */
  _markTp1Hit(id) {
    const idx = this.openCalls.findIndex(c => String(c._id) === String(id));
    if (idx !== -1) {
      this.openCalls[idx] = { ...this.openCalls[idx], status: 'tp1_hit', tp1Hit: true };
    }
  }

  /** Call when a call is fully resolved or manually deleted/cancelled */
  removeCall(id) {
    this.openCalls = this.openCalls.filter(c => String(c._id) !== String(id));
  }

  get _binancePairs() {
    return [...new Set(
      this.openCalls.filter(c => !this.cgFallback.has(c.pair)).map(c => c.pair),
    )];
  }

  get _cgCalls() {
    return this.openCalls.filter(c => this.cgFallback.has(c.pair) && c.coingeckoId);
  }

  // ── Binance REST polling ─────────────────────────────────────────────────────

  _startBinanceLoop() {
    if (this.binanceTimer) clearInterval(this.binanceTimer);
    this.binanceTimer = setInterval(() => this._pollBinance(), 5000);
    this._pollBinance();
  }

  async _pollBinance() {
    const pairs = this._binancePairs;
    if (!pairs.length) return;

    try {
      const url = pairs.length === 1
        ? `https://api.binance.com/api/v3/ticker/price?symbol=${pairs[0]}`
        : `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(pairs))}`;

      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });

      if (r.status === 400) {
        // At least one symbol is invalid — identify which ones and move them to CoinGecko
        await this._detectBadBinancePairs(pairs);
        return;
      }
      if (!r.ok) return;

      const data    = await r.json();
      const tickers = Array.isArray(data) ? data : [data];
      const updates = {};

      for (const { symbol, price } of tickers) {
        const p = parseFloat(price);
        if (p > 0) {
          this.pairPriceMap[symbol] = p;
          updates[symbol] = p;
        }
      }

      if (!Object.keys(updates).length) return;

      if (this.io) this.io.emit('tradecall:prices', updates);

      for (const [pair, price] of Object.entries(updates)) {
        this._checkResolution(pair, price);
      }
    } catch {
      // Network hiccup — will retry in 5 s
    }
  }

  async _detectBadBinancePairs(pairs) {
    await Promise.all(pairs.map(async (symbol) => {
      try {
        const r = await fetch(
          `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
          { signal: AbortSignal.timeout(3000) },
        );
        if (r.status === 400) {
          console.log(`[PriceMonitor] ${symbol} not on Binance — falling back to CoinGecko`);
          this.cgFallback.add(symbol);
        }
      } catch {}
    }));
  }

  // ── CoinGecko fallback polling ───────────────────────────────────────────────

  _startCoinGeckoLoop() {
    if (this.cgTimer) clearInterval(this.cgTimer);
    this.cgTimer = setInterval(() => this._pollCoinGecko(), 30000);
    // Give Binance 10 s to identify bad pairs before first CoinGecko run
    setTimeout(() => this._pollCoinGecko(), 10000);
  }

  async _pollCoinGecko() {
    const cgCalls = this._cgCalls;
    if (!cgCalls.length) return;

    const ids = [...new Set(cgCalls.map(c => c.coingeckoId))];
    try {
      const r = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
      );
      if (!r.ok) return;

      const data    = await r.json();
      const updates = {};

      for (const call of cgCalls) {
        const price = data[call.coingeckoId]?.usd;
        if (price) {
          this.pairPriceMap[call.pair] = price;
          updates[call.pair] = price;
        }
      }

      if (!Object.keys(updates).length) return;

      if (this.io) this.io.emit('tradecall:prices', updates);

      for (const [pair, price] of Object.entries(updates)) {
        this._checkResolution(pair, price);
      }
    } catch (e) {
      console.warn('[PriceMonitor] CoinGecko poll failed:', e.message);
    }
  }

  // ── Auto-resolution ──────────────────────────────────────────────────────────

  _checkResolution(pair, price) {
    const calls = this.openCalls.filter(c => c.pair === pair);
    for (const call of calls) this._tryResolve(call, price);
  }

  async _tryResolve(call, price) {
    const id = String(call._id);
    if (this.resolvingIds.has(id)) return;

    const isLong = call.direction === 'long';
    let update   = null;

    if (isLong) {
      if (price <= call.stopLoss) {
        update = { status: 'loss', closedAt: new Date(), closingPrice: price };
      } else if (!call.tp1Hit && price >= call.tp1) {
        update = call.tp2
          ? { status: 'tp1_hit', tp1Hit: true }
          : { status: 'win', tp1Hit: true, closedAt: new Date(), closingPrice: price };
      } else if (call.tp1Hit && call.tp2 && price >= call.tp2) {
        update = { status: 'win', tp2Hit: true, closedAt: new Date(), closingPrice: price };
      }
    } else {
      if (price >= call.stopLoss) {
        update = { status: 'loss', closedAt: new Date(), closingPrice: price };
      } else if (!call.tp1Hit && price <= call.tp1) {
        update = call.tp2
          ? { status: 'tp1_hit', tp1Hit: true }
          : { status: 'win', tp1Hit: true, closedAt: new Date(), closingPrice: price };
      } else if (call.tp1Hit && call.tp2 && price <= call.tp2) {
        update = { status: 'win', tp2Hit: true, closedAt: new Date(), closingPrice: price };
      }
    }

    if (!update) return;

    this.resolvingIds.add(id);
    try {
      if (update.status === 'tp1_hit') {
        // Keep monitoring — call is still live waiting for TP2
        this._markTp1Hit(id);
      } else {
        // Fully closed — stop watching
        this.removeCall(id);
      }

      await TradeCall.findByIdAndUpdate(call._id, update);
      console.log(`[PriceMonitor] ${call.pair} → ${update.status} @ $${price}`);

      if (this.io) {
        this.io.emit('tradecall:resolved', { _id: id, pair: call.pair, ...update });
      }
    } catch (e) {
      console.error('[PriceMonitor] Resolution DB error:', e.message);
    } finally {
      this.resolvingIds.delete(id);
    }
  }
}

export const priceMonitor = new TradeCallPriceMonitor();
