const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');
const db = require('../../utils/database');

class DefiLlamaService {
  constructor() {
    this.baseUrl = config.apis.defiLlama.baseUrl;
    this.timeout = config.apis.defiLlama.timeout;
  }

  async getProtocolTVL(protocolName) {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(`${this.baseUrl}/protocols`, {
        timeout: this.timeout
      });

      const protocol = response.data.find(
        p => p.name.toLowerCase() === protocolName.toLowerCase() ||
             p.symbol?.toLowerCase() === protocolName.toLowerCase()
      );

      if (!protocol) {
        logger.warn(`Protocol ${protocolName} not found on DefiLlama`);
        return null;
      }

      const result = {
        name: protocol.name,
        symbol: protocol.symbol,
        tvl: protocol.tvl || 0,
        chain: protocol.chain,
        category: protocol.category,
        change_1d: protocol.change_1d || 0,
        change_7d: protocol.change_7d || 0,
        change_1m: protocol.change_1m || 0,
        mcap_tvl_ratio: this.calculateMcapTVLRatio(protocol.mcap, protocol.tvl)
      };

      await db.logApiCall('defilama', '/protocols', 200, Date.now() - startTime);
      logger.info(`DefiLlama data fetched for ${protocolName}`, { 
        tvl: result.tvl,
        responseTime: Date.now() - startTime 
      });

      return result;

    } catch (error) {
      const status = error.response?.status || 500;
      await db.logApiCall('defilama', '/protocols', status, Date.now() - startTime);
      
      logger.error(`DefiLlama API error for ${protocolName}:`, error.message);
      return null;
    }
  }

  calculateMcapTVLRatio(mcap, tvl) {
    if (!mcap || !tvl || tvl === 0) return null;
    return mcap / tvl;
  }

  estimateActivityFromTVL(tvl) {
    if (!tvl || tvl === 0) {
      return {
        estimated_active_addresses: 0,
        estimated_transactions: 0,
        confidence: 'low'
      };
    }

    const addressMultiplier = 75;
    const txMultiplier = 150;

    return {
      estimated_active_addresses: Math.round((tvl / 1000000) * addressMultiplier),
      estimated_transactions: Math.round((tvl / 1000000) * txMultiplier),
      confidence: tvl > 10000000 ? 'medium' : 'low',
      note: 'Estimated from TVL using correlation model'
    };
  }
}

module.exports = new DefiLlamaService();