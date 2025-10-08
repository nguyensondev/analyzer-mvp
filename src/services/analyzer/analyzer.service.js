const coingeckoService = require('../real/coingecko.service');
const socialEnhancedService = require('../real/social-enhanced.service');
const onchainEnhancedService = require('../real/onchain-enhanced.service');
const scoringEngine = require('./scoring.engine');
const logger = require('../../utils/logger');
const cache = require('../../utils/cache');

/**
 * Main Analyzer Service
 * Orchestrates all data collection and analysis
 */
class AnalyzerService {
  constructor() {
    this.cachePrefix = 'analysis:';
    this.cacheTTL = 1800; // 30 minutes
  }

  /**
   * Analyze a cryptocurrency
   * @param {string} ticker - Coin ticker symbol
   * @returns {Object} Complete analysis results
   */
  async analyze(ticker) {
    const startTime = Date.now();
    
    try {
      logger.info(`[Analyzer] Starting analysis for ${ticker}`);

      // Check cache
      const cacheKey = `${this.cachePrefix}${ticker.toUpperCase()}`;
      const cached = await cache.get(cacheKey);
      if (cached) {
        logger.info(`[Analyzer] Using cached analysis for ${ticker}`);
        cached.from_cache = true;
        return cached;
      }

      // Step 1: Get basic coin data from CoinGecko
      logger.info(`[Analyzer] Step 1/4: Fetching CoinGecko data for ${ticker}`);
      const coinData = await coingeckoService.getCoinData(ticker);
      
      if (!coinData) {
        throw new Error(`Coin ${ticker} not found`);
      }

      // Step 2: Get social metrics (Week 1 - Real)
      logger.info(`[Analyzer] Step 2/4: Fetching social metrics for ${ticker}`);
      const socialMetrics = await socialEnhancedService.getSocialMetrics(
        ticker, 
        coinData
      );

      // Step 3: Get on-chain metrics (Week 2 - Real)
      logger.info(`[Analyzer] Step 3/4: Fetching on-chain metrics for ${ticker}`);
      const onchainMetrics = await onchainEnhancedService.getOnChainMetrics(
        ticker,
        coinData
      );

      // Step 4: Calculate scores and generate insights
      logger.info(`[Analyzer] Step 4/4: Calculating scores for ${ticker}`);
      const analysis = await this.buildAnalysis(
        coinData,
        socialMetrics,
        onchainMetrics
      );

      // Add execution time
      analysis.execution_time_ms = Date.now() - startTime;
      analysis.timestamp = new Date().toISOString();
      analysis.from_cache = false;

      // Cache the results
      await cache.set(cacheKey, analysis, this.cacheTTL);

      logger.info(`[Analyzer] Analysis complete for ${ticker} in ${analysis.execution_time_ms}ms`);

      return analysis;
    } catch (error) {
      logger.error(`[Analyzer] Error analyzing ${ticker}:`, error.message);
      throw error;
    }
  }

  /**
   * Build complete analysis object
   * @private
   */
  async buildAnalysis(coinData, socialMetrics, onchainMetrics) {
    // Extract basic info
    const basicInfo = this.extractBasicInfo(coinData);

    // Calculate individual scores
    const marketScore = scoringEngine.calculateMarketScore(coinData);
    const socialScore = scoringEngine.calculateSocialScore(socialMetrics);
    const onchainScore = onchainEnhancedService.calculateActivityScore(onchainMetrics);
    const liquidityScore = scoringEngine.calculateLiquidityScore(coinData);
    const technicalScore = scoringEngine.calculateTechnicalScore(coinData);

    // Calculate overall score
    const overallScore = scoringEngine.calculateOverallScore({
      market: marketScore,
      social: socialScore,
      onchain: onchainScore,
      liquidity: liquidityScore,
      technical: technicalScore
    });

    // Generate insights
    const insights = this.generateInsights(
      coinData,
      socialMetrics,
      onchainMetrics,
      overallScore
    );

    // Determine investment recommendation
    const recommendation = this.getRecommendation(overallScore, insights);

    return {
      // Basic Information
      basic_info: basicInfo,

      // Scores (0-10 scale)
      scores: {
        overall: parseFloat(overallScore.toFixed(2)),
        market: parseFloat(marketScore.toFixed(2)),
        social: parseFloat(socialScore.toFixed(2)),
        onchain: parseFloat(onchainScore.toFixed(2)),
        liquidity: parseFloat(liquidityScore.toFixed(2)),
        technical: parseFloat(technicalScore.toFixed(2))
      },

      // Market Metrics
      market_metrics: {
        market_cap: coinData.market_data?.market_cap?.usd || 0,
        market_cap_rank: coinData.market_cap_rank || null,
        volume_24h: coinData.market_data?.total_volume?.usd || 0,
        volume_to_market_cap: this.calculateVolumeRatio(coinData),
        price_change_24h: coinData.market_data?.price_change_percentage_24h || 0,
        price_change_7d: coinData.market_data?.price_change_percentage_7d || 0,
        price_change_30d: coinData.market_data?.price_change_percentage_30d || 0,
        all_time_high: coinData.market_data?.ath?.usd || 0,
        ath_change_percentage: coinData.market_data?.ath_change_percentage?.usd || 0,
        circulating_supply: coinData.market_data?.circulating_supply || 0,
        total_supply: coinData.market_data?.total_supply || 0
      },

      // Social Metrics (Week 1 - Enhanced)
      social_metrics: {
        community_score: socialMetrics.scores?.community || null,
        engagement_score: socialMetrics.scores?.engagement || null,
        developer_score: socialMetrics.scores?.developer || null,
        overall_social_score: socialMetrics.scores?.overall || null,
        
        // Platform presence
        has_twitter: socialMetrics.platforms?.twitter?.found || false,
        has_reddit: socialMetrics.platforms?.reddit?.found || false,
        has_github: socialMetrics.platforms?.github?.found || false,
        
        // Detailed metrics
        twitter_followers: socialMetrics.platforms?.twitter?.followers || null,
        reddit_subscribers: socialMetrics.platforms?.reddit?.subscribers || null,
        github_stars: socialMetrics.platforms?.github?.stars || null,
        github_forks: socialMetrics.platforms?.github?.forks || null,
        
        // Flags
        flags: socialMetrics.flags || []
      },

      // On-Chain Metrics (Week 2 - Enhanced)
      onchain_metrics: {
        // Aggregated metrics
        total_holders: onchainMetrics.total_holders || onchainMetrics.holders_count || null,
        active_addresses_7d: onchainMetrics.active_addresses_7d || null,
        active_addresses_30d: onchainMetrics.active_addresses_30d || null,
        transfers_24h: onchainMetrics.total_transfers_24h || onchainMetrics.transfers_24h || null,
        transfers_7d: onchainMetrics.total_transfers_7d || onchainMetrics.transfers_7d || null,
        
        // Distribution
        concentration_top10: onchainMetrics.avg_concentration || onchainMetrics.top_10_concentration || null,
        
        // Chain information
        primary_chain: onchainMetrics.chain_info?.primary || null,
        supported_chains: onchainMetrics.chain_info?.detected || [],
        is_multichain: onchainMetrics.chain_info?.is_multichain || false,
        
        // Chain-specific data (if multi-chain)
        chain_breakdown: onchainMetrics.chains || null,
        
        // Activity ratios
        daily_active_ratio: this.calculateActiveRatio(onchainMetrics),
        
        // Data quality
        data_source: onchainMetrics.data_source || 'unknown'
      },

      // Liquidity Metrics
      liquidity_metrics: {
        exchanges_count: coinData.tickers?.length || 0,
        top_exchanges: this.getTopExchanges(coinData),
        bid_ask_spread: this.calculateSpread(coinData),
        liquidity_score: parseFloat(liquidityScore.toFixed(2))
      },

      // Technical Metrics
      technical_metrics: {
        volatility_30d: this.calculateVolatility(coinData),
        trend_direction: this.analyzeTrend(coinData),
        support_level: this.findSupportLevel(coinData),
        resistance_level: this.findResistanceLevel(coinData)
      },

      // Investment Analysis
      investment_analysis: {
        recommendation: recommendation.action,
        confidence_level: recommendation.confidence,
        risk_level: this.assessRiskLevel(overallScore, insights),
        potential_return: this.estimatePotential(overallScore, coinData),
        time_horizon: recommendation.timeHorizon,
        entry_strategy: recommendation.entryStrategy
      },

      // Insights and Flags
      insights: {
        strengths: insights.strengths,
        weaknesses: insights.weaknesses,
        opportunities: insights.opportunities,
        risks: insights.risks,
        key_insights: insights.key
      },

      // Metadata
      metadata: {
        analyzed_at: new Date().toISOString(),
        data_sources: {
          market_data: 'CoinGecko API',
          social_sentiment: socialMetrics.data_source || 'unknown',
          onchain_activity: onchainMetrics.data_source || 'unknown'
        },
        reliability: this.assessReliability(socialMetrics, onchainMetrics)
      }
    };
  }

  /**
   * Extract basic coin information
   * @private
   */
  extractBasicInfo(coinData) {
    return {
      id: coinData.id,
      symbol: coinData.symbol?.toUpperCase(),
      name: coinData.name,
      current_price: coinData.market_data?.current_price?.usd || 0,
      image: coinData.image?.large || coinData.image?.small || null,
      description: coinData.description?.en?.substring(0, 500) || null,
      categories: coinData.categories || [],
      homepage: coinData.links?.homepage?.[0] || null,
      blockchain_site: coinData.links?.blockchain_site?.[0] || null
    };
  }

  /**
   * Generate comprehensive insights
   * @private
   */
  generateInsights(coinData, socialMetrics, onchainMetrics, overallScore) {
    const insights = {
      strengths: [],
      weaknesses: [],
      opportunities: [],
      risks: [],
      key: []
    };

    // Market strengths/weaknesses
    const marketCap = coinData.market_data?.market_cap?.usd || 0;
    const volume24h = coinData.market_data?.total_volume?.usd || 0;
    const volumeRatio = volume24h / marketCap;

    if (marketCap > 1000000000) {
      insights.strengths.push('Large market cap (>$1B) indicates established project');
    } else if (marketCap < 10000000) {
      insights.weaknesses.push('Very small market cap (<$10M) - high risk');
      insights.risks.push('Low market cap increases volatility risk');
    }

    if (volumeRatio > 0.1) {
      insights.strengths.push('High trading volume relative to market cap');
    } else if (volumeRatio < 0.01) {
      insights.weaknesses.push('Low trading volume - potential liquidity issues');
      insights.risks.push('Low volume may cause slippage on large trades');
    }

    // Social insights
    if (socialMetrics.data_source !== 'simulated (fallback)') {
      const socialScore = socialMetrics.scores?.overall || 0;
      
      if (socialScore > 7.5) {
        insights.strengths.push('Strong social presence and community engagement');
      } else if (socialScore < 3.5) {
        insights.weaknesses.push('Weak social presence');
        insights.risks.push('Limited community support may affect adoption');
      }

      // Platform-specific insights
      if (socialMetrics.platforms?.twitter?.followers > 100000) {
        insights.strengths.push(`Large Twitter following (${this.formatNumber(socialMetrics.platforms.twitter.followers)})`);
      }
      
      if (socialMetrics.platforms?.github?.stars > 1000) {
        insights.strengths.push('Active development with strong GitHub presence');
      } else if (socialMetrics.platforms?.github?.found && socialMetrics.platforms.github.stars < 100) {
        insights.weaknesses.push('Limited GitHub activity');
      }

      if (socialMetrics.platforms?.reddit?.subscribers > 50000) {
        insights.strengths.push(`Active Reddit community (${this.formatNumber(socialMetrics.platforms.reddit.subscribers)} members)`);
      }
    }

    // On-chain insights
    if (onchainMetrics.data_source !== 'simulated (fallback)') {
      const holders = onchainMetrics.total_holders || onchainMetrics.holders_count;
      const concentration = onchainMetrics.avg_concentration || onchainMetrics.top_10_concentration;
      const transfers = onchainMetrics.total_transfers_7d || onchainMetrics.transfers_7d;

      if (holders > 100000) {
        insights.strengths.push(`Wide distribution (${this.formatNumber(holders)} holders)`);
      } else if (holders < 1000) {
        insights.weaknesses.push('Very small holder base');
        insights.risks.push('Limited holders increases manipulation risk');
      }

      if (concentration && concentration < 30) {
        insights.strengths.push('Well-distributed token ownership (low concentration)');
      } else if (concentration > 70) {
        insights.weaknesses.push('Highly concentrated ownership');
        insights.risks.push('🚨 High concentration - whale manipulation risk');
      }

      if (transfers > 50000) {
        insights.strengths.push('High on-chain activity');
      } else if (transfers < 100) {
        insights.weaknesses.push('Very low on-chain activity');
      }

      if (onchainMetrics.chain_info?.is_multichain) {
        insights.opportunities.push(`Available on ${onchainMetrics.chain_info.detected.length} chains - good accessibility`);
      }
    }

    // Price trend insights
    const priceChange7d = coinData.market_data?.price_change_percentage_7d || 0;
    const priceChange30d = coinData.market_data?.price_change_percentage_30d || 0;

    if (priceChange7d > 20) {
      insights.opportunities.push('Strong recent uptrend (+20% in 7 days)');
      insights.risks.push('Rapid price increase may lead to correction');
    } else if (priceChange7d < -20) {
      insights.opportunities.push('Potential buying opportunity after recent dip');
      insights.risks.push('Downtrend momentum may continue');
    }

    // Overall assessment
    if (overallScore >= 7.5) {
      insights.key.push('✅ Strong fundamentals - good investment candidate');
    } else if (overallScore >= 6.0) {
      insights.key.push('⚠️ Moderate fundamentals - acceptable with caution');
    } else if (overallScore >= 4.0) {
      insights.key.push('⚠️ Weak fundamentals - high risk investment');
    } else {
      insights.key.push('🚨 Very weak fundamentals - avoid or extreme caution');
    }

    return insights;
  }

  /**
   * Get investment recommendation
   * @private
   */
  getRecommendation(score, insights) {
    let action, confidence, timeHorizon, entryStrategy;

    if (score >= 7.5) {
      action = 'STRONG BUY';
      confidence = 'High';
      timeHorizon = 'Medium to Long term (3-12 months)';
      entryStrategy = 'Consider dollar-cost averaging for large positions';
    } else if (score >= 6.5) {
      action = 'BUY';
      confidence = 'Medium-High';
      timeHorizon = 'Medium term (3-6 months)';
      entryStrategy = 'Enter on dips, set stop-loss at -15%';
    } else if (score >= 5.5) {
      action = 'HOLD / SMALL BUY';
      confidence = 'Medium';
      timeHorizon = 'Short to Medium term (1-3 months)';
      entryStrategy = 'Small position only, tight stop-loss at -10%';
    } else if (score >= 4.0) {
      action = 'HOLD / SELL';
      confidence = 'Low-Medium';
      timeHorizon = 'Short term only (<1 month)';
      entryStrategy = 'Avoid new positions, consider exiting existing';
    } else {
      action = 'SELL / AVOID';
      confidence = 'Low';
      timeHorizon = 'Not recommended';
      entryStrategy = 'Exit positions if held, avoid new entry';
    }

    // Adjust for specific risk factors
    const hasHighConcentration = insights.risks.some(r => r.includes('concentration'));
    const hasLowLiquidity = insights.weaknesses.some(w => w.includes('volume'));

    if (hasHighConcentration && score < 7) {
      action = this.downgradeRecommendation(action);
      confidence = this.lowerConfidence(confidence);
    }

    if (hasLowLiquidity && score < 6) {
      action = this.downgradeRecommendation(action);
    }

    return { action, confidence, timeHorizon, entryStrategy };
  }

  /**
   * Assess overall risk level
   * @private
   */
  assessRiskLevel(score, insights) {
    const riskFactors = insights.risks.length;
    const weaknesses = insights.weaknesses.length;

    if (score >= 7.5 && riskFactors <= 2) return 'Low';
    if (score >= 6.0 && riskFactors <= 3) return 'Medium-Low';
    if (score >= 5.0) return 'Medium';
    if (score >= 4.0) return 'Medium-High';
    return 'High';
  }

  /**
   * Estimate potential return
   * @private
   */
  estimatePotential(score, coinData) {
    const marketCap = coinData.market_data?.market_cap?.usd || 0;
    let potential = '0-25%';

    if (score >= 7.5) {
      if (marketCap < 100000000) potential = '100-250%';
      else if (marketCap < 1000000000) potential = '50-150%';
      else potential = '25-100%';
    } else if (score >= 6.5) {
      if (marketCap < 100000000) potential = '50-150%';
      else if (marketCap < 1000000000) potential = '25-100%';
      else potential = '10-50%';
    } else if (score >= 5.5) {
      potential = '10-50%';
    }

    return potential;
  }

  /**
   * Assess data reliability
   * @private
   */
  assessReliability(socialMetrics, onchainMetrics) {
    const socialReal = !socialMetrics.data_source?.includes('simulated');
    const onchainReal = !onchainMetrics.data_source?.includes('simulated');

    if (socialReal && onchainReal) return 'high';
    if (socialReal || onchainReal) return 'medium';
    return 'low';
  }

  // Helper methods
  calculateVolumeRatio(coinData) {
    const volume = coinData.market_data?.total_volume?.usd || 0;
    const marketCap = coinData.market_data?.market_cap?.usd || 1;
    return parseFloat((volume / marketCap).toFixed(4));
  }

  calculateActiveRatio(metrics) {
    if (!metrics.active_addresses_7d || !metrics.total_holders) return null;
    return parseFloat((metrics.active_addresses_7d / metrics.total_holders * 100).toFixed(2));
  }

  getTopExchanges(coinData) {
    if (!coinData.tickers) return [];
    return coinData.tickers
      .slice(0, 5)
      .map(t => t.market?.name)
      .filter(Boolean);
  }

  calculateSpread(coinData) {
    // Simplified spread calculation
    return null; // Would need real-time orderbook data
  }

  calculateVolatility(coinData) {
    const changes = [
      coinData.market_data?.price_change_percentage_24h || 0,
      coinData.market_data?.price_change_percentage_7d || 0,
      coinData.market_data?.price_change_percentage_30d || 0
    ];
    const avg = changes.reduce((a, b) => a + Math.abs(b), 0) / changes.length;
    return parseFloat(avg.toFixed(2));
  }

  analyzeTrend(coinData) {
    const change7d = coinData.market_data?.price_change_percentage_7d || 0;
    const change30d = coinData.market_data?.price_change_percentage_30d || 0;

    if (change7d > 10 && change30d > 20) return 'Strong Uptrend';
    if (change7d > 5 && change30d > 10) return 'Uptrend';
    if (change7d < -10 && change30d < -20) return 'Strong Downtrend';
    if (change7d < -5 && change30d < -10) return 'Downtrend';
    return 'Sideways';
  }

  findSupportLevel(coinData) {
    const current = coinData.market_data?.current_price?.usd || 0;
    const low24h = coinData.market_data?.low_24h?.usd || current;
    return parseFloat((low24h * 0.95).toFixed(2));
  }

  findResistanceLevel(coinData) {
    const current = coinData.market_data?.current_price?.usd || 0;
    const high24h = coinData.market_data?.high_24h?.usd || current;
    return parseFloat((high24h * 1.05).toFixed(2));
  }

  downgradeRecommendation(action) {
    const downgrades = {
      'STRONG BUY': 'BUY',
      'BUY': 'HOLD / SMALL BUY',
      'HOLD / SMALL BUY': 'HOLD / SELL',
      'HOLD / SELL': 'SELL / AVOID'
    };
    return downgrades[action] || action;
  }

  lowerConfidence(confidence) {
    const lower = {
      'High': 'Medium-High',
      'Medium-High': 'Medium',
      'Medium': 'Low-Medium',
      'Low-Medium': 'Low'
    };
    return lower[confidence] || confidence;
  }

  formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }
}

module.exports = new AnalyzerService();