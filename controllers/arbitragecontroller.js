import ccxt from "ccxt";
import { 
  getCachedOpportunities, 
  refreshOpportunities,
  isCacheReady 
} from "../services/Arbitrage/fetchPrices.js";

// Get all exchanges that is listed on ccxt
export const fetchExchanges = async (req, res) => {
  try {
    const exchanges = await ccxt.exchanges;
    
    return res.status(200).json({ exchanges: exchanges });
    
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
}

// Get arbitrage opportunities from cache
export const getArbitrageOpportunities = async (req, res) => {
  try {
    console.log('📡 API request received for arbitrage opportunities');
    
    const cacheData = getCachedOpportunities();
    
    // Check if cache is ready
    if (!isCacheReady() && !cacheData.isLoading) {
      return res.status(503).json({
        success: false,
        message: 'Arbitrage service is initializing. Please try again in a few moments.',
        isLoading: false,
        error: cacheData.error || 'Service not initialized'
      });
    }
    
    // If currently loading and no cached data
    if (cacheData.isLoading && cacheData.opportunities.length === 0) {
      return res.status(202).json({
        success: false,
        message: 'Arbitrage opportunities are currently being loaded. Please try again later.',
        isLoading: true,
        estimatedWaitTime: '2-5 minutes',
        retryAfter: 60 // seconds
      });
    }
    
    // Return cached data (even if currently refreshing)
    res.json({
      success: true,
      count: cacheData.opportunities.length,
      data: cacheData.opportunities,
      metadata: {
        lastUpdate: cacheData.lastUpdate,
        nextUpdate: cacheData.nextUpdate,
        isRefreshing: cacheData.isLoading,
        dataAge: cacheData.lastUpdate 
          ? Math.floor((Date.now() - cacheData.lastUpdate.getTime()) / 1000) 
          : null,
        dataAgeFormatted: cacheData.lastUpdate 
          ? formatTimeSince(cacheData.lastUpdate) 
          : 'N/A'
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching opportunities:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Manual refresh endpoint (optional - use with caution)
export const refreshArbitrageOpportunities = async (req, res) => {
  try {
    console.log('🔄 Manual refresh requested');
    
    const cacheData = getCachedOpportunities();
    
    // Prevent multiple simultaneous refreshes
    if (cacheData.isLoading) {
      return res.status(429).json({
        success: false,
        message: 'A refresh is already in progress. Please wait.',
        isLoading: true
      });
    }
    
    // Trigger refresh in background
    refreshOpportunities().catch(err => {
      console.error('Error during manual refresh:', err);
    });
    
    res.json({
      success: true,
      message: 'Refresh started. Data will be updated in a few minutes.',
      isLoading: true,
      estimatedTime: '2-5 minutes'
    });
    
  } catch (error) {
    console.error('❌ Error triggering refresh:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get service status
export const getArbitrageStatus = async (req, res) => {
  try {
    const cacheData = getCachedOpportunities();
    
    res.json({
      success: true,
      status: {
        isReady: isCacheReady(),
        isLoading: cacheData.isLoading,
        opportunitiesCount: cacheData.opportunities.length,
        lastUpdate: cacheData.lastUpdate,
        nextUpdate: cacheData.nextUpdate,
        dataAge: cacheData.lastUpdate 
          ? Math.floor((Date.now() - cacheData.lastUpdate.getTime()) / 1000) 
          : null,
        error: cacheData.error
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Helper function to format time
function formatTimeSince(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  
  if (seconds < 60) return `${seconds} seconds ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}