import express from 'express';
import authRoutes from './auth.js';
import dashboardRoutes from './dashboard.js';
import vaultRoutes from './vaults.js';
import notificationRoutes from './notifications.js';
import adminRoutes from './admin.js';
import userRoutes from './user.js'
import arbitrageRoutes from './arbitrage.js';


const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Strategic Crypto Save API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API routes
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/vaults', vaultRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);
router.use('/user', userRoutes)
router.use('/arbitrage', arbitrageRoutes);

// 404 handler for API routes
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    path: req.originalUrl
  });
});

export default router;