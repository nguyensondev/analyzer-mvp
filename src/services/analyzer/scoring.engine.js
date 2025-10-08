const config = require('../../config');
const logger = require('../../utils/logger');

class ScoringEngine {
  constructor() {
    this.weights = config.scoring.weights;
    this.thresholds = config.scoring.thresholds;
  }

  calculateOverallScore(scores) {
    const overall = 
      scores.tokenomics * this.weights.tokenomics +
      scores.liquidity * this.weights.liquidity +
      scores.social * this.weights.social +
      scores.onchain * this.weights.onchain;

    return parseFloat(overall.toFixed(2));
  }

  classifyScore(score) {
    if (score >= this.thresholds.green) {
      return { level: 'GREEN', description: 'Strong fundamentals' };
    } else if (score >= this.thresholds.yellow) {
      return { level: 'YELLOW', description: 'Moderate fundamentals' };
    } else {
      return { level: 'RED', description: 'Weak fundamentals' };
    }
  }

  // Tokenomics Score (0-10)
  scoreTokenomics(coinData) {
    let score = 5; // Base score
    const flags = [];

    // Circulating supply ratio
    const circulatingRatio = coinData.circulating_supply / coinData.total_supply;
    
    if (circulatingRatio > 0.7) {
      score += 2;
      flags.push('High circulating ratio (>70%) - Good');
    } else if (circulatingRatio > 0.4) {
      score += 1;
      flags.push('Moderate circulating ratio (40-70%)');
    } else {
      score -= 1;
      flags.push('Low circulating ratio (<40%) - Risk of dilution');
    }

    // Max supply check
    if (coinData.max_supply && coinData.max_supply > 0) {
      score += 1;
      flags.push('Fixed max supply - Predictable');
    } else {
      score -= 0.5;
      flags.push('No max supply - Potential inflation');
    }

    // Market cap relative to total supply valuation
    const fullyDilutedValuation = coinData.price_usd * coinData.total_supply;
    const fdvToMcapRatio = fullyDilutedValuation / coinData.market_cap;
    
    if (fdvToMcapRatio < 1.5) {
      score += 1.5;
      flags.push('Low FDV/MC ratio (<1.5x) - Low unlock pressure');
    } else if (fdvToMcapRatio < 3) {
      score += 0.5;
      flags.push('Moderate FDV/MC ratio (1.5-3x)');
    } else {
      score -= 1;
      flags.push('High FDV/MC ratio (>3x) - High unlock risk');
    }

    return {
      score: Math.max(0, Math.min(10, parseFloat(score.toFixed(2)))),
      details: {
        circulating_ratio: parseFloat((circulatingRatio * 100).toFixed(2)),
        fdv_to_mcap: parseFloat(fdvToMcapRatio.toFixed(2)),
        has_max_supply: !!coinData.max_supply
      },
      flags: flags
    };
  }

  // Liquidity Score (0-10)
  scoreLiquidity(coinData) {
    let score = 5;
    const flags = [];
    const liquidity = coinData.liquidity;

    // Volume to market cap ratio
    const volumeRatio = liquidity.volume_to_market_cap;
    
    if (volumeRatio > 10) {
      score += 2.5;
      flags.push('High volume/mcap ratio (>10%) - Very liquid');
    } else if (volumeRatio > 5) {
      score += 1.5;
      flags.push('Good volume/mcap ratio (5-10%)');
    } else if (volumeRatio > 2) {
      score += 0.5;
      flags.push('Moderate volume/mcap ratio (2-5%)');
    } else {
      score -= 1;
      flags.push('Low volume/mcap ratio (<2%) - Illiquid');
    }

    // Binance volume dominance (quality check)
    const binanceRatio = liquidity.binance_volume / liquidity.total_volume;
    
    if (binanceRatio > 0.3 && binanceRatio < 0.8) {
      score += 2;
      flags.push('Healthy Binance volume (30-80%) - Real volume');
    } else if (binanceRatio >= 0.8) {
      score += 1;
      flags.push('High Binance dominance (>80%) - Centralized but safe');
    } else if (binanceRatio > 0.1) {
      score += 0.5;
      flags.push('Low Binance volume (10-30%)');
    } else {
      score -= 1.5;
      flags.push('Very low Binance volume (<10%) - Wash trading risk');
    }

    // Absolute volume check
    if (liquidity.total_volume > 50000000) {
      score += 1;
      flags.push('High absolute volume (>$50M)');
    } else if (liquidity.total_volume > 10000000) {
      score += 0.5;
      flags.push('Moderate volume ($10-50M)');
    } else if (liquidity.total_volume < 1000000) {
      score -= 1;
      flags.push('Low volume (<$1M) - Risky');
    }

    return {
      score: Math.max(0, Math.min(10, parseFloat(score.toFixed(2)))),
      details: {
        volume_to_mcap_ratio: parseFloat(volumeRatio.toFixed(2)),
        binance_volume_percentage: parseFloat((binanceRatio * 100).toFixed(2)),
        total_volume_24h: liquidity.total_volume
      },
      flags: flags
    };
  }

  // Social Score (0-10)
  scoreSocial(socialData) {
    let score = 5;
    const flags = [];

    // Galaxy score mapping (0-100 → 0-10)
    const galaxyContribution = (socialData.galaxy_score / 100) * 4;
    score += galaxyContribution - 2; // Normalize around 5

    if (socialData.galaxy_score >= 70) {
      flags.push('Strong social presence (Galaxy >70)');
    } else if (socialData.galaxy_score >= 50) {
      flags.push('Moderate social presence (Galaxy 50-70)');
    } else {
      flags.push('Weak social presence (Galaxy <50)');
    }

    // Alt rank (lower is better)
    if (socialData.alt_rank <= 100) {
      score += 2;
      flags.push('Top 100 social rank - Excellent');
    } else if (socialData.alt_rank <= 500) {
      score += 1;
      flags.push('Top 500 social rank - Good');
    } else if (socialData.alt_rank > 2000) {
      score -= 1;
      flags.push('Low social rank (>2000)');
    }

    // Sentiment check
    if (socialData.sentiment === 'bullish') {
      score += 1;
      flags.push('Bullish sentiment');
    } else if (socialData.sentiment === 'bearish') {
      score -= 0.5;
      flags.push('Bearish sentiment');
    }

    // Social volume
    if (socialData.social_volume_24h > 20000) {
      score += 1;
      flags.push('High social volume (>20k mentions)');
    } else if (socialData.social_volume_24h < 5000) {
      score -= 0.5;
      flags.push('Low social volume (<5k mentions)');
    }

    return {
      score: Math.max(0, Math.min(10, parseFloat(score.toFixed(2)))),
      details: {
        galaxy_score: socialData.galaxy_score,
        alt_rank: socialData.alt_rank,
        sentiment: socialData.sentiment,
        social_volume: socialData.social_volume_24h
      },
      flags: flags,
      data_quality: socialData.confidence_level || 'simulated'
    };
  }

  // On-chain Score (0-10)
  scoreOnchain(onchainData) {
    let score = 5;
    const flags = [];

    // Active addresses (health indicator)
    if (onchainData.active_addresses_7d > 10000) {
      score += 2;
      flags.push('High activity (>10k addresses/week)');
    } else if (onchainData.active_addresses_7d > 5000) {
      score += 1;
      flags.push('Moderate activity (5-10k addresses)');
    } else if (onchainData.active_addresses_7d < 1000) {
      score -= 1;
      flags.push('Low activity (<1k addresses)');
    }

    // Growth metrics
    if (onchainData.address_growth_mom > 20) {
      score += 2;
      flags.push('Strong growth (>20% MoM)');
    } else if (onchainData.address_growth_mom > 0) {
      score += 1;
      flags.push('Positive growth');
    } else if (onchainData.address_growth_mom < -10) {
      score -= 1.5;
      flags.push('Declining users (>10% drop)');
    }

    // TVL trend
    if (onchainData.tvl_change_7d > 10) {
      score += 1.5;
      flags.push('TVL growing (>10% weekly)');
    } else if (onchainData.tvl_change_7d < -15) {
      score -= 1;
      flags.push('TVL declining (>15% weekly)');
    }

    // Daily active ratio
    if (onchainData.daily_active_ratio > 40) {
      score += 1;
      flags.push('High user retention (>40% DAU/MAU)');
    } else if (onchainData.daily_active_ratio < 20) {
      score -= 0.5;
      flags.push('Low retention (<20% DAU/MAU)');
    }

    return {
      score: Math.max(0, Math.min(10, parseFloat(score.toFixed(2)))),
      details: {
        active_addresses_7d: onchainData.active_addresses_7d,
        address_growth_mom: onchainData.address_growth_mom,
        tvl_change_7d: onchainData.tvl_change_7d,
        daily_active_ratio: onchainData.daily_active_ratio
      },
      flags: flags,
      data_quality: onchainData.confidence_level || 'simulated'
    };
  }
}

module.exports = new ScoringEngine();