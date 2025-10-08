const logger = require('../../utils/logger');

/**
 * Scoring Engine
 * Calculates various scores for cryptocurrency analysis
 * Updated for Week 2 with enhanced on-chain scoring
 */
class ScoringEngine {
  constructor() {
    // Scoring weights (total = 100%)
    this.weights = {
      market: 0.25,      // 25% - Market metrics
      social: 0.20,      // 20% - Social sentiment (Week 1)
      onchain: 0.25,     // 25% - On-chain activity (Week 2)
      liquidity: 0.15,   // 15% - Liquidity & volume
      technical: 0.15    // 15% - Technical indicators
    };
  }

  /**
   * Calculate overall score from component scores
   * @param {Object} scores - Individual component scores
   * @returns {number} Overall score (0-10)
   */
  calculateOverallScore(scores) {
    const weightedSum = 
      (scores.market || 5) * this.weights.market +
      (scores.social || 5) * this.weights.social +
      (scores.onchain || 5) * this.weights.onchain +
      (scores.liquidity || 5) * this.weights.liquidity +
      (scores.technical || 5) * this.weights.technical;

    return Math.min(10, Math.max(0, weightedSum));
  }

  /**
   * Calculate market score (0-10)
   * @param {Object} coinData - CoinGecko coin data
   * @returns {number} Market score
   */
  calculateMarketScore(coinData) {
    try {
      const marketData = coinData.market_data || {};
      let score = 0;
      let factors = 0;

      // 1. Market Cap Score (0-2.5 points)
      const marketCap = marketData.market_cap?.usd || 0;
      if (marketCap > 10000000000) { // >$10B
        score += 2.5;
      } else if (marketCap > 1000000000) { // $1B-$10B
        score += 2.0;
      } else if (marketCap > 100000000) { // $100M-$1B
        score += 1.5;
      } else if (marketCap > 10000000) { // $10M-$100M
        score += 1.0;
      } else if (marketCap > 1000000) { // $1M-$10M
        score += 0.5;
      } else {
        score += 0.2;
      }
      factors++;

      // 2. Market Cap Rank Score (0-2.5 points)
      const rank = coinData.market_cap_rank || 9999;
      if (rank <= 10) {
        score += 2.5;
      } else if (rank <= 50) {
        score += 2.0;
      } else if (rank <= 100) {
        score += 1.5;
      } else if (rank <= 500) {
        score += 1.0;
      } else if (rank <= 1000) {
        score += 0.5;
      } else {
        score += 0.2;
      }
      factors++;

      // 3. Volume/Market Cap Ratio (0-2.5 points)
      const volume24h = marketData.total_volume?.usd || 0;
      const volumeRatio = marketCap > 0 ? volume24h / marketCap : 0;
      
      if (volumeRatio > 0.15) { // Very high liquidity
        score += 2.5;
      } else if (volumeRatio > 0.10) {
        score += 2.0;
      } else if (volumeRatio > 0.05) {
        score += 1.5;
      } else if (volumeRatio > 0.01) {
        score += 1.0;
      } else if (volumeRatio > 0.005) {
        score += 0.5;
      } else {
        score += 0.2;
      }
      factors++;

      // 4. Price Performance (0-2.5 points)
      const priceChange7d = marketData.price_change_percentage_7d || 0;
      const priceChange30d = marketData.price_change_percentage_30d || 0;
      
      // Positive momentum is good, but not too extreme
      const avgChange = (priceChange7d + priceChange30d) / 2;
      
      if (avgChange > 50) { // Too hot, potential correction
        score += 1.5;
      } else if (avgChange > 20) { // Strong uptrend
        score += 2.5;
      } else if (avgChange > 10) { // Moderate uptrend
        score += 2.0;
      } else if (avgChange > 0) { // Slight uptrend
        score += 1.5;
      } else if (avgChange > -10) { // Slight downtrend
        score += 1.0;
      } else if (avgChange > -20) { // Moderate downtrend
        score += 0.5;
      } else { // Strong downtrend
        score += 0.2;
      }
      factors++;

      // Normalize to 0-10 scale
      const finalScore = factors > 0 ? (score / factors) * 4 : 5;
      
      logger.info('[ScoringEngine] Market score calculated:', {
        score: finalScore.toFixed(2),
        marketCap,
        rank,
        volumeRatio: volumeRatio.toFixed(4)
      });

      return Math.min(10, Math.max(0, finalScore));
    } catch (error) {
      logger.error('[ScoringEngine] Error calculating market score:', error.message);
      return 5.0; // Neutral score on error
    }
  }

  /**
   * Calculate social score (0-10)
   * Enhanced with real data from Week 1
   * @param {Object} socialMetrics - Social metrics from social-enhanced.service
   * @returns {number} Social score
   */
  calculateSocialScore(socialMetrics) {
    try {
      // If using mock data, return neutral score
      if (socialMetrics.data_source === 'simulated (fallback)') {
        logger.info('[ScoringEngine] Using mock social data, returning neutral score');
        return 5.0;
      }

      // Use the calculated overall score from social-enhanced service
      if (socialMetrics.scores?.overall) {
        const score = socialMetrics.scores.overall;
        logger.info('[ScoringEngine] Social score from enhanced service:', score);
        return Math.min(10, Math.max(0, score));
      }

      // Fallback: Calculate from individual components
      let score = 0;
      let factors = 0;

      // Community score (0-3.3 points)
      if (socialMetrics.scores?.community) {
        score += (socialMetrics.scores.community / 10) * 3.3;
        factors++;
      }

      // Engagement score (0-3.3 points)
      if (socialMetrics.scores?.engagement) {
        score += (socialMetrics.scores.engagement / 10) * 3.3;
        factors++;
      }

      // Developer score (0-3.3 points)
      if (socialMetrics.scores?.developer) {
        score += (socialMetrics.scores.developer / 10) * 3.3;
        factors++;
      }

      const finalScore = factors > 0 ? (score / factors) * 3 : 5.0;
      return Math.min(10, Math.max(0, finalScore));
    } catch (error) {
      logger.error('[ScoringEngine] Error calculating social score:', error.message);
      return 5.0;
    }
  }

  /**
   * Calculate on-chain score (0-10)
   * NEW for Week 2 - Real blockchain data scoring
   * @param {Object} onchainMetrics - On-chain metrics from onchain-enhanced.service
   * @returns {number} On-chain score
   */
  calculateOnChainScore(onchainMetrics) {
    try {
      // If using mock/simulated data, return neutral score
      if (onchainMetrics.data_source?.includes('simulated') || 
          onchainMetrics.data_source?.includes('estimated')) {
        logger.info('[ScoringEngine] Using simulated on-chain data, returning neutral score');
        return 5.0;
      }

      let score = 0;
      let factors = 0;

      // 1. Holder Count Score (0-2.5 points)
      const holders = onchainMetrics.total_holders || onchainMetrics.holders_count;
      if (holders) {
        if (holders > 500000) {
          score += 2.5;
        } else if (holders > 100000) {
          score += 2.0;
        } else if (holders > 50000) {
          score += 1.5;
        } else if (holders > 10000) {
          score += 1.0;
        } else if (holders > 1000) {
          score += 0.5;
        } else {
          score += 0.2;
        }
        factors++;
      }

      // 2. Transaction Activity Score (0-2.5 points)
      const transfers7d = onchainMetrics.total_transfers_7d || onchainMetrics.transfers_7d;
      if (transfers7d) {
        if (transfers7d > 500000) {
          score += 2.5;
        } else if (transfers7d > 100000) {
          score += 2.0;
        } else if (transfers7d > 50000) {
          score += 1.5;
        } else if (transfers7d > 10000) {
          score += 1.0;
        } else if (transfers7d > 1000) {
          score += 0.5;
        } else {
          score += 0.2;
        }
        factors++;
      }

      // 3. Active Addresses Score (0-2.5 points)
      const activeAddresses = onchainMetrics.active_addresses_7d;
      if (activeAddresses) {
        if (activeAddresses > 100000) {
          score += 2.5;
        } else if (activeAddresses > 50000) {
          score += 2.0;
        } else if (activeAddresses > 20000) {
          score += 1.5;
        } else if (activeAddresses > 5000) {
          score += 1.0;
        } else if (activeAddresses > 1000) {
          score += 0.5;
        } else {
          score += 0.2;
        }
        factors++;
      }

      // 4. Distribution/Concentration Score (0-2.5 points)
      // Lower concentration = better (inverted score)
      const concentration = onchainMetrics.avg_concentration || onchainMetrics.top_10_concentration;
      if (concentration) {
        if (concentration < 20) { // Excellent distribution
          score += 2.5;
        } else if (concentration < 35) { // Good distribution
          score += 2.0;
        } else if (concentration < 50) { // Moderate distribution
          score += 1.5;
        } else if (concentration < 70) { // Poor distribution
          score += 1.0;
        } else if (concentration < 85) { // Very poor distribution
          score += 0.5;
        } else { // Extremely concentrated (red flag)
          score += 0.2;
        }
        factors++;
      }

      // Normalize to 0-10 scale
      const finalScore = factors > 0 ? (score / factors) * 4 : 5.0;

      logger.info('[ScoringEngine] On-chain score calculated:', {
        score: finalScore.toFixed(2),
        holders,
        transfers7d,
        activeAddresses,
        concentration: concentration?.toFixed(2),
        dataSource: onchainMetrics.data_source
      });

      return Math.min(10, Math.max(0, finalScore));
    } catch (error) {
      logger.error('[ScoringEngine] Error calculating on-chain score:', error.message);
      return 5.0;
    }
  }

  /**
   * Calculate liquidity score (0-10)
   * @param {Object} coinData - CoinGecko coin data
   * @returns {number} Liquidity score
   */
  calculateLiquidityScore(coinData) {
    try {
      const marketData = coinData.market_data || {};
      let score = 0;
      let factors = 0;

      // 1. Volume Score (0-3.3 points)
      const volume24h = marketData.total_volume?.usd || 0;
      if (volume24h > 100000000) { // >$100M
        score += 3.3;
      } else if (volume24h > 10000000) { // $10M-$100M
        score += 2.5;
      } else if (volume24h > 1000000) { // $1M-$10M
        score += 2.0;
      } else if (volume24h > 100000) { // $100K-$1M
        score += 1.0;
      } else if (volume24h > 10000) { // $10K-$100K
        score += 0.5;
      } else {
        score += 0.2;
      }
      factors++;

      // 2. Exchange Listing Score (0-3.3 points)
      const exchangeCount = coinData.tickers?.length || 0;
      if (exchangeCount > 100) {
        score += 3.3;
      } else if (exchangeCount > 50) {
        score += 2.5;
      } else if (exchangeCount > 20) {
        score += 2.0;
      } else if (exchangeCount > 10) {
        score += 1.5;
      } else if (exchangeCount > 5) {
        score += 1.0;
      } else if (exchangeCount > 2) {
        score += 0.5;
      } else {
        score += 0.2;
      }
      factors++;

      // 3. Volume/Market Cap Consistency (0-3.3 points)
      const marketCap = marketData.market_cap?.usd || 1;
      const volumeRatio = volume24h / marketCap;
      
      // Sweet spot: 5-20% volume/mcap ratio
      if (volumeRatio >= 0.05 && volumeRatio <= 0.20) {
        score += 3.3; // Ideal liquidity
      } else if (volumeRatio > 0.20 && volumeRatio <= 0.50) {
        score += 2.5; // High but acceptable
      } else if (volumeRatio > 0.02 && volumeRatio < 0.05) {
        score += 2.0; // Moderate
      } else if (volumeRatio > 0.01) {
        score += 1.0; // Low
      } else {
        score += 0.5; // Very low
      }
      factors++;

      // Normalize to 0-10 scale
      const finalScore = factors > 0 ? (score / factors) * 3 : 5.0;

      logger.info('[ScoringEngine] Liquidity score calculated:', {
        score: finalScore.toFixed(2),
        volume24h,
        exchangeCount,
        volumeRatio: volumeRatio.toFixed(4)
      });

      return Math.min(10, Math.max(0, finalScore));
    } catch (error) {
      logger.error('[ScoringEngine] Error calculating liquidity score:', error.message);
      return 5.0;
    }
  }

  /**
   * Calculate technical score (0-10)
   * @param {Object} coinData - CoinGecko coin data
   * @returns {number} Technical score
   */
  calculateTechnicalScore(coinData) {
    try {
      const marketData = coinData.market_data || {};
      let score = 0;
      let factors = 0;

      // 1. Price Momentum Score (0-2.5 points)
      const change24h = marketData.price_change_percentage_24h || 0;
      const change7d = marketData.price_change_percentage_7d || 0;
      const change30d = marketData.price_change_percentage_30d || 0;

      // Favor positive but not extreme momentum
      const avgMomentum = (change24h + change7d + change30d) / 3;
      
      if (avgMomentum > 5 && avgMomentum < 30) {
        score += 2.5; // Healthy uptrend
      } else if (avgMomentum > 0 && avgMomentum <= 5) {
        score += 2.0; // Slight uptrend
      } else if (avgMomentum >= -5 && avgMomentum <= 0) {
        score += 1.5; // Consolidation
      } else if (avgMomentum > 30) {
        score += 1.0; // Too hot
      } else {
        score += 0.5; // Downtrend
      }
      factors++;

      // 2. Volatility Score (0-2.5 points)
      // Calculate volatility from price changes
      const volatility = (Math.abs(change24h) + Math.abs(change7d) + Math.abs(change30d)) / 3;
      
      if (volatility < 5) {
        score += 2.5; // Low volatility - stable
      } else if (volatility < 15) {
        score += 2.0; // Moderate volatility
      } else if (volatility < 30) {
        score += 1.5; // High volatility
      } else if (volatility < 50) {
        score += 1.0; // Very high volatility
      } else {
        score += 0.5; // Extreme volatility
      }
      factors++;

      // 3. Distance from ATH (0-2.5 points)
      const athChangePercent = marketData.ath_change_percentage?.usd || -100;
      
      if (athChangePercent > -10) {
        score += 2.5; // Near ATH
      } else if (athChangePercent > -25) {
        score += 2.0; // Slight pullback
      } else if (athChangePercent > -50) {
        score += 1.5; // Moderate pullback
      } else if (athChangePercent > -75) {
        score += 1.0; // Deep pullback
      } else {
        score += 0.5; // Very deep pullback
      }
      factors++;

      // 4. Supply Metrics (0-2.5 points)
      const circulatingSupply = marketData.circulating_supply || 0;
      const totalSupply = marketData.total_supply || circulatingSupply;
      const maxSupply = marketData.max_supply || totalSupply;

      if (maxSupply > 0) {
        const supplyRatio = circulatingSupply / maxSupply;
        
        if (supplyRatio > 0.9) {
          score += 2.5; // Most supply in circulation
        } else if (supplyRatio > 0.7) {
          score += 2.0; // Majority in circulation
        } else if (supplyRatio > 0.5) {
          score += 1.5; // Half in circulation
        } else if (supplyRatio > 0.3) {
          score += 1.0; // Less than half
        } else {
          score += 0.5; // Low circulation ratio
        }
        factors++;
      }

      // Normalize to 0-10 scale
      const finalScore = factors > 0 ? (score / factors) * 4 : 5.0;

      logger.info('[ScoringEngine] Technical score calculated:', {
        score: finalScore.toFixed(2),
        avgMomentum: avgMomentum.toFixed(2),
        volatility: volatility.toFixed(2),
        athChangePercent: athChangePercent.toFixed(2)
      });

      return Math.min(10, Math.max(0, finalScore));
    } catch (error) {
      logger.error('[ScoringEngine] Error calculating technical score:', error.message);
      return 5.0;
    }
  }

  /**
   * Get score interpretation
   * @param {number} score - Score value (0-10)
   * @returns {Object} Interpretation details
   */
  interpretScore(score) {
    if (score >= 8.5) {
      return {
        rating: 'Excellent',
        color: '#00C853',
        description: 'Outstanding fundamentals',
        emoji: '🟢'
      };
    } else if (score >= 7.0) {
      return {
        rating: 'Very Good',
        color: '#64DD17',
        description: 'Strong fundamentals',
        emoji: '🟢'
      };
    } else if (score >= 6.0) {
      return {
        rating: 'Good',
        color: '#AEEA00',
        description: 'Solid fundamentals',
        emoji: '🟡'
      };
    } else if (score >= 5.0) {
      return {
        rating: 'Average',
        color: '#FFD600',
        description: 'Moderate fundamentals',
        emoji: '🟡'
      };
    } else if (score >= 4.0) {
      return {
        rating: 'Below Average',
        color: '#FF6F00',
        description: 'Weak fundamentals',
        emoji: '🟠'
      };
    } else if (score >= 3.0) {
      return {
        rating: 'Poor',
        color: '#FF3D00',
        description: 'Very weak fundamentals',
        emoji: '🔴'
      };
    } else {
      return {
        rating: 'Very Poor',
        color: '#DD2C00',
        description: 'Extremely weak fundamentals',
        emoji: '🔴'
      };
    }
  }

  /**
   * Generate score breakdown for display
   * @param {Object} scores - All component scores
   * @returns {Object} Detailed breakdown
   */
  getScoreBreakdown(scores) {
    return {
      overall: {
        score: scores.overall,
        interpretation: this.interpretScore(scores.overall)
      },
      components: {
        market: {
          score: scores.market,
          weight: this.weights.market,
          contribution: scores.market * this.weights.market,
          interpretation: this.interpretScore(scores.market)
        },
        social: {
          score: scores.social,
          weight: this.weights.social,
          contribution: scores.social * this.weights.social,
          interpretation: this.interpretScore(scores.social)
        },
        onchain: {
          score: scores.onchain,
          weight: this.weights.onchain,
          contribution: scores.onchain * this.weights.onchain,
          interpretation: this.interpretScore(scores.onchain)
        },
        liquidity: {
          score: scores.liquidity,
          weight: this.weights.liquidity,
          contribution: scores.liquidity * this.weights.liquidity,
          interpretation: this.interpretScore(scores.liquidity)
        },
        technical: {
          score: scores.technical,
          weight: this.weights.technical,
          contribution: scores.technical * this.weights.technical,
          interpretation: this.interpretScore(scores.technical)
        }
      }
    };
  }

  /**
   * Get scoring weights
   * @returns {Object} Current weights configuration
   */
  getWeights() {
    return { ...this.weights };
  }

  /**
   * Update scoring weights (for customization)
   * @param {Object} newWeights - New weights object
   */
  setWeights(newWeights) {
    const total = Object.values(newWeights).reduce((a, b) => a + b, 0);
    
    if (Math.abs(total - 1.0) > 0.01) {
      throw new Error('Weights must sum to 1.0 (100%)');
    }

    this.weights = { ...newWeights };
    logger.info('[ScoringEngine] Weights updated:', this.weights);
  }
}

module.exports = new ScoringEngine();