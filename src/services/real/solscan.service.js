const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');
const db = require('../../utils/database');

class SolscanService {
  constructor() {
    this.baseUrl = config.apis.solscan.baseUrl;
    this.timeout = config.apis.solscan.timeout;
    this.enabled = config.apis.solscan.enabled;
  }

  async getTokenMetrics(tokenAddress) {
    if (!this.enabled || !tokenAddress) {
      logger.info('Solscan not configured or no token address');
      return null;
    }

    const startTime = Date.now();
    
    try {
      logger.info(`[Solscan] Fetching data for ${tokenAddress}`);

      const [tokenMeta, holders, transactions] = await Promise.all([
        this.getTokenMeta(tokenAddress),
        this.getHolders(tokenAddress),
        this.getTransactions(tokenAddress)
      ]);

      const distribution = this.calculateDistribution(holders);
      const activity = this.calculateActivity(transactions);

      const result = {
        chain: 'solana',
        token_address: tokenAddress,
        
        total_holders: holders.total || 0,
        top_holders: holders.data.slice(0, 10),
        top_10_concentration: distribution.top10Pct,
        top_50_concentration: distribution.top50Pct,
        
        gini_coefficient: distribution.gini,
        whale_holders: distribution.whaleCount,
        retail_holders: distribution.retailCount,
        
        token_name: tokenMeta.name,
        token_symbol: tokenMeta.symbol,
        total_supply: tokenMeta.supply,
        decimals: tokenMeta.decimals,
        
        transactions_24h: activity.count24h,
        transactions_7d: activity.count7d,
        unique_traders_24h: activity.uniqueTraders,
        
        estimated_active_7d: activity.count7d > 0 ? Math.round(activity.count7d / 10) : 0,
        estimated_active_30d: activity.count7d > 0 ? Math.round(activity.count7d / 10 * 4) : 0,
        activity_confidence: 'high',
        
        data_source: 'solscan_api',
        reliability: 'high',
        timestamp: new Date().toISOString()
      };

      await db.logApiCall('solscan', `/token/${tokenAddress}`, 200, Date.now() - startTime);
      logger.info(`[Solscan] Data fetched successfully`, {
        token: tokenAddress,
        holders: holders.total,
        responseTime: Date.now() - startTime
      });

      return result;

    } catch (error) {
      const status = error.response?.status || 500;
      await db.logApiCall('solscan', `/token/${tokenAddress}`, status, Date.now() - startTime);
      
      logger.error(`[Solscan] API error for ${tokenAddress}:`, error.message);
      return null;
    }
  }

  async getTokenMeta(tokenAddress) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/token/meta`,
        {
          params: { tokenAddress },
          timeout: this.timeout
        }
      );

      return {
        name: response.data.name || 'Unknown',
        symbol: response.data.symbol || 'UNKNOWN',
        supply: response.data.supply || '0',
        decimals: response.data.decimals || 9
      };

    } catch (error) {
      logger.warn('[Solscan] Could not get token meta:', error.message);
      return {
        name: 'Unknown',
        symbol: 'UNKNOWN',
        supply: '0',
        decimals: 9
      };
    }
  }

  async getHolders(tokenAddress) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/token/holders`,
        {
          params: {
            tokenAddress,
            offset: 0,
            limit: 50
          },
          timeout: this.timeout
        }
      );

      return {
        total: response.data.total || 0,
        data: response.data.data || []
      };

    } catch (error) {
      logger.warn('[Solscan] Could not get holders:', error.message);
      return {
        total: 0,
        data: []
      };
    }
  }

  async getTransactions(tokenAddress) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/token/transfer`,
        {
          params: {
            tokenAddress,
            offset: 0,
            limit: 100
          },
          timeout: this.timeout
        }
      );

      return response.data.data || [];

    } catch (error) {
      logger.warn('[Solscan] Could not get transactions:', error.message);
      return [];
    }
  }

  calculateDistribution(holders) {
    if (!holders.data || holders.data.length === 0) {
      return {
        top10Pct: 0,
        top50Pct: 0,
        gini: 0,
        whaleCount: 0,
        retailCount: 0
      };
    }

    const holderList = holders.data;
    const totalSupply = holderList.reduce((sum, h) => sum + parseFloat(h.amount || 0), 0);

    let top10Balance = 0;
    let top50Balance = 0;
    let whaleCount = 0;
    let retailCount = 0;

    holderList.forEach((holder, index) => {
      const balance = parseFloat(holder.amount || 0);
      const percentage = totalSupply > 0 ? (balance / totalSupply) * 100 : 0;

      if (index < 10) top10Balance += balance;
      if (index < 50) top50Balance += balance;

      if (percentage >= 1) {
        whaleCount++;
      } else {
        retailCount++;
      }
    });

    const balances = holderList.map(h => parseFloat(h.amount || 0));
    const gini = this.calculateGini(balances);

    return {
      top10Pct: totalSupply > 0 ? parseFloat(((top10Balance / totalSupply) * 100).toFixed(2)) : 0,
      top50Pct: totalSupply > 0 ? parseFloat(((top50Balance / totalSupply) * 100).toFixed(2)) : 0,
      gini: parseFloat(gini.toFixed(3)),
      whaleCount,
      retailCount
    };
  }

  calculateActivity(transactions) {
    if (transactions.length === 0) {
      return {
        count24h: 0,
        count7d: 0,
        uniqueTraders: 0
      };
    }

    const now = Date.now() / 1000;
    const day = 24 * 60 * 60;
    const week = 7 * day;

    let count24h = 0;
    let count7d = 0;
    const uniqueAddresses = new Set();

    transactions.forEach(tx => {
      const txTime = tx.blockTime || tx.time || 0;
      const timeDiff = now - txTime;

      if (timeDiff <= day) {
        count24h++;
      }
      if (timeDiff <= week) {
        count7d++;
      }

      if (tx.from) uniqueAddresses.add(tx.from);
      if (tx.to) uniqueAddresses.add(tx.to);
    });

    return {
      count24h,
      count7d,
      uniqueTraders: uniqueAddresses.size
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
}

module.exports = new SolscanService();