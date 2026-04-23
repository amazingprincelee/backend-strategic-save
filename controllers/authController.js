import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { generateAccessToken, generateRefreshToken, verifyToken } from '../utils/jwt.js';
import {
  userRegistrationSchema,
  userLoginSchema,
  profileUpdateSchema
} from '../utils/validation.js';

// ─── Google OAuth helpers ─────────────────────────────────────────────────────

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USER_URL  = 'https://www.googleapis.com/oauth2/v3/userinfo';

function buildGoogleRedirectUri() {
  // Use the backend URL for the callback — Google calls this server-side
  const base = process.env.API_URL || `http://localhost:${process.env.PORT || 5000}`;
  return `${base}/api/auth/google/callback`;
}

// GET /api/auth/google — redirect user to Google consent screen
export const googleAuth = (req, res) => {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  buildGoogleRedirectUri(),
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'online',
    prompt:        'select_account',
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
};

// GET /api/auth/google/callback — Google redirects here with ?code=
export const googleCallback = async (req, res) => {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  try {
    const { code } = req.query;
    if (!code) throw new Error('No code from Google');

    // Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  buildGoogleRedirectUri(),
        grant_type:    'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Token exchange failed');

    // Fetch user info from Google
    const userRes  = await fetch(GOOGLE_USER_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userRes.json();
    if (!googleUser.email) throw new Error('Could not get email from Google');

    // Find existing user by googleId or email
    let user = await User.findOne({
      $or: [
        { googleId: googleUser.sub },
        { email: googleUser.email.toLowerCase() },
      ],
    });

    if (user) {
      // Link Google ID if not already set
      if (!user.googleId) {
        user.googleId     = googleUser.sub;
        user.authProvider = 'google';
        await user.save();
      }
    } else {
      // Create new user from Google profile
      const googleTrialEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      user = new User({
        email:        googleUser.email.toLowerCase(),
        fullName:     googleUser.name || '',
        googleId:     googleUser.sub,
        authProvider: 'google',
        role:         'user',
        subscription: { plan: 'free', status: 'trial', startedAt: new Date(), expiresAt: googleTrialEnd },
        password:     await bcrypt.hash(googleUser.sub + process.env.JWT_SECRET, 10),
      });
      await user.save();
    }

    user.lastLogin = new Date();
    await user.save();

    // Issue our JWT
    const accessToken  = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Redirect to frontend callback page with tokens in query params
    const params = new URLSearchParams({
      token:        accessToken,
      refreshToken,
      userId:       user._id.toString(),
      email:        user.email,
      role:         user.role,
      fullName:     user.fullName || '',
    });
    res.redirect(`${clientUrl}/auth/callback?${params}`);
  } catch (err) {
    console.error('[Google OAuth] Callback error:', err.message);
    res.redirect(`${clientUrl}/login?error=google_auth_failed`);
  }
};

// Register new user
export const register = async (req, res) => {
 
  try {
    const { email, password, fullName, referralCode } = req.body;

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


    // Validate referral code (if provided)
    let referredBy = null;
    if (referralCode) {
      const referrer = await User.findOne({ 'referral.code': referralCode.toUpperCase().trim() });
      if (referrer) referredBy = referralCode.toUpperCase().trim();
    }

    // 3-day free trial for all new users
    const trialEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    // Create new user
    const userObj = {
      email: email.toLowerCase(),
      password: hashedPassword,
      fullName,
      role: 'user',
      subscription: {
        plan:      'free',
        status:    'trial',
        startedAt: new Date(),
        expiresAt: trialEnd,
      },
      ...(referredBy ? { referral: { referredBy } } : {}),
    };


    const user = new User(userObj);

    await user.save();

    // If referred, add this user to the referrer's referral list
    if (referredBy) {
      await User.findOneAndUpdate(
        { 'referral.code': referredBy },
        { $push: { 'referral.referrals': user._id } }
      );
    }

    // Generate JWT tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Remove sensitive data from response
    const userResponse = {
      id: user._id,
      email: user.email,
      profile: user.profile,
      role: user.role,
      subscription: user.subscription,
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
      subscription: user.subscription,
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
      subscription: user.subscription,
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
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, message: 'Logout failed' });
  }
};

// Activate a pending free trial via claim token
export const activateTrial = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token is required' });

    // Verify the JWT claim token
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      const expired = e.name === 'TokenExpiredError';
      return res.status(400).json({
        success: false,
        code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
        message: expired ? 'This trial link has expired.' : 'Invalid trial link.',
      });
    }

    if (payload.type !== 'trial_claim') {
      return res.status(400).json({ success: false, code: 'TOKEN_INVALID', message: 'Invalid trial link.' });
    }

    const user = await User.findById(payload.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Check the stored token matches (one-time use guard)
    if (!user.pendingTrial?.token || user.pendingTrial.token !== token) {
      return res.status(400).json({
        success: false,
        code: 'ALREADY_CLAIMED',
        message: 'This trial has already been activated or the link is no longer valid.',
      });
    }

    // Check claim window
    if (new Date() > new Date(user.pendingTrial.claimExpiresAt)) {
      return res.status(400).json({ success: false, code: 'TOKEN_EXPIRED', message: 'This trial link has expired.' });
    }

    const trialDays = user.pendingTrial.days;
    const now       = new Date();
    const expiresAt = new Date(now.getTime() + trialDays * 86400000);

    // Activate trial
    user.subscription.plan      = 'free';
    user.subscription.status    = 'trial';
    user.subscription.startedAt = now;
    user.subscription.expiresAt = expiresAt;

    // Consume the pending trial (one-time use)
    user.pendingTrial = {
      token: null, days: null, note: null,
      grantedByAdmin: null, grantedAt: null, claimExpiresAt: null,
    };

    await user.save();

    // Return fresh tokens so UI can update immediately if user is logged in
    const accessToken  = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    res.json({
      success: true,
      message: `Your ${trialDays}-day premium trial is now active!`,
      data: {
        trialDays,
        expiresAt,
        tokens: { accessToken, refreshToken },
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          subscription: user.subscription,
        },
      },
    });
  } catch (error) {
    console.error('activateTrial error:', error);
    res.status(500).json({ success: false, message: 'Failed to activate trial' });
  }
};