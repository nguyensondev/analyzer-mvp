const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');
const db = require('../../utils/database');

class CovalentService {
  constructor() {
    this.apiKey = config.apis.covalent.apiKey;
    this.baseUrl = config.apis.covalent.baseUrl;
    this.timeout = config.apis.covalent.timeout;
    this.enabled = config.apis.covalent.enabled;
    
    // Chain ID mapping
    this.chains = {
      ethereum: 1,
      bsc: 56,
      polygon: 137,
      avalanche: 43114,
      fantom: 250,
      arbitrum: 42161,
      optimism: 10
    };
  }

  async getTokenMetricsMultiChain(contractAddresses) {
    if (!this.enabled || !contractAddresses) {
      logger.info('Covalent not configured or no contract addresses');
      return null;
    }

    const startTime = Date.now();
    
    try {
      logger.info('[Covalent] Fetching multi-chain data');

      // Fetch data from all chains in parallel
      const chainPromises = Object.entries(contractAddresses).map(([chain, address]) => {
        if (address && this.chains[chain]) {
          return this.getTokenDataForChain(this.chains[chain], address, chain);
        }
        return Promise.resolve(null);
      });

      const chainResults = await Promise.all(chainPromises);
      const validResults = chainResults.filter(r => r !== null);

      if (validResults.length === 0) {
        return null;
      }

      // Aggregate cross-chain metrics
      const aggregated = this.aggregateChainData(validResults);

      await db.logApiCall('covalent', '/multi-chain', 200, Date.now() - startTime);
      logger.info('[Covalent] Multi-chain data fetched', {
        chains: validResults.length,
        responseTime: Date.now() - startTime
      });

      return aggregated;

    } catch (error) {
      const status = error.response?.status || 500;
      await db.logApiCall('covalent', '/multi-chain', status, Date.now() - startTime);
      
      logger.error('[Covalent] Multi-chain error:', error.message);
      return null;
    }
  }

  async getTokenDataForChain(chainId, contractAddress, chainName) {
    try {
      // Get token holders
      const holdersResponse = await axios.get(
        `${this.baseUrl}/${chainId}/tokens/${contractAddress}/token_holders/`,
        {
          params: {
            'page-size': 100
          },
          auth: {
            username: this.apiKey,
            password: ''
          },
          timeout: this.timeout
        }
      );

      const holders = holdersResponse.data.data?.items || [];

      // Get token transfers (for activity metrics)
      const transfersResponse = await axios.get(
        `${this.baseUrl}/${chainId}/address/${contractAddress}/transfers_v2/`,
        {
          params: {
            'page-size': 100
          },
          auth: {
            username: this.apiKey,
            password: ''
          },
          timeout: this.timeout
        }
      );

      const transfers = transfersResponse.data.data?.items || [];

      // Calculate metrics for this chain
      const distribution = this.calculateDistributionFromHolders(holders);
      const activity = this.calculateActivityFromTransfers(transfers);

      return {
        chain: chainName,
        chain_id: chainId,
        contract_address: contractAddress,
        
        total_holders: holders.length,
        top_10_concentration: distribution.top10Pct,
        whale_holders: distribution.whaleCount,
        retail_holders: distribution.retailCount,
        
        transactions_24h: activity.count24h,
        transactions_7d: activity.count7d,
        unique_addresses: activity.uniqueAddresses,
        
        data_source: 'covalent_api',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.warn(`[Covalent] Could not fetch data for ${chainName}:`, error.message);
      return null;
    }
  }

  calculateDistributionFromHolders(holders) {
    if (holders.length === 0) {
      return {
        top10Pct: 0,
        whaleCount: 0,
        retailCount: 0
      };
    }

    const totalBalance = holders.reduce((sum, h) => {
      return sum + parseFloat(h.balance || 0);
    }, 0);

    let top10Balance = 0;
    let whaleCount = 0;
    let retailCount = 0;

    holders.forEach((holder, index) => {
      const balance = parseFloat(holder.balance || 0);
      const percentage = totalBalance > 0 ? (balance / totalBalance) * 100 : 0;

      if (index < 10) {
        top10Balance += balance;
      }

      if (percentage >= 1) {
        whaleCount++;
      } else {
        retailCount++;
      }
    });

    return {
      top10Pct: totalBalance > 0 ? parseFloat(((top10Balance / totalBalance) * 100).toFixed(2)) : 0,
      whaleCount,
      retailCount
    };
  }

  calculateActivityFromTransfers(transfers) {
    if (transfers.length === 0) {
      return {
        count24h: 0,
        count7d: 0,
        uniqueAddresses: 0
      };
    }

    const now = new Date();
    const day = 24 * 60 * 60 * 1000;
    const week = 7 * day;

    let count24h = 0;
    let count7d = 0;
    const addresses = new Set();

    transfers.forEach(transfer => {
      const txDate = new Date(transfer.block_signed_at);
      const timeDiff = now - txDate;

      if (timeDiff <= day) count24h++;
      if (timeDiff <= week) count7d++;

      if (transfer.from_address) addresses.add(transfer.from_address);
      if (transfer.to_address) addresses.add(transfer.to_address);
    });

    return {
      count24h,
      count7d,
      uniqueAddresses: addresses.size
    };
  }

  aggregateChainData(chainResults) {
    // Aggregate metrics across all chains
    let totalHolders = 0;
    let totalTransactions24h = 0;
    let totalTransactions7d = 0;
    let totalWhales = 0;
    let totalRetail = 0;
    let totalUniqueAddresses = 0;

    const chains = {};

    chainResults.forEach(result => {
      totalHolders += result.total_holders || 0;
      totalTransactions24h += result.transactions_24h || 0;
      totalTransactions7d += result.transactions_7d || 0;
      totalWhales += result.whale_holders || 0;
      totalRetail += result.retail_holders || 0;
      totalUniqueAddresses += result.unique_addresses || 0;

      chains[result.chain] = {
        holders: result.total_holders,
        concentration: result.top_10_concentration,
        transactions_7d: result.transactions_7d
      };
    });

    // Calculate average concentration
    const avgConcentration = chainResults.reduce((sum, r) => 
      sum + (r.top_10_concentration || 0), 0) / chainResults.length;

    return {
      data_source: 'covalent_multi_chain',
      chains_covered: Object.keys(chains),
      chain_details: chains,
      
      // Aggregated metrics
      total_holders_all_chains: totalHolders,
      total_transactions_24h: totalTransactions24h,
      total_transactions_7d: totalTransactions7d,
      total_whale_holders: totalWhales,
      total_retail_holders: totalRetail,
      total_unique_addresses: totalUniqueAddresses,
      
      // Cross-chain metrics
      average_concentration: parseFloat(avgConcentration.toFixed(2)),
      most_active_chain: this.findMostActiveChain(chains),
      distribution_score: this.calculateDistributionScore(chains),
      
      reliability: 'high',
      timestamp: new Date().toISOString()
    };
  }

  findMostActiveChain(chains) {
    let maxActivity = 0;
    let mostActive = null;

    Object.entries(chains).forEach(([chain, data]) => {
      if (data.transactions_7d > maxActivity) {
        maxActivity = data.transactions_7d;
        mostActive = chain;
      }
    });

    return mostActive;
  }

  calculateDistributionScore(chains) {
    // Score from 0-100, higher = better distribution (less concentrated)
    const concentrations = Object.values(chains).map(c => c.concentration || 100);
    const avgConcentration = concentrations.reduce((a, b) => a + b, 0) / concentrations.length;
    
    // Invert: 100 - concentration (so lower concentration = higher score)
    return parseFloat((100 - avgConcentration).toFixed(2));
  }
}

module.exports = new CovalentService();