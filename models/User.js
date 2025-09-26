import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please enter a valid email address'
    ]
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters long'],
    select: false // Don't include password in queries by default
  },
  walletAddress: {
    type: String,
    required: false,
    sparse: true, // Allows multiple null values while maintaining uniqueness for non-null values
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^0x[a-fA-F0-9]{40}$/, 'Please enter a valid Ethereum address']
  },
  profile: {
    firstName: {
      type: String,
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters']
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters']
    },
    avatar: {
      type: String,
      default: null
    }
  },
  preferences: {
    emailNotifications: {
      vaultMatured: { type: Boolean, default: true },
      depositConfirmed: { type: Boolean, default: true },
      withdrawalCompleted: { type: Boolean, default: true },
      platformUpdates: { type: Boolean, default: false }
    },
    inAppNotifications: {
      vaultMatured: { type: Boolean, default: true },
      depositConfirmed: { type: Boolean, default: true },
      withdrawalCompleted: { type: Boolean, default: true },
      platformUpdates: { type: Boolean, default: true }
    }
  },
  lastLogin: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  investments: [{
    vaultId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vault'
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'completed', 'cancelled'],
      default: 'pending'
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    maturityDate: {
      type: Date
    },
    returns: {
      type: Number,
      default: 0
    }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  if (this.profile.firstName && this.profile.lastName) {
    return `${this.profile.firstName} ${this.profile.lastName}`;
  }
  return this.profile.firstName || this.profile.lastName || 'User';
});

// Virtual populate for user's vaults
userSchema.virtual('vaults', {
  ref: 'Vault',
  localField: 'walletAddress',
  foreignField: 'userAddress'
});

// Index for better query performance
userSchema.index({ createdAt: -1 });

const User = mongoose.model('User', userSchema);

export default User;