const logger = require('../../utils/logger');
const chainDetector = require('../analyzer/chain-detector.service');
const etherscanService = require('./etherscan.service');
const bscscanService = require('./bscscan.service');
const solscanService = require('./solscan.service');
const covalentService = require('./covalent.service');
const cache = require('../../utils/cache');

/**
 * On-Chain Enhanced Service
 * Aggregates on-chain data from multiple sources
 * Intelligent routing based on chain detection
 */
class OnChainEnhancedService {
  constructor() {
    this.cachePrefix = 'onchain:enhanced:';
    this.cacheTTL = 1800; // 30 minutes
  }

  /**
   * Get comprehensive on-chain metrics
   * @param {string} ticker - Coin ticker symbol
   * @param {Object} coinData - CoinGecko coin data
   * @returns {Object} Aggregated on-chain metrics
   */
  async getOnChainMetrics(ticker, coinData) {
    try {
      // Check cache
      const cacheKey = `${this.cachePrefix}${ticker}`;
      const cached = await cache.get(cacheKey);
      if (cached) {
        logger.info(`[OnChainEnhanced] Using cached data for ${ticker}`);
        return cached;
      }

      logger.info(`[OnChainEnhanced] Fetching on-chain data for ${ticker}`);

      // Detect chains
      const chainInfo = chainDetector.detectChains(coinData);
      const strategy = chainDetector.getDataStrategy(chainInfo);

      let metrics = {};

      // Handle native coins (BTC, ETH, etc.)
      if (strategy.native_coin) {
        metrics = await this.getNativeCoinMetrics(ticker, coinData, chainInfo);
      }
      // Handle multi-chain tokens
      else if (strategy.use_aggregator) {
        metrics = await this.getMultiChainMetrics(ticker, coinData, chainInfo);
      }
      // Handle single-chain tokens
      else if (strategy.primary_service !== 'mock') {
        metrics = await this.getSingleChainMetrics(ticker, coinData, chainInfo, strategy);
      }
      // Fallback to mock
      else {
        metrics = this.getMockMetrics(ticker, coinData);
      }

      // Add metadata
      metrics.chain_info = {
        primary: chainInfo.primary,
        detected: chainInfo.detected,
        is_multichain: chainInfo.is_multichain,
        data_source: metrics.data_source || 'unknown'
      };

      // Cache results
      await cache.set(cacheKey, metrics, this.cacheTTL);

      return metrics;
    } catch (error) {
      logger.error(`[OnChainEnhanced] Error fetching data for ${ticker}:`, error.message);
      return this.getMockMetrics(ticker, coinData);
    }
  }

  /**
   * Get metrics for native blockchain coins
   * @private
   */
  async getNativeCoinMetrics(ticker, coinData, chainInfo) {
    logger.info(`[OnChainEnhanced] Fetching native coin data for ${ticker}`);

    try {
      // For native coins, use Covalent for address metrics
      const chain = chainInfo.primary;
      let metrics = {};

      if (chain === 'ethereum' || chain === 'bitcoin') {
        // Use Covalent for ETH/BTC address stats
        metrics = await covalentService.getNativeChainMetrics(chain);
      } else if (chain === 'solana') {
        // Use Solscan for SOL
        metrics = await solscanService.getNetworkMetrics();
      } else {
        // Generic native coin handling
        metrics = this.estimateNativeMetrics(coinData);
      }

      metrics.data_source = 'real (native chain)';
      return metrics;
    } catch (error) {
      logger.error(`[OnChainEnhanced] Error with native coin ${ticker}:`, error.message);
      return this.estimateNativeMetrics(coinData);
    }
  }

  /**
   * Get metrics for multi-chain tokens
   * @private
   */
  async getMultiChainMetrics(ticker, coinData, chainInfo) {
    logger.info(`[OnChainEnhanced] Fetching multi-chain data for ${ticker}`);

    try {
      const chainMetrics = {};
      const contracts = chainInfo.contracts;

      // Fetch data from each chain in parallel
      const promises = chainInfo.detected.map(async (chain) => {
        const contract = contracts[chain];
        if (!contract) return null;

        try {
          const service = this.getServiceForChain(chain);
          const data = await service.getTokenMetrics(contract);
          return { chain, data };
        } catch (error) {
          logger.error(`[OnChainEnhanced] Error fetching ${chain} data:`, error.message);
          return null;
        }
      });

      const results = await Promise.all(promises);

      // Aggregate results
      results.forEach(result => {
        if (result && result.data) {
          chainMetrics[result.chain] = result.data;
        }
      });

      // Calculate aggregated metrics
      const aggregated = this.aggregateMultiChainMetrics(chainMetrics);
      aggregated.chains = chainMetrics;
      aggregated.data_source = 'real (multi-chain aggregated)';

      return aggregated;
    } catch (error) {
      logger.error(`[OnChainEnhanced] Error with multi-chain ${ticker}:`, error.message);
      return this.getMockMetrics(ticker, coinData);
    }
  }

  /**
   * Get metrics for single-chain tokens
   * @private
   */
  async getSingleChainMetrics(ticker, coinData, chainInfo, strategy) {
    logger.info(`[OnChainEnhanced] Fetching single-chain data for ${ticker} on ${chainInfo.primary}`);

    try {
      const contract = chainInfo.contracts[chainInfo.primary];
      if (!contract) {
        throw new Error('No contract address found');
      }

      // Get service for primary chain
      const service = this.getServiceForChain(chainInfo.primary);
      const metrics = await service.getTokenMetrics(contract);

      metrics.primary_chain = chainInfo.primary;
      metrics.data_source = `real (${chainInfo.primary})`;

      return metrics;
    } catch (error) {
      logger.error(`[OnChainEnhanced] Error with single-chain ${ticker}:`, error.message);
      
      // Try fallback services
      if (strategy.fallback_services && strategy.fallback_services.length > 0) {
        logger.info(`[OnChainEnhanced] Trying fallback services for ${ticker}`);
        // Could implement fallback logic here
      }

      return this.getMockMetrics(ticker, coinData);
    }
  }

  /**
   * Get appropriate service for chain
   * @private
   */
  getServiceForChain(chain) {
    const services = {
      ethereum: etherscanService,
      bsc: bscscanService,
      polygon: bscscanService, // PolygonScan uses same API pattern
      solana: solscanService
    };

    return services[chain] || covalentService;
  }

  /**
   * Aggregate metrics from multiple chains
   * @private
   */
  aggregateMultiChainMetrics(chainMetrics) {
    const chains = Object.values(chainMetrics);
    if (chains.length === 0) return {};

    // Sum up metrics across chains
    const aggregated = {
      total_holders: 0,
      total_transfers_24h: 0,
      total_transfers_7d: 0,
      active_addresses_7d: 0,
      active_addresses_30d: 0,
      weighted_concentration: 0
    };

    let validChains = 0;

    chains.forEach(chain => {
      if (!chain) return;

      aggregated.total_holders += chain.holders_count || 0;
      aggregated.total_transfers_24h += chain.transfers_24h || 0;
      aggregated.total_transfers_7d += chain.transfers_7d || 0;
      aggregated.active_addresses_7d += chain.active_addresses_7d || 0;
      aggregated.active_addresses_30d += chain.active_addresses_30d || 0;
      
      if (chain.top_10_concentration) {
        aggregated.weighted_concentration += chain.top_10_concentration;
        validChains++;
      }
    });

    // Calculate averages
    if (validChains > 0) {
      aggregated.avg_concentration = aggregated.weighted_concentration / validChains;
    }

    // Add chain count
    aggregated.chain_count = chains.length;

    return aggregated;
  }

  /**
   * Estimate metrics for native coins
   * @private
   */
  estimateNativeMetrics(coinData) {
    const marketCap = coinData.market_data?.market_cap?.usd || 0;
    const volume24h = coinData.market_data?.total_volume?.usd || 0;

    return {
      estimated: true,
      active_addresses_estimate: Math.floor(marketCap / 10000),
      daily_transactions_estimate: Math.floor(volume24h / 1000),
      data_source: 'estimated (native coin)',
      note: 'Native blockchain coins use estimated metrics'
    };
  }

  /**
   * Generate mock metrics as fallback
   * @private
   */
  getMockMetrics(ticker, coinData) {
    logger.warn(`[OnChainEnhanced] Using mock data for ${ticker}`);

    const marketCap = coinData.market_data?.market_cap?.usd || 0;
    const volume24h = coinData.market_data?.total_volume?.usd || 0;

    return {
      holders_count: Math.floor(marketCap / 5000) + Math.floor(Math.random() * 10000),
      transfers_24h: Math.floor(volume24h / 100) + Math.floor(Math.random() * 5000),
      transfers_7d: Math.floor((volume24h / 100) * 7) + Math.floor(Math.random() * 30000),
      active_addresses_7d: Math.floor(marketCap / 10000) + Math.floor(Math.random() * 5000),
      active_addresses_30d: Math.floor(marketCap / 8000) + Math.floor(Math.random() * 10000),
      top_10_concentration: 25 + Math.random() * 40,
      data_source: 'simulated (fallback)',
      note: 'Real on-chain data unavailable, using estimates'
    };
  }

  /**
   * Get on-chain activity score
   * @param {Object} metrics - On-chain metrics
   * @returns {number} Score 0-10
   */
  calculateActivityScore(metrics) {
    if (!metrics || metrics.data_source === 'simulated (fallback)') {
      return 5.0; // Neutral score for mock data
    }

    let score = 0;
    let factors = 0;

    // Holder count (0-2.5 points)
    if (metrics.holders_count || metrics.total_holders) {
      const holders = metrics.total_holders || metrics.holders_count;
      if (holders > 100000) score += 2.5;
      else if (holders > 50000) score += 2.0;
      else if (holders > 10000) score += 1.5;
      else if (holders > 1000) score += 1.0;
      else score += 0.5;
      factors++;
    }

    // Transfer activity (0-2.5 points)
    if (metrics.transfers_7d || metrics.total_transfers_7d) {
      const transfers = metrics.total_transfers_7d || metrics.transfers_7d;
      if (transfers > 100000) score += 2.5;
      else if (transfers > 50000) score += 2.0;
      else if (transfers > 10000) score += 1.5;
      else if (transfers > 1000) score += 1.0;
      else score += 0.5;
      factors++;
    }

    // Active addresses (0-2.5 points)
    if (metrics.active_addresses_7d) {
      const active = metrics.active_addresses_7d;
      if (active > 50000) score += 2.5;
      else if (active > 20000) score += 2.0;
      else if (active > 5000) score += 1.5;
      else if (active > 1000) score += 1.0;
      else score += 0.5;
      factors++;
    }

    // Concentration (0-2.5 points, inverted - lower is better)
    const concentration = metrics.avg_concentration || metrics.top_10_concentration;
    if (concentration) {
      if (concentration < 20) score += 2.5;
      else if (concentration < 35) score += 2.0;
      else if (concentration < 50) score += 1.5;
      else if (concentration < 70) score += 1.0;
      else score += 0.5;
      factors++;
    }

    // Normalize to 0-10 scale
    return factors > 0 ? (score / factors) * 4 : 5.0;
  }

  /**
   * Generate on-chain insights
   * @param {Object} metrics - On-chain metrics
   * @returns {Array} Array of insight strings
   */
  generateInsights(metrics) {
    const insights = [];

    if (!metrics || metrics.data_source === 'simulated (fallback)') {
      insights.push('⚠️ On-chain data unavailable - using estimates');
      return insights;
    }

    // Multi-chain insights
    if (metrics.chain_info?.is_multichain) {
      insights.push(`✅ Available on ${metrics.chain_info.detected.length} chains`);
    }

    // Holder insights
    const holders = metrics.total_holders || metrics.holders_count;
    if (holders) {
      if (holders > 100000) {
        insights.push(`✅ Large holder base (${this.formatNumber(holders)} holders)`);
      } else if (holders < 1000) {
        insights.push(`⚠️ Small holder base (${this.formatNumber(holders)} holders)`);
      }
    }

    // Activity insights
    const transfers = metrics.total_transfers_7d || metrics.transfers_7d;
    if (transfers) {
      if (transfers > 50000) {
        insights.push(`✅ High activity (${this.formatNumber(transfers)} transfers/week)`);
      } else if (transfers < 100) {
        insights.push(`⚠️ Low activity (${this.formatNumber(transfers)} transfers/week)`);
      }
    }

    // Concentration insights
    const concentration = metrics.avg_concentration || metrics.top_10_concentration;
    if (concentration) {
      if (concentration > 70) {
        insights.push(`🚨 Highly concentrated (top 10: ${concentration.toFixed(1)}%)`);
      } else if (concentration < 30) {
        insights.push(`✅ Well distributed (top 10: ${concentration.toFixed(1)}%)`);
      }
    }

    return insights;
  }

  /**
   * Format number with K/M/B suffixes
   * @private
   */
  formatNumber(num) {
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }
}

module.exports = new OnChainEnhancedService();