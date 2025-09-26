import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getPlatformStats,
  getAllUsers,
  updateUser,
  deleteUser,
  sendBroadcastNotification,
  sendBroadcastEmail,
  syncAllVaults,
  getSystemHealth,
  getAuditLogs
} from '../controllers/adminController.js';
import {
  authenticate,
  requireAdmin
} from '../middleware/auth.js';
import {
  validateQuery,
  validateParams,
  validateRequest,
  paginationSchema,
  adminUserUpdateSchema
} from '../utils/validation.js';

const router = express.Router();

// Rate limiting for admin endpoints
const adminLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute
  message: {
    success: false,
    message: 'Too many admin requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const adminActionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // limit each IP to 10 actions per 5 minutes
  message: {
    success: false,
    message: 'Too many admin actions, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const broadcastLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // limit each IP to 5 broadcasts per hour
  message: {
    success: false,
    message: 'Too many broadcast attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

/**
 * @route   GET /api/admin/stats
 * @desc    Get platform statistics
 * @access  Private (Admin only)
 */
router.get('/stats', 
  adminLimiter,
  getPlatformStats
);

/**
 * @route   GET /api/admin/users
 * @desc    Get all users with pagination and search
 * @access  Private (Admin only)
 */
router.get('/users', 
  adminLimiter,
  validateQuery({
    ...paginationSchema.fields,
    search: {
      type: 'string',
      required: false,
      min: 1,
      max: 100
    },
    role: {
      type: 'string',
      required: false,
      oneOf: ['user', 'admin']
    },
    isEmailVerified: {
      type: 'string',
      required: false,
      oneOf: ['true', 'false']
    }
  }),
  getAllUsers
);

/**
 * @route   PUT /api/admin/users/:userId
 * @desc    Update user
 * @access  Private (Admin only)
 */
router.put('/users/:userId', 
  adminActionLimiter,
  validateParams({
    userId: {
      type: 'string',
      required: true,
      matches: /^[0-9a-fA-F]{24}$/,
      message: 'Invalid user ID'
    }
  }),
  validateRequest(adminUserUpdateSchema),
  updateUser
);

/**
 * @route   DELETE /api/admin/users/:userId
 * @desc    Delete user
 * @access  Private (Admin only)
 */
router.delete('/users/:userId', 
  adminActionLimiter,
  validateParams({
    userId: {
      type: 'string',
      required: true,
      matches: /^[0-9a-fA-F]{24}$/,
      message: 'Invalid user ID'
    }
  }),
  deleteUser
);

/**
 * @route   POST /api/admin/broadcast/notification
 * @desc    Send broadcast notification to all users
 * @access  Private (Admin only)
 */
router.post('/broadcast/notification', 
  broadcastLimiter,
  validateRequest({
    title: {
      type: 'string',
      required: true,
      min: 1,
      max: 200
    },
    message: {
      type: 'string',
      required: true,
      min: 1,
      max: 1000
    },
    type: {
      type: 'string',
      required: false,
      oneOf: [
        'vault_created',
        'deposit_confirmed',
        'withdrawal_confirmed',
        'vault_matured',
        'vault_unlocked',
        'platform_fee_updated',
        'system_maintenance',
        'security_alert',
        'announcement'
      ],
      default: 'announcement'
    },
    priority: {
      type: 'string',
      required: false,
      oneOf: ['low', 'medium', 'high'],
      default: 'medium'
    }
  }),
  sendBroadcastNotification
);

/**
 * @route   POST /api/admin/broadcast/email
 * @desc    Send broadcast email to all users
 * @access  Private (Admin only)
 */
router.post('/broadcast/email', 
  broadcastLimiter,
  validateRequest({
    subject: {
      type: 'string',
      required: true,
      min: 1,
      max: 200
    },
    htmlContent: {
      type: 'string',
      required: false,
      min: 1,
      max: 10000
    },
    textContent: {
      type: 'string',
      required: false,
      min: 1,
      max: 10000
    }
  }),
  sendBroadcastEmail
);

/**
 * @route   POST /api/admin/sync-vaults
 * @desc    Sync all vaults with blockchain
 * @access  Private (Admin only)
 */
router.post('/sync-vaults', 
  adminActionLimiter,
  syncAllVaults
);

/**
 * @route   GET /api/admin/health
 * @desc    Get system health status
 * @access  Private (Admin only)
 */
router.get('/health', 
  adminLimiter,
  getSystemHealth
);

/**
 * @route   GET /api/admin/audit-logs
 * @desc    Get audit logs
 * @access  Private (Admin only)
 */
router.get('/audit-logs', 
  adminLimiter,
  validateQuery({
    ...paginationSchema.fields,
    action: {
      type: 'string',
      required: false,
      min: 1,
      max: 50
    },
    userId: {
      type: 'string',
      required: false,
      matches: /^[0-9a-fA-F]{24}$/,
      message: 'Invalid user ID'
    },
    startDate: {
      type: 'string',
      required: false,
      matches: /^\d{4}-\d{2}-\d{2}$/,
      message: 'Invalid date format (YYYY-MM-DD)'
    },
    endDate: {
      type: 'string',
      required: false,
      matches: /^\d{4}-\d{2}-\d{2}$/,
      message: 'Invalid date format (YYYY-MM-DD)'
    }
  }),
  getAuditLogs
);

export default router;