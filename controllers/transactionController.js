import Transaction from '../models/Transaction.js';

// ─── GET /api/admin/transactions ─────────────────────────────────────────────
export const listTransactions = async (req, res) => {
  try {
    const { status, provider, range = '30d', search, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status && status !== 'all') filter.status = status;
    if (provider && provider !== 'all') filter.provider = provider;
    if (search) filter.userEmail = { $regex: search, $options: 'i' };

    // Date range
    const now = new Date();
    const rangeMap = { today: 1, '7d': 7, '30d': 30, '90d': 90 };
    const days = rangeMap[range];
    if (days) filter.createdAt = { $gte: new Date(now - days * 86_400_000) };

    const skip = (Number(page) - 1) * Number(limit);
    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select('-events'), // exclude events from list — load on detail
      Transaction.countDocuments(filter),
    ]);

    res.json({ success: true, data: transactions, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/admin/transactions/stats ───────────────────────────────────────
export const getTransactionStats = async (req, res) => {
  try {
    const [completed, pending, failed, expired, initiated] = await Promise.all([
      Transaction.countDocuments({ status: 'completed' }),
      Transaction.countDocuments({ status: { $in: ['pending', 'processing'] } }),
      Transaction.countDocuments({ status: 'failed' }),
      Transaction.countDocuments({ status: 'expired' }),
      Transaction.countDocuments({ status: 'initiated' }),
    ]);

    const revenueAgg = await Transaction.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amountUSD' } } },
    ]);
    const totalRevenue = revenueAgg[0]?.total || 0;

    const total = completed + pending + failed + expired + initiated;
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    res.json({ success: true, data: { totalRevenue, completed, pending, failed, expired, initiated, total, successRate } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/admin/transactions/:id ─────────────────────────────────────────
export const getTransactionDetail = async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id);
    if (!txn) return res.status(404).json({ success: false, message: 'Transaction not found' });
    res.json({ success: true, data: txn });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
