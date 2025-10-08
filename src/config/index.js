require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    cacheTTL: parseInt(process.env.CACHE_TTL) || 3600
  },
  
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
  },
  
  apis: {
    coingecko: {
      baseUrl: 'https://api.coingecko.com/api/v3',
      apiKey: process.env.COINGECKO_API_KEY || null,
      timeout: 10000
    },
    coinmarketcap: {
      baseUrl: 'https://pro-api.coinmarketcap.com/v1',
      apiKey: process.env.COINMARKETCAP_API_KEY || null,
      timeout: 10000
    },
    tokenUnlocks: {
      baseUrl: 'https://api.tokenunlocks.app/api/v1',
      timeout: 10000
    },
    defiLlama: {
      baseUrl: 'https://api.llama.fi',
      timeout: 10000
    }
  },
  
  mock: {
    useMockSocial: process.env.USE_MOCK_SOCIAL === 'true',
    useMockOnchain: process.env.USE_MOCK_ONCHAIN === 'true',
    dataVariance: parseFloat(process.env.MOCK_DATA_VARIANCE) || 0.15
  },
  
  scoring: {
    weights: {
      tokenomics: 0.30,
      liquidity: 0.25,
      social: 0.20,
      onchain: 0.25
    },
    thresholds: {
      green: 7.0,
      yellow: 5.0
    }
  }
};