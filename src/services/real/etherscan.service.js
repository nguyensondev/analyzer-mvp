const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');
const db = require('../../utils/database');

class EtherscanService {
  constructor() {
    this.apiKey = config.apis.etherscan.apiKey;
    this.baseUrl = config.apis.etherscan.baseUrl;
    this.timeout = config.apis.etherscan.timeout;
    this.enabled = config.apis.etherscan.enabled;
  }

  async getTokenMetrics(contractAddress) {
    if (!this.enabled || !contractAddress) {
      logger.info('Etherscan not configured or no contract address');
      return null;
    }

    const startTime = Date.now();
    
    try {
      logger.info(`[Etherscan] Fetching data for ${contractAddress}`);

      // Parallel API calls for speed
      const [holderCount, topHolders, tokenInfo] = await Promise.all([
        this.getHolderCount(contractAddress),
        this.getTopHolders(contractAddress),
        this.getTokenInfo(contractAddress)
      ]);

      // Calculate distribution metrics
      const distribution = this.calculateDistribution(topHolders);
      
      // Estimate active addresses (Etherscan doesn't provide this directly)
      const activityEstimate = this.estimateActivity(holderCount, topHolders);

      const result = {
        chain: 'ethereum',
        contract_address: contractAddress,
        
        // Holder metrics
        total_holders: holderCount,
        top_10_holders: topHolders.slice(0, 10),
        top_10_concentration: distribution.top10Pct,
        top_50_concentration: distribution.top50Pct,
        top_100_concentration: distribution.top100Pct,
        
        // Distribution metrics
        gini_coefficient: distribution.gini,
        whale_holders: distribution.whaleCount,
        retail_holders: distribution.retailCount,
        
        // Token info
        token_name: tokenInfo.name,
        token_symbol: tokenInfo.symbol,
        total_supply: tokenInfo.totalSupply,
        decimals: tokenInfo.decimals,
        
        // Activity estimates
        estimated_active_7d: activityEstimate.active7d,
        estimated_active_30d: activityEstimate.active30d,
        activity_confidence: 'medium',
        
        data_source: 'etherscan_api',
        reliability: 'high',
        timestamp: new Date().toISOString()
      };

      await db.logApiCall('etherscan', `/token/${contractAddress}`, 200, Date.now() - startTime);
      logger.info(`[Etherscan] Data fetched successfully`, {
        contract: contractAddress,
        holders: holderCount,
        responseTime: Date.now() - startTime
      });

      return result;

    } catch (error) {
      const status = error.response?.status || 500;
      await db.logApiCall('etherscan', `/token/${contractAddress}`, status, Date.now() - startTime);
      
      logger.error(`[Etherscan] API error for ${contractAddress}:`, error.message);
      return null;
    }
  }

  async getHolderCount(contractAddress) {
    try {
      // Etherscan doesn't have direct holder count endpoint
      // We estimate from top holders page
      const response = await axios.get(this.baseUrl, {
        params: {
          module: 'token',
          action: 'tokenholderlist',
          contractaddress: contractAddress,
          page: 1,
          offset: 1,
          apikey: this.apiKey
        },
        timeout: this.timeout
      });

      // If we can't get exact count, estimate from top holders
      // This is a limitation of free Etherscan API
      return parseInt(response.data.result?.length) || 0;
      
    } catch (error) {
      logger.warn('[Etherscan] Could not get holder count:', error.message);
      return 0;
    }
  }

  async getTopHolders(contractAddress) {
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          module: 'token',
          action: 'tokenholderlist',
          contractaddress: contractAddress,
          page: 1,
          offset: 100, // Get top 100 holders
          apikey: this.apiKey
        },
        timeout: this.timeout
      });

      if (response.data.status !== '1') {
        throw new Error(response.data.message || 'API error');
      }

      const holders = response.data.result || [];
      
      return holders.map(holder => ({
        address: holder.TokenHolderAddress,
        balance: holder.TokenHolderQuantity,
        percentage: parseFloat(holder.TokenHolderQuantity) // Will calculate properly
      }));

    } catch (error) {
      logger.warn('[Etherscan] Could not get top holders:', error.message);
      return [];
    }
  }

  async getTokenInfo(contractAddress) {
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          module: 'token',
          action: 'tokeninfo',
          contractaddress: contractAddress,
          apikey: this.apiKey
        },
        timeout: this.timeout
      });

      if (response.data.status !== '1' || !response.data.result) {
        throw new Error('Token info not found');
      }

      const info = Array.isArray(response.data.result) ? response.data.result[0] : response.data.result;

      return {
        name: info.tokenName || info.name || 'Unknown',
        symbol: info.symbol || 'UNKNOWN',
        totalSupply: info.totalSupply || '0',
        decimals: parseInt(info.decimals) || 18
      };

    } catch (error) {
      logger.warn('[Etherscan] Could not get token info:', error.message);
      return {
        name: 'Unknown',
        symbol: 'UNKNOWN',
        totalSupply: '0',
        decimals: 18
      };
    }
  }

  calculateDistribution(holders) {
    if (holders.length === 0) {
      return {
        top10Pct: 0,
        top50Pct: 0,
        top100Pct: 0,
        gini: 0,
        whaleCount: 0,
        retailCount: 0
      };
    }

    // Calculate total supply from holders
    const totalBalance = holders.reduce((sum, h) => sum + parseFloat(h.balance), 0);

    // Calculate percentages
    let top10Balance = 0;
    let top50Balance = 0;
    let top100Balance = 0;
    let whaleCount = 0;
    let retailCount = 0;

    holders.forEach((holder, index) => {
      const balance = parseFloat(holder.balance);
      const percentage = (balance / totalBalance) * 100;

      if (index < 10) top10Balance += balance;
      if (index < 50) top50Balance += balance;
      if (index < 100) top100Balance += balance;

      if (percentage >= 1) {
        whaleCount++;
      } else {
        retailCount++;
      }
    });

    // Calculate Gini coefficient (simplified)
    const gini = this.calculateGini(holders.map(h => parseFloat(h.balance)));

    return {
      top10Pct: parseFloat(((top10Balance / totalBalance) * 100).toFixed(2)),
      top50Pct: parseFloat(((top50Balance / totalBalance) * 100).toFixed(2)),
      top100Pct: parseFloat(((top100Balance / totalBalance) * 100).toFixed(2)),
      gini: parseFloat(gini.toFixed(3)),
      whaleCount,
      retailCount
    };
  }

  calculateGini(balances) {
    // Gini coefficient: measure of inequality (0 = perfect equality, 1 = perfect inequality)
    if (balances.length === 0) return 0;

    const sorted = balances.sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    if (sum === 0) return 0;

    let numerator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (2 * (i + 1) - n - 1) * sorted[i];
    }

    return numerator / (n * sum);
  }

  estimateActivity(totalHolders, topHolders) {
    // Estimate active addresses based on holder concentration
    // More concentrated = less active addresses
    // This is a heuristic estimation

    const concentration = topHolders.length > 10 
      ? this.calculateDistribution(topHolders).top10Pct 
      : 100;

    // If highly concentrated (>70%), assume low activity
    // If well distributed (<30%), assume high activity
    let activityMultiplier = 0.05; // Default: 5% of holders active

    if (concentration < 30) {
      activityMultiplier = 0.15; // 15% active (well distributed)
    } else if (concentration < 50) {
      activityMultiplier = 0.10; // 10% active (moderate)
    } else if (concentration < 70) {
      activityMultiplier = 0.07; // 7% active (somewhat concentrated)
    }

    return {
      active7d: Math.round(totalHolders * activityMultiplier),
      active30d: Math.round(totalHolders * activityMultiplier * 2)
    };
  }
}

module.exports = new EtherscanService();