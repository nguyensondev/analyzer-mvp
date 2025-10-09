const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');
const db = require('../../utils/database');

class CoinGeckoService {
  constructor() {
    this.baseUrl = config.apis.coingecko.baseUrl;
    this.apiKey = config.apis.coingecko.apiKey;
    this.timeout = config.apis.coingecko.timeout;
  }

  async getCoinData(ticker) {
    const startTime = Date.now();
    
    try {
      // First, find the coin ID from ticker
      const coinId = await this.findCoinId(ticker);
      
      if (!coinId) {
        throw new Error(`Coin ${ticker} not found on CoinGecko`);
      }

      // Get comprehensive coin data
      const response = await axios.get(
        `${this.baseUrl}/coins/${coinId}`,
        {
          params: {
            localization: false,
            tickers: true,
            market_data: true,
            community_data: false,
            developer_data: false
          },
          timeout: this.timeout,
          headers: this.apiKey ? { 'x-cg-pro-api-key': this.apiKey } : {}
        }
      );

      const data = response.data;
      const marketData = data.market_data;
      
     
      const result = {
        id: data.id,
        platforms: data.platforms,
        symbol: data.symbol.toUpperCase(),
        name: data.name,
        price_usd: marketData.current_price?.usd || 0,
        market_cap: marketData.market_cap?.usd || 0,
        total_volume_24h: marketData.total_volume?.usd || 0,
        circulating_supply: marketData.circulating_supply || 0,
        total_supply: marketData.total_supply || 0,
        max_supply: marketData.max_supply || null,
        price_change_24h: marketData.price_change_percentage_24h || 0,
        ath: marketData.ath?.usd || 0,
        ath_change_percentage: marketData.ath_change_percentage?.usd || 0,
        liquidity: {
          binance_volume: this.getBinanceVolume(data.tickers),
          total_volume: marketData.total_volume?.usd || 0,
          volume_to_market_cap: this.calculateVolumeRatio(
            marketData.total_volume?.usd,
            marketData.market_cap?.usd
          )
        }
      };

      await db.logApiCall('coingecko', `/coins/${coinId}`, 200, Date.now() - startTime);
      logger.info(`CoinGecko data fetched for ${ticker}`, { responseTime: Date.now() - startTime });

      return result;

    } catch (error) {
      const status = error.response?.status || 500;
      await db.logApiCall('coingecko', `/coins/${ticker}`, status, Date.now() - startTime);
      
      logger.error(`CoinGecko API error for ${ticker}:`, {
        message: error.message,
        status: status
      });
      
      throw error;
    }
  }

  async findCoinId(ticker) {
    try {
      const response = await axios.get(`${this.baseUrl}/coins/list`, {
        timeout: this.timeout,
        headers: this.apiKey ? { 'x-cg-pro-api-key': this.apiKey } : {}
      });

      const coin = response.data.find(
        c => c.symbol.toLowerCase() === ticker.toLowerCase()
      );

      return coin?.id || null;
    } catch (error) {
      logger.error('Error finding coin ID:', error.message);
      return null;
    }
  }

  getBinanceVolume(tickers) {
    if (!tickers || !Array.isArray(tickers)) return 0;

    const binanceTickers = tickers.filter(
      t => t.market?.name?.toLowerCase().includes('binance')
    );

    return binanceTickers.reduce((sum, t) => sum + (t.converted_volume?.usd || 0), 0);
  }

  calculateVolumeRatio(volume, marketCap) {
    if (!volume || !marketCap || marketCap === 0) return 0;
    return (volume / marketCap) * 100;
  }
}

module.exports = new CoinGeckoService();