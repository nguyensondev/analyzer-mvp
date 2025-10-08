const puppeteer = require('puppeteer');
const logger = require('../../utils/logger');

class TwitterService {
  constructor() {
    this.browser = null;
  }

  async scrapeBasicStats(ticker) {
    let page = null;
    
    try {
      if (!this.browser) {
        this.browser = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
          ]
        });
      }

      page = await this.browser.newPage();
      
      const searchUrl = `https://twitter.com/search?q=${ticker}%20crypto&f=user`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 15000 });

      await page.waitForTimeout(3000);

      const stats = await page.evaluate(() => {
        const followersElement = document.querySelector('[href$="/verified_followers"] span');
        const followersText = followersElement?.textContent || '0';
        
        return {
          followers: followersText,
          found: !!followersElement
        };
      });

      const result = {
        ticker: ticker.toUpperCase(),
        followers: this.parseFollowerCount(stats.followers),
        data_source: 'twitter_scrape',
        timestamp: new Date().toISOString(),
        reliability: stats.found ? 'medium' : 'low'
      };

      logger.info(`Twitter data scraped for ${ticker}`, result);
      return result;

    } catch (error) {
      logger.error(`Twitter scrape error for ${ticker}:`, error.message);
      
      return {
        ticker: ticker.toUpperCase(),
        followers: 0,
        data_source: 'failed_scrape',
        timestamp: new Date().toISOString(),
        reliability: 'none',
        error: error.message
      };
      
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  parseFollowerCount(text) {
    if (!text) return 0;
    
    text = text.toLowerCase().replace(/,/g, '');
    
    if (text.includes('k')) {
      return parseFloat(text.replace('k', '')) * 1000;
    } else if (text.includes('m')) {
      return parseFloat(text.replace('m', '')) * 1000000;
    }
    
    return parseInt(text) || 0;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = new TwitterService();