const coingeckoService = require('../real/coingecko.service');
const defillamaService = require('../real/defilama.service');
const twitterService = require('../real/twitter.service');
const socialMock = require('../mock/social.mock');
const onchainMock = require('../mock/onchain.mock');
const scoringEngine = require('./scoring.engine');
const logger = require('../../utils/logger');
const config = require('../../config');

class AnalyzerService {
  async analyzeCoin(ticker) {
    logger.info(`Starting analysis for ${ticker}`);
    const startTime = Date.now();

    try {
      // Step 1: Get real coin data from CoinGecko
      logger.info(`[${ticker}] Fetching CoinGecko data...`);
      const coinData = await coingeckoService.getCoinData(ticker);

      // Step 2: Get TVL data from DefiLlama (if it's a DeFi project)
      logger.info(`[${ticker}] Fetching DefiLlama data...`);
      const tvlData = await defillamaService.getProtocolTVL(ticker);

      // Step 3: Get Twitter data (real scraping)
      logger.info(`[${ticker}] Scraping Twitter data...`);
      const twitterData = await twitterService.scrapeBasicStats(ticker);

      // Step 4: Generate mock social metrics (LunarCrush-style)
      logger.info(`[${ticker}] Generating social metrics...`);
      const socialData = socialMock.generateSocialMetrics(
        ticker,
        coinData.market_cap,
        twitterData.followers
      );

      // Step 5: Generate mock on-chain metrics (Dune-style)
      logger.info(`[${ticker}] Generating on-chain metrics...`);
      const onchainData = onchainMock.generateOnchainMetrics(
        ticker,
        tvlData?.tvl || 0,
        coinData.market_cap,
        coinData.total_volume_24h
      );

      // Step 6: Calculate scores
      logger.info(`[${ticker}] Calculating scores...`);
      const tokenomicsResult = scoringEngine.scoreTokenomics(coinData);
      const liquidityResult = scoringEngine.scoreLiquidity(coinData);
      const socialResult = scoringEngine.scoreSocial(socialData);
      const onchainResult = scoringEngine.scoreOnchain(onchainData);

      const scores = {
        tokenomics: tokenomicsResult.score,
        liquidity: liquidityResult.score,
        social: socialResult.score,
        onchain: onchainResult.score
      };

      const overallScore = scoringEngine.calculateOverallScore(scores);
      const classification = scoringEngine.classifyScore(overallScore);

      // Step 7: Compile final result
      const result = {
        ticker: ticker.toUpperCase(),
        name: coinData.name,
        symbol: coinData.symbol,
        overall_score: overallScore,
        classification: classification.level,
        classification_description: classification.description,
        
        scores: scores,
        
        details: {
          tokenomics: {
            ...tokenomicsResult.details,
            flags: tokenomicsResult.flags
          },
          liquidity: {
            ...liquidityResult.details,
            flags: liquidityResult.flags
          },
          social: {
            ...socialResult.details,
            flags: socialResult.flags,
            data_source: socialData.data_source
          },
          onchain: {
            ...onchainResult.details,
            flags: onchainResult.flags,
            data_source: onchainData.data_source
          }
        },

        market_data: {
          price_usd: coinData.price_usd,
          market_cap: coinData.market_cap,
          volume_24h: coinData.total_volume_24h,
          circulating_supply: coinData.circulating_supply,
          total_supply: coinData.total_supply,
          max_supply: coinData.max_supply
        },

        data_sources: {
          price_liquidity: 'real (CoinGecko API)',
          tvl: tvlData ? 'real (DefiLlama API)' : 'not available',
          twitter: twitterData.data_source,
          social_sentiment: socialData.data_source,
          onchain_activity: onchainData.data_source
        },

        metadata: {
          analyzed_at: new Date().toISOString(),
          analysis_duration_ms: Date.now() - startTime,
          scoring_weights: config.scoring.weights
        },

        disclaimer: 'Some metrics are estimated. Not financial advice. DYOR.'
      };

      logger.info(`Analysis completed for ${ticker}`, {
        overall_score: overallScore,
        classification: classification.level,
        duration: Date.now() - startTime
      });

      return result;

    } catch (error) {
      logger.error(`Analysis failed for ${ticker}:`, error);
      throw error;
    }
  }

  // Batch analysis (future feature)
  async analyzeBatch(tickers, maxConcurrent = 3) {
    logger.info(`Batch analysis for ${tickers.length} coins`);
    
    const results = [];
    const errors = [];

    // Process in batches to avoid rate limits
    for (let i = 0; i < tickers.length; i += maxConcurrent) {
      const batch = tickers.slice(i, i + maxConcurrent);
      
      const batchPromises = batch.map(async ticker => {
        try {
          const result = await this.analyzeCoin(ticker);
          results.push(result);
        } catch (error) {
          errors.push({ ticker, error: error.message });
        }
      });

      await Promise.all(batchPromises);
      
      // Wait between batches to respect rate limits
      if (i + maxConcurrent < tickers.length) {
        await this.sleep(2000);
      }
    }

    return { results, errors };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AnalyzerService();