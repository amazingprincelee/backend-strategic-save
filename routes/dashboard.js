import express from 'express';
import {
  getDashboard,
  getInvestmentSummary,
  getNotifications
} from '../controllers/dashboardController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All dashboard routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/dashboard
 * @desc    Get user dashboard data
 * @access  Private
 */
router.get('/', getDashboard);

/**
 * @route   GET /api/dashboard/investments
 * @desc    Get user investment summary
 * @access  Private
 */
router.get('/investments', getInvestmentSummary);

/**
 * @route   GET /api/dashboard/notifications
 * @desc    Get user notifications
 * @access  Private
 */
router.get('/notifications', getNotifications);

export default router;