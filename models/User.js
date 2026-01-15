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
    lowercase: true,
    trim: true,
    match: [/^0x[a-fA-F0-9]{40}$/, 'Please enter a valid Ethereum address']
  },

  fullName: {
      type: String,
      trim: true,
      maxlength: [50, 'Full name cannot exceed 50 characters']
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