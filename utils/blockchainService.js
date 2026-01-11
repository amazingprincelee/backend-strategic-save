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
    
    // Rate limiting configuration
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.requestDelay = 200; // 200ms between requests to avoid rate limits
    this.maxRetries = 3;
    this.retryDelay = 2000; // 2 seconds
    
    // Block range configuration for batch processing
    this.batchSize = 50; // Process 50 blocks at a time to avoid rate limits
    this.maxBlockRange = 100; // Maximum blocks to scan in one go
    
    this.initialize();
  }

  /**
   * Delayed request wrapper to prevent rate limiting
   */
  async queueRequest(requestFn, retryCount = 0) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await requestFn();
          resolve(result);
        } catch (error) {
          // Handle rate limiting errors
          if (error.code === 'UNKNOWN_ERROR' || 
              error.message?.includes('Too Many Requests') ||
              error.message?.includes('429') ||
              error.code === -32005) {
            
            if (retryCount < this.maxRetries) {
              console.log(`âš ï¸ Rate limit hit, retrying (${retryCount + 1}/${this.maxRetries})...`);
              await this.delay(this.retryDelay * (retryCount + 1));
              
              // Retry the request
              try {
                const result = await this.queueRequest(requestFn, retryCount + 1);
                resolve(result);
              } catch (retryError) {
                reject(retryError);
              }
            } else {
              console.error('âŒ Max retries reached for request');
              reject(error);
            }
          } else {
            reject(error);
          }
        }
      });

      // Start processing queue if not already processing
      if (!this.isProcessingQueue) {
        this.processQueue();
      }
    });
  }

  /**
   * Process queued requests with delays
   */
  async processQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      await request();
      
      // Delay between requests to avoid rate limiting
      if (this.requestQueue.length > 0) {
        await this.delay(this.requestDelay);
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Simple delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async initialize() {
    // Check if blockchain features should be enabled
    if (process.env.ENABLE_BLOCKCHAIN === 'false') {
      console.log('ℹ️  Blockchain service disabled');
      return;
    }

    try {
      // Initialize provider with retry configuration
      this.provider = new ethers.JsonRpcProvider(
        process.env.RPC_URL,
        undefined,
        {
          staticNetwork: true, // Optimize for static networks
          batchMaxCount: 1 // Disable batching to avoid rate limits
        }
      );
      
      // Test connection
      await this.queueRequest(() => this.provider.getNetwork());
      console.log('âœ… Blockchain provider connected');

      // Initialize contract
      this.contract = new ethers.Contract(
        process.env.CONTRACT_ADDRESS,
        VAULT_MANAGER_ABI,
        this.provider
      );

      // Verify contract exists
      const code = await this.queueRequest(() => 
        this.provider.getCode(process.env.CONTRACT_ADDRESS)
      );
      
      if (code === '0x') {
        throw new Error('Contract not found at the specified address');
      }

      console.log('âœ… VaultManager contract initialized');

      // Set up event filters
      this.setupEventFilters();

      // Get the latest block number for starting point
      const currentBlock = await this.queueRequest(() => this.provider.getBlockNumber());
      
      // Check if we have a saved checkpoint
      const deploymentBlock = parseInt(process.env.CONTRACT_DEPLOYMENT_BLOCK || currentBlock);
      this.lastProcessedBlock = Math.max(deploymentBlock, currentBlock - 100); // Only go back 100 blocks max
      
      console.log(`ðŸ“¦ Starting from block: ${this.lastProcessedBlock}`);

      // Start listening to events
      this.startEventListening();

      // Sync recent historical events (smaller range to avoid rate limits)
      await this.syncRecentEvents();

      // Set up periodic sync for missed events
      this.startPeriodicSync();

    } catch (error) {
      console.log('⚠️  App will continue without blockchain');
      if (!(error.message?.includes('ENOTFOUND') || error.code === 'ENOTFOUND')) {
        this.scheduleReconnect();
      }
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
      console.log('ðŸŽ§ Event listeners started');

    } catch (error) {
      console.error('âŒ Failed to start event listening:', error.message);
      this.scheduleReconnect();
    }
  }

  async handleVaultCreated(vaultId, user, token, unlockTime, event) {
    try {
      console.log(`ðŸ” VaultCreated: ID=${vaultId}, User=${user}, Token=${token}`);

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

      console.log(`âœ… Vault ${vaultId} created and saved to database`);

    } catch (error) {
      console.error(`âŒ Error handling VaultCreated event:`, error);
    }
  }

  async handleDeposited(vaultId, user, token, amount, event) {
    try {
      console.log(`ðŸ’° Deposited: VaultID=${vaultId}, User=${user}, Amount=${amount}`);

      // Get token symbol and decimals
      const tokenSymbol = await this.getTokenSymbol(token);
      const tokenDecimals = await this.getTokenDecimals(token);
      const formattedAmount = ethers.formatUnits(amount, tokenDecimals);

      // Find and update vault
      const vault = await Vault.findOne({ vaultId: vaultId.toString() });
      if (!vault) {
        console.error(`âŒ Vault ${vaultId} not found for deposit`);
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

      console.log(`âœ… Deposit ${formattedAmount} ${tokenSymbol} processed for vault ${vaultId}`);

    } catch (error) {
      console.error(`âŒ Error handling Deposited event:`, error);
    }
  }

  async handleWithdrawn(vaultId, user, token, amount, platformFee, event) {
    try {
      console.log(`ðŸ’¸ Withdrawn: VaultID=${vaultId}, User=${user}, Amount=${amount}, Fee=${platformFee}`);

      // Get token symbol and decimals
      const tokenSymbol = await this.getTokenSymbol(token);
      const tokenDecimals = await this.getTokenDecimals(token);
      const formattedAmount = ethers.formatUnits(amount, tokenDecimals);
      const formattedFee = ethers.formatUnits(platformFee, tokenDecimals);

      // Find and update vault
      const vault = await Vault.findOne({ vaultId: vaultId.toString() });
      if (!vault) {
        console.error(`âŒ Vault ${vaultId} not found for withdrawal`);
        return;
      }

      // Record withdrawal
      vault.addWithdrawal(formattedAmount, formattedFee, event.transactionHash, event.blockNumber);
      await vault.save();

      // Find user and send notifications
      const dbUser = await User.findOne({ walletAddress: user.toLowerCase() });
      if (dbUser) {
        // Create in-app notification
        await Notification.createNotification(
          dbUser._id,
          user.toLowerCase(),
          'withdrawal_confirmed',
          'Withdrawal Successful',
          `You have successfully withdrawn ${formattedAmount} ${tokenSymbol} from vault #${vaultId}. Platform fee: ${formattedFee} ${tokenSymbol}`,
          {
            vaultId: vaultId.toString(),
            transactionHash: event.transactionHash,
            amount: formattedAmount,
            fee: formattedFee,
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

      console.log(`âœ… Withdrawal ${formattedAmount} ${tokenSymbol} processed for vault ${vaultId}`);

    } catch (error) {
      console.error(`âŒ Error handling Withdrawn event:`, error);
    }
  }

  async handlePlatformFeeUpdated(oldFeeRate, newFeeRate, event) {
    try {
      console.log(`ðŸ’³ Platform fee updated: ${oldFeeRate} â†’ ${newFeeRate}`);

      // Notify admin users
      const adminUsers = await User.find({ role: 'admin' });
      
      for (const admin of adminUsers) {
        await Notification.createNotification(
          admin._id,
          admin.walletAddress,
          'system_update',
          'Platform Fee Updated',
          `Platform fee rate has been updated from ${oldFeeRate}% to ${newFeeRate}%.`,
          {
            transactionHash: event.transactionHash,
            oldFeeRate: oldFeeRate.toString(),
            newFeeRate: newFeeRate.toString(),
            actionUrl: `/admin/settings`
          },
          'high'
        );
      }

      console.log(`âœ… Fee update processed`);

    } catch (error) {
      console.error(`âŒ Error handling PlatformFeeUpdated event:`, error);
    }
  }

  async handleFeeRecipientUpdated(oldRecipient, newRecipient, event) {
    try {
      console.log(`ðŸ‘› Fee recipient updated: ${oldRecipient} â†’ ${newRecipient}`);

      // Notify admin users
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

      console.log(`âœ… Fee recipient update processed`);

    } catch (error) {
      console.error(`âŒ Error handling FeeRecipientUpdated event:`, error);
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

      return await this.queueRequest(() => tokenContract.symbol());
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

      return await this.queueRequest(() => tokenContract.decimals());
    } catch (error) {
      console.error(`Failed to get token decimals for ${tokenAddress}:`, error);
      return 18; // Default to 18 decimals
    }
  }

  /**
   * Sync recent events with smaller block range to avoid rate limits
   */
  async syncRecentEvents() {
    try {
      const currentBlock = await this.queueRequest(() => this.provider.getBlockNumber());
      const fromBlock = Math.max(this.lastProcessedBlock, currentBlock - this.maxBlockRange);
      
      await this.syncHistoricalEvents(fromBlock, currentBlock);
      
    } catch (error) {
      console.error('âŒ Error syncing recent events:', error);
    }
  }

  /**
   * Sync historical events in batches to avoid rate limits
   */
  async syncHistoricalEvents(fromBlock, toBlock) {
    try {
      if (!toBlock) {
        toBlock = await this.queueRequest(() => this.provider.getBlockNumber());
      }

      const totalBlocks = toBlock - fromBlock;
      
      // Skip if range is too large
      if (totalBlocks > this.maxBlockRange * 3) {
        console.log(`âš ï¸ Block range too large (${totalBlocks} blocks). Skipping historical sync.`);
        console.log(`ðŸ’¡ Consider setting CONTRACT_DEPLOYMENT_BLOCK in .env to avoid large syncs`);
        this.lastProcessedBlock = toBlock;
        return;
      }

      console.log(`ðŸ”„ Syncing events from block ${fromBlock} to ${toBlock} (${totalBlocks} blocks)`);

      // Process in batches
      for (let startBlock = fromBlock; startBlock <= toBlock; startBlock += this.batchSize) {
        const endBlock = Math.min(startBlock + this.batchSize - 1, toBlock);
        
        console.log(`  ðŸ“Š Processing blocks ${startBlock} to ${endBlock}`);

        try {
          // Sync all event types for this batch
          await this.syncEventBatch(startBlock, endBlock);
          
          // Small delay between batches
          await this.delay(500);
          
        } catch (error) {
          console.error(`  âŒ Error processing batch ${startBlock}-${endBlock}:`, error.message);
          
          // If rate limited, wait longer before next batch
          if (error.message?.includes('Too Many Requests') || error.code === -32005) {
            console.log(`  â³ Rate limited, waiting 5 seconds...`);
            await this.delay(5000);
          }
        }
      }

      this.lastProcessedBlock = toBlock;
      console.log(`âœ… Historical sync completed. Processed up to block ${toBlock}`);

    } catch (error) {
      console.error('âŒ Error syncing historical events:', error);
    }
  }

  /**
   * Sync a single batch of events
   */
  async syncEventBatch(fromBlock, toBlock) {
    // Sync VaultCreated events
    const vaultCreatedEvents = await this.queueRequest(() =>
      this.contract.queryFilter(this.eventFilters.vaultCreated, fromBlock, toBlock)
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
    const depositedEvents = await this.queueRequest(() =>
      this.contract.queryFilter(this.eventFilters.deposited, fromBlock, toBlock)
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
    const withdrawnEvents = await this.queueRequest(() =>
      this.contract.queryFilter(this.eventFilters.withdrawn, fromBlock, toBlock)
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
  }

  /**
   * Periodic sync with rate limiting
    if (!this.provider || !this.contract) return;
   */
  startPeriodicSync() {
    // Sync every 10 minutes to catch any missed events (increased from 5 minutes)
    setInterval(async () => {
      try {
        const currentBlock = await this.queueRequest(() => this.provider.getBlockNumber());
        
        if (currentBlock > this.lastProcessedBlock) {
          const blocksToSync = currentBlock - this.lastProcessedBlock;
          
          // Only sync if there are blocks to process and not too many
          if (blocksToSync <= this.maxBlockRange) {
            await this.syncHistoricalEvents(this.lastProcessedBlock + 1, currentBlock);
          } else {
            console.log(`âš ï¸ Too many blocks to sync (${blocksToSync}). Updating checkpoint.`);
            this.lastProcessedBlock = currentBlock - this.batchSize;
          }
        }
      } catch (error) {
        console.error('âŒ Periodic sync error:', error);
      }
    }, 10 * 60 * 1000); // 10 minutes
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('âŒ Max reconnection attempts reached. Manual intervention required.');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;

    console.log(`ðŸ”„ Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

    setTimeout(() => {
      this.stopEventListening();
      this.initialize();
    }, delay);
  }

  stopEventListening() {
    if (this.contract && this.isListening) {
      this.contract.removeAllListeners();
      this.isListening = false;
      console.log('ðŸ”‡ Event listeners stopped');
    }
  }

  async getContractInfo() {
    try {
      const [nextVaultId, platformFeeRate, feeRecipient, owner, supportsETH] = await Promise.all([
        this.queueRequest(() => this.contract.nextVaultId()),
        this.queueRequest(() => this.contract.platformFeeRate()),
        this.queueRequest(() => this.contract.feeRecipient()),
        this.queueRequest(() => this.contract.owner()),
        this.queueRequest(() => this.contract.supportsETH())
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
      console.error('âŒ Error getting contract info:', error);
      throw error;
    }
  }

  async getVaultInfo(vaultId) {
    try {
      const vaultInfo = await this.queueRequest(() => this.contract.vaults(vaultId));
      
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
      console.error(`âŒ Error getting vault info for ${vaultId}:`, error);
      throw error;
    }
  }

  // Graceful shutdown
  async shutdown() {
    console.log('ðŸ›‘ Shutting down blockchain service...');
    this.stopEventListening();
    
    if (this.provider) {
      // Clean up provider if needed
      this.provider = null;
    }
    
    console.log('âœ… Blockchain service shutdown complete');
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