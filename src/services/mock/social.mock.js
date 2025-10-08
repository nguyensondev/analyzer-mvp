const config = require('../../config');
const logger = require('../../utils/logger');

class SocialMockService {
  constructor() {
    this.variance = config.mock.dataVariance;
  }

  // Simulate LunarCrush-style social metrics
  generateSocialMetrics(ticker, marketCap, twitterFollowers) {
    logger.info(`Generating mock social data for ${ticker}`);

    // Base score on market cap tier
    const baseScore = this.getBaseScoreFromMarketCap(marketCap);
    
    // Adjust based on Twitter followers if available
    const followerBoost = twitterFollowers > 100000 ? 10 : 
                          twitterFollowers > 50000 ? 5 : 0;

    const galaxyScore = Math.min(100, 
      this.addVariance(baseScore + followerBoost, 0, 100)
    );

    const altRank = this.calculateAltRank(marketCap);
    
    const socialVolume = this.addVariance(
      this.estimateSocialVolume(marketCap, twitterFollowers),
      1000,
      100000
    );

    const sentiment = this.determineSentiment(galaxyScore);

    return {
      data_source: 'simulated (LunarCrush-style)',
      galaxy_score: Math.round(galaxyScore),
      alt_rank: altRank,
      social_volume_24h: Math.round(socialVolume),
      social_dominance: this.calculateDominance(marketCap),
      sentiment: sentiment,
      influencer_mentions: Math.round(this.addVariance(galaxyScore / 2, 5, 200)),
      reddit_engagement: Math.round(this.addVariance(socialVolume / 10, 100, 5000)),
      disclaimer: 'Simulated based on market cap and follower correlation',
      confidence_level: twitterFollowers > 0 ? 'medium' : 'low'
    };
  }

  getBaseScoreFromMarketCap(marketCap) {
    if (marketCap > 10000000000) return 75; // >$10B
    if (marketCap > 1000000000) return 65;  // >$1B
    if (marketCap > 100000000) return 55;   // >$100M
    if (marketCap > 10000000) return 45;    // >$10M
    return 35;
  }

  calculateAltRank(marketCap) {
    // Higher market cap = better rank (lower number)
    if (marketCap > 10000000000) return Math.round(this.addVariance(50, 10, 100));
    if (marketCap > 1000000000) return Math.round(this.addVariance(150, 100, 300));
    if (marketCap > 100000000) return Math.round(this.addVariance(500, 300, 800));
    return Math.round(this.addVariance(1500, 800, 3000));
  }

  estimateSocialVolume(marketCap, followers) {
    let baseVolume = (marketCap / 1000000) * 10; // $1M mcap ≈ 10 mentions
    
    if (followers > 0) {
      baseVolume += followers / 10; // 100k followers ≈ 10k mentions
    }
    
    return Math.max(1000, baseVolume);
  }

  calculateDominance(marketCap) {
    // Social dominance as % (rough estimate)
    const btcMarketCap = 1200000000000; // ~$1.2T
    const dominance = (marketCap / btcMarketCap) * 100;
    return Math.min(50, Math.max(0.01, dominance)).toFixed(2);
  }

  determineSentiment(galaxyScore) {
    if (galaxyScore >= 70) return 'bullish';
    if (galaxyScore >= 50) return 'neutral';
    return 'bearish';
  }

  addVariance(value, min, max) {
    const variance = value * this.variance;
    const randomFactor = (Math.random() - 0.5) * 2; // -1 to 1
    const newValue = value + (variance * randomFactor);
    return Math.max(min, Math.min(max, newValue));
  }
}

module.exports = new SocialMockService();