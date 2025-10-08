const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');
const db = require('../../utils/database');

class TokenUnlocksService {
  constructor() {
    this.baseUrl = config.apis.tokenUnlocks.baseUrl;
    this.timeout = config.apis.tokenUnlocks.timeout;
  }

  async getUnlockSchedule(ticker) {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(
        `${this.baseUrl}/unlocks/${ticker.toLowerCase()}`,
        { timeout: this.timeout }
      );

      if (!response.data || response.data.length === 0) {
        logger.warn(`No unlock data found for ${ticker}`);
        return this.generateMockUnlockData(ticker);
      }

      const unlocks = response.data;
      
      const result = {
        ticker: ticker.toUpperCase(),
        total_unlocks: unlocks.length,
        next_unlock: this.getNextUnlock(unlocks),
        unlock_30d: this.calculateUnlocksInPeriod(unlocks, 30),
        unlock_90d: this.calculateUnlocksInPeriod(unlocks, 90),
        unlock_180d: this.calculateUnlocksInPeriod(unlocks, 180),
        upcoming_cliffs: this.detectCliffs(unlocks),
        data_source: 'tokenunlocks_api'
      };

      await db.logApiCall('tokenunlocks', `/unlocks/${ticker}`, 200, Date.now() - startTime);
      logger.info(`TokenUnlocks data fetched for ${ticker}`);

      return result;

    } catch (error) {
      const status = error.response?.status || 500;
      await db.logApiCall('tokenunlocks', `/unlocks/${ticker}`, status, Date.now() - startTime);
      
      logger.warn(`TokenUnlocks data not available for ${ticker}, using mock`);
      return this.generateMockUnlockData(ticker);
    }
  }

  getNextUnlock(unlocks) {
    const now = new Date();
    const futureUnlocks = unlocks
      .filter(u => new Date(u.date) > now)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (futureUnlocks.length === 0) return null;

    const next = futureUnlocks[0];
    return {
      date: next.date,
      amount: next.amount || 0,
      percentage: next.percentage || 0,
      days_until: Math.ceil((new Date(next.date) - now) / (1000 * 60 * 60 * 24))
    };
  }

  calculateUnlocksInPeriod(unlocks, days) {
    const now = new Date();
    const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const periodUnlocks = unlocks.filter(u => {
      const unlockDate = new Date(u.date);
      return unlockDate > now && unlockDate <= endDate;
    });

    const totalAmount = periodUnlocks.reduce((sum, u) => sum + (u.amount || 0), 0);
    const totalPercentage = periodUnlocks.reduce((sum, u) => sum + (u.percentage || 0), 0);

    return {
      count: periodUnlocks.length,
      total_amount: totalAmount,
      total_percentage: parseFloat(totalPercentage.toFixed(2))
    };
  }

  detectCliffs(unlocks) {
    const cliffs = unlocks
      .filter(u => u.percentage && u.percentage > 10)
      .map(u => ({
        date: u.date,
        percentage: u.percentage,
        category: u.category || 'unknown'
      }));

    return cliffs;
  }

  generateMockUnlockData(ticker) {
    logger.info(`Generating mock unlock data for ${ticker}`);
    
    const monthlyUnlockPercentage = Math.random() * 5 + 2;
    
    return {
      ticker: ticker.toUpperCase(),
      total_unlocks: 12,
      next_unlock: {
        date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        amount: 0,
        percentage: parseFloat(monthlyUnlockPercentage.toFixed(2)),
        days_until: 30
      },
      unlock_30d: {
        count: 1,
        total_amount: 0,
        total_percentage: parseFloat(monthlyUnlockPercentage.toFixed(2))
      },
      unlock_90d: {
        count: 3,
        total_amount: 0,
        total_percentage: parseFloat((monthlyUnlockPercentage * 3).toFixed(2))
      },
      unlock_180d: {
        count: 6,
        total_amount: 0,
        total_percentage: parseFloat((monthlyUnlockPercentage * 6).toFixed(2))
      },
      upcoming_cliffs: [],
      data_source: 'mock_estimated',
      note: 'TokenUnlocks data not available - using estimated model'
    };
  }
}

module.exports = new TokenUnlocksService();