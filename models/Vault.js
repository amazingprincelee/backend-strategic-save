import mongoose from 'mongoose';

const depositSchema = new mongoose.Schema({
  amount: {
    type: String, // Store as string to handle BigNumber precision
    required: true
  },
  transactionHash: {
    type: String,
    required: true,
    unique: true
  },
  blockNumber: {
    type: Number,
    required: true
  },
  timestamp: {
    type: Date,
    required: true
  },
  gasUsed: {
    type: String,
    default: '0'
  },
  gasFee: {
    type: String,
    default: '0'
  }
}, {
  _id: true,
  timestamps: true
});

const withdrawalSchema = new mongoose.Schema({
  amount: {
    type: String, // Store as string to handle BigNumber precision
    required: true
  },
  platformFee: {
    type: String,
    required: true,
    default: '0'
  },
  netAmount: {
    type: String,
    required: true
  },
  transactionHash: {
    type: String,
    required: true,
    unique: true
  },
  blockNumber: {
    type: Number,
    required: true
  },
  timestamp: {
    type: Date,
    required: true
  },
  gasUsed: {
    type: String,
    default: '0'
  },
  gasFee: {
    type: String,
    default: '0'
  }
}, {
  _id: true,
  timestamps: true
});

const vaultSchema = new mongoose.Schema({
  vaultId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  userAddress: {
    type: String,
    required: [true, 'User address is required'],
    lowercase: true,
    trim: true,
    match: [/^0x[a-fA-F0-9]{40}$/, 'Please enter a valid Ethereum address'],
    index: true
  },
  tokenAddress: {
    type: String,
    required: [true, 'Token address is required'],
    lowercase: true,
    trim: true,
    match: [/^0x[a-fA-F0-9]{40}$/, 'Please enter a valid token address']
  },
  tokenSymbol: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },
  tokenDecimals: {
    type: Number,
    required: true,
    min: 0,
    max: 18
  },
  balance: {
    type: String, // Store as string to handle BigNumber precision
    required: true,
    default: '0'
  },
  lockDuration: {
    type: Number, // Duration in seconds
    required: true,
    min: 86400, // 1 day minimum
    max: 315360000 // 10 years maximum
  },
  unlockTime: {
    type: Date,
    required: true,
    index: true
  },
  createdAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  isWithdrawn: {
    type: Boolean,
    default: false,
    index: true
  },
  withdrawnAt: {
    type: Date,
    default: null
  },
  deposits: [depositSchema],
  withdrawals: [withdrawalSchema],
  
  // Blockchain event tracking
  creationTransactionHash: {
    type: String,
    required: true
  },
  creationBlockNumber: {
    type: Number,
    required: true
  },
  
  // Metadata
  status: {
    type: String,
    enum: ['active', 'unlocked', 'withdrawn', 'emergency'],
    default: 'active',
    index: true
  },
  
  // Notification tracking
  notifications: {
    maturityNotificationSent: {
      type: Boolean,
      default: false
    },
    reminderNotificationSent: {
      type: Boolean,
      default: false
    },
    lastNotificationDate: {
      type: Date,
      default: null
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for checking if vault is unlocked
vaultSchema.virtual('isUnlocked').get(function() {
  return new Date() >= this.unlockTime && !this.isWithdrawn;
});

// Virtual for time remaining until unlock
vaultSchema.virtual('timeUntilUnlock').get(function() {
  const now = new Date();
  const unlockTime = new Date(this.unlockTime);
  
  if (now >= unlockTime) {
    return 0;
  }
  
  return Math.max(0, unlockTime.getTime() - now.getTime());
});

// Virtual for total deposited amount
vaultSchema.virtual('totalDeposited').get(function() {
  return this.deposits.reduce((total, deposit) => {
    return (BigInt(total) + BigInt(deposit.amount)).toString();
  }, '0');
});

// Virtual for total withdrawn amount
vaultSchema.virtual('totalWithdrawn').get(function() {
  return this.withdrawals.reduce((total, withdrawal) => {
    return (BigInt(total) + BigInt(withdrawal.amount)).toString();
  }, '0');
});

// Virtual for total platform fees paid
vaultSchema.virtual('totalPlatformFees').get(function() {
  return this.withdrawals.reduce((total, withdrawal) => {
    return (BigInt(total) + BigInt(withdrawal.platformFee)).toString();
  }, '0');
});

// Virtual for days until unlock
vaultSchema.virtual('daysUntilUnlock').get(function() {
  const timeRemaining = this.timeUntilUnlock;
  return Math.ceil(timeRemaining / (1000 * 60 * 60 * 24));
});

// Virtual for lock duration in days
vaultSchema.virtual('lockDurationDays').get(function() {
  return Math.ceil(this.lockDuration / 86400);
});

// Indexes for better query performance
vaultSchema.index({ userAddress: 1, createdAt: -1 });
vaultSchema.index({ unlockTime: 1, isWithdrawn: 1 });
vaultSchema.index({ status: 1 });
vaultSchema.index({ tokenAddress: 1 });
vaultSchema.index({ 'notifications.maturityNotificationSent': 1, unlockTime: 1 });

// Pre-save middleware to update status
vaultSchema.pre('save', function(next) {
  const now = new Date();
  
  if (this.isWithdrawn) {
    this.status = 'withdrawn';
  } else if (now >= this.unlockTime) {
    this.status = 'unlocked';
  } else {
    this.status = 'active';
  }
  
  next();
});

// Static method to find vaults ready for maturity notification
vaultSchema.statics.findVaultsForMaturityNotification = function() {
  const now = new Date();
  const reminderTime = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now
  
  return this.find({
    unlockTime: { $lte: reminderTime },
    isWithdrawn: false,
    'notifications.maturityNotificationSent': false
  });
};

// Static method to find unlocked vaults
vaultSchema.statics.findUnlockedVaults = function() {
  const now = new Date();
  
  return this.find({
    unlockTime: { $lte: now },
    isWithdrawn: false
  });
};

// Static method to get user vault statistics
vaultSchema.statics.getUserStats = function(userAddress) {
  return this.aggregate([
    { $match: { userAddress: userAddress.toLowerCase() } },
    {
      $group: {
        _id: null,
        totalVaults: { $sum: 1 },
        activeVaults: {
          $sum: {
            $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
          }
        },
        unlockedVaults: {
          $sum: {
            $cond: [{ $eq: ['$status', 'unlocked'] }, 1, 0]
          }
        },
        withdrawnVaults: {
          $sum: {
            $cond: [{ $eq: ['$status', 'withdrawn'] }, 1, 0]
          }
        },
        totalBalance: {
          $sum: {
            $toDouble: '$balance'
          }
        }
      }
    }
  ]);
};

// Instance method to add deposit
vaultSchema.methods.addDeposit = function(depositData) {
  this.deposits.push(depositData);
  this.balance = (BigInt(this.balance) + BigInt(depositData.amount)).toString();
  return this.save();
};

// Instance method to add withdrawal
vaultSchema.methods.addWithdrawal = function(withdrawalData) {
  this.withdrawals.push(withdrawalData);
  this.balance = '0'; // Vault is emptied on withdrawal
  this.isWithdrawn = true;
  this.withdrawnAt = new Date();
  this.status = 'withdrawn';
  return this.save();
};

const Vault = mongoose.model('Vault', vaultSchema);

export default Vault;