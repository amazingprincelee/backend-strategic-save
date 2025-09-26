import { Vault, User, Notification } from '../models/index.js';
import blockchainService from '../utils/blockchainService.js';
import {
  vaultCreationSchema,
  depositSchema,
  withdrawalSchema,
  paginationSchema
} from '../utils/validation.js';
import { ethers } from 'ethers';

// Get all vaults (general endpoint)
export const getAllVaults = async (req, res) => {
  try {
    // Validate pagination parameters
    const validatedQuery = await paginationSchema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    const { page, limit, sortBy, sortOrder } = validatedQuery;
    const skip = (page - 1) * limit;

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Find vaults with basic filtering
    const query = {};
    
    // Optional filters
    if (req.query.status) {
      query.status = req.query.status;
    }
    
    if (req.query.tokenSymbol) {
      query.tokenSymbol = req.query.tokenSymbol;
    }

    // Find vaults
    const vaults = await Vault.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count for pagination
    const totalVaults = await Vault.countDocuments(query);

    // Calculate pagination info
    const totalPages = Math.ceil(totalVaults / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    // Add computed fields to vaults
    const enrichedVaults = vaults.map(vault => ({
      ...vault,
      isUnlocked: vault.isUnlocked,
      timeUntilUnlock: vault.timeUntilUnlock,
      totalDeposited: vault.totalDeposited,
      totalWithdrawn: vault.totalWithdrawn,
      totalPlatformFees: vault.totalPlatformFees,
      daysUntilUnlock: vault.daysUntilUnlock,
      lockDurationDays: vault.lockDurationDays
    }));

    res.json({
      success: true,
      data: {
        vaults: enrichedVaults,
        pagination: {
          currentPage: page,
          totalPages,
          totalVaults,
          hasNextPage,
          hasPrevPage,
          limit
        }
      }
    });

  } catch (error) {
    console.error('Get all vaults error:', error);
    
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
      message: 'Failed to fetch vaults'
    });
  }
};

// Get all vaults for a user
export const getUserVaults = async (req, res) => {
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

    const { page, limit, sortBy, sortOrder } = validatedQuery;
    const skip = (page - 1) * limit;

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Find vaults for the user
    const vaults = await Vault.find({ 
      userAddress: userAddress.toLowerCase() 
    })
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();

    // Get total count for pagination
    const totalVaults = await Vault.countDocuments({ 
      userAddress: userAddress.toLowerCase() 
    });

    // Calculate pagination info
    const totalPages = Math.ceil(totalVaults / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    // Add computed fields to vaults
    const enrichedVaults = vaults.map(vault => ({
      ...vault,
      isUnlocked: vault.isUnlocked,
      timeUntilUnlock: vault.timeUntilUnlock,
      totalDeposited: vault.totalDeposited,
      totalWithdrawn: vault.totalWithdrawn,
      totalPlatformFees: vault.totalPlatformFees,
      daysUntilUnlock: vault.daysUntilUnlock,
      lockDurationDays: vault.lockDurationDays
    }));

    res.json({
      success: true,
      data: {
        vaults: enrichedVaults,
        pagination: {
          currentPage: page,
          totalPages,
          totalVaults,
          hasNextPage,
          hasPrevPage,
          limit
        }
      }
    });

  } catch (error) {
    console.error('Get user vaults error:', error);
    
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
      message: 'Failed to fetch vaults'
    });
  }
};

// Get a specific vault by ID
export const getVaultById = async (req, res) => {
  try {
    const { vaultId } = req.params;

    // Validate vault ID
    if (!vaultId || isNaN(vaultId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vault ID'
      });
    }

    // Find vault in database
    const vault = await Vault.findOne({ vaultId: vaultId.toString() }).lean();

    if (!vault) {
      return res.status(404).json({
        success: false,
        message: 'Vault not found'
      });
    }

    // Add computed fields
    const enrichedVault = {
      ...vault,
      isUnlocked: vault.isUnlocked,
      timeUntilUnlock: vault.timeUntilUnlock,
      totalDeposited: vault.totalDeposited,
      totalWithdrawn: vault.totalWithdrawn,
      totalPlatformFees: vault.totalPlatformFees,
      daysUntilUnlock: vault.daysUntilUnlock,
      lockDurationDays: vault.lockDurationDays
    };

    // Get real-time blockchain data for comparison
    try {
      const blockchainVault = await blockchainService.getVaultInfo(vaultId);
      if (blockchainVault) {
        enrichedVault.blockchainData = blockchainVault;
      }
    } catch (blockchainError) {
      console.error('Failed to fetch blockchain data:', blockchainError);
      // Continue without blockchain data
    }

    res.json({
      success: true,
      data: { vault: enrichedVault }
    });

  } catch (error) {
    console.error('Get vault by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vault'
    });
  }
};

// Get vault statistics for a user
export const getUserVaultStats = async (req, res) => {
  try {
    const { userAddress } = req.params;
    
    // Validate Ethereum address
    if (!ethers.isAddress(userAddress)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Ethereum address'
      });
    }

    // Aggregate vault statistics
    const stats = await Vault.aggregate([
      { $match: { userAddress: userAddress.toLowerCase() } },
      {
        $group: {
          _id: null,
          totalVaults: { $sum: 1 },
          activeVaults: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          },
          unlockedVaults: {
            $sum: { 
              $cond: [
                { $lte: ['$unlockTime', new Date()] }, 
                1, 
                0
              ] 
            }
          },
          totalBalance: {
            $sum: { $toDouble: '$balance' }
          },
          totalDeposited: {
            $sum: {
              $reduce: {
                input: '$deposits',
                initialValue: 0,
                in: { $add: ['$$value', { $toDouble: '$$this.amount' }] }
              }
            }
          },
          totalWithdrawn: {
            $sum: {
              $reduce: {
                input: '$withdrawals',
                initialValue: 0,
                in: { $add: ['$$value', { $toDouble: '$$this.amount' }] }
              }
            }
          },
          totalPlatformFees: {
            $sum: {
              $reduce: {
                input: '$withdrawals',
                initialValue: 0,
                in: { $add: ['$$value', { $toDouble: '$$this.platformFee' }] }
              }
            }
          }
        }
      }
    ]);

    const userStats = stats[0] || {
      totalVaults: 0,
      activeVaults: 0,
      unlockedVaults: 0,
      totalBalance: 0,
      totalDeposited: 0,
      totalWithdrawn: 0,
      totalPlatformFees: 0
    };

    // Get vault distribution by token
    const tokenDistribution = await Vault.aggregate([
      { $match: { userAddress: userAddress.toLowerCase() } },
      {
        $group: {
          _id: '$tokenSymbol',
          count: { $sum: 1 },
          totalBalance: { $sum: { $toDouble: '$balance' } }
        }
      },
      { $sort: { totalBalance: -1 } }
    ]);

    // Get recent activity (last 10 deposits/withdrawals)
    const recentActivity = await Vault.aggregate([
      { $match: { userAddress: userAddress.toLowerCase() } },
      {
        $project: {
          vaultId: 1,
          tokenSymbol: 1,
          activities: {
            $concatArrays: [
              {
                $map: {
                  input: '$deposits',
                  as: 'deposit',
                  in: {
                    type: 'deposit',
                    amount: '$$deposit.amount',
                    transactionHash: '$$deposit.transactionHash',
                    timestamp: '$$deposit.timestamp',
                    blockNumber: '$$deposit.blockNumber'
                  }
                }
              },
              {
                $map: {
                  input: '$withdrawals',
                  as: 'withdrawal',
                  in: {
                    type: 'withdrawal',
                    amount: '$$withdrawal.amount',
                    platformFee: '$$withdrawal.platformFee',
                    transactionHash: '$$withdrawal.transactionHash',
                    timestamp: '$$withdrawal.timestamp',
                    blockNumber: '$$withdrawal.blockNumber'
                  }
                }
              }
            ]
          }
        }
      },
      { $unwind: '$activities' },
      { $sort: { 'activities.timestamp': -1 } },
      { $limit: 10 },
      {
        $project: {
          vaultId: 1,
          tokenSymbol: 1,
          type: '$activities.type',
          amount: '$activities.amount',
          platformFee: '$activities.platformFee',
          transactionHash: '$activities.transactionHash',
          timestamp: '$activities.timestamp',
          blockNumber: '$activities.blockNumber'
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        stats: userStats,
        tokenDistribution,
        recentActivity
      }
    });

  } catch (error) {
    console.error('Get user vault stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vault statistics'
    });
  }
};

// Get vaults ready for maturity notifications
export const getVaultsForMaturityNotification = async (req, res) => {
  try {
    // Only allow admin access
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const vaults = await Vault.findVaultsForMaturityNotification();

    res.json({
      success: true,
      data: { vaults }
    });

  } catch (error) {
    console.error('Get vaults for maturity notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vaults for notification'
    });
  }
};

// Get unlocked vaults
export const getUnlockedVaults = async (req, res) => {
  try {
    // Validate pagination parameters
    const validatedQuery = await paginationSchema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    const { page, limit, sortBy, sortOrder } = validatedQuery;
    const skip = (page - 1) * limit;

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const vaults = await Vault.findUnlockedVaults()
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count
    const totalVaults = await Vault.countDocuments({
      unlockTime: { $lte: new Date() },
      status: 'active',
      balance: { $gt: '0' }
    });

    // Calculate pagination info
    const totalPages = Math.ceil(totalVaults / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      success: true,
      data: {
        vaults,
        pagination: {
          currentPage: page,
          totalPages,
          totalVaults,
          hasNextPage,
          hasPrevPage,
          limit
        }
      }
    });

  } catch (error) {
    console.error('Get unlocked vaults error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unlocked vaults'
    });
  }
};

// Record a deposit (called after blockchain transaction)
export const recordDeposit = async (req, res) => {
  try {
    // Validate request data
    const validatedData = await depositSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    const { vaultId, amount, transactionHash } = validatedData;

    // Find the vault
    const vault = await Vault.findOne({ vaultId: vaultId.toString() });

    if (!vault) {
      return res.status(404).json({
        success: false,
        message: 'Vault not found'
      });
    }

    // Check if user owns the vault (if authenticated)
    if (req.user) {
      const user = await User.findById(req.user.id);
      if (user && user.walletAddress !== vault.userAddress) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    // Check if deposit already recorded
    const existingDeposit = vault.deposits.find(
      deposit => deposit.transactionHash === transactionHash
    );

    if (existingDeposit) {
      return res.status(400).json({
        success: false,
        message: 'Deposit already recorded'
      });
    }

    // Add deposit (this will be handled by the blockchain service automatically)
    // This endpoint is mainly for manual recording or verification

    res.json({
      success: true,
      message: 'Deposit recorded successfully',
      data: { vault }
    });

  } catch (error) {
    console.error('Record deposit error:', error);
    
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
      message: 'Failed to record deposit'
    });
  }
};

// Record a withdrawal (called after blockchain transaction)
export const recordWithdrawal = async (req, res) => {
  try {
    // Validate request data
    const validatedData = await withdrawalSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    const { vaultId, amount, transactionHash } = validatedData;

    // Find the vault
    const vault = await Vault.findOne({ vaultId: vaultId.toString() });

    if (!vault) {
      return res.status(404).json({
        success: false,
        message: 'Vault not found'
      });
    }

    // Check if user owns the vault (if authenticated)
    if (req.user) {
      const user = await User.findById(req.user.id);
      if (user && user.walletAddress !== vault.userAddress) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    // Check if withdrawal already recorded
    const existingWithdrawal = vault.withdrawals.find(
      withdrawal => withdrawal.transactionHash === transactionHash
    );

    if (existingWithdrawal) {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal already recorded'
      });
    }

    // Add withdrawal (this will be handled by the blockchain service automatically)
    // This endpoint is mainly for manual recording or verification

    res.json({
      success: true,
      message: 'Withdrawal recorded successfully',
      data: { vault }
    });

  } catch (error) {
    console.error('Record withdrawal error:', error);
    
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
      message: 'Failed to record withdrawal'
    });
  }
};

// Get contract information
export const getContractInfo = async (req, res) => {
  try {
    const contractInfo = await blockchainService.getContractInfo();

    res.json({
      success: true,
      data: { contract: contractInfo }
    });

  } catch (error) {
    console.error('Get contract info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contract information'
    });
  }
};

// Sync vault data with blockchain
export const syncVaultWithBlockchain = async (req, res) => {
  try {
    const { vaultId } = req.params;

    // Validate vault ID
    if (!vaultId || isNaN(vaultId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vault ID'
      });
    }

    // Get blockchain data
    const blockchainVault = await blockchainService.getVaultInfo(vaultId);

    if (!blockchainVault) {
      return res.status(404).json({
        success: false,
        message: 'Vault not found on blockchain'
      });
    }

    // Find vault in database
    let vault = await Vault.findOne({ vaultId: vaultId.toString() });

    if (!vault) {
      // Create vault if it doesn't exist in database
      vault = new Vault({
        vaultId: vaultId.toString(),
        userAddress: blockchainVault.user.toLowerCase(),
        tokenAddress: blockchainVault.token.toLowerCase(),
        tokenSymbol: blockchainVault.tokenSymbol,
        balance: blockchainVault.balance,
        unlockTime: blockchainVault.unlockTime,
        status: 'active'
      });
    } else {
      // Update existing vault with blockchain data
      vault.balance = blockchainVault.balance;
      vault.tokenSymbol = blockchainVault.tokenSymbol;
    }

    await vault.save();

    res.json({
      success: true,
      message: 'Vault synced with blockchain successfully',
      data: { 
        vault,
        blockchainData: blockchainVault
      }
    });

  } catch (error) {
    console.error('Sync vault with blockchain error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync vault with blockchain'
    });
  }
};

// Search vaults
export const searchVaults = async (req, res) => {
  try {
    const { q, userAddress, tokenSymbol, status } = req.query;

    // Validate pagination parameters
    const validatedQuery = await paginationSchema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    const { page, limit, sortBy, sortOrder } = validatedQuery;
    const skip = (page - 1) * limit;

    // Build search query
    const searchQuery = {};

    if (userAddress) {
      if (!ethers.isAddress(userAddress)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid user address'
        });
      }
      searchQuery.userAddress = userAddress.toLowerCase();
    }

    if (tokenSymbol) {
      searchQuery.tokenSymbol = { $regex: tokenSymbol, $options: 'i' };
    }

    if (status) {
      searchQuery.status = status;
    }

    if (q) {
      // General search across multiple fields
      searchQuery.$or = [
        { vaultId: { $regex: q, $options: 'i' } },
        { tokenSymbol: { $regex: q, $options: 'i' } },
        { userAddress: { $regex: q, $options: 'i' } }
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute search
    const vaults = await Vault.find(searchQuery)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count
    const totalVaults = await Vault.countDocuments(searchQuery);

    // Calculate pagination info
    const totalPages = Math.ceil(totalVaults / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      success: true,
      data: {
        vaults,
        pagination: {
          currentPage: page,
          totalPages,
          totalVaults,
          hasNextPage,
          hasPrevPage,
          limit
        },
        searchQuery: {
          q,
          userAddress,
          tokenSymbol,
          status
        }
      }
    });

  } catch (error) {
    console.error('Search vaults error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search vaults'
    });
  }
};