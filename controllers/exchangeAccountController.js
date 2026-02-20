import ExchangeAccount from '../models/ExchangeAccount.js';
import BotConfig from '../models/bot/BotConfig.js';
import exchangeConnector from '../services/bot/ExchangeConnector.js';
import botEngine from '../services/bot/BotEngine.js';

/**
 * GET /api/exchange-accounts
 * List all exchange accounts for the authenticated user.
 * API keys are never returned.
 */
export const listAccounts = async (req, res) => {
  try {
    const accounts = await ExchangeAccount.find({ userId: req.user.id })
      .select('-apiKeyEncrypted -apiSecretEncrypted -apiPassphraseEncrypted')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: { accounts } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/exchange-accounts
 * Add a new exchange account with API credentials.
 */
export const addAccount = async (req, res) => {
  try {
    const { label, exchange, apiKey, apiSecret, apiPassphrase, isSandbox } = req.body;

    if (!label || !exchange || !apiKey || !apiSecret) {
      return res.status(400).json({
        success: false,
        message: 'label, exchange, apiKey and apiSecret are required'
      });
    }

    // Check exchange is supported
    if (!exchangeConnector.getSupportedExchanges().includes(exchange.toLowerCase())) {
      return res.status(400).json({ success: false, message: `Exchange "${exchange}" is not supported` });
    }

    const account = new ExchangeAccount({
      userId: req.user.id,
      label: label.trim(),
      exchange: exchange.toLowerCase(),
      isSandbox: !!isSandbox
    });

    account.setApiKey(apiKey);
    account.setApiSecret(apiSecret);
    if (apiPassphrase) account.setApiPassphrase(apiPassphrase);

    // Test the connection before saving
    const testResult = await exchangeConnector.testConnection(account);
    account.isValid = testResult.isValid;
    account.lastTestedAt = new Date();
    account.lastError = testResult.error || null;
    account.permissions.canRead = testResult.isValid;
    account.permissions.canTrade = testResult.canTrade;

    if (!testResult.isValid) {
      return res.status(400).json({
        success: false,
        message: `Connection test failed: ${testResult.error}`,
        data: { testResult }
      });
    }

    await account.save();

    const safeAccount = account.toObject();
    delete safeAccount.apiKeyEncrypted;
    delete safeAccount.apiSecretEncrypted;
    delete safeAccount.apiPassphraseEncrypted;

    res.status(201).json({ success: true, data: { account: safeAccount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/exchange-accounts/:id
 * Update label or API keys.
 */
export const updateAccount = async (req, res) => {
  try {
    const account = await ExchangeAccount
      .findOne({ _id: req.params.id, userId: req.user.id })
      .select('+apiKeyEncrypted +apiSecretEncrypted +apiPassphraseEncrypted');

    if (!account) {
      return res.status(404).json({ success: false, message: 'Exchange account not found' });
    }

    const { label, apiKey, apiSecret, apiPassphrase, isSandbox } = req.body;

    if (label) account.label = label.trim();
    if (typeof isSandbox === 'boolean') account.isSandbox = isSandbox;
    if (apiKey) account.setApiKey(apiKey);
    if (apiSecret) account.setApiSecret(apiSecret);
    if (apiPassphrase) account.setApiPassphrase(apiPassphrase);

    // If keys updated, remove cached connection and re-validate
    if (apiKey || apiSecret) {
      exchangeConnector.removeConnection(req.user.id, account._id);
      const testResult = await exchangeConnector.testConnection(account);
      account.isValid = testResult.isValid;
      account.lastTestedAt = new Date();
      account.lastError = testResult.error || null;
    }

    await account.save();

    const safeAccount = account.toObject();
    delete safeAccount.apiKeyEncrypted;
    delete safeAccount.apiSecretEncrypted;
    delete safeAccount.apiPassphraseEncrypted;

    res.json({ success: true, data: { account: safeAccount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/exchange-accounts/:id
 */
export const deleteAccount = async (req, res) => {
  try {
    const account = await ExchangeAccount.findOne({ _id: req.params.id, userId: req.user.id });
    if (!account) {
      return res.status(404).json({ success: false, message: 'Exchange account not found' });
    }

    // Stop any running bots using this account
    const botsUsing = await BotConfig.find({ exchangeAccountId: account._id, status: 'running' });
    for (const bot of botsUsing) {
      await botEngine.stopBot(bot._id);
    }

    exchangeConnector.removeConnection(req.user.id, account._id);
    await ExchangeAccount.deleteOne({ _id: account._id });

    res.json({ success: true, message: 'Exchange account removed' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/exchange-accounts/:id/test
 * Test an existing account's connection.
 */
export const testAccount = async (req, res) => {
  try {
    const account = await ExchangeAccount
      .findOne({ _id: req.params.id, userId: req.user.id })
      .select('+apiKeyEncrypted +apiSecretEncrypted +apiPassphraseEncrypted');

    if (!account) {
      return res.status(404).json({ success: false, message: 'Exchange account not found' });
    }

    exchangeConnector.removeConnection(req.user.id, account._id);
    const testResult = await exchangeConnector.testConnection(account);

    await ExchangeAccount.findByIdAndUpdate(account._id, {
      isValid: testResult.isValid,
      lastTestedAt: new Date(),
      lastError: testResult.error || null,
      'permissions.canRead': testResult.isValid,
      'permissions.canTrade': testResult.canTrade
    });

    res.json({ success: true, data: { testResult } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/exchange-accounts/supported
 * Return popular exchanges list.
 */
export const getSupportedExchanges = (req, res) => {
  res.json({
    success: true,
    data: {
      popular: exchangeConnector.getPopularExchanges(),
      all: exchangeConnector.getSupportedExchanges()
    }
  });
};
