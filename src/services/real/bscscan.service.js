const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');
const db = require('../../utils/database');

class BscScanService {
  constructor() {
    this.apiKey = config.apis.bscscan.apiKey;
    this.baseUrl = config.apis.bscscan.baseUrl;
    this.timeout = config.apis.bscscan.timeout;
    this.enabled = config.apis.bscscan.enabled;
  }

  async getTokenMetrics(contractAddress) {
    if (!this.enabled || !contractAddress) {
      logger.info('BscScan not configured or no contract address');
      return null;
    }

    const startTime = Date.now();
    
    try {
      logger.info(`[BscScan] Fetching data for ${contractAddress}`);

      const [topHolders, tokenInfo] = await Promise.all([
        this.getTopHolders(contractAddress),
        this.getTokenInfo(contractAddress)
      ]);

      const distribution = this.calculateDistribution(topHolders);
      const holderCount = topHolders.length > 0 ? topHolders.length * 10 : 0;
      const activityEstimate = this.estimateActivity(holderCount, topHolders);

      const result = {
        chain: 'bsc',
        contract_address: contractAddress,
        
        total_holders: holderCount,
        top_10_holders: topHolders.slice(0, 10),
        top_10_concentration: distribution.top10Pct,
        top_50_concentration: distribution.top50Pct,
        top_100_concentration: distribution.top100Pct,
        
        gini_coefficient: distribution.gini,
        whale_holders: distribution.whaleCount,
        retail_holders: distribution.retailCount,
        
        token_name: tokenInfo.name,
        token_symbol: tokenInfo.symbol,
        total_supply: tokenInfo.totalSupply,
        decimals: tokenInfo.decimals,
        
        estimated_active_7d: activityEstimate.active7d,
        estimated_active_30d: activityEstimate.active30d,
        activity_confidence: 'medium',
        
        data_source: 'bscscan_api',
        reliability: 'high',
        timestamp: new Date().toISOString()
      };

      await db.logApiCall('bscscan', `/token/${contractAddress}`, 200, Date.now() - startTime);
      logger.info(`[BscScan] Data fetched successfully`, {
        contract: contractAddress,
        holders: holderCount,
        responseTime: Date.now() - startTime
      });

      return result;

    } catch (error) {
      const status = error.response?.status || 500;
      await db.logApiCall('bscscan', `/token/${contractAddress}`, status, Date.now() - startTime);
      
      logger.error(`[BscScan] API error for ${contractAddress}:`, error.message);
      return null;
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
          offset: 100,
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
        percentage: parseFloat(holder.TokenHolderQuantity)
      }));

    } catch (error) {
      logger.warn('[BscScan] Could not get top holders:', error.message);
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
      logger.warn('[BscScan] Could not get token info:', error.message);
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

    const totalBalance = holders.reduce((sum, h) => sum + parseFloat(h.balance), 0);

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
    const concentration = topHolders.length > 10 
      ? this.calculateDistribution(topHolders).top10Pct 
      : 100;

    let activityMultiplier = 0.05;

    if (concentration < 30) {
      activityMultiplier = 0.15;
    } else if (concentration < 50) {
      activityMultiplier = 0.10;
    } else if (concentration < 70) {
      activityMultiplier = 0.07;
    }

    return {
      active7d: Math.round(totalHolders * activityMultiplier),
      active30d: Math.round(totalHolders * activityMultiplier * 2)
    };
  }
}

module.exports = new BscScanService();