import mongoose from 'mongoose';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-cbc';

function getKey() {
  const key = process.env.EXCHANGE_API_ENCRYPTION_KEY;
  if (!key) throw new Error('EXCHANGE_API_ENCRYPTION_KEY not set in environment');
  return scryptSync(key, 'strategicCryptoSalt', 32);
}

function encrypt(text) {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

const exchangeAccountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  label: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  exchange: {
    type: String,
    required: true,
    lowercase: true
  },
  // Encrypted at rest - never returned in API responses
  apiKeyEncrypted: { type: String, required: true, select: false },
  apiSecretEncrypted: { type: String, required: true, select: false },
  apiPassphraseEncrypted: { type: String, default: null, select: false },

  isSandbox: { type: Boolean, default: false },
  supportsSpot: { type: Boolean, default: true },
  supportsFutures: { type: Boolean, default: false },

  isValid: { type: Boolean, default: false },
  lastTestedAt: { type: Date, default: null },
  lastError: { type: String, default: null },

  permissions: {
    canRead: { type: Boolean, default: false },
    canTrade: { type: Boolean, default: false },
    canWithdraw: { type: Boolean, default: false }
  }
}, {
  timestamps: true
});

exchangeAccountSchema.methods.setApiKey = function (apiKey) {
  this.apiKeyEncrypted = encrypt(apiKey);
};

exchangeAccountSchema.methods.setApiSecret = function (apiSecret) {
  this.apiSecretEncrypted = encrypt(apiSecret);
};

exchangeAccountSchema.methods.setApiPassphrase = function (passphrase) {
  if (passphrase) this.apiPassphraseEncrypted = encrypt(passphrase);
};

exchangeAccountSchema.methods.getDecryptedKeys = function () {
  return {
    apiKey: decrypt(this.apiKeyEncrypted),
    apiSecret: decrypt(this.apiSecretEncrypted),
    apiPassphrase: this.apiPassphraseEncrypted ? decrypt(this.apiPassphraseEncrypted) : undefined
  };
};

exchangeAccountSchema.index({ userId: 1, exchange: 1 });

const ExchangeAccount = mongoose.model('ExchangeAccount', exchangeAccountSchema);
export default ExchangeAccount;
