import * as yup from 'yup';
import { ethers } from 'ethers';

// Common validation schemas
export const emailSchema = yup
  .string()
  .email('Please provide a valid email address')
  .required('Email is required')
  .lowercase()
  .trim();

export const passwordSchema = yup
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`])[A-Za-z\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]*$/,
    'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
  )
  .required('Password is required');



export const tokenAmountSchema = yup
  .string()
  .test('is-valid-amount', 'Please provide a valid amount', (value) => {
    if (!value) return false;
    try {
      const num = parseFloat(value);
      return num > 0 && !isNaN(num) && isFinite(num);
    } catch {
      return false;
    }
  })
  .required('Amount is required');

export const lockDurationSchema = yup
  .number()
  .min(1, 'Lock duration must be at least 1 day')
  .max(3650, 'Lock duration cannot exceed 10 years (3650 days)')
  .integer('Lock duration must be a whole number of days')
  .required('Lock duration is required');

// User registration validation
export const userRegistrationSchema = yup.object({
  email: emailSchema,
  password: passwordSchema,
  confirmPassword: yup
    .string()
    .oneOf([yup.ref('password')], 'Passwords must match')
    .required('Please confirm your password'),
  fullName: yup
    .string()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name cannot exceed 100 characters')
    .required('Full name is required')
    .trim(),
  walletAddress: yup
    .string()
    .test('is-valid-address', 'Please provide a valid Ethereum address', (value) => {
      if (!value) return true; // Allow empty values
      try {
        return ethers.isAddress(value);
      } catch {
        return false;
      }
    })
    .optional(),
  acceptTerms: yup
    .boolean()
    .oneOf([true], 'You must accept the terms and conditions')
    .required('You must accept the terms and conditions')
});

// User login validation
export const userLoginSchema = yup.object({
  email: emailSchema,
  password: yup.string().required('Password is required')
});

// Password reset request validation
export const passwordResetRequestSchema = yup.object({
  email: emailSchema
});

// Password reset validation
export const passwordResetSchema = yup.object({
  token: yup.string().required('Reset token is required'),
  password: passwordSchema,
  confirmPassword: yup
    .string()
    .oneOf([yup.ref('password')], 'Passwords must match')
    .required('Please confirm your password')
});

// Email verification validation
export const emailVerificationSchema = yup.object({
  token: yup.string().required('Verification token is required')
});

// Profile update validation
export const profileUpdateSchema = yup.object({
  fullName: yup
    .string()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name cannot exceed 100 characters')
    .trim()
    .optional(),
  walletAddress: yup
    .string()
    .test('is-valid-address', 'Please provide a valid Ethereum address', (value) => {
      if (!value) return true; // Allow empty values
      try {
        return ethers.isAddress(value);
      } catch {
        return false;
      }
    })
    .optional(),
  notificationPreferences: yup.object({
    email: yup.object({
      vaultMaturity: yup.boolean().optional(),
      deposits: yup.boolean().optional(),
      withdrawals: yup.boolean().optional(),
      security: yup.boolean().optional()
    }).optional(),
    inApp: yup.object({
      vaultMaturity: yup.boolean().optional(),
      deposits: yup.boolean().optional(),
      withdrawals: yup.boolean().optional(),
      security: yup.boolean().optional()
    }).optional()
  }).optional()
});

// Vault creation validation
export const vaultCreationSchema = yup.object({
  tokenAddress: yup
    .string()
    .test('is-valid-address', 'Please provide a valid token address', (value) => {
      if (!value) return false;
      if (value.toLowerCase() === '0x0000000000000000000000000000000000000000') return true; // ETH
      try {
        return ethers.isAddress(value);
      } catch {
        return false;
      }
    })
    .required('Token address is required'),
  lockDuration: lockDurationSchema,
  initialDeposit: tokenAmountSchema.optional()
});

// Deposit validation
export const depositSchema = yup.object({
  vaultId: yup
    .number()
    .integer('Vault ID must be a valid number')
    .min(0, 'Vault ID must be non-negative')
    .required('Vault ID is required'),
  amount: tokenAmountSchema,
  transactionHash: yup
    .string()
    .matches(/^0x[a-fA-F0-9]{64}$/, 'Please provide a valid transaction hash')
    .required('Transaction hash is required')
});

// Withdrawal validation
export const withdrawalSchema = yup.object({
  vaultId: yup
    .number()
    .integer('Vault ID must be a valid number')
    .min(0, 'Vault ID must be non-negative')
    .required('Vault ID is required'),
  amount: tokenAmountSchema.optional(), // Optional for full withdrawal
  transactionHash: yup
    .string()
    .matches(/^0x[a-fA-F0-9]{64}$/, 'Please provide a valid transaction hash')
    .required('Transaction hash is required')
});

// Notification validation
export const notificationSchema = yup.object({
  type: yup
    .string()
    .oneOf(['vault_maturity', 'deposit_confirmed', 'withdrawal_completed', 'security_alert', 'system_update'])
    .required('Notification type is required'),
  title: yup
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title cannot exceed 200 characters')
    .required('Title is required'),
  message: yup
    .string()
    .min(1, 'Message is required')
    .max(1000, 'Message cannot exceed 1000 characters')
    .required('Message is required'),
  priority: yup
    .string()
    .oneOf(['low', 'medium', 'high'])
    .default('medium'),
  data: yup.object().optional()
});

// Admin validation schemas
export const adminUpdateFeeSchema = yup.object({
  newFeeRate: yup
    .number()
    .min(0, 'Fee rate cannot be negative')
    .max(10000, 'Fee rate cannot exceed 100% (10000 basis points)')
    .integer('Fee rate must be a whole number of basis points')
    .required('Fee rate is required')
});

export const adminUpdateFeeRecipientSchema = yup.object({
  newFeeRecipient: yup
    .string()
    .test('is-valid-address', 'Please provide a valid Ethereum address', (value) => {
      if (!value) return false;
      try {
        return ethers.isAddress(value);
      } catch {
        return false;
      }
    })
    .required('Fee recipient address is required')
});

export const adminUserUpdateSchema = yup.object({
  fullName: yup
    .string()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name cannot exceed 100 characters')
    .trim()
    .optional(),
  email: emailSchema.optional(),
  role: yup
    .string()
    .oneOf(['user', 'admin'], 'Role must be either user or admin')
    .optional(),
  isActive: yup.boolean().optional(),
  walletAddress: yup
    .string()
    .test('is-valid-address', 'Please provide a valid Ethereum address', (value) => {
      if (!value) return true; // Allow empty values
      try {
        return ethers.isAddress(value);
      } catch {
        return false;
      }
    })
    .optional()
});

// Pagination validation
export const paginationSchema = yup.object({
  page: yup
    .mixed()
    .transform((value) => {
      if (value === undefined || value === null || value === '') return 1;
      const num = Number(value);
      return isNaN(num) ? value : num;
    })
    .test('is-number', 'Page must be a number', (value) => typeof value === 'number')
    .test('is-integer', 'Page must be a whole number', (value) => Number.isInteger(value))
    .test('min-value', 'Page must be at least 1', (value) => value >= 1)
    .default(1),
  limit: yup
    .mixed()
    .transform((value) => {
      if (value === undefined || value === null || value === '') return 20;
      const num = Number(value);
      return isNaN(num) ? value : num;
    })
    .test('is-number', 'Limit must be a number', (value) => typeof value === 'number')
    .test('is-integer', 'Limit must be a whole number', (value) => Number.isInteger(value))
    .test('min-value', 'Limit must be at least 1', (value) => value >= 1)
    .test('max-value', 'Limit cannot exceed 100', (value) => value <= 100)
    .default(20),
  sortBy: yup
    .string()
    .oneOf(['createdAt', 'updatedAt', 'unlockTime', 'balance', 'vaultId'])
    .default('createdAt'),
  sortOrder: yup
    .string()
    .oneOf(['asc', 'desc'])
    .default('desc')
});

// Wallet signature validation
export const walletSignatureSchema = yup.object({
  message: yup.string().required('Message is required'),
  signature: yup
    .string()
    .matches(/^0x[a-fA-F0-9]{130}$/, 'Please provide a valid signature')
    .required('Signature is required'),
  address: yup
    .string()
    .test('is-valid-address', 'Please provide a valid Ethereum address', (value) => {
      if (!value) return false;
      try {
        return ethers.isAddress(value);
      } catch {
        return false;
      }
    })
    .required('Wallet address is required')
});

// Custom validation functions
export const validateEthereumAddress = (address) => {
  try {
    return ethers.isAddress(address);
  } catch {
    return false;
  }
};

export const validateTransactionHash = (hash) => {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
};

export const validateTokenAmount = (amount) => {
  try {
    const num = parseFloat(amount);
    return num > 0 && !isNaN(num) && isFinite(num);
  } catch {
    return false;
  }
};

export const validateLockDuration = (days) => {
  return Number.isInteger(days) && days >= 1 && days <= 3650;
};

// Sanitization functions
export const sanitizeEmail = (email) => {
  return email?.toLowerCase().trim();
};

export const sanitizeString = (str, maxLength = 1000) => {
  if (!str) return '';
  return str.trim().substring(0, maxLength);
};

export const sanitizeAddress = (address) => {
  if (!address) return '';
  return ethers.getAddress(address.toLowerCase());
};

// Error formatting
export const formatValidationErrors = (error) => {
  if (error.inner && error.inner.length > 0) {
    return error.inner.map(err => ({
      field: err.path,
      message: err.message
    }));
  }
  
  return [{
    field: error.path || 'general',
    message: error.message || 'Validation failed'
  }];
};

// Middleware for validation
export const validateRequest = (schema) => {
  return async (req, res, next) => {
    try {
      const validatedData = await schema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true
      });
      
      req.validatedData = validatedData;
      next();
    } catch (error) {
      const errors = formatValidationErrors(error);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }
  };
};

export const validateQuery = (schema) => {
  return async (req, res, next) => {
    try {
      const validatedQuery = await schema.validate(req.query, {
        abortEarly: false,
        stripUnknown: true
      });
      
      req.validatedQuery = validatedQuery;
      next();
    } catch (error) {
      const errors = formatValidationErrors(error);
      return res.status(400).json({
        success: false,
        message: 'Query validation failed',
        errors
      });
    }
  };
};

export const validateParams = (schema) => {
  return async (req, res, next) => {
    try {
      const validatedParams = await schema.validate(req.params, {
        abortEarly: false,
        stripUnknown: true
      });
      
      req.validatedParams = validatedParams;
      next();
    } catch (error) {
      const errors = formatValidationErrors(error);
      return res.status(400).json({
        success: false,
        message: 'Parameter validation failed',
        errors
      });
    }
  };
};