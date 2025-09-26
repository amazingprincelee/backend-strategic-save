import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

// Generate JWT token
export const generateToken = (payload) => {
  try {
    return jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRE,
      issuer: 'strategic-crypto-save',
      audience: 'strategic-crypto-save-users'
    });
  } catch (error) {
    throw new Error(`Token generation failed: ${error.message}`);
  }
};

// Verify JWT token
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: 'strategic-crypto-save',
      audience: 'strategic-crypto-save-users'
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    } else {
      throw new Error(`Token verification failed: ${error.message}`);
    }
  }
};

// Generate access token for user
export const generateAccessToken = (user) => {
  const payload = {
    id: user._id,
    email: user.email,
    walletAddress: user.walletAddress,
    role: user.role,
    isEmailVerified: user.isEmailVerified
  };
  
  return generateToken(payload);
};

// Generate refresh token
export const generateRefreshToken = (user) => {
  const payload = {
    id: user._id,
    type: 'refresh'
  };
  
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '30d',
    issuer: 'strategic-crypto-save',
    audience: 'strategic-crypto-save-users'
  });
};

// Decode token without verification (for expired tokens)
export const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    throw new Error(`Token decode failed: ${error.message}`);
  }
};

// Check if token is expired
export const isTokenExpired = (token) => {
  try {
    const decoded = decodeToken(token);
    if (!decoded || !decoded.exp) {
      return true;
    }
    
    const currentTime = Math.floor(Date.now() / 1000);
    return decoded.exp < currentTime;
  } catch (error) {
    return true;
  }
};

// Extract token from Authorization header
export const extractTokenFromHeader = (authHeader) => {
  if (!authHeader) {
    return null;
  }
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }
  
  return parts[1];
};

export default {
  generateToken,
  verifyToken,
  generateAccessToken,
  generateRefreshToken,
  decodeToken,
  isTokenExpired,
  extractTokenFromHeader
};