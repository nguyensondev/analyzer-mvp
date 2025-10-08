const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');
const db = require('../../utils/database');

class TwitterAPIService {
  constructor() {
    this.bearerToken = process.env.TWITTER_BEARER_TOKEN;
    this.baseUrl = 'https://api.twitter.com/2';
    this.timeout = 10000;
  }

  async getAccountMetrics(ticker) {
    if (!this.bearerToken) {
      logger.warn('Twitter Bearer Token not configured, skipping Twitter API');
      return null;
    }

    const startTime = Date.now();
    
    try {
      // Step 1: Search for official account
      const username = await this.findOfficialAccount(ticker);
      
      if (!username) {
        logger.info(`No official Twitter account found for ${ticker}`);
        return null;
      }

      // Step 2: Get user details
      const userResponse = await axios.get(
        `${this.baseUrl}/users/by/username/${username}`,
        {
          params: {
            'user.fields': 'created_at,description,public_metrics,verified,verified_type'
          },
          headers: {
            'Authorization': `Bearer ${this.bearerToken}`
          },
          timeout: this.timeout
        }
      );

      const userData = userResponse.data.data;
      const metrics = userData.public_metrics;

      // Step 3: Get recent mentions/engagement
      const mentionData = await this.getRecentMentions(ticker, username);

      const result = {
        username: userData.username,
        name: userData.name,
        verified: userData.verified || false,
        created_at: userData.created_at,
        description: userData.description,
        
        // Core metrics
        followers_count: metrics.followers_count,
        following_count: metrics.following_count,
        tweet_count: metrics.tweet_count,
        listed_count: metrics.listed_count,
        
        // Calculated metrics
        follower_following_ratio: this.calculateRatio(
          metrics.followers_count, 
          metrics.following_count
        ),
        
        // Engagement metrics
        recent_mentions: mentionData.mention_count,
        mention_growth: mentionData.growth_7d,
        average_engagement: mentionData.avg_engagement,
        
        // Quality indicators
        account_age_days: this.calculateAccountAge(userData.created_at),
        tweets_per_day: this.calculateTweetsPerDay(
          metrics.tweet_count, 
          userData.created_at
        ),
        
        data_source: 'twitter_api_v2',
        reliability: 'high',
        timestamp: new Date().toISOString()
      };

      await db.logApiCall('twitter_api', `/users/by/username/${username}`, 200, Date.now() - startTime);
      logger.info(`Twitter API data fetched for ${ticker}`, {
        username: username,
        followers: result.followers_count,
        responseTime: Date.now() - startTime
      });

      return result;

    } catch (error) {
      const status = error.response?.status || 500;
      await db.logApiCall('twitter_api', `/users/${ticker}`, status, Date.now() - startTime);
      
      if (status === 429) {
        logger.warn(`Twitter API rate limit exceeded for ${ticker}`);
      } else {
        logger.error(`Twitter API error for ${ticker}:`, error.message);
      }
      
      return null;
    }
  }

  async findOfficialAccount(ticker) {
    try {
      // Common username patterns
      const patterns = [
        ticker.toLowerCase(),
        `${ticker.toLowerCase()}coin`,
        `${ticker.toLowerCase()}protocol`,
        `${ticker.toLowerCase()}network`,
        `official${ticker.toLowerCase()}`
      ];

      // Try each pattern
      for (const username of patterns) {
        try {
          const response = await axios.get(
            `${this.baseUrl}/users/by/username/${username}`,
            {
              headers: {
                'Authorization': `Bearer ${this.bearerToken}`
              },
              timeout: 5000
            }
          );

          if (response.data && response.data.data) {
            logger.info(`Found Twitter account: @${username} for ${ticker}`);
            return username;
          }
        } catch (err) {
          // Continue to next pattern
          continue;
        }
      }

      return null;
    } catch (error) {
      logger.error('Error finding Twitter account:', error.message);
      return null;
    }
  }

  async getRecentMentions(ticker, username) {
    try {
      const query = `${ticker} OR @${username} -is:retweet`;
      
      const response = await axios.get(
        `${this.baseUrl}/tweets/search/recent`,
        {
          params: {
            query: query,
            max_results: 100,
            'tweet.fields': 'public_metrics,created_at'
          },
          headers: {
            'Authorization': `Bearer ${this.bearerToken}`
          },
          timeout: this.timeout
        }
      );

      const tweets = response.data.data || [];
      
      if (tweets.length === 0) {
        return {
          mention_count: 0,
          growth_7d: 0,
          avg_engagement: 0
        };
      }

      // Calculate metrics
      const totalEngagement = tweets.reduce((sum, tweet) => {
        const metrics = tweet.public_metrics;
        return sum + metrics.like_count + metrics.retweet_count + metrics.reply_count;
      }, 0);

      return {
        mention_count: tweets.length,
        growth_7d: this.estimateGrowth(tweets),
        avg_engagement: Math.round(totalEngagement / tweets.length)
      };

    } catch (error) {
      logger.error('Error getting Twitter mentions:', error.message);
      return {
        mention_count: 0,
        growth_7d: 0,
        avg_engagement: 0
      };
    }
  }

  calculateRatio(followers, following) {
    if (following === 0) return 9999;
    return parseFloat((followers / following).toFixed(2));
  }

  calculateAccountAge(createdAt) {
    const created = new Date(createdAt);
    const now = new Date();
    const diffTime = Math.abs(now - created);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  calculateTweetsPerDay(totalTweets, createdAt) {
    const ageDays = this.calculateAccountAge(createdAt);
    if (ageDays === 0) return 0;
    return parseFloat((totalTweets / ageDays).toFixed(2));
  }

  estimateGrowth(tweets) {
    // Simple growth estimation based on recent activity
    const now = new Date();
    const recent = tweets.filter(t => {
      const tweetDate = new Date(t.created_at);
      const hoursDiff = (now - tweetDate) / (1000 * 60 * 60);
      return hoursDiff <= 24;
    }).length;

    const older = tweets.length - recent;
    
    if (older === 0) return 100;
    return parseFloat(((recent - older) / older * 100).toFixed(2));
  }
}

module.exports = new TwitterAPIService();