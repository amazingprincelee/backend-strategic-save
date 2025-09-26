import express from 'express';
import rateLimit from 'express-rate-limit';
import * as yup from 'yup';
import {
  getUserNotifications,
  getNotificationsByAddress,
  markAsRead,
  markAsReadByAddress,
  markAllAsRead,
  archiveNotification,
  deleteNotification,
  createNotification,
  getNotificationStats,
  cleanupExpiredNotifications,
  getUnreadCount,
  getUnreadCountByAddress
} from '../controllers/notificationController.js';
import {
  authenticate,
  requireEmailVerification,
  requireAdmin
} from '../middleware/auth.js';
import {
  validateQuery,
  validateParams,
  validateRequest,
  paginationSchema,
  notificationSchema
} from '../utils/validation.js';

const router = express.Router();

// Rate limiting for notification endpoints
const notificationLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per minute
  message: {
    success: false,
    message: 'Too many notification requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const notificationActionLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 actions per minute
  message: {
    success: false,
    message: 'Too many notification actions, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Public routes (for wallet-only users)
/**
 * @route   GET /api/notifications/address/:userAddress
 * @desc    Get notifications by user address
 * @access  Public
 */
router.get('/address/:userAddress', 
  notificationLimiter,
  validateParams({
    userAddress: {
      type: 'string',
      required: true,
      matches: /^0x[a-fA-F0-9]{40}$/,
      message: 'Invalid Ethereum address'
    }
  }),
  validateQuery({
    ...paginationSchema.fields,
    unreadOnly: {
      type: 'string',
      required: false,
      oneOf: ['true', 'false']
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
      ]
    },
    priority: {
      type: 'string',
      required: false,
      oneOf: ['low', 'medium', 'high']
    },
    includeArchived: {
      type: 'string',
      required: false,
      oneOf: ['true', 'false']
    }
  }),
  getNotificationsByAddress
);

/**
 * @route   GET /api/notifications/address/:userAddress/unread-count
 * @desc    Get unread notification count by address
 * @access  Public
 */
router.get('/address/:userAddress/unread-count', 
  notificationLimiter,
  validateParams({
    userAddress: {
      type: 'string',
      required: true,
      matches: /^0x[a-fA-F0-9]{40}$/,
      message: 'Invalid Ethereum address'
    }
  }),
  getUnreadCountByAddress
);

/**
 * @route   PUT /api/notifications/:notificationId/read-by-address
 * @desc    Mark notification as read by address
 * @access  Public
 */
router.put('/:notificationId/read-by-address', 
  notificationActionLimiter,
  validateParams({
    notificationId: {
      type: 'string',
      required: true,
      matches: /^[0-9a-fA-F]{24}$/,
      message: 'Invalid notification ID'
    }
  }),
  validateRequest({
    userAddress: {
      type: 'string',
      required: true,
      matches: /^0x[a-fA-F0-9]{40}$/,
      message: 'Invalid Ethereum address'
    }
  }),
  markAsReadByAddress
);

// Protected routes (authenticated users)
/**
 * @route   GET /api/notifications
 * @desc    Get user notifications
 * @access  Private
 */
router.get('/', 
  authenticate,
  notificationLimiter,
  validateQuery(paginationSchema.shape({
    unreadOnly: yup
      .string()
      .oneOf(['true', 'false'])
      .optional(),
    type: yup
      .string()
      .oneOf([
        'vault_created',
        'deposit_confirmed',
        'withdrawal_confirmed',
        'vault_matured',
        'vault_unlocked',
        'platform_fee_updated',
        'system_maintenance',
        'security_alert',
        'announcement'
      ])
      .optional(),
    priority: yup
      .string()
      .oneOf(['low', 'medium', 'high'])
      .optional(),
    includeArchived: yup
      .string()
      .oneOf(['true', 'false'])
      .optional()
  })),
  getUserNotifications
);

/**
 * @route   GET /api/notifications/unread-count
 * @desc    Get unread notification count
 * @access  Private
 */
router.get('/unread-count', 
  authenticate,
  notificationLimiter,
  getUnreadCount
);

/**
 * @route   PUT /api/notifications/:notificationId/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.put('/:notificationId/read', 
  authenticate,
  notificationActionLimiter,
  validateParams({
    notificationId: {
      type: 'string',
      required: true,
      matches: /^[0-9a-fA-F]{24}$/,
      message: 'Invalid notification ID'
    }
  }),
  markAsRead
);

/**
 * @route   PUT /api/notifications/mark-all-read
 * @desc    Mark all notifications as read
 * @access  Private
 */
router.put('/mark-all-read', 
  authenticate,
  notificationActionLimiter,
  markAllAsRead
);

/**
 * @route   PUT /api/notifications/:notificationId/archive
 * @desc    Archive notification
 * @access  Private
 */
router.put('/:notificationId/archive', 
  authenticate,
  notificationActionLimiter,
  validateParams({
    notificationId: {
      type: 'string',
      required: true,
      matches: /^[0-9a-fA-F]{24}$/,
      message: 'Invalid notification ID'
    }
  }),
  archiveNotification
);

/**
 * @route   DELETE /api/notifications/:notificationId
 * @desc    Delete notification
 * @access  Private
 */
router.delete('/:notificationId', 
  authenticate,
  notificationActionLimiter,
  validateParams({
    notificationId: {
      type: 'string',
      required: true,
      matches: /^[0-9a-fA-F]{24}$/,
      message: 'Invalid notification ID'
    }
  }),
  deleteNotification
);

// Admin only routes
/**
 * @route   POST /api/notifications
 * @desc    Create notification (admin only)
 * @access  Private (Admin only)
 */
router.post('/', 
  authenticate,
  requireAdmin,
  notificationActionLimiter,
  validateRequest(notificationSchema),
  createNotification
);

/**
 * @route   GET /api/notifications/admin/stats
 * @desc    Get notification statistics
 * @access  Private (Admin only)
 */
router.get('/admin/stats', 
  authenticate,
  requireAdmin,
  notificationLimiter,
  getNotificationStats
);

/**
 * @route   DELETE /api/notifications/admin/cleanup-expired
 * @desc    Clean up expired notifications
 * @access  Private (Admin only)
 */
router.delete('/admin/cleanup-expired', 
  authenticate,
  requireAdmin,
  notificationActionLimiter,
  cleanupExpiredNotifications
);

export default router;