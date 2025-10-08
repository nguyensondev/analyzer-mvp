const express = require('express');
const analyzerController = require('../controllers/analyzer.controller');

const router = express.Router();

router.get('/health', analyzerController.healthCheck);
router.get('/analyze/:ticker', analyzerController.analyzeCoin);
router.get('/history/:ticker', analyzerController.getHistory);
router.post('/compare', analyzerController.compareCoins);

router.get('/', (req, res) => {
  res.json({
    service: 'Crypto Fundamental Analyzer API',
    version: '1.0.0',
    endpoints: {
      analyze: 'GET /api/analyze/:ticker - Analyze a single coin',
      analyze_refresh: 'GET /api/analyze/:ticker?refresh=true - Force refresh analysis',
      history: 'GET /api/history/:ticker - Get analysis history',
      compare: 'POST /api/compare - Compare multiple coins (body: {tickers: []})',
      health: 'GET /api/health - Service health check'
    },
    documentation: 'See README.md for full documentation'
  });
});

module.exports = router;