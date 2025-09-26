import { ethers } from 'ethers';
import { Vault, User, Notification } from '../models/index.js';
import emailService from './emailService.js';
import dotenv from 'dotenv';

dotenv.config();

// VaultManager ABI - only the events and functions we need
const VAULT_MANAGER_ABI = [
  // Events
  "event VaultCreated(uint256 indexed vaultId, address indexed user, address indexed token, uint256 unlockTime)",
  "event Deposited(uint256 indexed vaultId, address indexed user, address indexed token, uint256 amount)",
  "event Withdrawn(uint256 indexed vaultId, address indexed user, address indexed token, uint256 amount, uint256 platformFee)",
  "event PlatformFeeUpdated(uint256 oldFeeRate, uint256 newFeeRate)",
  "event FeeRecipientUpdated(address oldRecipient, address newRecipient)",
  
  // Read functions
  "function vaults(uint256) view returns (address user, address token, uint256 balance, uint256 unlockTime, bool exists)",
  "function nextVaultId() view returns (uint256)",
  "function platformFeeRate() view returns (uint256)",
  "function feeRecipient() view returns (address)",
  "function owner() view returns (address)",
  "function supportsETH() view returns (bool)"
];

class BlockchainService {
  constructor() {
    this.provider = null;
    this.contract = null;
    this.isListening = false;
    this.lastProcessedBlock = 0;
    this.eventFilters = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000; // 5 seconds
    
    this.initialize();
  }

  async initialize() {
    try {
      // Initialize provider
      this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
      
      // Test connection
      await this.provider.getNetwork();
      console.log('✅ Blockchain provider connected');

      // Initialize contract
      this.contract = new ethers.Contract(
        process.env.CONTRACT_ADDRESS,
        VAULT_MANAGER_ABI,
        this.provider
      );

      // Verify contract exists
      const code = await this.provider.getCode(process.env.CONTRACT_ADDRESS);
      if (code === '0x') {
        throw new Error('Contract not found at the specified address');
      }

      console.log('✅ VaultManager contract initialized');

      // Set up event filters
      this.setupEventFilters();

      // Get the latest block number for starting point
      this.lastProcessedBlock = await this.provider.getBlockNumber();
      console.log(`📦 Starting from block: ${this.lastProcessedBlock}`);

      // Start listening to events
      this.startEventListening();

      // Set up periodic sync for missed events
      this.startPeriodicSync();

    } catch (error) {
      console.error('❌ Blockchain service initialization failed:', error.message);
      this.scheduleReconnect();
    }
  }

  setupEventFilters() {
    this.eventFilters = {
      vaultCreated: this.contract.filters.VaultCreated(),
      deposited: this.contract.filters.Deposited(),
      withdrawn: this.contract.filters.Withdrawn(),
      platformFeeUpdated: this.contract.filters.PlatformFeeUpdated(),
      feeRecipientUpdated: this.contract.filters.FeeRecipientUpdated()
    };
  }

  startEventListening() {
    if (this.isListening) return;

    try {
      // Listen for VaultCreated events
      this.contract.on('VaultCreated', async (vaultId, user, token, unlockTime, event) => {
        await this.handleVaultCreated(vaultId, user, token, unlockTime, event);
      });

      // Listen for Deposited events
      this.contract.on('Deposited', async (vaultId, user, token, amount, event) => {
        await this.handleDeposited(vaultId, user, token, amount, event);
      });

      // Listen for Withdrawn events
      this.contract.on('Withdrawn', async (vaultId, user, token, amount, platformFee, event) => {
        await this.handleWithdrawn(vaultId, user, token, amount, platformFee, event);
      });

      // Listen for PlatformFeeUpdated events
      this.contract.on('PlatformFeeUpdated', async (oldFeeRate, newFeeRate, event) => {
        await this.handlePlatformFeeUpdated(oldFeeRate, newFeeRate, event);
      });

      // Listen for FeeRecipientUpdated events
      this.contract.on('FeeRecipientUpdated', async (oldRecipient, newRecipient, event) => {
        await this.handleFeeRecipientUpdated(oldRecipient, newRecipient, event);
      });

      this.isListening = true;
      this.reconnectAttempts = 0;
      console.log('🎧 Event listeners started');

    } catch (error) {
      console.error('❌ Failed to start event listening:', error.message);
      this.scheduleReconnect();
    }
  }

  async handleVaultCreated(vaultId, user, token, unlockTime, event) {
    try {
      console.log(`📝 VaultCreated: ID=${vaultId}, User=${user}, Token=${token}`);

      // Get token symbol
      const tokenSymbol = await this.getTokenSymbol(token);

      // Create or update vault in database
      const vault = await Vault.findOneAndUpdate(
        { vaultId: vaultId.toString() },
        {
          vaultId: vaultId.toString(),
          userAddress: user.toLowerCase(),
          tokenAddress: token.toLowerCase(),
          tokenSymbol,
          balance: '0',
          unlockTime: new Date(Number(unlockTime) * 1000),
          status: 'active',
          createdAt: new Date(),
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          events: {
            created: {
              blockNumber: event.blockNumber,
              transactionHash: event.transactionHash,
              timestamp: new Date()
            }
          }
        },
        { upsert: true, new: true }
      );

      // Find user and create notification
      const dbUser = await User.findOne({ walletAddress: user.toLowerCase() });
      if (dbUser) {
        await Notification.createNotification(
          dbUser._id,
          user.toLowerCase(),
          'vault_created',
          'Vault Created Successfully',
          `Your new ${tokenSymbol} vault #${vaultId} has been created and will unlock on ${new Date(Number(unlockTime) * 1000).toLocaleDateString()}.`,
          {
            vaultId: vaultId.toString(),
            transactionHash: event.transactionHash,
            tokenSymbol,
            unlockTime: new Date(Number(unlockTime) * 1000),
            actionUrl: `/dashboard`
          }
        );
      }

      console.log(`✅ Vault ${vaultId} created and saved to database`);

    } catch (error) {
      console.error(`❌ Error handling VaultCreated event:`, error);
    }
  }

  async handleDeposited(vaultId, user, token, amount, event) {
    try {
      console.log(`💰 Deposited: VaultID=${vaultId}, User=${user}, Amount=${amount}`);

      // Get token symbol and decimals
      const tokenSymbol = await this.getTokenSymbol(token);
      const tokenDecimals = await this.getTokenDecimals(token);
      const formattedAmount = ethers.formatUnits(amount, tokenDecimals);

      // Find and update vault
      const vault = await Vault.findOne({ vaultId: vaultId.toString() });
      if (!vault) {
        console.error(`❌ Vault ${vaultId} not found for deposit`);
        return;
      }

      // Add deposit to vault
      vault.addDeposit(formattedAmount, event.transactionHash, event.blockNumber);
      await vault.save();

      // Find user and send notifications
      const dbUser = await User.findOne({ walletAddress: user.toLowerCase() });
      if (dbUser) {
        // Create in-app notification
        await Notification.createNotification(
          dbUser._id,
          user.toLowerCase(),
          'deposit_confirmed',
          'Deposit Confirmed',
          `Your deposit of ${formattedAmount} ${tokenSymbol} to vault #${vaultId} has been confirmed.`,
          {
            vaultId: vaultId.toString(),
            transactionHash: event.transactionHash,
            amount: formattedAmount,
            tokenSymbol,
            actionUrl: `/dashboard`
          }
        );

        // Send email notification if enabled
        if (dbUser.notificationPreferences?.email?.deposits) {
          try {
            await emailService.sendDepositConfirmation(
              dbUser,
              vault,
              formattedAmount,
              event.transactionHash
            );
          } catch (emailError) {
            console.error('Failed to send deposit confirmation email:', emailError);
          }
        }
      }

      console.log(`✅ Deposit ${formattedAmount} ${tokenSymbol} processed for vault ${vaultId}`);

    } catch (error) {
      console.error(`❌ Error handling Deposited event:`, error);
    }
  }

  async handleWithdrawn(vaultId, user, token, amount, platformFee, event) {
    try {
      console.log(`💸 Withdrawn: VaultID=${vaultId}, User=${user}, Amount=${amount}, Fee=${platformFee}`);

      // Get token symbol and decimals
      const tokenSymbol = await this.getTokenSymbol(token);
      const tokenDecimals = await this.getTokenDecimals(token);
      const formattedAmount = ethers.formatUnits(amount, tokenDecimals);
      const formattedFee = ethers.formatUnits(platformFee, tokenDecimals);

      // Find and update vault
      const vault = await Vault.findOne({ vaultId: vaultId.toString() });
      if (!vault) {
        console.error(`❌ Vault ${vaultId} not found for withdrawal`);
        return;
      }

      // Add withdrawal to vault
      vault.addWithdrawal(formattedAmount, formattedFee, event.transactionHash, event.blockNumber);
      
      // Update vault status if fully withdrawn
      if (parseFloat(vault.balance) <= 0) {
        vault.status = 'withdrawn';
      }
      
      await vault.save();

      // Find user and send notifications
      const dbUser = await User.findOne({ walletAddress: user.toLowerCase() });
      if (dbUser) {
        // Create in-app notification
        await Notification.createNotification(
          dbUser._id,
          user.toLowerCase(),
          'withdrawal_completed',
          'Withdrawal Completed',
          `Your withdrawal of ${formattedAmount} ${tokenSymbol} from vault #${vaultId} has been completed. Platform fee: ${formattedFee} ${tokenSymbol}.`,
          {
            vaultId: vaultId.toString(),
            transactionHash: event.transactionHash,
            amount: formattedAmount,
            platformFee: formattedFee,
            tokenSymbol,
            actionUrl: `/dashboard`
          }
        );

        // Send email notification if enabled
        if (dbUser.notificationPreferences?.email?.withdrawals) {
          try {
            await emailService.sendWithdrawalConfirmation(
              dbUser,
              vault,
              formattedAmount,
              formattedFee,
              event.transactionHash
            );
          } catch (emailError) {
            console.error('Failed to send withdrawal confirmation email:', emailError);
          }
        }
      }

      console.log(`✅ Withdrawal ${formattedAmount} ${tokenSymbol} processed for vault ${vaultId}`);

    } catch (error) {
      console.error(`❌ Error handling Withdrawn event:`, error);
    }
  }

  async handlePlatformFeeUpdated(oldFeeRate, newFeeRate, event) {
    try {
      console.log(`⚙️ Platform fee updated: ${oldFeeRate} -> ${newFeeRate}`);

      // Create system notification for all admin users
      const adminUsers = await User.find({ role: 'admin' });
      
      for (const admin of adminUsers) {
        await Notification.createNotification(
          admin._id,
          admin.walletAddress,
          'system_update',
          'Platform Fee Updated',
          `Platform fee rate has been updated from ${oldFeeRate} to ${newFeeRate} basis points.`,
          {
            transactionHash: event.transactionHash,
            oldFeeRate: oldFeeRate.toString(),
            newFeeRate: newFeeRate.toString(),
            actionUrl: `/admin/settings`
          },
          'high'
        );
      }

      console.log(`✅ Platform fee update processed`);

    } catch (error) {
      console.error(`❌ Error handling PlatformFeeUpdated event:`, error);
    }
  }

  async handleFeeRecipientUpdated(oldRecipient, newRecipient, event) {
    try {
      console.log(`⚙️ Fee recipient updated: ${oldRecipient} -> ${newRecipient}`);

      // Create system notification for all admin users
      const adminUsers = await User.find({ role: 'admin' });
      
      for (const admin of adminUsers) {
        await Notification.createNotification(
          admin._id,
          admin.walletAddress,
          'system_update',
          'Fee Recipient Updated',
          `Platform fee recipient has been updated to ${newRecipient}.`,
          {
            transactionHash: event.transactionHash,
            oldRecipient,
            newRecipient,
            actionUrl: `/admin/settings`
          },
          'high'
        );
      }

      console.log(`✅ Fee recipient update processed`);

    } catch (error) {
      console.error(`❌ Error handling FeeRecipientUpdated event:`, error);
    }
  }

  async getTokenSymbol(tokenAddress) {
    try {
      // ETH case
      if (tokenAddress === '0x0000000000000000000000000000000000000000') {
        return 'ETH';
      }

      // ERC20 token case
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function symbol() view returns (string)'],
        this.provider
      );

      return await tokenContract.symbol();
    } catch (error) {
      console.error(`Failed to get token symbol for ${tokenAddress}:`, error);
      return 'UNKNOWN';
    }
  }

  async getTokenDecimals(tokenAddress) {
    try {
      // ETH case
      if (tokenAddress === '0x0000000000000000000000000000000000000000') {
        return 18;
      }

      // ERC20 token case
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function decimals() view returns (uint8)'],
        this.provider
      );

      return await tokenContract.decimals();
    } catch (error) {
      console.error(`Failed to get token decimals for ${tokenAddress}:`, error);
      return 18; // Default to 18 decimals
    }
  }

  async syncHistoricalEvents(fromBlock = null) {
    try {
      if (!fromBlock) {
        // Get the deployment block or start from a reasonable block
        fromBlock = this.lastProcessedBlock - 1000; // Go back 1000 blocks
      }

      const toBlock = await this.provider.getBlockNumber();
      console.log(`🔄 Syncing events from block ${fromBlock} to ${toBlock}`);

      // Sync VaultCreated events
      const vaultCreatedEvents = await this.contract.queryFilter(
        this.eventFilters.vaultCreated,
        fromBlock,
        toBlock
      );

      for (const event of vaultCreatedEvents) {
        await this.handleVaultCreated(
          event.args.vaultId,
          event.args.user,
          event.args.token,
          event.args.unlockTime,
          event
        );
      }

      // Sync Deposited events
      const depositedEvents = await this.contract.queryFilter(
        this.eventFilters.deposited,
        fromBlock,
        toBlock
      );

      for (const event of depositedEvents) {
        await this.handleDeposited(
          event.args.vaultId,
          event.args.user,
          event.args.token,
          event.args.amount,
          event
        );
      }

      // Sync Withdrawn events
      const withdrawnEvents = await this.contract.queryFilter(
        this.eventFilters.withdrawn,
        fromBlock,
        toBlock
      );

      for (const event of withdrawnEvents) {
        await this.handleWithdrawn(
          event.args.vaultId,
          event.args.user,
          event.args.token,
          event.args.amount,
          event.args.platformFee,
          event
        );
      }

      this.lastProcessedBlock = toBlock;
      console.log(`✅ Historical sync completed. Processed up to block ${toBlock}`);

    } catch (error) {
      console.error('❌ Error syncing historical events:', error);
    }
  }

  startPeriodicSync() {
    // Sync every 5 minutes to catch any missed events
    setInterval(async () => {
      try {
        const currentBlock = await this.provider.getBlockNumber();
        if (currentBlock > this.lastProcessedBlock) {
          await this.syncHistoricalEvents(this.lastProcessedBlock + 1);
        }
      } catch (error) {
        console.error('❌ Periodic sync error:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached. Manual intervention required.');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;

    console.log(`🔄 Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

    setTimeout(() => {
      this.stopEventListening();
      this.initialize();
    }, delay);
  }

  stopEventListening() {
    if (this.contract && this.isListening) {
      this.contract.removeAllListeners();
      this.isListening = false;
      console.log('🔇 Event listeners stopped');
    }
  }

  async getContractInfo() {
    try {
      const [nextVaultId, platformFeeRate, feeRecipient, owner, supportsETH] = await Promise.all([
        this.contract.nextVaultId(),
        this.contract.platformFeeRate(),
        this.contract.feeRecipient(),
        this.contract.owner(),
        this.contract.supportsETH()
      ]);

      return {
        address: process.env.CONTRACT_ADDRESS,
        nextVaultId: nextVaultId.toString(),
        platformFeeRate: platformFeeRate.toString(),
        feeRecipient,
        owner,
        supportsETH,
        abi: VAULT_MANAGER_ABI
      };
    } catch (error) {
      console.error('❌ Error getting contract info:', error);
      throw error;
    }
  }

  async getVaultInfo(vaultId) {
    try {
      const vaultInfo = await this.contract.vaults(vaultId);
      
      if (!vaultInfo.exists) {
        return null;
      }

      const tokenSymbol = await this.getTokenSymbol(vaultInfo.token);
      const tokenDecimals = await this.getTokenDecimals(vaultInfo.token);

      return {
        vaultId: vaultId.toString(),
        user: vaultInfo.user,
        token: vaultInfo.token,
        tokenSymbol,
        balance: ethers.formatUnits(vaultInfo.balance, tokenDecimals),
        unlockTime: new Date(Number(vaultInfo.unlockTime) * 1000),
        exists: vaultInfo.exists
      };
    } catch (error) {
      console.error(`❌ Error getting vault info for ${vaultId}:`, error);
      throw error;
    }
  }

  // Graceful shutdown
  async shutdown() {
    console.log('🛑 Shutting down blockchain service...');
    this.stopEventListening();
    
    if (this.provider) {
      // Clean up provider if needed
      this.provider = null;
    }
    
    console.log('✅ Blockchain service shutdown complete');
  }
}

// Create singleton instance
const blockchainService = new BlockchainService();

// Graceful shutdown handling
process.on('SIGINT', async () => {
  await blockchainService.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await blockchainService.shutdown();
  process.exit(0);
});

export default blockchainService;