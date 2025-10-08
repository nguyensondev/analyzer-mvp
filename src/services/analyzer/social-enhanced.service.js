const twitterAPI = require('../real/twitter-api.service');
const redditService = require('../real/reddit.service');
const githubService = require('../real/github.service');
const socialMock = require('../mock/social.mock');
const config = require('../../config');
const logger = require('../../utils/logger');

class SocialEnhancedService {
  async getSocialMetrics(ticker, coinName, marketCap) {
    logger.info(`[SocialEnhanced] Fetching social metrics for ${ticker}`);
    
    // Parallel fetch from all sources
    const [twitterData, redditData, githubData] = await Promise.all([
      twitterAPI.getAccountMetrics(ticker).catch(err => {
        logger.warn(`Twitter API failed: ${err.message}`);
        return null;
      }),
      redditService.getCommunityMetrics(ticker, coinName).catch(err => {
        logger.warn(`Reddit API failed: ${err.message}`);
        return null;
      }),
      githubService.getDevActivity(ticker, coinName).catch(err => {
        logger.warn(`GitHub API failed: ${err.message}`);
        return null;
      })
    ]);

    // Determine data quality
    const hasRealData = !!(twitterData || redditData || githubData);
    
    if (!hasRealData) {
      logger.info(`[SocialEnhanced] No real data available, using mock for ${ticker}`);
      // Fallback to mock
      return {
        ...socialMock.generateSocialMetrics(ticker, marketCap, 0),
        data_quality: 'simulated',
        reason: 'No real social data available'
      };
    }

    // Aggregate real data
    const aggregated = this.aggregateRealData(
      ticker,
      twitterData,
      redditData,
      githubData,
      marketCap
    );

    logger.info(`[SocialEnhanced] Real data used for ${ticker}`, {
      twitter: !!twitterData,
      reddit: !!redditData,
      github: !!githubData
    });

    return aggregated;
  }

  aggregateRealData(ticker, twitter, reddit, github, marketCap) {
    // Calculate combined metrics - ENSURE ALL RETURN NUMBERS
    const communityScore = this.calculateCommunityScore(twitter, reddit) || 0;
    const engagementScore = this.calculateEngagementScore(twitter, reddit) || 0;
    const developerScore = this.calculateDeveloperScore(github) || 0;
    
    logger.info('[SocialEnhanced] Calculated scores', {
      ticker,
      communityScore: communityScore,
      engagementScore: engagementScore,
      developerScore: developerScore,
      hasTwitter: !!twitter,
      hasReddit: !!reddit,
      hasGithub: !!github
    });
    
    const overallScore = this.calculateOverallScore({
      community_score: communityScore,
      engagement_score: engagementScore,
      developer_score: developerScore
    });
    
    logger.info('[SocialEnhanced] Overall score calculated', {
      ticker,
      overallScore: overallScore
    });

    const metrics = {
      ticker: ticker.toUpperCase(),
      data_source: 'real (enhanced)',
      data_quality: 'high',
      
      // Twitter metrics
      twitter: twitter ? {
        username: twitter.username,
        followers: twitter.followers_count,
        engagement: twitter.average_engagement,
        verified: twitter.verified,
        account_age_days: twitter.account_age_days,
        tweets_per_day: twitter.tweets_per_day,
        follower_ratio: twitter.follower_following_ratio
      } : null,
      
      // Reddit metrics
      reddit: reddit ? {
        subreddit: reddit.subreddit,
        subscribers: reddit.subscribers,
        active_users: reddit.active_users,
        activity_ratio: reddit.activity_ratio,
        engagement_rate: reddit.engagement_rate,
        community_age_days: reddit.community_age_days
      } : null,
      
      // GitHub metrics
      github: github ? {
        repository: github.repository,
        stars: github.stars,
        forks: github.forks,
        commits_last_month: github.commits_last_month,
        contributors: github.total_contributors,
        days_since_last_commit: github.days_since_last_commit,
        commits_last_week: github.commits_last_week
      } : null,
      
      // Combined scores (0-100 scale) - NOW CALCULATED ABOVE
      community_score: communityScore,
      engagement_score: engagementScore,
      developer_score: developerScore,
      overall_social_score: overallScore,
      
      // Sentiment (estimated from engagement)
      sentiment: this.estimateSentiment(twitter, reddit, marketCap),
      
      // Growth indicators
      growth_indicators: {
        twitter_growing: twitter ? twitter.mention_growth > 0 : false,
        reddit_active: reddit ? reddit.activity_ratio > 1 : false,
        github_active: github ? github.days_since_last_commit < 7 : false
      },
      
      confidence_level: this.calculateConfidence(twitter, reddit, github),
      timestamp: new Date().toISOString()
    };

    return metrics;
  }

  calculateCommunityScore(twitter, reddit) {
    let score = 0;
    let weight = 0;

    logger.debug('[CommunityScore] Calculating...', { 
      hasTwitter: !!twitter, 
      hasReddit: !!reddit,
      redditSubs: reddit?.subscribers 
    });

    // Twitter contribution (0-50 points)
    if (twitter) {
      const followerScore = Math.min(50, (twitter.followers_count / 100000) * 25);
      const engagementScore = Math.min(25, (twitter.average_engagement / 1000) * 25);
      score += followerScore + engagementScore;
      weight += 50;
      logger.debug('[CommunityScore] Twitter contribution', { followerScore, engagementScore, score, weight });
    }

    // Reddit contribution (0-50 points)
    if (reddit && reddit.subscribers) {
      const subscriberScore = Math.min(30, (reddit.subscribers / 50000) * 30);
      const activityScore = Math.min(20, (reddit.activity_ratio || 0) * 10);
      score += subscriberScore + activityScore;
      weight += 50;
      logger.debug('[CommunityScore] Reddit contribution', { subscriberScore, activityScore, score, weight });
    }

    // Normalize to 0-100
    if (weight === 0) {
      logger.warn('[CommunityScore] No data available, returning 0');
      return 0;
    }
    
    const finalScore = Math.min(100, Math.round((score / weight) * 100));
    logger.debug('[CommunityScore] Final score', { score, weight, finalScore });
    
    return finalScore;
  }

  calculateEngagementScore(twitter, reddit) {
    let score = 0;
    let count = 0;

    logger.debug('[EngagementScore] Calculating...', { 
      hasTwitter: !!twitter, 
      hasReddit: !!reddit 
    });

    if (twitter && twitter.followers_count && twitter.average_engagement) {
      // High engagement if > 1% of followers engage
      const engagementRate = (twitter.average_engagement / twitter.followers_count) * 100;
      const twitterScore = Math.min(100, engagementRate * 50);
      score += twitterScore;
      count++;
      logger.debug('[EngagementScore] Twitter', { engagementRate, twitterScore });
    }

    if (reddit && reddit.engagement_rate !== undefined) {
      const redditScore = Math.min(100, reddit.engagement_rate);
      score += redditScore;
      count++;
      logger.debug('[EngagementScore] Reddit', { redditScore });
    }

    if (count === 0) {
      logger.warn('[EngagementScore] No engagement data, returning 0');
      return 0;
    }
    
    const finalScore = Math.round(score / count);
    logger.debug('[EngagementScore] Final', { score, count, finalScore });
    
    return finalScore;
  }

  calculateDeveloperScore(github) {
    if (!github) {
      logger.debug('[DeveloperScore] No GitHub data, returning 0');
      return 0;
    }

    logger.debug('[DeveloperScore] Calculating...', { 
      stars: github.stars,
      commits: github.commits_last_month,
      contributors: github.contributors
    });

    let score = 0;

    // Stars (0-30 points)
    const starScore = Math.min(30, (github.stars / 1000) * 30);
    score += starScore;

    // Recent activity (0-40 points)
    if (github.days_since_last_commit < 7) {
      score += 40;
    } else if (github.days_since_last_commit < 30) {
      score += 20;
    }

    // Contributors (0-20 points)
    const contributorScore = Math.min(20, (github.contributors / 50) * 20);
    score += contributorScore;

    // Commits last month (0-10 points)
    const commitScore = Math.min(10, (github.commits_last_month / 100) * 10);
    score += commitScore;

    const finalScore = Math.min(100, Math.round(score));
    logger.debug('[DeveloperScore] Final', { 
      starScore, 
      contributorScore, 
      commitScore, 
      finalScore 
    });
    
    return finalScore;
  }

  calculateOverallScore(metrics) {
    const weights = {
      community: 0.40,
      engagement: 0.30,
      developer: 0.30
    };

    logger.debug('[OverallScore] Input metrics', {
      community_score: metrics.community_score,
      engagement_score: metrics.engagement_score,
      developer_score: metrics.developer_score
    });

    // Ensure all scores are numbers, default to 0
    const communityScore = Number(metrics.community_score) || 0;
    const engagementScore = Number(metrics.engagement_score) || 0;
    const developerScore = Number(metrics.developer_score) || 0;

    const score = 
      communityScore * weights.community +
      engagementScore * weights.engagement +
      developerScore * weights.developer;

    const finalScore = Math.round(score);
    
    logger.debug('[OverallScore] Calculation', {
      communityScore,
      engagementScore,
      developerScore,
      weightedScore: score,
      finalScore,
      isNaN: isNaN(finalScore)
    });

    // Return 0 if NaN, otherwise return score
    return isNaN(finalScore) ? 0 : finalScore;
  }

  estimateSentiment(twitter, reddit, marketCap) {
    // Simple heuristic
    let positiveSignals = 0;
    let totalSignals = 0;

    if (twitter) {
      totalSignals++;
      if (twitter.mention_growth > 10) positiveSignals++;
      if (twitter.follower_following_ratio > 10) positiveSignals += 0.5;
    }

    if (reddit) {
      totalSignals++;
      if (reddit.activity_ratio > 2) positiveSignals++;
      if (reddit.engagement_rate > 50) positiveSignals += 0.5;
    }

    if (totalSignals === 0) return 'neutral';

    const sentimentScore = positiveSignals / totalSignals;
    
    if (sentimentScore > 0.7) return 'bullish';
    if (sentimentScore < 0.3) return 'bearish';
    return 'neutral';
  }

  calculateConfidence(twitter, reddit, github) {
    const sources = [twitter, reddit, github].filter(Boolean).length;
    
    if (sources === 3) return 'high';
    if (sources === 2) return 'medium';
    if (sources === 1) return 'low';
    return 'none';
  }
}

module.exports = new SocialEnhancedService();