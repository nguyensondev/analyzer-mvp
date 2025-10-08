const analyzerService = require('../services/analyzer/analyzer.service');
const database = require('../utils/database');
const logger = require('../utils/logger');

/**
 * Analyze Controller
 * Handles cryptocurrency analysis requests
 */
class AnalyzeController {
  /**
   * Analyze a cryptocurrency by ticker symbol
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware
   */
  async analyze(req, res, next) {
    try {
      const { ticker } = req.params;

      // Validate ticker
      if (!ticker || ticker.length === 0) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Ticker symbol is required'
        });
      }

      // Validate ticker format (alphanumeric, 1-10 chars)
      if (!/^[a-zA-Z0-9]{1,10}$/i.test(ticker)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid ticker format. Use 1-10 alphanumeric characters.'
        });
      }

      logger.info(`[Controller] Received analysis request for: ${ticker.toUpperCase()}`);

      // Perform analysis
      const analysis = await analyzerService.analyze(ticker);

      // Save to database (async, don't wait)
      // Pass ticker explicitly to ensure it's not undefined
      database.saveAnalysis(ticker.toUpperCase(), analysis)
        .then(() => {
          logger.info(`[Controller] Analysis saved to database for ${ticker.toUpperCase()}`);
        })
        .catch(err => {
          logger.error(`[Controller] Failed to save analysis for ${ticker.toUpperCase()}:`, err.message);
          // Don't fail the request if database save fails
        });

      // Return analysis result
      res.json({
        success: true,
        ticker: ticker.toUpperCase(),
        data: analysis
      });

    } catch (error) {
      logger.error('[Controller] Analysis error:', error.message);
      
      // Handle specific error types
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Cryptocurrency '${req.params.ticker}' not found. Please check the ticker symbol.`,
          ticker: req.params.ticker
        });
      }

      if (error.message.includes('rate limit')) {
        return res.status(429).json({
          error: 'Rate Limit Exceeded',
          message: 'Too many requests. Please try again later.',
          retryAfter: 60
        });
      }

      // Pass to error handler middleware
      next(error);
    }
  }

  /**
   * Get analysis history for a ticker
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware
   */
  async getHistory(req, res, next) {
    try {
      const { ticker } = req.params;
      const limit = parseInt(req.query.limit, 10) || 10;

      if (!ticker) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Ticker symbol is required'
        });
      }

      const history = await database.getAnalysisHistory(ticker, limit);

      res.json({
        success: true,
        ticker: ticker.toUpperCase(),
        count: history.length,
        data: history
      });

    } catch (error) {
      logger.error('[Controller] Get history error:', error.message);
      next(error);
    }
  }

  /**
   * Get full analysis by ID
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware
   */
  async getById(req, res, next) {
    try {
      const { id } = req.params;

      if (!id || isNaN(id)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Valid analysis ID is required'
        });
      }

      const analysis = await database.getAnalysisById(parseInt(id, 10));

      if (!analysis) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Analysis with ID ${id} not found`
        });
      }

      res.json({
        success: true,
        data: analysis
      });

    } catch (error) {
      logger.error('[Controller] Get by ID error:', error.message);
      next(error);
    }
  }

  /**
   * Get top performing coins
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware
   */
  async getTopCoins(req, res, next) {
    try {
      const limit = parseInt(req.query.limit, 10) || 20;

      if (limit < 1 || limit > 100) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Limit must be between 1 and 100'
        });
      }

      const topCoins = await database.getTopCoins(limit);

      res.json({
        success: true,
        count: topCoins.length,
        data: topCoins
      });

    } catch (error) {
      logger.error('[Controller] Get top coins error:', error.message);
      next(error);
    }
  }

  /**
   * Get analysis statistics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware
   */
  async getStatistics(req, res, next) {
    try {
      const stats = await database.getStatistics();

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error('[Controller] Get statistics error:', error.message);
      next(error);
    }
  }

  /**
   * Batch analyze multiple cryptocurrencies
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware
   */
  async batchAnalyze(req, res, next) {
    try {
      const { tickers } = req.body;

      // Validate input
      if (!Array.isArray(tickers) || tickers.length === 0) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Array of tickers is required'
        });
      }

      if (tickers.length > 10) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Maximum 10 tickers per batch request'
        });
      }

      logger.info(`[Controller] Batch analysis request for: ${tickers.join(', ')}`);

      // Analyze all tickers in parallel
      const results = await Promise.allSettled(
        tickers.map(ticker => analyzerService.analyze(ticker))
      );

      // Process results
      const analyses = results.map((result, index) => {
        const ticker = tickers[index].toUpperCase();
        
        if (result.status === 'fulfilled') {
          // Save to database (async, don't wait)
          database.saveAnalysis(ticker, result.value).catch(err => {
            logger.error(`[Controller] Failed to save batch analysis for ${ticker}:`, err.message);
          });

          return {
            ticker,
            success: true,
            data: result.value
          };
        } else {
          return {
            ticker,
            success: false,
            error: result.reason.message
          };
        }
      });

      const successCount = analyses.filter(a => a.success).length;
      const failureCount = analyses.length - successCount;

      res.json({
        success: true,
        total: analyses.length,
        successful: successCount,
        failed: failureCount,
        data: analyses
      });

    } catch (error) {
      logger.error('[Controller] Batch analyze error:', error.message);
      next(error);
    }
  }

  /**
   * Compare multiple cryptocurrencies
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware
   */
  async compare(req, res, next) {
    try {
      const { tickers } = req.query;

      if (!tickers) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Tickers parameter is required (comma-separated)'
        });
      }

      const tickerList = tickers.split(',').map(t => t.trim()).filter(t => t);

      if (tickerList.length < 2 || tickerList.length > 5) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Please provide 2-5 tickers to compare'
        });
      }

      logger.info(`[Controller] Compare request for: ${tickerList.join(', ')}`);

      // Analyze all tickers
      const analyses = await Promise.all(
        tickerList.map(ticker => analyzerService.analyze(ticker))
      );

      // Extract key metrics for comparison
      const comparison = analyses.map((analysis, index) => ({
        ticker: tickerList[index].toUpperCase(),
        name: analysis.basic_info?.name,
        overall_score: analysis.scores?.overall,
        market_score: analysis.scores?.market,
        social_score: analysis.scores?.social,
        onchain_score: analysis.scores?.onchain,
        recommendation: analysis.investment_analysis?.recommendation,
        risk_level: analysis.investment_analysis?.risk_level,
        market_cap: analysis.market_metrics?.market_cap,
        holders: analysis.onchain_metrics?.total_holders || analysis.onchain_metrics?.holders_count
      }));

      // Sort by overall score
      comparison.sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0));

      res.json({
        success: true,
        count: comparison.length,
        winner: comparison[0]?.ticker,
        data: comparison
      });

    } catch (error) {
      logger.error('[Controller] Compare error:', error.message);
      next(error);
    }
  }

  /**
   * Health check endpoint
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async healthCheck(req, res) {
    try {
      // Check database
      const stats = await database.getStatistics();

      res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          total_analyses: stats.total_analyses,
          unique_coins: stats.unique_coins
        },
        version: '2.0.0'
      });
    } catch (error) {
      res.status(503).json({
        success: false,
        status: 'unhealthy',
        error: error.message
      });
    }
  }
}

module.exports = new AnalyzeController();