import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getCurrentUser,
  updateUserProfile,
  updateUserPreferences,
  changePassword,
  getUserInvestments,
  getUserStatistics,
  deleteUserAccount,
  linkWalletAddress,
  unlinkWalletAddress,
  getUserActivity
} from '../controllers/userController.js';
import {
  authenticate
} from '../middleware/auth.js';


const router = express.Router();

// Rate limiting for user endpoints
const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const strictUserLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    success: false,
    message: 'Too many attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/users/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/me', 
  userLimiter,
  getCurrentUser
);

/**
 * @route   PUT /api/users/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile', 
  userLimiter,
  updateUserProfile
);

/**
 * @route   PUT /api/users/preferences
 * @desc    Update user notification preferences
 * @access  Private
 */
router.put('/preferences', 
  userLimiter,
  updateUserPreferences
);

/**
 * @route   PUT /api/users/password
 * @desc    Change user password
 * @access  Private
 */
router.put('/password', 
  strictUserLimiter,
  changePassword
);

/**
 * @route   GET /api/users/investments
 * @desc    Get user's investments
 * @access  Private
 */
router.get('/investments', 
  userLimiter,
  getUserInvestments
);

/**
 * @route   GET /api/users/statistics
 * @desc    Get user statistics
 * @access  Private
 */
router.get('/statistics', 
  userLimiter,
  getUserStatistics
);

/**
 * @route   GET /api/users/activity
 * @desc    Get user activity log
 * @access  Private
 */
router.get('/activity', 
  userLimiter,
  getUserActivity
);

/**
 * @route   POST /api/users/wallet/link
 * @desc    Link wallet address to user account
 * @access  Private
 */
router.post('/wallet/link', 
  strictUserLimiter,
  linkWalletAddress
);

/**
 * @route   POST /api/users/wallet/unlink
 * @desc    Unlink wallet address from user account
 * @access  Private
 */
router.post('/wallet/unlink', 
  strictUserLimiter,
  unlinkWalletAddress
);

/**
 * @route   DELETE /api/users/account
 * @desc    Delete user account
 * @access  Private
 */
router.delete('/account', 
  strictUserLimiter,
  deleteUserAccount
);

export default router;