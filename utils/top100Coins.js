/**
 * Arbitrage Fallback Pair List
 *
 * Used when dynamic pair discovery (DynamicPairDiscovery.js) fails or is warming up.
 *
 * Selection criteria — coins that are GOOD for arbitrage:
 *   ✅ Listed on only 2–4 of our 8 exchanges (not all of them — fewer bots watching)
 *   ✅ Mid/small market cap ($10M–$2B) — slower price convergence between exchanges
 *   ✅ Enough daily volume for $25–$500 trades
 *   ❌ NOT BTC, ETH, SOL, BNB — those are watched by every HFT bot on earth
 *
 * The dynamic discovery system finds these automatically anyway.
 * This list is just a reliable backup.
 */
export const TOP_100_PAIRS = [

  // ── DeFi protocols (often priced differently across smaller exchanges) ────
  'PENDLE/USDT',  // Pendle — yield trading, not on all exchanges
  'GMX/USDT',     // GMX — perp DEX, primarily on certain CEXs
  'DYDX/USDT',    // dYdX — governance token
  'CRV/USDT',     // Curve DAO
  'SNX/USDT',     // Synthetix
  'BAL/USDT',     // Balancer
  'COMP/USDT',    // Compound
  'AAVE/USDT',    // Aave
  'LDO/USDT',     // Lido DAO
  'LQTY/USDT',    // Liquity — very few exchanges list this
  'YFI/USDT',     // yearn.finance
  '1INCH/USDT',   // 1inch aggregator
  'MKR/USDT',     // Maker
  'UNI/USDT',     // Uniswap

  // ── Layer 2 / newer infrastructure (selective exchange listings) ──────────
  'ARB/USDT',     // Arbitrum
  'OP/USDT',      // Optimism
  'STRK/USDT',    // Starknet — newer, not on all exchanges yet
  'MANTA/USDT',   // Manta Network
  'ZK/USDT',      // zkSync — newer listing
  'ZRO/USDT',     // LayerZero
  'W/USDT',       // Wormhole
  'SEI/USDT',     // Sei Network
  'TIA/USDT',     // Celestia
  'ALT/USDT',     // AltLayer

  // ── Solana ecosystem (priced differently away from Binance-centric chains) ─
  'JUP/USDT',     // Jupiter — Solana DEX aggregator
  'PYTH/USDT',    // Pyth Network
  'WIF/USDT',     // dogwifhat
  'BONK/USDT',    // Bonk
  'BOME/USDT',    // Book of Meme
  'NOT/USDT',     // Notcoin (Telegram)

  // ── AI / data tokens (fast-growing, selective listings) ──────────────────
  'FET/USDT',     // Fetch.ai / ASI
  'OCEAN/USDT',   // Ocean Protocol
  'RENDER/USDT',  // Render Token
  'TAO/USDT',     // Bittensor
  'BAND/USDT',    // Band Protocol
  'IO/USDT',      // io.net

  // ── Restaking / yield (newer category, fewer exchange listings) ───────────
  'ETHFI/USDT',   // ether.fi
  'ENA/USDT',     // Ethena
  'ONDO/USDT',    // Ondo Finance — RWA token
  'LISTA/USDT',   // Lista DAO

  // ── NFT / gaming (thin liquidity across exchanges) ────────────────────────
  'BLUR/USDT',    // Blur NFT marketplace
  'IMX/USDT',     // Immutable X
  'PIXEL/USDT',   // Pixels

  // ── Older L1 chains (less attention, selective exchange listings) ──────────
  'ICX/USDT',     // ICON — few exchanges
  'KAVA/USDT',    // Kava
  'ROSE/USDT',    // Oasis Network
  'ZIL/USDT',     // Zilliqa
  'MINA/USDT',    // Mina Protocol
  'FLOW/USDT',    // Flow blockchain
  'KSM/USDT',     // Kusama
  'ALGO/USDT',    // Algorand
  'VET/USDT',     // VeChain
  'HBAR/USDT',    // Hedera

  // ── Infrastructure / storage (niche, less bot coverage) ───────────────────
  'STORJ/USDT',   // Storj decentralized storage
  'ANKR/USDT',    // Ankr network
  'CELR/USDT',    // Celer Network
  'RSR/USDT',     // Reserve Rights
  'ACH/USDT',     // Alchemy Pay
  'OGN/USDT',     // Origin Protocol
  'DUSK/USDT',    // Dusk Network — very few exchanges
  'VELO/USDT',    // Velo

  // ── Mid-cap with decent volume but fewer arbitrageurs ─────────────────────
  'INJ/USDT',     // Injective
  'RUNE/USDT',    // THORChain — unique cross-chain pricing
  'GRT/USDT',     // The Graph
  'STX/USDT',     // Stacks (Bitcoin L2)
  'FIL/USDT',     // Filecoin
  'ATOM/USDT',    // Cosmos
  'NEAR/USDT',    // NEAR Protocol
  'APT/USDT',     // Aptos
  'SUI/USDT',     // Sui
  'FTM/USDT',     // Fantom
  'ICP/USDT',     // Internet Computer
  'WLD/USDT',     // Worldcoin
  'PEPE/USDT',    // Pepe
  'THETA/USDT',   // Theta Network
  'XLM/USDT',     // Stellar
  'ETC/USDT',     // Ethereum Classic
];
