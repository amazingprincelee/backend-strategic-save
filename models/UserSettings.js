import mongoose from 'mongoose';

const userSettingsSchema = new mongoose.Schema({
  // Reference to the user
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },

  // Arbitrage settings
  arbitrage: {
    // Filter settings
    filters: {
      minProfitPercent: {
        type: Number,
        default: 0.001,
        min: 0,
        max: 100
      },
      minVolume: {
        type: Number,
        default: 0.0001,
        min: 0
      },
      includeZeroVolume: {
        type: Boolean,
        default: false
      },
      requireTransferable: {
        type: Boolean,
        default: false
      },
      maxRisk: {
        type: String,
        enum: ['Low', 'Medium', 'High'],
        default: 'High'
      },
      showOnlyProfitable: {
        type: Boolean,
        default: false
      }
    },

    // Display settings
    display: {
      sortBy: {
        type: String,
        enum: ['profitPercent', 'profitDollar', 'volume', 'riskLevel'],
        default: 'profitPercent'
      },
      sortOrder: {
        type: String,
        enum: ['asc', 'desc'],
        default: 'desc'
      },
      pageSize: {
        type: Number,
        default: 25,
        min: 10,
        max: 100
      },
      showOrderBookDepth: {
        type: Boolean,
        default: true
      },
      compactView: {
        type: Boolean,
        default: false
      }
    },

    // Selected exchanges for scanning
    selectedExchanges: [{
      type: String,
      lowercase: true
    }],

    // Favorite coins to prioritize
    favoriteCoins: [{
      type: String,
      uppercase: true
    }],

    // Notification settings
    notifications: {
      enableAlerts: {
        type: Boolean,
        default: false
      },
      minProfitForAlert: {
        type: Number,
        default: 1.0  // 1% profit minimum to trigger alert
      },
      alertFrequency: {
        type: String,
        enum: ['realtime', 'hourly', 'daily'],
        default: 'hourly'
      }
    },

    // Fee customization (user's actual fees on exchanges)
    customFees: [{
      exchange: { type: String, lowercase: true },
      maker: { type: Number, default: 0.1 },
      taker: { type: Number, default: 0.1 }
    }]
  },

  // Vault settings
  vault: {
    defaultLockDuration: {
      type: Number,
      default: 30,  // days
      min: 1
    },
    autoCompound: {
      type: Boolean,
      default: false
    },
    notifications: {
      maturityReminder: {
        type: Boolean,
        default: true
      },
      reminderDaysBefore: {
        type: Number,
        default: 3
      }
    }
  },

  // UI preferences
  ui: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system'
    },
    currency: {
      type: String,
      default: 'USD'
    },
    language: {
      type: String,
      default: 'en'
    },
    timezone: {
      type: String,
      default: 'UTC'
    }
  }
}, {
  timestamps: true
});

// Create or get settings for a user
userSettingsSchema.statics.getOrCreate = async function(userId) {
  let settings = await this.findOne({ userId });

  if (!settings) {
    settings = await this.create({ userId });
  }

  return settings;
};

// Update specific section of settings
userSettingsSchema.methods.updateSection = async function(section, data) {
  if (this[section]) {
    Object.assign(this[section], data);
    return this.save();
  }
  throw new Error(`Invalid settings section: ${section}`);
};

const UserSettings = mongoose.model('UserSettings', userSettingsSchema);

export default UserSettings;
