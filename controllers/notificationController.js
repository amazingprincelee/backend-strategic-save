import { Notification, User } from '../models/index.js';
import {
  notificationSchema,
  paginationSchema
} from '../utils/validation.js';
import { ethers } from 'ethers';

// Get user notifications
export const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user.id;

    // Validate pagination parameters
    const validatedQuery = await paginationSchema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    const { page, limit } = validatedQuery;
    const { unreadOnly, type, priority } = req.query;

    // Build filter query
    const filterQuery = { userId };

    if (unreadOnly === 'true') {
      filterQuery.isRead = false;
    }

    if (type) {
      filterQuery.type = type;
    }

    if (priority) {
      filterQuery.priority = priority;
    }

    // Don't include archived notifications unless specifically requested
    if (req.query.includeArchived !== 'true') {
      filterQuery.isArchived = false;
    }

    // Get notifications with pagination
    const notifications = await Notification.getUserNotifications(
      userId,
      page,
      limit,
      filterQuery
    );

    // Get unread count
    const unreadCount = await Notification.getUnreadCount(userId);

    res.json({
      success: true,
      data: {
        notifications: notifications.notifications,
        pagination: notifications.pagination,
        unreadCount
      }
    });

  } catch (error) {
    console.error('Get user notifications error:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
};

// Get notifications by user address (for non-authenticated users)
export const getNotificationsByAddress = async (req, res) => {
  try {
    const { userAddress } = req.params;

    // Validate Ethereum address
    if (!ethers.isAddress(userAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Ethereum address'
      });
    }

    // Validate pagination parameters
    const validatedQuery = await paginationSchema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    const { page, limit } = validatedQuery;
    const { unreadOnly, type, priority } = req.query;

    // Build filter query
    const filterQuery = { userAddress: userAddress.toLowerCase() };

    if (unreadOnly === 'true') {
      filterQuery.isRead = false;
    }

    if (type) {
      filterQuery.type = type;
    }

    if (priority) {
      filterQuery.priority = priority;
    }

    // Don't include archived notifications unless specifically requested
    if (req.query.includeArchived !== 'true') {
      filterQuery.isArchived = false;
    }

    // Get notifications
    const skip = (page - 1) * limit;
    const notifications = await Notification.find(filterQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count
    const totalNotifications = await Notification.countDocuments(filterQuery);

    // Calculate pagination info
    const totalPages = Math.ceil(totalNotifications / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    // Get unread count
    const unreadCount = await Notification.countDocuments({
      userAddress: userAddress.toLowerCase(),
      isRead: false,
      isArchived: false
    });

    res.json({
      success: true,
      data: {
        notifications,
        pagination: {
          currentPage: page,
          totalPages,
          totalNotifications,
          hasNextPage,
          hasPrevPage,
          limit
        },
        unreadCount
      }
    });

  } catch (error) {
    console.error('Get notifications by address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications'
    });
  }
};

// Mark notification as read
export const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    // Find notification
    const notification = await Notification.findOne({
      _id: notificationId,
      userId
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Mark as read
    await notification.markAsRead();

    res.json({
      success: true,
      message: 'Notification marked as read',
      data: { notification }
    });

  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
};

// Mark notification as read by address (for non-authenticated users)
export const markAsReadByAddress = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { userAddress } = req.body;

    // Validate Ethereum address
    if (!ethers.isAddress(userAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Ethereum address'
      });
    }

    // Find notification
    const notification = await Notification.findOne({
      _id: notificationId,
      userAddress: userAddress.toLowerCase()
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Mark as read
    await notification.markAsRead();

    res.json({
      success: true,
      message: 'Notification marked as read',
      data: { notification }
    });

  } catch (error) {
    console.error('Mark notification as read by address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read'
    });
  }
};

// Mark all notifications as read
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    // Update all unread notifications for the user
    const result = await Notification.updateMany(
      { userId, isRead: false },
      { 
        isRead: true,
        readAt: new Date()
      }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
      data: { modifiedCount: result.modifiedCount }
    });

  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read'
    });
  }
};

// Archive notification
export const archiveNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    // Find notification
    const notification = await Notification.findOne({
      _id: notificationId,
      userId
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Archive notification
    await notification.archive();

    res.json({
      success: true,
      message: 'Notification archived',
      data: { notification }
    });

  } catch (error) {
    console.error('Archive notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to archive notification'
    });
  }
};

// Delete notification
export const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    // Find and delete notification
    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      userId
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted',
      data: { notification }
    });

  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification'
    });
  }
};

// Create notification (admin only)
export const createNotification = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Validate request data
    const validatedData = await notificationCreateSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    const {
      userId,
      userAddress,
      type,
      title,
      message,
      data,
      priority,
      expiresAt
    } = validatedData;

    // Create notification
    const notification = await Notification.createNotification({
      userId,
      userAddress,
      type,
      title,
      message,
      data,
      priority,
      expiresAt
    });

    res.status(201).json({
      success: true,
      message: 'Notification created successfully',
      data: { notification }
    });

  } catch (error) {
    console.error('Create notification error:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create notification'
    });
  }
};

// Get notification statistics (admin only)
export const getNotificationStats = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get notification statistics
    const stats = await Notification.aggregate([
      {
        $group: {
          _id: null,
          totalNotifications: { $sum: 1 },
          unreadNotifications: {
            $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] }
          },
          archivedNotifications: {
            $sum: { $cond: [{ $eq: ['$isArchived', true] }, 1, 0] }
          },
          highPriorityNotifications: {
            $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] }
          }
        }
      }
    ]);

    // Get notification distribution by type
    const typeDistribution = await Notification.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get notification distribution by priority
    const priorityDistribution = await Notification.aggregate([
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get recent notifications
    const recentNotifications = await Notification.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('userId', 'email walletAddress')
      .lean();

    const notificationStats = stats[0] || {
      totalNotifications: 0,
      unreadNotifications: 0,
      archivedNotifications: 0,
      highPriorityNotifications: 0
    };

    res.json({
      success: true,
      data: {
        stats: notificationStats,
        typeDistribution,
        priorityDistribution,
        recentNotifications
      }
    });

  } catch (error) {
    console.error('Get notification stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification statistics'
    });
  }
};

// Clean up expired notifications (admin only)
export const cleanupExpiredNotifications = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Clean up expired notifications
    const result = await Notification.cleanupExpiredNotifications();

    res.json({
      success: true,
      message: `${result.deletedCount} expired notifications cleaned up`,
      data: { deletedCount: result.deletedCount }
    });

  } catch (error) {
    console.error('Cleanup expired notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup expired notifications'
    });
  }
};

// Get unread count
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const unreadCount = await Notification.getUnreadCount(userId);

    res.json({
      success: true,
      data: { unreadCount }
    });

  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unread count'
    });
  }
};

// Get unread count by address (for non-authenticated users)
export const getUnreadCountByAddress = async (req, res) => {
  try {
    const { userAddress } = req.params;

    // Validate Ethereum address
    if (!ethers.isAddress(userAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Ethereum address'
      });
    }

    const unreadCount = await Notification.countDocuments({
      userAddress: userAddress.toLowerCase(),
      isRead: false,
      isArchived: false
    });

    res.json({
      success: true,
      data: { unreadCount }
    });

  } catch (error) {
    console.error('Get unread count by address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unread count'
    });
  }
};