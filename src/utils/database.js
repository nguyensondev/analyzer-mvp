const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const config = require('../config');

class Database {
  constructor() {
    this.db = null;
    this.init();
  }

  init() {
    try {
      // Ensure data directory exists
      const dbDir = path.dirname(config.database.path);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        logger.info(`[Database] Created directory: ${dbDir}`);
      }

      // Connect to database
      this.db = new sqlite3.Database(config.database.path, (err) => {
        if (err) {
          logger.error('[Database] Connection error:', err.message);
          throw err;
        }
        logger.info('[Database] Connected to SQLite database');
      });

      // Create tables
      this.createTables();
    } catch (error) {
      logger.error('[Database] Initialization error:', error.message);
      throw error;
    }
  }

  createTables() {
    const createAnalysesTable = `
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        coin_id TEXT,
        coin_name TEXT,
        overall_score REAL,
        market_score REAL,
        social_score REAL,
        onchain_score REAL,
        analysis_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_ticker ON analyses(ticker);
      CREATE INDEX IF NOT EXISTS idx_created_at ON analyses(created_at);
      CREATE INDEX IF NOT EXISTS idx_overall_score ON analyses(overall_score);
    `;

    this.db.serialize(() => {
      this.db.run(createAnalysesTable, (err) => {
        if (err) {
          logger.error('[Database] Error creating analyses table:', err.message);
        } else {
          logger.info('[Database] Analyses table ready');
        }
      });

      this.db.run(createIndexes, (err) => {
        if (err) {
          logger.error('[Database] Error creating indexes:', err.message);
        } else {
          logger.info('[Database] Database indexes ready');
        }
      });
    });
  }

  /**
   * Save analysis result to database
   * @param {string} ticker - Coin ticker symbol
   * @param {Object} analysis - Analysis result object
   * @returns {Promise<number>} - Inserted row ID
   */
  saveAnalysis(ticker, analysis) {
    return new Promise((resolve, reject) => {
      try {
        // Extract data with safe fallbacks
        const coinId = analysis.basic_info?.id || null;
        const coinName = analysis.basic_info?.name || null;
        const overallScore = analysis.scores?.overall || 0;
        const marketScore = analysis.scores?.market || 0;
        const socialScore = analysis.scores?.social || 0;
        const onchainScore = analysis.scores?.onchain || 0;
        
        // Convert analysis object to JSON string
        const analysisData = JSON.stringify(analysis);

        const sql = `
          INSERT INTO analyses (
            ticker, 
            coin_id, 
            coin_name, 
            overall_score, 
            market_score, 
            social_score, 
            onchain_score, 
            analysis_data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        this.db.run(
          sql,
          [
            ticker.toUpperCase(), // Ensure ticker is uppercase
            coinId,
            coinName,
            overallScore,
            marketScore,
            socialScore,
            onchainScore,
            analysisData
          ],
          function(err) {
            if (err) {
              logger.error('[Database] Save analysis error:', err.message, {
                ticker,
                coinId,
                coinName
              });
              reject(err);
            } else {
              logger.info(`[Database] Analysis saved for ${ticker} (ID: ${this.lastID})`);
              resolve(this.lastID);
            }
          }
        );
      } catch (error) {
        logger.error('[Database] Error preparing analysis data:', error.message);
        reject(error);
      }
    });
  }

  /**
   * Get analysis history for a ticker
   * @param {string} ticker - Coin ticker symbol
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array>} - Array of analysis records
   */
  getAnalysisHistory(ticker, limit = 10) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          id,
          ticker,
          coin_id,
          coin_name,
          overall_score,
          market_score,
          social_score,
          onchain_score,
          created_at
        FROM analyses
        WHERE ticker = ?
        ORDER BY created_at DESC
        LIMIT ?
      `;

      this.db.all(sql, [ticker.toUpperCase(), limit], (err, rows) => {
        if (err) {
          logger.error('[Database] Get history error:', err.message);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Get full analysis by ID
   * @param {number} id - Analysis ID
   * @returns {Promise<Object>} - Full analysis object
   */
  getAnalysisById(id) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM analyses WHERE id = ?
      `;

      this.db.get(sql, [id], (err, row) => {
        if (err) {
          logger.error('[Database] Get analysis by ID error:', err.message);
          reject(err);
        } else if (row) {
          // Parse JSON data
          try {
            row.analysis_data = JSON.parse(row.analysis_data);
            resolve(row);
          } catch (parseError) {
            logger.error('[Database] JSON parse error:', parseError.message);
            reject(parseError);
          }
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Get top performing coins
   * @param {number} limit - Maximum number of results
   * @returns {Promise<Array>} - Array of top coins
   */
  getTopCoins(limit = 20) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          ticker,
          coin_name,
          AVG(overall_score) as avg_score,
          COUNT(*) as analysis_count,
          MAX(created_at) as last_analysis
        FROM analyses
        GROUP BY ticker
        HAVING analysis_count >= 2
        ORDER BY avg_score DESC
        LIMIT ?
      `;

      this.db.all(sql, [limit], (err, rows) => {
        if (err) {
          logger.error('[Database] Get top coins error:', err.message);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Get analysis statistics
   * @returns {Promise<Object>} - Statistics object
   */
  getStatistics() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          COUNT(DISTINCT ticker) as unique_coins,
          COUNT(*) as total_analyses,
          AVG(overall_score) as avg_score,
          MAX(overall_score) as max_score,
          MIN(overall_score) as min_score,
          COUNT(CASE WHEN overall_score >= 7.5 THEN 1 END) as strong_buy_count,
          COUNT(CASE WHEN overall_score < 4.0 THEN 1 END) as avoid_count
        FROM analyses
      `;

      this.db.get(sql, [], (err, row) => {
        if (err) {
          logger.error('[Database] Get statistics error:', err.message);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * Delete old analyses (cleanup)
   * @param {number} daysToKeep - Number of days to keep
   * @returns {Promise<number>} - Number of deleted rows
   */
  cleanupOldAnalyses(daysToKeep = 90) {
    return new Promise((resolve, reject) => {
      const sql = `
        DELETE FROM analyses
        WHERE created_at < datetime('now', '-${daysToKeep} days')
      `;

      this.db.run(sql, function(err) {
        if (err) {
          logger.error('[Database] Cleanup error:', err.message);
          reject(err);
        } else {
          logger.info(`[Database] Cleaned up ${this.changes} old analyses`);
          resolve(this.changes);
        }
      });
    });
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          logger.error('[Database] Error closing database:', err.message);
        } else {
          logger.info('[Database] Database connection closed');
        }
      });
    }
  }

  /**
   * Get database instance
   * @returns {sqlite3.Database} - Database instance
   */
  getDb() {
    return this.db;
  }
}

// Export singleton instance
module.exports = new Database();