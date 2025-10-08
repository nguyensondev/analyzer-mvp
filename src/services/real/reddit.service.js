const axios = require('axios');
const logger = require('../../utils/logger');
const db = require('../../utils/database');

class RedditService {
  constructor() {
    this.baseUrl = 'https://www.reddit.com';
    this.timeout = 10000;
    this.userAgent = 'CryptoFundamentalAnalyzer/1.0';
  }

  async getCommunityMetrics(ticker, coinName) {
    const startTime = Date.now();
    
    try {
      // Step 1: Find subreddit
      const subreddit = await this.findSubreddit(ticker, coinName);
      
      if (!subreddit) {
        logger.info(`No subreddit found for ${ticker}`);
        return null;
      }

      // Step 2: Get subreddit info
      const aboutResponse = await axios.get(
        `${this.baseUrl}/r/${subreddit}/about.json`,
        {
          headers: {
            'User-Agent': this.userAgent
          },
          timeout: this.timeout
        }
      );

      const aboutData = aboutResponse.data.data;

      // Step 3: Get recent posts
      const postsResponse = await axios.get(
        `${this.baseUrl}/r/${subreddit}/hot.json`,
        {
          params: { limit: 25 },
          headers: {
            'User-Agent': this.userAgent
          },
          timeout: this.timeout
        }
      );

      const posts = postsResponse.data.data.children;

      // Calculate engagement metrics
      const engagement = this.calculateEngagement(posts);

      const result = {
        subreddit: subreddit,
        display_name: aboutData.display_name,
        title: aboutData.title,
        description: aboutData.public_description,
        
        // Core metrics
        subscribers: aboutData.subscribers,
        active_users: aboutData.active_user_count || aboutData.accounts_active || 0,
        created_utc: aboutData.created_utc,
        
        // Calculated metrics - FIX: Ensure activity_ratio always has value
        activity_ratio: this.calculateActivityRatio(
          aboutData.active_user_count || aboutData.accounts_active || 0,
          aboutData.subscribers
        ),
        
        // Engagement metrics
        avg_posts_per_day: engagement.posts_per_day,
        avg_score: engagement.avg_score,
        avg_comments: engagement.avg_comments,
        engagement_rate: engagement.engagement_rate,
        
        // Community health
        community_age_days: this.calculateAge(aboutData.created_utc),
        subscribers_per_day: this.calculateGrowthRate(
          aboutData.subscribers,
          aboutData.created_utc
        ),
        
        // Quality indicators
        is_over_18: aboutData.over18,
        quarantined: aboutData.quarantine || false,
        
        data_source: 'reddit_api',
        reliability: 'high',
        timestamp: new Date().toISOString()
      };

      // LOG the result to debug
      logger.debug('[Reddit] Result data', {
        subreddit: result.subreddit,
        subscribers: result.subscribers,
        active_users: result.active_users,
        activity_ratio: result.activity_ratio,
        engagement_rate: result.engagement_rate
      });

      await db.logApiCall('reddit', `/r/${subreddit}/about`, 200, Date.now() - startTime);
      logger.info(`Reddit data fetched for ${ticker}`, {
        subreddit: subreddit,
        subscribers: result.subscribers,
        responseTime: Date.now() - startTime
      });

      return result;

    } catch (error) {
      const status = error.response?.status || 500;
      await db.logApiCall('reddit', `/r/${ticker}`, status, Date.now() - startTime);
      
      if (status === 429) {
        logger.warn(`Reddit API rate limit exceeded for ${ticker}`);
      } else if (status === 404) {
        logger.info(`Subreddit not found for ${ticker}`);
      } else {
        logger.error(`Reddit API error for ${ticker}:`, error.message);
      }
      
      return null;
    }
  }

  async findSubreddit(ticker, coinName) {
    // Common subreddit naming patterns
    const patterns = [
      ticker.toLowerCase(),
      coinName?.toLowerCase().replace(/\s+/g, ''),
      `${ticker.toLowerCase()}coin`,
      `${ticker.toLowerCase()}token`,
      `${ticker.toLowerCase()}network`
    ].filter(Boolean);

    // Try each pattern
    for (const name of patterns) {
      try {
        const response = await axios.get(
          `${this.baseUrl}/r/${name}/about.json`,
          {
            headers: {
              'User-Agent': this.userAgent
            },
            timeout: 5000
          }
        );

        if (response.data && response.data.data) {
          logger.info(`Found subreddit: r/${name} for ${ticker}`);
          return name;
        }
      } catch (err) {
        // Continue to next pattern
        continue;
      }
    }

    return null;
  }

  calculateEngagement(posts) {
    if (posts.length === 0) {
      return {
        posts_per_day: 0,
        avg_score: 0,
        avg_comments: 0,
        engagement_rate: 0
      };
    }

    let totalScore = 0;
    let totalComments = 0;
    let totalEngagement = 0;

    posts.forEach(post => {
      const data = post.data;
      totalScore += data.score;
      totalComments += data.num_comments;
      totalEngagement += data.score + data.num_comments;
    });

    const avgScore = Math.round(totalScore / posts.length);
    const avgComments = Math.round(totalComments / posts.length);
    const avgEngagement = Math.round(totalEngagement / posts.length);

    return {
      posts_per_day: posts.length, // Simplified, real would need time range
      avg_score: avgScore,
      avg_comments: avgComments,
      engagement_rate: avgEngagement
    };
  }

  calculateActivityRatio(activeUsers, totalSubscribers) {
    if (totalSubscribers === 0) return 0;
    return parseFloat(((activeUsers / totalSubscribers) * 100).toFixed(2));
  }

  calculateAge(createdUtc) {
    const created = new Date(createdUtc * 1000);
    const now = new Date();
    const diffTime = Math.abs(now - created);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  calculateGrowthRate(subscribers, createdUtc) {
    const ageDays = this.calculateAge(createdUtc);
    if (ageDays === 0) return 0;
    return parseFloat((subscribers / ageDays).toFixed(2));
  }
}

module.exports = new RedditService();