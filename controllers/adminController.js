import { User, Notification } from '../models/index.js';
import emailService from '../utils/emailService.js';
import {
  adminUserUpdateSchema,
  paginationSchema
} from '../utils/validation.js';

// Get platform statistics
export const getPlatformStats = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get user statistics
    const userStats = await User.aggregate([
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          verifiedUsers: {
            $sum: { $cond: [{ $eq: ['$isEmailVerified', true] }, 1, 0] }
          },
          adminUsers: {
            $sum: { $cond: [{ $eq: ['$role', 'admin'] }, 1, 0] }
          },
          usersWithWallets: {
            $sum: { $cond: [{ $ne: ['$walletAddress', null] }, 1, 0] }
          }
        }
      }
    ]);

    // Get notification statistics
    const notificationStats = await Notification.aggregate([
      {
        $group: {
          _id: null,
          totalNotifications: { $sum: 1 },
          unreadNotifications: {
            $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] }
          },
          highPriorityNotifications: {
            $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] }
          }
        }
      }
    ]);

    // Get recent activity
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('email walletAddress createdAt')
      .lean();

    const platformStats = {
      users: userStats[0] || {
        totalUsers: 0,
        verifiedUsers: 0,
        adminUsers: 0,
        usersWithWallets: 0
      },
      notifications: notificationStats[0] || {
        totalNotifications: 0,
        unreadNotifications: 0,
        highPriorityNotifications: 0
      },
      recentActivity: {
        users: recentUsers,
      },
    };

    res.json({
      success: true,
      data: { stats: platformStats }
    });

  } catch (error) {
    console.error('Get platform stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch platform statistics'
    });
  }
};

// Get all users (admin only)
export const getAllUsers = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Validate pagination parameters
    const validatedQuery = await paginationSchema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    const { page, limit, sortBy, sortOrder } = validatedQuery;
    const { search, role, isEmailVerified } = req.query;
    const skip = (page - 1) * limit;

    // Build search query
    const searchQuery = {};

    if (search) {
      searchQuery.$or = [
        { email: { $regex: search, $options: 'i' } },
        { walletAddress: { $regex: search, $options: 'i' } },
        { 'profile.firstName': { $regex: search, $options: 'i' } },
        { 'profile.lastName': { $regex: search, $options: 'i' } }
      ];
    }

    if (role) {
      searchQuery.role = role;
    }

    if (isEmailVerified !== undefined) {
      searchQuery.isEmailVerified = isEmailVerified === 'true';
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Get users
    const users = await User.find(searchQuery)
      .select('-password -emailVerificationToken -passwordResetToken')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count
    const totalUsers = await User.countDocuments(searchQuery);

    // Calculate pagination info
    const totalPages = Math.ceil(totalUsers / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: page,
          totalPages,
          totalUsers,
          hasNextPage,
          hasPrevPage,
          limit
        }
      }
    });

  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
};

// Update user (admin only)
export const updateUser = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { userId } = req.params;

    // Validate request data
    const validatedData = await adminUserUpdateSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    // Find user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent admin from demoting themselves
    if (user._id.toString() === req.user.id && validatedData.role && validatedData.role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot change your own admin role'
      });
    }

    // Update user
    Object.assign(user, validatedData);
    await user.save();

    // Remove sensitive fields from response
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.emailVerificationToken;
    delete userResponse.passwordResetToken;

    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user: userResponse }
    });

  } catch (error) {
    console.error('Update user error:', error);
    
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
      message: 'Failed to update user'
    });
  }
};

// Delete user (admin only)
export const deleteUser = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { userId } = req.params;

    // Find user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent admin from deleting themselves
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    // Delete user's notifications
    await Notification.deleteMany({
      $or: [
        { userId: user._id },
        { userAddress: user.walletAddress?.toLowerCase() }
      ]
    });

    // Delete user
    await User.findByIdAndDelete(userId);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
};

// Send notification to all users (admin only)
export const sendBroadcastNotification = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { title, message, type = 'announcement', priority = 'medium' } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: 'Title and message are required'
      });
    }

    // Get all users
    const users = await User.find({ isEmailVerified: true }).select('_id email walletAddress');

    // Create notifications for all users
    const notifications = [];
    for (const user of users) {
      const notification = await Notification.createNotification({
        userId: user._id,
        userAddress: user.walletAddress?.toLowerCase(),
        type,
        title,
        message,
        priority
      });
      notifications.push(notification);
    }

    res.json({
      success: true,
      message: `Broadcast notification sent to ${notifications.length} users`,
      data: { 
        notificationCount: notifications.length,
        sampleNotification: notifications[0]
      }
    });

  } catch (error) {
    console.error('Send broadcast notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send broadcast notification'
    });
  }
};

// Send email to all users (admin only)
export const sendBroadcastEmail = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const { subject, htmlContent, textContent } = req.body;

    if (!subject || (!htmlContent && !textContent)) {
      return res.status(400).json({
        success: false,
        message: 'Subject and content are required'
      });
    }

    // Get all verified users
    const users = await User.find({ 
      isEmailVerified: true,
      'notifications.email': true 
    }).select('email profile.firstName profile.lastName');

    let successCount = 0;
    let failureCount = 0;

    // Send emails to all users
    for (const user of users) {
      try {
        await emailService.sendEmail({
          to: user.email,
          subject,
          html: htmlContent,
          text: textContent
        });
        successCount++;
      } catch (emailError) {
        console.error(`Failed to send email to ${user.email}:`, emailError);
        failureCount++;
      }
    }

    res.json({
      success: true,
      message: `Broadcast email sent successfully`,
      data: { 
        totalUsers: users.length,
        successCount,
        failureCount
      }
    });

  } catch (error) {
    console.error('Send broadcast email error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send broadcast email'
    });
  }
};

// Get system health (admin only)
export const getSystemHealth = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const health = {
      timestamp: new Date(),
      status: 'healthy',
      services: {}
    };

    // Check database connection
    try {
      await User.findOne().limit(1);
      health.services.database = { status: 'healthy', message: 'Connected' };
    } catch (dbError) {
      health.services.database = { status: 'unhealthy', message: dbError.message };
      health.status = 'unhealthy';
    }

    // Check email service
    try {
      await emailService.verifyConnection();
      health.services.email = { status: 'healthy', message: 'Connected' };
    } catch (emailError) {
      health.services.email = { status: 'unhealthy', message: emailError.message };
      health.status = 'degraded';
    }

    // System metrics
    health.metrics = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      platform: process.platform
    };

    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json({
      success: health.status !== 'unhealthy',
      data: { health }
    });

  } catch (error) {
    console.error('Get system health error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check system health'
    });
  }
};

// Get audit logs (admin only)
export const getAuditLogs = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Validate pagination parameters
    const validatedQuery = await paginationSchema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    const { page, limit } = validatedQuery;
    const { action, userId, startDate, endDate } = req.query;
    const skip = (page - 1) * limit;

    // Build search query for audit logs
    // Note: This would require implementing an audit log system
    // For now, we'll return recent user activities as a placeholder

    const searchQuery = {};

    if (userId) {
      searchQuery._id = userId;
    }

    if (startDate || endDate) {
      searchQuery.createdAt = {};
      if (startDate) {
        searchQuery.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        searchQuery.createdAt.$lte = new Date(endDate);
      }
    }

    // Get recent user activities as audit logs
    const auditLogs = await User.find(searchQuery)
      .select('email walletAddress lastLogin createdAt updatedAt role')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count
    const totalLogs = await User.countDocuments(searchQuery);

    // Calculate pagination info
    const totalPages = Math.ceil(totalLogs / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      success: true,
      data: {
        auditLogs,
        pagination: {
          currentPage: page,
          totalPages,
          totalLogs,
          hasNextPage,
          hasPrevPage,
          limit
        }
      }
    });

  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch audit logs'
    });
  }
};