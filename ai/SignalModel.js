/**
 * SignalModel.js
 * TensorFlow.js Dense Neural Network for signal probability prediction.
 *
 * Uses @tensorflow/tfjs (pure JavaScript — no native binaries required).
 * Install: npm install @tensorflow/tfjs
 *
 * Architecture: 10 features → [128 → BN → Drop(0.3) → 64 → Drop(0.2) → 32 → 3 softmax]
 * Output: [buyProb, sellProb, holdProb]
 *
 * Falls back to a calibrated rule-based probability model if TF is unavailable.
 *
 * Key differences from tfjs-node:
 *  - Dynamic import yields a module namespace (not a .default export)
 *  - Must explicitly set backend to 'cpu' (no WebGL in Node.js)
 *  - Model weights persisted as JSON (file:// handler not guaranteed in pure tfjs)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildTrainingData } from './FeatureEngineering.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const WEIGHTS_DIR = path.join(__dirname, 'saved_model');
const WEIGHTS_FILE = path.join(WEIGHTS_DIR, 'weights.json');
const FEATURE_LEN = 10;

// ─── Singleton ────────────────────────────────────────────────────────────────

class SignalModel {
  constructor() {
    this.tf           = null;
    this.model        = null;
    this.isTFReady    = false;
    this.isModelReady = false;
    this._lock        = false;
  }

  // ─── Init ────────────────────────────────────────────────────────────────

  async init() {
    try {
      // @tensorflow/tfjs exports as a namespace — no .default
      const tfMod = await import('@tensorflow/tfjs');
      this.tf = tfMod;

      // Force CPU backend — WebGL is not available in Node.js
      await this.tf.setBackend('cpu');
      await this.tf.ready();

      this.isTFReady = true;
      console.log(`[SignalModel] TensorFlow.js ready (backend: ${this.tf.getBackend()})`);

      // Try to load previously saved weights
      await this._tryLoadWeights();
    } catch (err) {
      console.warn(
        '[SignalModel] @tensorflow/tfjs not available — using rule-based scoring.\n' +
        '             Run: npm install @tensorflow/tfjs   to enable AI predictions.\n' +
        `             (${err.message})`
      );
      this.isTFReady = false;
    }
  }

  // ─── Training ────────────────────────────────────────────────────────────

  async train(candles) {
    if (!this.isTFReady || this._lock) return;
    this._lock = true;

    try {
      console.log('[SignalModel] Building training dataset...');
      const data = buildTrainingData(candles);
      if (!data || data.X.length < 200) {
        console.warn('[SignalModel] Not enough samples to train (need ≥200)');
        return;
      }

      const tf = this.tf;
      const xs = tf.tensor2d(data.X);
      const ys = tf.tensor2d(data.y);

      if (!this.model) this.model = this._buildModel();

      console.log(`[SignalModel] Training on ${data.X.length} samples (CPU backend)…`);
      await this.model.fit(xs, ys, {
        epochs:          80,
        batchSize:       64,
        validationSplit: 0.15,
        shuffle:         true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if ((epoch + 1) % 20 === 0) {
              const acc = logs.acc ?? logs.accuracy ?? 0;
              console.log(
                `[SignalModel] Epoch ${epoch + 1}/80 — ` +
                `loss: ${logs.loss.toFixed(4)}  acc: ${acc.toFixed(4)}`
              );
            }
          },
        },
      });

      xs.dispose();
      ys.dispose();

      await this._saveWeights();
      this.isModelReady = true;
      console.log('[SignalModel] Training complete — weights saved.');
    } catch (err) {
      console.error('[SignalModel] Training error:', err.message);
    } finally {
      this._lock = false;
    }
  }

  // ─── Prediction ──────────────────────────────────────────────────────────

  async predict(normalizedFeatures) {
    if (this.isTFReady && this.isModelReady && this.model) {
      return this._tfPredict(normalizedFeatures);
    }
    return this._rulePredict(normalizedFeatures);
  }

  // ─── Private — TF prediction ─────────────────────────────────────────────

  _tfPredict(features) {
    try {
      const tf    = this.tf;
      const input = tf.tensor2d([features], [1, FEATURE_LEN]);
      const out   = this.model.predict(input);
      const probs = Array.from(out.dataSync());
      input.dispose();
      out.dispose();

      return {
        buyProb:  probs[0] ?? 0,
        sellProb: probs[1] ?? 0,
        holdProb: probs[2] ?? 0,
        source:   'ai',
      };
    } catch (err) {
      console.error('[SignalModel] TF predict error:', err.message);
      return this._rulePredict(features);
    }
  }

  // ─── Private — rule-based fallback ───────────────────────────────────────

  /**
   * Calibrated probabilistic scoring used when TF model is not ready.
   * Feature index map (from FeatureEngineering.js normalized vector):
   *  0  ema20dist   1  ema50dist   2  ema200dist
   *  3  rsiNorm     4  macdLine    5  macdHist
   *  6  atrRel      7  volRatio    8  volChange
   *  9  candleBody
   */
  _rulePredict(f) {
    const [
      ema20d, ema50d, ema200d,
      rsiN, macdL, macdH,
      /* atrR */ , volR, /* volC */ ,
      body,
    ] = f;

    let buy  = 0;
    let sell = 0;

    // RSI — strongest individual signal
    if      (rsiN < -0.4) { buy  += 0.35; }   // RSI < 30
    else if (rsiN < -0.2) { buy  += 0.20; }   // RSI < 40
    if      (rsiN >  0.4) { sell += 0.35; }   // RSI > 70
    else if (rsiN >  0.2) { sell += 0.20; }   // RSI > 60

    // Price vs short-term EMAs
    if      (ema20d < -0.04) { buy  += 0.15; }
    else if (ema20d < -0.02) { buy  += 0.08; }
    if      (ema20d >  0.04) { sell += 0.15; }
    else if (ema20d >  0.02) { sell += 0.08; }

    if (ema50d < -0.06) { buy  += 0.10; }
    if (ema50d >  0.06) { sell += 0.10; }

    // EMA200 macro trend filter
    if (ema200d > 0)  { buy  += 0.08; }
    else              { sell += 0.08; }

    // MACD momentum
    if (macdL > 0 && macdH > 0) { buy  += 0.12; }
    if (macdL < 0 && macdH < 0) { sell += 0.12; }
    if (macdH > 0)               { buy  += 0.05; }
    if (macdH < 0)               { sell += 0.05; }

    // Volume confirms direction
    if (volR > 0.5) {
      buy  += body > 0 ? 0.07 : 0;
      sell += body < 0 ? 0.07 : 0;
    }

    // Candle body bias
    if (body >  0.6) { buy  += 0.05; }
    if (body < -0.6) { sell += 0.05; }

    const total   = buy + sell + 0.15; // 0.15 hold base (smaller = less compressed)
    const buyProb  = Math.min(0.95, buy  / total);
    const sellProb = Math.min(0.95, sell / total);
    const holdProb = Math.max(0.01, 1 - buyProb - sellProb);

    return { buyProb, sellProb, holdProb, source: 'rule-based' };
  }

  // ─── Private — model architecture ────────────────────────────────────────

  _buildModel() {
    const tf = this.tf;

    const m = tf.sequential();
    m.add(tf.layers.dense({
      inputShape:        [FEATURE_LEN],
      units:             128,
      activation:        'relu',
      kernelInitializer: 'glorotUniform',
    }));
    m.add(tf.layers.batchNormalization());
    m.add(tf.layers.dropout({ rate: 0.3 }));

    m.add(tf.layers.dense({ units: 64, activation: 'relu' }));
    m.add(tf.layers.dropout({ rate: 0.2 }));

    m.add(tf.layers.dense({ units: 32, activation: 'relu' }));

    m.add(tf.layers.dense({
      units:      3,
      activation: 'softmax',   // [buyProb, sellProb, holdProb]
    }));

    m.compile({
      optimizer: tf.train.adam(0.001),
      loss:      'categoricalCrossentropy',
      metrics:   ['accuracy'],
    });

    return m;
  }

  // ─── Private — weight persistence (JSON, no file:// handler needed) ───────

  async _saveWeights() {
    if (!this.tf || !this.model) return;
    try {
      fs.mkdirSync(WEIGHTS_DIR, { recursive: true });

      // Serialize all weight tensors to plain arrays
      const weightData = this.model.getWeights().map(w => ({
        name:   w.name,
        shape:  w.shape,
        values: Array.from(w.dataSync()),
      }));

      fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(weightData), 'utf8');
      console.log('[SignalModel] Weights saved to', WEIGHTS_FILE);
    } catch (err) {
      console.warn('[SignalModel] Could not save weights:', err.message);
    }
  }

  async _tryLoadWeights() {
    if (!this.tf || !fs.existsSync(WEIGHTS_FILE)) return;

    try {
      const raw         = fs.readFileSync(WEIGHTS_FILE, 'utf8');
      const weightData  = JSON.parse(raw);

      // Rebuild model first so it has the right shape
      this.model = this._buildModel();

      // Restore weight tensors
      const tensors = weightData.map(w =>
        this.tf.tensor(w.values, w.shape)
      );
      this.model.setWeights(tensors);
      tensors.forEach(t => t.dispose());

      this.isModelReady = true;
      console.log('[SignalModel] Loaded saved weights from disk');
    } catch (err) {
      console.warn('[SignalModel] Could not load saved weights:', err.message);
      this.model = null;
      this.isModelReady = false;
    }
  }
}

export default new SignalModel();
