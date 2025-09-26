import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getAllVaults,
  getUserVaults,
  getVaultById,
  getUserVaultStats,
  getVaultsForMaturityNotification,
  getUnlockedVaults,
  recordDeposit,
  recordWithdrawal,
  getContractInfo,
  syncVaultWithBlockchain,
  searchVaults
} from '../controllers/vaultController.js';
import {
  authenticate,
  requireEmailVerification,
  optionalAuth,
  requireAdmin
} from '../middleware/auth.js';
import {
  validateQuery,
  validateParams,
  validateRequest,
  paginationSchema,
  depositSchema,
  withdrawalSchema
} from '../utils/validation.js';

const router = express.Router();

// Rate limiting for vault endpoints
const vaultLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests per minute
  message: {
    success: false,
    message: 'Too many vault requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const transactionLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 transaction records per minute
  message: {
    success: false,
    message: 'Too many transaction requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Public routes
/**
 * @route   GET /api/vaults
 * @desc    Get all vaults with pagination and filtering
 * @access  Public
 */
router.get('/', 
  vaultLimiter,
  validateQuery(paginationSchema),
  getAllVaults
);

/**
 * @route   GET /api/vaults/contract
 * @desc    Get contract information (ABI + address)
 * @access  Public
 */
router.get('/contract', 
  vaultLimiter,
  getContractInfo
);

/**
 * @route   GET /api/vaults/user/:userAddress
 * @desc    Get all vaults for a user address
 * @access  Public
 */
router.get('/user/:userAddress', 
  vaultLimiter,
  validateParams({
    userAddress: {
      type: 'string',
      required: true,
      matches: /^0x[a-fA-F0-9]{40}$/,
      message: 'Invalid Ethereum address'
    }
  }),
  validateQuery(paginationSchema),
  getUserVaults
);

/**
 * @route   GET /api/vaults/:vaultId
 * @desc    Get vault by ID
 * @access  Public
 */
router.get('/:vaultId', 
  vaultLimiter,
  validateParams({
    vaultId: {
      type: 'string',
      required: true,
      matches: /^\d+$/,
      message: 'Invalid vault ID'
    }
  }),
  getVaultById
);

/**
 * @route   GET /api/vaults/user/:userAddress/stats
 * @desc    Get vault statistics for a user
 * @access  Public
 */
router.get('/user/:userAddress/stats', 
  vaultLimiter,
  validateParams({
    userAddress: {
      type: 'string',
      required: true,
      matches: /^0x[a-fA-F0-9]{40}$/,
      message: 'Invalid Ethereum address'
    }
  }),
  getUserVaultStats
);

/**
 * @route   GET /api/vaults/unlocked/list
 * @desc    Get unlocked vaults
 * @access  Public
 */
router.get('/unlocked/list', 
  vaultLimiter,
  validateQuery(paginationSchema),
  getUnlockedVaults
);

/**
 * @route   GET /api/vaults/search
 * @desc    Search vaults
 * @access  Public
 */
router.get('/search', 
  vaultLimiter,
  validateQuery({
    ...paginationSchema.fields,
    q: {
      type: 'string',
      required: false,
      min: 1,
      max: 100
    },
    userAddress: {
      type: 'string',
      required: false,
      matches: /^0x[a-fA-F0-9]{40}$/,
      message: 'Invalid Ethereum address'
    },
    tokenSymbol: {
      type: 'string',
      required: false,
      min: 1,
      max: 20
    },
    status: {
      type: 'string',
      required: false,
      oneOf: ['active', 'withdrawn', 'closed']
    }
  }),
  searchVaults
);

// Protected routes (optional authentication)
/**
 * @route   POST /api/vaults/:vaultId/record-deposit
 * @desc    Record a deposit transaction
 * @access  Public/Private
 */
router.post('/:vaultId/record-deposit', 
  transactionLimiter,
  optionalAuth,
  validateParams({
    vaultId: {
      type: 'string',
      required: true,
      matches: /^\d+$/,
      message: 'Invalid vault ID'
    }
  }),
  validateRequest(depositSchema),
  recordDeposit
);

/**
 * @route   POST /api/vaults/:vaultId/record-withdrawal
 * @desc    Record a withdrawal transaction
 * @access  Public/Private
 */
router.post('/:vaultId/record-withdrawal', 
  transactionLimiter,
  optionalAuth,
  validateParams({
    vaultId: {
      type: 'string',
      required: true,
      matches: /^\d+$/,
      message: 'Invalid vault ID'
    }
  }),
  validateRequest(withdrawalSchema),
  recordWithdrawal
);

/**
 * @route   POST /api/vaults/:vaultId/sync
 * @desc    Sync vault data with blockchain
 * @access  Public/Private
 */
router.post('/:vaultId/sync', 
  vaultLimiter,
  optionalAuth,
  validateParams({
    vaultId: {
      type: 'string',
      required: true,
      matches: /^\d+$/,
      message: 'Invalid vault ID'
    }
  }),
  syncVaultWithBlockchain
);

// Admin only routes
/**
 * @route   GET /api/vaults/admin/maturity-notifications
 * @desc    Get vaults ready for maturity notifications
 * @access  Private (Admin only)
 */
router.get('/admin/maturity-notifications', 
  authenticate,
  requireAdmin,
  getVaultsForMaturityNotification
);

export default router;