const logger = require('../../utils/logger');

/**
 * Chain Detector Service
 * Detects which blockchain(s) a token exists on
 * Routes to appropriate on-chain data services
 */
class ChainDetectorService {
  constructor() {
    this.chainPriority = [
      'ethereum',
      'binance-smart-chain', 
      'solana',
      'polygon-pos',
      'avalanche',
      'arbitrum-one',
      'optimistic-ethereum'
    ];
  }

  /**
   * Detect chains for a coin
   * @param {Object} coinData - CoinGecko coin data
   * @returns {Object} Chain detection results
   */
  detectChains(coinData) {
    try {
       
      const chains = {
        detected: [],
        primary: null,
        contracts: {},
        is_multichain: false
      };

      // Check platforms from CoinGecko
      if (coinData.platforms) {
        const platforms = coinData.platforms;
        
        // Map CoinGecko platform IDs to our service names
        const platformMap = {
          'ethereum': 'ethereum',
          'binance-smart-chain': 'bsc',
          'solana': 'solana',
          'polygon-pos': 'polygon',
          'avalanche': 'avalanche',
          'arbitrum-one': 'arbitrum',
          'optimistic-ethereum': 'optimism'
        };

        // Detect all chains
        for (const [platform, contract] of Object.entries(platforms)) {
          if (contract && platformMap[platform]) {
            const serviceName = platformMap[platform];
            chains.detected.push(serviceName);
            chains.contracts[serviceName] = contract;
          }
        }

        // Determine primary chain (first in priority order)
        for (const priorityChain of this.chainPriority) {
          if (platforms[priorityChain] && platforms[priorityChain] !== '') {
            chains.primary = platformMap[priorityChain];
            break;
          }
        }

        chains.is_multichain = chains.detected.length > 1;
      }

      // Special cases for native coins
      const symbol = coinData.symbol?.toUpperCase();
      if (symbol === 'BTC' || coinData.id === 'bitcoin') {
        chains.primary = 'bitcoin';
        chains.detected = ['bitcoin'];
        chains.native = true;
      } else if (symbol === 'ETH' || coinData.id === 'ethereum') {
        chains.primary = 'ethereum';
        chains.detected = ['ethereum'];
        chains.native = true;
      } else if (symbol === 'SOL' || coinData.id === 'solana') {
        chains.primary = 'solana';
        chains.detected = ['solana'];
        chains.native = true;
      } else if (symbol === 'BNB' || coinData.id === 'binancecoin') {
        chains.primary = 'bsc';
        chains.detected = ['bsc'];
        chains.native = true;
      }

      logger.info(`[ChainDetector] Detected chains for ${coinData.symbol}:`, {
        primary: chains.primary,
        detected: chains.detected,
        multichain: chains.is_multichain,
        native: chains.native || false
      });

      return chains;
    } catch (error) {
      logger.error('[ChainDetector] Error detecting chains:', error.message);
      return {
        detected: [],
        primary: null,
        contracts: {},
        is_multichain: false,
        error: error.message
      };
    }
  }

  /**
   * Get recommended service for chain
   * @param {string} chain - Chain name
   * @returns {string} Service name
   */
  getServiceForChain(chain) {
    const serviceMap = {
      'ethereum': 'etherscan',
      'bsc': 'bscscan',
      'polygon': 'polygonscan',
      'solana': 'solscan',
      'avalanche': 'covalent',
      'arbitrum': 'covalent',
      'optimism': 'covalent',
      'bitcoin': 'native' // No smart contracts
    };

    return serviceMap[chain] || 'covalent';
  }

  /**
   * Determine data fetching strategy
   * @param {Object} chainInfo - Chain detection results
   * @returns {Object} Strategy configuration
   */
  getDataStrategy(chainInfo) {
    const strategy = {
      primary_service: null,
      fallback_services: [],
      use_aggregator: false,
      native_coin: chainInfo.native || false
    };

    if (chainInfo.native) {
      // Native coins: use specialized logic
      strategy.primary_service = 'native';
      strategy.use_aggregator = false;
    } else if (chainInfo.is_multichain) {
      // Multi-chain tokens: use Covalent aggregator
      strategy.primary_service = 'covalent';
      strategy.use_aggregator = true;
      
      // Add chain-specific as fallbacks
      chainInfo.detected.forEach(chain => {
        const service = this.getServiceForChain(chain);
        if (service !== 'covalent' && service !== 'native') {
          strategy.fallback_services.push(service);
        }
      });
    } else if (chainInfo.primary) {
      // Single chain: use chain-specific service
      strategy.primary_service = this.getServiceForChain(chainInfo.primary);
      strategy.fallback_services = ['covalent']; // Covalent as fallback
    } else {
      // Unknown: try Covalent or mock
      strategy.primary_service = 'mock';
      strategy.use_aggregator = false;
    }

    logger.info('[ChainDetector] Data strategy:', strategy);
    return strategy;
  }

  /**
   * Get contract address for specific chain
   * @param {Object} chainInfo - Chain detection results
   * @param {string} chain - Target chain
   * @returns {string|null} Contract address
   */
  getContractAddress(chainInfo, chain) {
    return chainInfo.contracts[chain] || null;
  }

  /**
   * Validate contract address format
   * @param {string} address - Contract address
   * @param {string} chain - Blockchain name
   * @returns {boolean} Is valid
   */
  validateContractAddress(address, chain) {
    if (!address) return false;

    const validators = {
      ethereum: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr),
      bsc: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr),
      polygon: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr),
      solana: (addr) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr),
      avalanche: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr),
      arbitrum: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr),
      optimism: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr)
    };

    const validator = validators[chain];
    return validator ? validator(address) : false;
  }

  /**
   * Get chain display name
   * @param {string} chain - Chain identifier
   * @returns {string} Display name
   */
  getChainDisplayName(chain) {
    const names = {
      ethereum: 'Ethereum',
      bsc: 'BNB Smart Chain',
      polygon: 'Polygon',
      solana: 'Solana',
      avalanche: 'Avalanche',
      arbitrum: 'Arbitrum',
      optimism: 'Optimism',
      bitcoin: 'Bitcoin'
    };

    return names[chain] || chain;
  }

  /**
   * Get supported chains list
   * @returns {Array} List of supported chains
   */
  getSupportedChains() {
    return [
      {
        id: 'ethereum',
        name: 'Ethereum',
        service: 'etherscan',
        type: 'EVM'
      },
      {
        id: 'bsc',
        name: 'BNB Smart Chain',
        service: 'bscscan',
        type: 'EVM'
      },
      {
        id: 'polygon',
        name: 'Polygon',
        service: 'polygonscan',
        type: 'EVM'
      },
      {
        id: 'solana',
        name: 'Solana',
        service: 'solscan',
        type: 'Non-EVM'
      },
      {
        id: 'avalanche',
        name: 'Avalanche',
        service: 'covalent',
        type: 'EVM'
      },
      {
        id: 'arbitrum',
        name: 'Arbitrum',
        service: 'covalent',
        type: 'EVM'
      },
      {
        id: 'optimism',
        name: 'Optimism',
        service: 'covalent',
        type: 'EVM'
      }
    ];
  }
}

module.exports = new ChainDetectorService();