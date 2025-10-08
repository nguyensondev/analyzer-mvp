const request = require('supertest');
const app = require('../src/app');

describe('Crypto Analyzer API', () => {
  
  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app)
        .get('/api/health')
        .expect(200);
      
      expect(res.body.status).toBe('healthy');
      expect(res.body.services).toBeDefined();
    });
  });

  describe('GET /api/', () => {
    it('should return API info', async () => {
      const res = await request(app)
        .get('/api/')
        .expect(200);
      
      expect(res.body.service).toBe('Crypto Fundamental Analyzer API');
      expect(res.body.endpoints).toBeDefined();
    });
  });

  describe('GET /api/analyze/:ticker', () => {
    it('should analyze BTC successfully', async () => {
      const res = await request(app)
        .get('/api/analyze/BTC')
        .expect(200);
      
      expect(res.body.ticker).toBe('BTC');
      expect(res.body.overall_score).toBeDefined();
      expect(res.body.classification).toMatch(/GREEN|YELLOW|RED/);
      expect(res.body.scores).toHaveProperty('tokenomics');
      expect(res.body.scores).toHaveProperty('liquidity');
      expect(res.body.scores).toHaveProperty('social');
      expect(res.body.scores).toHaveProperty('onchain');
    }, 30000);

    it('should return 404 for invalid ticker', async () => {
      const res = await request(app)
        .get('/api/analyze/INVALIDCOIN123')
        .expect(404);
      
      expect(res.body.error).toBe('Coin not found');
    }, 15000);

    it('should return cached data on second request', async () => {
      await request(app).get('/api/analyze/ETH');
      
      const res = await request(app)
        .get('/api/analyze/ETH')
        .expect(200);
      
      expect(res.body.from_cache).toBe(true);
    }, 30000);
  });

  describe('POST /api/compare', () => {
    it('should compare multiple coins', async () => {
      const res = await request(app)
        .post('/api/compare')
        .send({ tickers: ['BTC', 'ETH'] })
        .expect(200);
      
      expect(res.body.comparison).toHaveLength(2);
      expect(res.body.winner).toBeDefined();
    }, 60000);

    it('should reject invalid input', async () => {
      const res = await request(app)
        .post('/api/compare')
        .send({ tickers: ['BTC'] })
        .expect(400);
      
      expect(res.body.error).toBe('Invalid input');
    });

    it('should reject too many tickers', async () => {
      const tickers = Array(15).fill('BTC');
      const res = await request(app)
        .post('/api/compare')
        .send({ tickers })
        .expect(400);
      
      expect(res.body.error).toBe('Too many tickers');
    });
  });

  describe('Scoring System', () => {
    it('should return scores between 0 and 10', async () => {
      const res = await request(app)
        .get('/api/analyze/BTC')
        .expect(200);
      
      expect(res.body.scores.tokenomics).toBeGreaterThanOrEqual(0);
      expect(res.body.scores.tokenomics).toBeLessThanOrEqual(10);
      expect(res.body.scores.liquidity).toBeGreaterThanOrEqual(0);
      expect(res.body.scores.liquidity).toBeLessThanOrEqual(10);
    }, 30000);

    it('should classify correctly based on score', async () => {
      const res = await request(app)
        .get('/api/analyze/BTC')
        .expect(200);
      
      if (res.body.overall_score >= 7.0) {
        expect(res.body.classification).toBe('GREEN');
      } else if (res.body.overall_score >= 5.0) {
        expect(res.body.classification).toBe('YELLOW');
      } else {
        expect(res.body.classification).toBe('RED');
      }
    }, 30000);
  });

  describe('Data Sources', () => {
    it('should label real vs simulated data', async () => {
      const res = await request(app)
        .get('/api/analyze/BTC')
        .expect(200);
      
      expect(res.body.data_sources).toBeDefined();
      expect(res.body.data_sources.price_liquidity).toContain('real');
      expect(res.body.data_sources.social_sentiment).toContain('simulated');
    }, 30000);
  });

});