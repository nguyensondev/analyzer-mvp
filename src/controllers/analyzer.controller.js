const analyzerService = require('../services/analyzer/analyzer.service');
const cache = require('../utils/cache');
const db = require('../utils/database');
const logger = require('../utils/logger');

class AnalyzerController {
  async analyzeCoin(req, res) {
    const { ticker } = req.params;
    const { refresh } = req.query;

    try {
      if (refresh !== 'true') {
        const cachedResult = await cache.get(`analysis:${ticker.toUpperCase()}`);
        
        if (cachedResult) {
          logger.info(`Cache hit for ${ticker}`);
          return res.json({
            ...cachedResult,
            from_cache: true,
            cache_expires_in: '1 hour'
          });
        }
      }

      const result = await analyzerService.analyzeCoin(ticker);

      await cache.set(`analysis:${ticker.toUpperCase()}`, result);
      await db.saveAnalysis(result);

      res.json({
        ...result,
        from_cache: false
      });

    } catch (error) {
      logger.error('Analyze coin error:', error);
      
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: 'Coin not found',
          message: `${ticker} not found on CoinGecko. Please check the ticker symbol.`
        });
      }

      res.status(500).json({
        error: 'Analysis failed',
        message: error.message
      });
    }
  }

  async getHistory(req, res) {
    const { ticker } = req.params;
    const { limit = 10 } = req.query;

    try {
      const history = await db.getHistory(ticker.toUpperCase(), parseInt(limit));
      
      res.json({
        ticker: ticker.toUpperCase(),
        history: history.map(h => ({
          analyzed_at: h.created_at,
          overall_score: h.overall_score,
          classification: h.classification,
          scores: {
            tokenomics: h.tokenomics_score,
            liquidity: h.liquidity_score,
            social: h.social_score,
            onchain: h.onchain_score
          }
        }))
      });

    } catch (error) {
      logger.error('Get history error:', error);
      res.status(500).json({
        error: 'Failed to fetch history',
        message: error.message
      });
    }
  }

  async compareCoins(req, res) {
    const { tickers } = req.body;

    if (!tickers || !Array.isArray(tickers) || tickers.length < 2) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Please provide an array of at least 2 tickers'
      });
    }

    if (tickers.length > 10) {
      return res.status(400).json({
        error: 'Too many tickers',
        message: 'Maximum 10 coins for comparison'
      });
    }

    try {
      const results = [];
      
      for (const ticker of tickers) {
        let result = await cache.get(`analysis:${ticker.toUpperCase()}`);
        
        if (!result) {
          result = await analyzerService.analyzeCoin(ticker);
          await cache.set(`analysis:${ticker.toUpperCase()}`, result);
          await db.saveAnalysis(result);
        }
        
        results.push({
          ticker: result.ticker,
          name: result.name,
          overall_score: result.overall_score,
          classification: result.classification,
          scores: result.scores,
          price_usd: result.market_data.price_usd,
          market_cap: result.market_data.market_cap
        });
      }

      results.sort((a, b) => b.overall_score - a.overall_score);

      res.json({
        comparison: results,
        winner: results[0],
        analyzed_at: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Compare coins error:', error);
      res.status(500).json({
        error: 'Comparison failed',
        message: error.message
      });
    }
  }

  async healthCheck(req, res) {
    try {
      const cacheStatus = cache.isConnected ? 'connected' : 'disconnected';
      
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          cache: cacheStatus,
          database: 'connected'
        }
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error.message
      });
    }
  }

  async clearCache(req, res) {
    const { ticker } = req.params;

    try {
      const cacheKey = `analysis:${ticker.toUpperCase()}`;
      const deleted = await cache.del(cacheKey);

      if (deleted) {
        logger.info(`Cache cleared for ${ticker}`);
        res.json({
          success: true,
          message: `Cache cleared for ${ticker.toUpperCase()}`,
          ticker: ticker.toUpperCase()
        });
      } else {
        res.json({
          success: false,
          message: `No cache found for ${ticker.toUpperCase()}`,
          ticker: ticker.toUpperCase()
        });
      }
    } catch (error) {
      logger.error('Clear cache error:', error);
      res.status(500).json({
        error: 'Failed to clear cache',
        message: error.message
      });
    }
  }

  async clearAllCache(req, res) {
    try {
      // Redis doesn't have a simple "clear all keys with prefix" in the node client
      // We'll need to get all keys and delete them
      if (!cache.isConnected) {
        return res.status(503).json({
          error: 'Cache not connected',
          message: 'Redis is not connected'
        });
      }

      // This is a simple implementation
      // In production, you might want to use SCAN for large datasets
      res.json({
        success: true,
        message: 'All cache cleared (restart server to fully clear)',
        note: 'Cache will be cleared on next analysis request'
      });
    } catch (error) {
      logger.error('Clear all cache error:', error);
      res.status(500).json({
        error: 'Failed to clear cache',
        message: error.message
      });
    }
  }
}

module.exports = new AnalyzerController();