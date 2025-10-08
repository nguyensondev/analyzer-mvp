const config = require('../../config');
const logger = require('../../utils/logger');

class OnchainMockService {
  constructor() {
    this.variance = config.mock.dataVariance;
  }

  generateOnchainMetrics(ticker, tvl, marketCap, volume24h) {
    logger.info(`Generating mock on-chain data for ${ticker}`);

    const baseTVL = tvl || (marketCap * 0.1);

    const activeAddresses = this.estimateActiveAddresses(baseTVL, volume24h);
    const transactionVolume = this.estimateTransactionVolume(baseTVL, volume24h);
    const uniqueUsers = this.estimateUniqueUsers(activeAddresses);

    return {
      data_source: 'simulated (Dune-style from TVL correlation)',
      active_addresses_7d: Math.round(activeAddresses),
      transaction_volume_7d_usd: Math.round(transactionVolume),
      unique_users_30d: Math.round(uniqueUsers),
      avg_transaction_size: Math.round(transactionVolume / activeAddresses),
      
      address_growth_mom: this.generateGrowthMetric(-15, 45),
      transaction_growth_wow: this.generateGrowthMetric(-20, 60),
      tvl_change_7d: this.generateGrowthMetric(-10, 30),
      
      daily_active_ratio: this.calculateDailyActiveRatio(activeAddresses, uniqueUsers),
      transaction_success_rate: this.addVariance(95, 85, 99),
      
      whale_transactions_7d: Math.round(this.addVariance(activeAddresses * 0.05, 5, 500)),
      large_holders_percentage: this.addVariance(45, 20, 70),
      
      disclaimer: 'Estimated from TVL and volume using correlation models',
      confidence_level: tvl > 0 ? 'medium' : 'low',
      base_tvl_used: baseTVL
    };
  }

  estimateActiveAddresses(tvl, volume) {
    let baseAddresses = (tvl / 1000000) * 75;
    
    if (volume > 0) {
      const volumeBoost = (volume / 1000000) * 10;
      baseAddresses += volumeBoost;
    }
    
    return this.addVariance(Math.max(100, baseAddresses), 100, 1000000);
  }

  estimateTransactionVolume(tvl, volume24h) {
    if (volume24h > 0) {
      return this.addVariance(volume24h * 7 * 1.2, volume24h * 5, volume24h * 10);
    }
    
    const weeklyVolume = tvl * 0.5;
    return this.addVariance(weeklyVolume, tvl * 0.2, tvl * 2);
  }

  estimateUniqueUsers(activeAddresses) {
    return this.addVariance(activeAddresses * 3.5, activeAddresses * 2, activeAddresses * 5);
  }

  generateGrowthMetric(min, max) {
    const mean = (min + max) / 2;
    const value = this.addVariance(mean, min, max);
    return parseFloat(value.toFixed(2));
  }

  calculateDailyActiveRatio(weeklyActive, monthlyUsers) {
    if (monthlyUsers === 0) return 0;
    const ratio = (weeklyActive / 7) / (monthlyUsers / 30) * 100;
    return parseFloat(Math.min(100, ratio).toFixed(2));
  }

  addVariance(value, min, max) {
    const variance = value * this.variance;
    const randomFactor = (Math.random() - 0.5) * 2;
    const newValue = value + (variance * randomFactor);
    return Math.max(min, Math.min(max, newValue));
  }
}

module.exports = new OnchainMockService();