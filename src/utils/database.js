const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

class Database {
  constructor() {
    this.db = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      // Ensure data directory exists
      const dataDir = path.join(__dirname, '../../data');
      
      try {
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
          logger.info(`Created data directory: ${dataDir}`);
        }
      } catch (err) {
        logger.error('Failed to create data directory:', err);
        return reject(new Error(`Cannot create data directory: ${err.message}`));
      }

      const dbPath = path.join(dataDir, 'analyzer.db');
      logger.info(`Database path: ${dbPath}`);
      
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          logger.error('Database connection error:', err);
          reject(err);
        } else {
          logger.info('Database connected successfully');
          this.initialize().then(resolve).catch(reject);
        }
      });
    });
  }

  initialize() {
    return new Promise((resolve, reject) => {
      const schema = `
        CREATE TABLE IF NOT EXISTS analyses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ticker TEXT NOT NULL,
          overall_score REAL,
          tokenomics_score REAL,
          liquidity_score REAL,
          social_score REAL,
          onchain_score REAL,
          classification TEXT,
          data_snapshot TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_ticker ON analyses(ticker);
        CREATE INDEX IF NOT EXISTS idx_created_at ON analyses(created_at);

        CREATE TABLE IF NOT EXISTS api_calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          service TEXT NOT NULL,
          endpoint TEXT,
          status INTEGER,
          response_time INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `;

      this.db.exec(schema, (err) => {
        if (err) {
          logger.error('Database initialization error:', err);
          reject(err);
        } else {
          logger.info('Database schema initialized');
          resolve();
        }
      });
    });
  }

  async saveAnalysis(data) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO analyses (
          ticker, overall_score, tokenomics_score, 
          liquidity_score, social_score, onchain_score,
          classification, data_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        data.ticker,
        data.overall_score,
        data.scores.tokenomics,
        data.scores.liquidity,
        data.scores.social,
        data.scores.onchain,
        data.classification,
        JSON.stringify(data)
      ];

      this.db.run(sql, params, function(err) {
        if (err) {
          logger.error('Save analysis error:', err);
          reject(err);
        } else {
          resolve({ id: this.lastID });
        }
      });
    });
  }

  async getHistory(ticker, limit = 10) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM analyses 
        WHERE ticker = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `;

      this.db.all(sql, [ticker, limit], (err, rows) => {
        if (err) {
          logger.error('Get history error:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async logApiCall(service, endpoint, status, responseTime) {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO api_calls (service, endpoint, status, response_time)
        VALUES (?, ?, ?, ?)
      `;

      this.db.run(sql, [service, endpoint, status, responseTime], (err) => {
        if (err) {
          logger.error('Log API call error:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          logger.error('Database close error:', err);
        } else {
          logger.info('Database connection closed');
        }
      });
    }
  }
}

module.exports = new Database();