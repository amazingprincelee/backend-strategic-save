import { User } from '../models/index.js';

// Get dashboard data for authenticated user
export const getDashboard = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Calculate user statistics
    const totalInvestments = user.investments?.length || 0;
    const totalInvested = user.investments?.reduce((sum, investment) => sum + investment.amount, 0) || 0;
    const activeVaults = user.investments?.filter(investment => investment.status === 'active').length || 0;

    // Get recent activity (last 5 investments)
    const recentActivity = user.investments?.slice(-5).reverse() || [];

    // User profile data
    const userProfile = {
      id: user._id,
      email: user.email,
      walletAddress: user.walletAddress,
      profile: user.profile,
      role: user.role,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt
    };

    // Dashboard statistics
    const stats = {
      totalInvestments,
      totalInvested,
      activeVaults,
      portfolioValue: totalInvested, // In a real app, this would be calculated based on current values
      totalReturns: 0 // Placeholder for actual returns calculation
    };

    res.json({
      success: true,
      data: {
        user: userProfile,
        stats,
        recentActivity,
        message: `Welcome back, ${user.profile.firstName || 'User'}!`
      }
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load dashboard data'
    });
  }
};

// Get user investment summary
export const getInvestmentSummary = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const investments = user.investments || [];
    
    // Group investments by status
    const investmentsByStatus = investments.reduce((acc, investment) => {
      const status = investment.status || 'pending';
      if (!acc[status]) acc[status] = [];
      acc[status].push(investment);
      return acc;
    }, {});

    // Calculate totals by status
    const summary = {
      total: investments.length,
      active: investmentsByStatus.active?.length || 0,
      completed: investmentsByStatus.completed?.length || 0,
      pending: investmentsByStatus.pending?.length || 0,
      totalAmount: investments.reduce((sum, inv) => sum + inv.amount, 0),
      activeAmount: (investmentsByStatus.active || []).reduce((sum, inv) => sum + inv.amount, 0),
      completedAmount: (investmentsByStatus.completed || []).reduce((sum, inv) => sum + inv.amount, 0)
    };

    res.json({
      success: true,
      data: {
        summary,
        investments: investments.slice(-10) // Last 10 investments
      }
    });

  } catch (error) {
    console.error('Investment summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load investment summary'
    });
  }
};

// Get user notifications
export const getNotifications = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // In a real app, notifications would be stored separately
    // For now, we'll create some sample notifications based on user activity
    const notifications = [
      {
        id: '1',
        type: 'welcome',
        title: 'Welcome to Strategic Crypto Save!',
        message: 'Start your crypto investment journey today.',
        read: false,
        createdAt: user.createdAt
      }
    ];

    // Add investment-related notifications if user has investments
    if (user.investments && user.investments.length > 0) {
      const lastInvestment = user.investments[user.investments.length - 1];
      notifications.unshift({
        id: '2',
        type: 'investment',
        title: 'Investment Confirmed',
        message: `Your investment of $${lastInvestment.amount} has been confirmed.`,
        read: false,
        createdAt: lastInvestment.createdAt || new Date()
      });
    }

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount: notifications.filter(n => !n.read).length
      }
    });

  } catch (error) {
    console.error('Notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load notifications'
    });
  }
};