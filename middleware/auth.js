import { verifyToken, extractTokenFromHeader } from '../utils/jwt.js';
import { User } from '../models/index.js';

// Middleware to authenticate user
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }
    
    // Verify token
    const decoded = verifyToken(token);
    
    // Find user
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }
    
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }
    
    // Attach user to request
    req.user = user;
    req.token = token;
    
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message || 'Invalid token'
    });
  }
};

// Middleware to check if user is verified
export const requireEmailVerification = (req, res, next) => {
  if (!req.user.isEmailVerified) {
    return res.status(403).json({
      success: false,
      message: 'Email verification is required',
      code: 'EMAIL_NOT_VERIFIED'
    });
  }
  
  next();
};

// Middleware to check if user is admin
export const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  
  next();
};

// Middleware to check wallet ownership
export const requireWalletOwnership = (req, res, next) => {
  const { walletAddress } = req.params;
  
  if (!walletAddress) {
    return res.status(400).json({
      success: false,
      message: 'Wallet address is required'
    });
  }
  
  if (req.user.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    return res.status(403).json({
      success: false,
      message: 'Access denied: wallet address mismatch'
    });
  }
  
  next();
};

// Optional authentication middleware (doesn't fail if no token)
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);
    
    if (token) {
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.id).select('-password');
      
      if (user && user.isActive) {
        req.user = user;
        req.token = token;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

// Rate limiting by user
export const rateLimitByUser = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const requests = new Map();
  
  return (req, res, next) => {
    const userId = req.user?.id || req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Clean old entries
    for (const [key, timestamps] of requests.entries()) {
      const validTimestamps = timestamps.filter(timestamp => timestamp > windowStart);
      if (validTimestamps.length === 0) {
        requests.delete(key);
      } else {
        requests.set(key, validTimestamps);
      }
    }
    
    // Check current user's requests
    const userRequests = requests.get(userId) || [];
    const validUserRequests = userRequests.filter(timestamp => timestamp > windowStart);
    
    if (validUserRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests, please try again later',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
    
    // Add current request
    validUserRequests.push(now);
    requests.set(userId, validUserRequests);
    
    next();
  };
};

// Middleware to validate wallet signature (for additional security)
export const validateWalletSignature = async (req, res, next) => {
  try {
    const { signature, message, walletAddress } = req.body;
    
    if (!signature || !message || !walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Signature, message, and wallet address are required'
      });
    }
    
    // Import ethers for signature verification
    const { ethers } = await import('ethers');
    
    // Verify signature
    const recoveredAddress = ethers.verifyMessage(message, signature);
    
    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid wallet signature'
      });
    }
    
    // Check if message is recent (within 5 minutes)
    const messageTimestamp = parseInt(message.split('Timestamp: ')[1]);
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    
    if (now - messageTimestamp > fiveMinutes) {
      return res.status(401).json({
        success: false,
        message: 'Signature has expired'
      });
    }
    
    req.verifiedWallet = walletAddress.toLowerCase();
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Signature verification failed'
    });
  }
};

export default {
  authenticate,
  requireEmailVerification,
  requireAdmin,
  requireWalletOwnership,
  optionalAuth,
  rateLimitByUser,
  validateWalletSignature
};