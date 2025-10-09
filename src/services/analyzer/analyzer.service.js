const coingeckoService = require("../real/coingecko.service");
const defillamaService = require("../real/defilama.service");
const twitterService = require("../real/twitter.service");
const socialEnhanced = require("./social-enhanced.service");
const chainDetector = require("./chain-detector.service");
const onchainEnhancedService = require("./onchain-enhanced.service");
const socialMock = require("../mock/social.mock");
const onchainMock = require("../mock/onchain.mock");
const scoringEngine = require("./scoring.engine");
const logger = require("../../utils/logger");
const config = require("../../config");

class AnalyzerService {
  async analyzeCoin(ticker) {
    logger.info(`Starting analysis for ${ticker}`);
    const startTime = Date.now();

    try {
      logger.info(`[${ticker}] Fetching CoinGecko data...`);
      const coinData = await coingeckoService.getCoinData(ticker);

      logger.info(`[${ticker}] Fetching DefiLlama data...`);
      const tvlData = await defillamaService.getProtocolTVL(ticker);

      logger.info(
        `[${ticker}] Fetching Social data (Twitter scraping - old method)...`
      );
      const twitterData = await twitterService.scrapeBasicStats(ticker);

      logger.info(`[${ticker}] Fetching Enhanced Social metrics (NEW APIs)...`);
      // NEW: Use enhanced social service instead of mock
      const socialData = await socialEnhanced.getSocialMetrics(
        ticker,
        coinData.name,
        coinData.market_cap
      );
      const chainInfo = chainDetector.detectChains(coinData);
      
      logger.info(`[${ticker}] Generating on-chain metrics...`);
      // const onchainData = onchainMock.generateOnchainMetrics(
      //   ticker,
      //   tvlData?.tvl || 0,
      //   coinData.market_cap,
      //   coinData.total_volume_24h
      // );

      const onchainData = await onchainEnhancedService.getOnChainMetrics(
        ticker,
        coinData
      );

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
          price_liquidity: "real (CoinGecko API)",
          tvl: tvlData ? "real (DefiLlama API)" : "not available",
          twitter: twitterData.data_source,
          social_sentiment: socialData.data_source,
          onchain_activity: onchainData.data_source
        },

        metadata: {
          analyzed_at: new Date().toISOString(),
          analysis_duration_ms: Date.now() - startTime,
          scoring_weights: config.scoring.weights
        },

        disclaimer: "Some metrics are estimated. Not financial advice. DYOR."
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

  async analyzeBatch(tickers, maxConcurrent = 3) {
    logger.info(`Batch analysis for ${tickers.length} coins`);

    const results = [];
    const errors = [];

    for (let i = 0; i < tickers.length; i += maxConcurrent) {
      const batch = tickers.slice(i, i + maxConcurrent);

      const batchPromises = batch.map(async (ticker) => {
        try {
          const result = await this.analyzeCoin(ticker);
          results.push(result);
        } catch (error) {
          errors.push({ ticker, error: error.message });
        }
      });

      await Promise.all(batchPromises);

      if (i + maxConcurrent < tickers.length) {
        await this.sleep(2000);
      }
    }

    return { results, errors };
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new AnalyzerService();
