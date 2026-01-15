import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import { generateAccessToken, generateRefreshToken, verifyToken } from '../utils/jwt.js';
import {
  userRegistrationSchema,
  userLoginSchema,
  profileUpdateSchema
} from '../utils/validation.js';

// Register new user
export const register = async (req, res) => {
 
  try {
    const { email, password, fullName} = req.body;

    // Check if user already exists by email
    const existingUserByEmail = await User.findOne({ email: email.toLowerCase() });
    if (existingUserByEmail) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists'
      });
    }


    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);


    // Create new user
    const userObj = {
      email: email.toLowerCase(),
      password: hashedPassword,
      profile: {
        fullName,
      },
      role: 'user'
    };


    const user = new User(userObj);

    await user.save();

    // Generate JWT tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Remove sensitive data from response
    const userResponse = {
      id: user._id,
      email: user.email,
      profile: user.profile,
      role: user.role,
      createdAt: user.createdAt
    };

    res.status(201).json({
      success: true,
      message: 'Account created successfully! You can now log in.',
      data: {
        user: userResponse,
        tokens: {
          accessToken,
          refreshToken
        }
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.'
    });
  }
};

// Login user
export const login = async (req, res) => {
   console.log("I got hit o");
  try {
    // Validate request data
    const validatedData = await userLoginSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    const { email, password } = validatedData;

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Remove sensitive data from response
    const userResponse = {
      id: user._id,
      email: user.email,
      walletAddress: user.walletAddress,
      profile: user.profile,
      role: user.role,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt
    };

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: userResponse,
        tokens: {
          accessToken,
          refreshToken
        }
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    
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
      message: 'Login failed. Please try again.'
    });
  }
};

// Refresh token
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const decoded = verifyToken(refreshToken, 'refresh');
    
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Find user
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate new tokens
    const accessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        tokens: {
          accessToken,
          refreshToken: newRefreshToken
        }
      }
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({
      success: false,
      message: 'Token refresh failed'
    });
  }
};

// Get user profile
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Remove sensitive data from response
    const userResponse = {
      id: user._id,
      email: user.email,
      walletAddress: user.walletAddress,
      profile: user.profile,
      preferences: user.preferences,
      role: user.role,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    res.json({
      success: true,
      data: {
        user: userResponse
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
};

// Update user profile
export const updateProfile = async (req, res) => {
  try {
    // Validate request data
    const validatedData = await profileUpdateSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update profile fields
    if (validatedData.firstName !== undefined) {
      user.profile.firstName = validatedData.firstName;
    }
    if (validatedData.lastName !== undefined) {
      user.profile.lastName = validatedData.lastName;
    }
    if (validatedData.avatar !== undefined) {
      user.profile.avatar = validatedData.avatar;
    }

    // Update preferences if provided
    if (validatedData.preferences) {
      if (validatedData.preferences.emailNotifications) {
        user.preferences.emailNotifications = {
          ...user.preferences.emailNotifications,
          ...validatedData.preferences.emailNotifications
        };
      }
      if (validatedData.preferences.inAppNotifications) {
        user.preferences.inAppNotifications = {
          ...user.preferences.inAppNotifications,
          ...validatedData.preferences.inAppNotifications
        };
      }
    }

    await user.save();

    // Remove sensitive data from response
    const userResponse = {
      id: user._id,
      email: user.email,
      walletAddress: user.walletAddress,
      profile: user.profile,
      preferences: user.preferences,
      role: user.role,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: userResponse
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    
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
      message: 'Profile update failed'
    });
  }
};

// Logout user
export const logout = async (req, res) => {
  try {
    // In a real application, you might want to blacklist the token
    // For now, we'll just return a success response
    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};