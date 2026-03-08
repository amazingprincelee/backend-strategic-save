/**
 * Strategy catalog - static metadata about all available strategies.
 * No database required.
 */

const STRATEGY_CATALOG = [
  {
    id: 'smart_signal',
    name: 'SmartSignal Bot',
    description: 'Automatically trades the highest-confidence signals from SmartStrategy\'s signal engine — across any pair on your connected exchange. No fixed pair needed. Checks for new opportunities every 5 minutes and enters trades that meet your confidence threshold.',
    riskLevel: 'low',
    timeframe: '5m',
    supportedMarkets: ['spot', 'futures'],
    isDefault: true,
    bestFor: ['Signal-based trading', 'Hands-free automation', 'Consistent R:R management'],
    defaultParams: {
      minConfidencePercent:  70,
      maxConcurrentTrades:   2,
      riskPerTrade:          2,
      signalMaxAgeMinutes:   20,
      leverage:              3,
    }
  },
  {
    id: 'swing_rider',
    name: 'Swing Rider Bot',
    description: 'Reads live price structure — swing highs and swing lows — to identify exactly where the market has been bouncing. Enters near support, targets the next resistance, and scales in if price dips further. Adapts automatically to uptrends, downtrends, and ranging markets.',
    riskLevel: 'medium',
    timeframe: '15m',
    supportedMarkets: ['spot', 'futures'],
    isDefault: false,
    bestFor: ['Price-action trading', 'Range & trend markets', 'Smart entries with scale-in'],
    defaultParams: {
      swingLookback:        5,
      maxScaleIns:          2,
      scaleInAtrMultiplier: 1.5,
      riskPerEntry:         1,
      minRR:                1.5,
      leverage:             3,
    }
  },
  {
    id: 'dca',
    name: 'Simple DCA',
    description: 'Buys a fixed dollar amount at regular time intervals regardless of price. Simple, proven, and effective for long-term accumulation on a specific pair. Supports futures with configurable leverage.',
    riskLevel: 'low',
    timeframe: '4h',
    supportedMarkets: ['spot', 'futures'],
    isDefault: false,
    bestFor: ['Long-term accumulation', 'Beginners', 'Passive investing'],
    defaultParams: {
      dcaIntervalHours:       24,
      dcaAmountPerOrder:      100,
      fixedTakeProfitPercent: 2.0,
      stopLossAtrMultiplier:  3.0,
      leverage:               1,
    }
  },
];

export const getStrategyCatalog = (req, res) => {
  res.json({
    success: true,
    data: {
      strategies: STRATEGY_CATALOG,
      count: STRATEGY_CATALOG.length
    }
  });
};

export const getStrategyById = (req, res) => {
  const strategy = STRATEGY_CATALOG.find(s => s.id === req.params.id);
  if (!strategy) {
    return res.status(404).json({ success: false, message: 'Strategy not found' });
  }
  res.json({ success: true, data: { strategy } });
};
