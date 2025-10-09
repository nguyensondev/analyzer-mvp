const config = require("../../config");
const logger = require("../../utils/logger");

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
      return { level: "GREEN", description: "Strong fundamentals" };
    } else if (score >= this.thresholds.yellow) {
      return { level: "YELLOW", description: "Moderate fundamentals" };
    } else {
      return { level: "RED", description: "Weak fundamentals" };
    }
  }

  scoreTokenomics(coinData) {
    let score = 5;
    const flags = [];

    const circulatingRatio =
      coinData.circulating_supply / coinData.total_supply;

    if (circulatingRatio > 0.7) {
      score += 2;
      flags.push("High circulating ratio (>70%) - Good");
    } else if (circulatingRatio > 0.4) {
      score += 1;
      flags.push("Moderate circulating ratio (40-70%)");
    } else {
      score -= 1;
      flags.push("Low circulating ratio (<40%) - Risk of dilution");
    }

    if (coinData.max_supply && coinData.max_supply > 0) {
      score += 1;
      flags.push("Fixed max supply - Predictable");
    } else {
      score -= 0.5;
      flags.push("No max supply - Potential inflation");
    }

    const fullyDilutedValuation = coinData.price_usd * coinData.total_supply;
    const fdvToMcapRatio = fullyDilutedValuation / coinData.market_cap;

    if (fdvToMcapRatio < 1.5) {
      score += 1.5;
      flags.push("Low FDV/MC ratio (<1.5x) - Low unlock pressure");
    } else if (fdvToMcapRatio < 3) {
      score += 0.5;
      flags.push("Moderate FDV/MC ratio (1.5-3x)");
    } else {
      score -= 1;
      flags.push("High FDV/MC ratio (>3x) - High unlock risk");
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

  scoreLiquidity(coinData) {
    let score = 5;
    const flags = [];
    const liquidity = coinData.liquidity;

    const volumeRatio = liquidity.volume_to_market_cap;

    if (volumeRatio > 10) {
      score += 2.5;
      flags.push("High volume/mcap ratio (>10%) - Very liquid");
    } else if (volumeRatio > 5) {
      score += 1.5;
      flags.push("Good volume/mcap ratio (5-10%)");
    } else if (volumeRatio > 2) {
      score += 0.5;
      flags.push("Moderate volume/mcap ratio (2-5%)");
    } else {
      score -= 1;
      flags.push("Low volume/mcap ratio (<2%) - Illiquid");
    }

    const binanceRatio = liquidity.binance_volume / liquidity.total_volume;

    if (binanceRatio > 0.3 && binanceRatio < 0.8) {
      score += 2;
      flags.push("Healthy Binance volume (30-80%) - Real volume");
    } else if (binanceRatio >= 0.8) {
      score += 1;
      flags.push("High Binance dominance (>80%) - Centralized but safe");
    } else if (binanceRatio > 0.1) {
      score += 0.5;
      flags.push("Low Binance volume (10-30%)");
    } else {
      score -= 1.5;
      flags.push("Very low Binance volume (<10%) - Wash trading risk");
    }

    if (liquidity.total_volume > 50000000) {
      score += 1;
      flags.push("High absolute volume (>$50M)");
    } else if (liquidity.total_volume > 10000000) {
      score += 0.5;
      flags.push("Moderate volume ($10-50M)");
    } else if (liquidity.total_volume < 1000000) {
      score -= 1;
      flags.push("Low volume (<$1M) - Risky");
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

  scoreSocial(socialData) {
    let score = 5;
    const flags = [];

    // Check if using new enhanced format or old mock format
    const isEnhanced = socialData.data_source === "real (enhanced)";

    if (isEnhanced) {
      // NEW: Score based on real API data
      const communityScore = socialData.community_score || 0;
      const engagementScore = socialData.engagement_score || 0;
      const developerScore = socialData.developer_score || 0;

      // Map 0-100 scores to 0-10 scale
      score =
        ((communityScore * 0.4 + engagementScore * 0.3 + developerScore * 0.3) /
          100) *
        10;

      // Add flags based on real data
      if (socialData.twitter) {
        if (socialData.twitter.followers > 100000) {
          flags.push(
            `Strong Twitter presence (${(
              socialData.twitter.followers / 1000
            ).toFixed(0)}K followers)`
          );
        }
        if (socialData.twitter.verified) {
          flags.push("Verified Twitter account");
        }
      }

      if (socialData.reddit) {
        if (socialData.reddit.subscribers > 50000) {
          flags.push(
            `Large Reddit community (${(
              socialData.reddit.subscribers / 1000
            ).toFixed(0)}K members)`
          );
        }
        if (socialData.reddit.activity_ratio > 2) {
          flags.push("High Reddit activity ratio");
        }
      }

      if (socialData.github) {
        if (socialData.github.days_since_last_commit < 7) {
          flags.push("Active development (commits within last week)");
        }
        if (socialData.github.stars > 1000) {
          flags.push(
            `Popular GitHub repo (${(socialData.github.stars / 1000).toFixed(
              1
            )}K stars)`
          );
        }
      }

      // Sentiment
      if (socialData.sentiment === "bullish") {
        score += 0.5;
        flags.push("Bullish community sentiment");
      } else if (socialData.sentiment === "bearish") {
        score -= 0.5;
        flags.push("Bearish community sentiment");
      }
    } else {
      // OLD: Mock data scoring (fallback)
      const galaxyContribution = (socialData.galaxy_score / 100) * 4;
      score += galaxyContribution - 2;

      if (socialData.galaxy_score >= 70) {
        flags.push("Strong social presence (Galaxy >70)");
      } else if (socialData.galaxy_score >= 50) {
        flags.push("Moderate social presence (Galaxy 50-70)");
      } else {
        flags.push("Weak social presence (Galaxy <50)");
      }

      if (socialData.alt_rank <= 100) {
        score += 2;
        flags.push("Top 100 social rank - Excellent");
      } else if (socialData.alt_rank <= 500) {
        score += 1;
        flags.push("Top 500 social rank - Good");
      } else if (socialData.alt_rank > 2000) {
        score -= 1;
        flags.push("Low social rank (>2000)");
      }

      if (socialData.sentiment === "bullish") {
        score += 1;
        flags.push("Bullish sentiment");
      } else if (socialData.sentiment === "bearish") {
        score -= 0.5;
        flags.push("Bearish sentiment");
      }

      if (socialData.social_volume_24h > 20000) {
        score += 1;
        flags.push("High social volume (>20k mentions)");
      } else if (socialData.social_volume_24h < 5000) {
        score -= 0.5;
        flags.push("Low social volume (<5k mentions)");
      }
    }

    return {
      score: Math.max(0, Math.min(10, parseFloat(score.toFixed(2)))),
      details: isEnhanced
        ? {
            community_score: socialData.community_score,
            engagement_score: socialData.engagement_score,
            developer_score: socialData.developer_score,
            overall_social_score: socialData.overall_social_score,
            sentiment: socialData.sentiment,
            has_twitter: !!socialData.twitter,
            has_reddit: !!socialData.reddit,
            has_github: !!socialData.github
          }
        : {
            galaxy_score: socialData.galaxy_score,
            alt_rank: socialData.alt_rank,
            sentiment: socialData.sentiment,
            social_volume: socialData.social_volume_24h
          },
      flags: flags,
      data_quality:
        socialData.data_quality || socialData.confidence_level || "simulated"
    };
  }

  scoreOnchain_old(onchainData) {
    let score = 5;
    const flags = [];

    if (onchainData.active_addresses_7d > 10000) {
      score += 2;
      flags.push("High activity (>10k addresses/week)");
    } else if (onchainData.active_addresses_7d > 5000) {
      score += 1;
      flags.push("Moderate activity (5-10k addresses)");
    } else if (onchainData.active_addresses_7d < 1000) {
      score -= 1;
      flags.push("Low activity (<1k addresses)");
    }

    if (onchainData.address_growth_mom > 20) {
      score += 2;
      flags.push("Strong growth (>20% MoM)");
    } else if (onchainData.address_growth_mom > 0) {
      score += 1;
      flags.push("Positive growth");
    } else if (onchainData.address_growth_mom < -10) {
      score -= 1.5;
      flags.push("Declining users (>10% drop)");
    }

    if (onchainData.tvl_change_7d > 10) {
      score += 1.5;
      flags.push("TVL growing (>10% weekly)");
    } else if (onchainData.tvl_change_7d < -15) {
      score -= 1;
      flags.push("TVL declining (>15% weekly)");
    }

    if (onchainData.daily_active_ratio > 40) {
      score += 1;
      flags.push("High user retention (>40% DAU/MAU)");
    } else if (onchainData.daily_active_ratio < 20) {
      score -= 0.5;
      flags.push("Low retention (<20% DAU/MAU)");
    }
    const temp = Math.max(0, Math.min(10, parseFloat(score.toFixed(2))));
   
    return {
      score: Math.max(0, Math.min(10, parseFloat(score.toFixed(2)))),
      details: {
        active_addresses_7d: onchainData.active_addresses_7d,
        address_growth_mom: onchainData.address_growth_mom,
        tvl_change_7d: onchainData.tvl_change_7d,
        daily_active_ratio: onchainData.daily_active_ratio
      },
      flags: flags,
      data_quality: onchainData.confidence_level || "simulated"
    };
  }

  scoreOnchain(onchainData) {
    let score = 5;
    const flags = [];
    const warnings = [];
    const redFlags = [];

    // === AGGREGATE DATA FROM ALL CHAINS ===
    let totalHolders = onchainData.total_holders || 0;
    let totalActive7d = onchainData.active_addresses_7d || 0;
    let totalActive30d = onchainData.active_addresses_30d || 0;
    let totalTransfers24h = onchainData.total_transfers_24h || 0;
    let totalTransfers7d = onchainData.total_transfers_7d || 0;

    const chains = onchainData.chains || {};
    const chainList = Object.values(chains);
    const isMultichain = onchainData.chain_info?.is_multichain;
    const chainCount = onchainData.chain_count || chainList.length;

    // Aggregate from chains if root data is empty
    if (chainList.length > 0 && totalHolders === 0) {
      // SUM holders vì mỗi chain là ecosystem riêng (đúng hơn MAX)
      totalHolders = chainList.reduce(
        (sum, c) => sum + (c.total_holders || 0),
        0
      );
      totalActive7d = chainList.reduce(
        (sum, c) => sum + (c.estimated_active_7d || 0),
        0
      );
      totalActive30d = chainList.reduce(
        (sum, c) => sum + (c.estimated_active_30d || 0),
        0
      );

      flags.push(`Multi-chain aggregation: ${chainList.length} chains`);
    }

    // === DETERMINE TOKEN TIER (quan trọng!) ===
    let tier = "unknown";
    if (totalHolders > 1000000) tier = "mega";
    else if (totalHolders > 100000) tier = "large";
    else if (totalHolders > 10000) tier = "mid";
    else if (totalHolders > 1000) tier = "small";
    else tier = "micro";

    // === 1. HOLDER BASE ANALYSIS (adjusted by tier) ===
    if (tier === "mega") {
      score += 3;
      flags.push(`🦄 Mega cap: ${totalHolders.toLocaleString()} holders`);
    } else if (tier === "large") {
      if (totalHolders > 500000) {
        score += 2.8;
        flags.push(
          `Massive adoption: ${totalHolders.toLocaleString()} holders`
        );
      } else if (totalHolders > 250000) {
        score += 2.5;
        flags.push(
          `Very large community: ${totalHolders.toLocaleString()} holders`
        );
      } else {
        score += 2.2;
        flags.push(`Large cap: ${totalHolders.toLocaleString()} holders`);
      }
    } else if (tier === "mid") {
      if (totalHolders > 50000) {
        score += 2;
        flags.push(`Strong mid cap: ${totalHolders.toLocaleString()} holders`);
      } else if (totalHolders > 25000) {
        score += 1.6;
        flags.push(`Good mid cap: ${totalHolders.toLocaleString()} holders`);
      } else {
        score += 1.2;
        flags.push(`Mid cap: ${totalHolders.toLocaleString()} holders`);
      }
    } else if (tier === "small") {
      if (totalHolders > 5000) {
        score += 1;
        flags.push(`Upper small cap: ${totalHolders.toLocaleString()} holders`);
      } else if (totalHolders > 2500) {
        score += 0.7;
        flags.push(`Small cap: ${totalHolders.toLocaleString()} holders`);
      } else {
        score += 0.4;
        flags.push(`Lower small cap: ${totalHolders.toLocaleString()} holders`);
      }
    } else {
      // micro
      if (totalHolders > 500) {
        score += 0.2;
        flags.push(`Established micro cap: ${totalHolders} holders`);
      } else if (totalHolders > 250) {
        score += 0;
        flags.push(`Micro cap: ${totalHolders} holders - early stage`);
      } else if (totalHolders > 100) {
        score -= 0.3;
        warnings.push(`Very early stage: ${totalHolders} holders`);
      } else if (totalHolders > 50) {
        score -= 0.8;
        warnings.push(`Extremely early: ${totalHolders} holders - HIGH RISK`);
      } else if (totalHolders > 0) {
        score -= 1.5;
        redFlags.push(
          `Pre-launch stage: ${totalHolders} holders - EXTREME RISK`
        );
      }
    }

    // === 2. CONCENTRATION ANALYSIS (per chain + aggregate) ===
    let worstConcentration = 0;
    let bestConcentration = 100;
    let avgConcentration = onchainData.weighted_concentration || 0;

    // Check individual chains
    chainList.forEach((chain) => {
      const chainConc = chain.top_10_concentration || 0;
      if (chainConc > 0) {
        worstConcentration = Math.max(worstConcentration, chainConc);
        bestConcentration = Math.min(bestConcentration, chainConc);

        // Warning cho từng chain có concentration cao
        if (chainConc > 85) {
          redFlags.push(`${chain.chain}: EXTREME concentration ${chainConc}%`);
        } else if (chainConc > 75) {
          warnings.push(
            `${chain.chain}: Very high concentration ${chainConc}%`
          );
        }
      }

      // Check Gini coefficient nếu có
      if (chain.gini_coefficient > 0) {
        const gini = chain.gini_coefficient;
        if (gini > 0.9) {
          redFlags.push(
            `${chain.chain}: Gini ${gini.toFixed(2)} - extremely unequal`
          );
        } else if (gini > 0.8) {
          warnings.push(
            `${chain.chain}: Gini ${gini.toFixed(2)} - very unequal`
          );
        }
      }
    });

    // Use worst concentration for scoring (conservative approach)
    const concentrationToUse =
      worstConcentration > 0 ? worstConcentration : avgConcentration;

    if (concentrationToUse > 0) {
      // Điều chỉnh threshold theo tier
      const thresholds =
        tier === "mega" || tier === "large"
          ? { excellent: 20, good: 35, moderate: 50, high: 65, extreme: 80 }
          : tier === "mid"
          ? { excellent: 25, good: 40, moderate: 55, high: 70, extreme: 85 }
          : { excellent: 30, good: 45, moderate: 60, high: 75, extreme: 90 }; // small/micro có threshold cao hơn vì bình thường concentration cao hơn

      if (concentrationToUse < thresholds.excellent) {
        score += 1.8;
        flags.push(
          `Excellent distribution: Top 10 hold ${concentrationToUse.toFixed(
            1
          )}%`
        );
      } else if (concentrationToUse < thresholds.good) {
        score += 1.2;
        flags.push(
          `Good distribution: ${concentrationToUse.toFixed(1)}% concentration`
        );
      } else if (concentrationToUse < thresholds.moderate) {
        score += 0.5;
        flags.push(`Fair distribution: ${concentrationToUse.toFixed(1)}%`);
      } else if (concentrationToUse < thresholds.high) {
        score -= 0.4;
        warnings.push(
          `Moderate concentration risk: ${concentrationToUse.toFixed(1)}%`
        );
      } else if (concentrationToUse < thresholds.extreme) {
        score -= 1.2;
        warnings.push(
          `High concentration: ${concentrationToUse.toFixed(1)}% - RISKY`
        );
      } else {
        score -= 2.2;
        redFlags.push(
          `EXTREME concentration: ${concentrationToUse.toFixed(
            1
          )}% - CRITICAL RISK`
        );
      }
    }

    // === 3. ACTIVE USERS ANALYSIS (tier-adjusted) ===
    const activeRatio7d =
      totalHolders > 0 ? (totalActive7d / totalHolders) * 100 : 0;

    // Điều chỉnh threshold realistic hơn cho crypto
    // Thực tế: 2-5% active ratio là BÌNH THƯỜNG, 10%+ là RẤT TỐT
    let activeThresholds;
    if (tier === "mega" || tier === "large") {
      activeThresholds = { excellent: 15, good: 8, fair: 4, low: 2 };
    } else if (tier === "mid") {
      activeThresholds = { excellent: 20, good: 10, fair: 5, low: 2 };
    } else {
      activeThresholds = { excellent: 25, good: 12, fair: 6, low: 3 }; // small/micro
    }

    // Absolute numbers
    if (totalActive7d > 100000) {
      score += 2.5;
      flags.push(
        `Massive activity: ${totalActive7d.toLocaleString()} active/week`
      );
    } else if (totalActive7d > 50000) {
      score += 2.2;
      flags.push(
        `Very high activity: ${totalActive7d.toLocaleString()} active/week`
      );
    } else if (totalActive7d > 20000) {
      score += 1.8;
      flags.push(
        `High activity: ${totalActive7d.toLocaleString()} active/week`
      );
    } else if (totalActive7d > 10000) {
      score += 1.5;
      flags.push(
        `Strong activity: ${totalActive7d.toLocaleString()} active/week`
      );
    } else if (totalActive7d > 5000) {
      score += 1.2;
      flags.push(
        `Good activity: ${totalActive7d.toLocaleString()} active/week`
      );
    } else if (totalActive7d > 1000) {
      score += 0.8;
      flags.push(
        `Moderate activity: ${totalActive7d.toLocaleString()} active/week`
      );
    } else if (totalActive7d > 500) {
      score += 0.4;
      flags.push(`Fair activity: ${totalActive7d} active/week`);
    } else if (totalActive7d > 100) {
      score += 0.1;
      flags.push(`Low activity: ${totalActive7d} active/week`);
    } else if (totalActive7d > 20) {
      score -= 0.3;
      warnings.push(`Very low activity: ${totalActive7d} active/week`);
    } else if (totalActive7d > 5) {
      score -= 0.7;
      warnings.push(`Minimal activity: ${totalActive7d} active addresses`);
    } else if (totalActive7d > 0) {
      score -= 1.2;
      redFlags.push(`Near-zero activity: ${totalActive7d} active/week`);
    }

    // Active ratio (%)
    if (activeRatio7d > 0) {
      if (activeRatio7d >= activeThresholds.excellent) {
        score += 1.5;
        flags.push(
          `🔥 Excellent engagement: ${activeRatio7d.toFixed(
            1
          )}% holders active weekly`
        );
      } else if (activeRatio7d >= activeThresholds.good) {
        score += 1;
        flags.push(
          `Strong engagement: ${activeRatio7d.toFixed(1)}% active rate`
        );
      } else if (activeRatio7d >= activeThresholds.fair) {
        score += 0.5;
        flags.push(`Good engagement: ${activeRatio7d.toFixed(1)}% active`);
      } else if (activeRatio7d >= activeThresholds.low) {
        flags.push(
          `Fair engagement: ${activeRatio7d.toFixed(
            1
          )}% active (normal for crypto)`
        );
      } else if (activeRatio7d >= 1) {
        score -= 0.2;
        warnings.push(`Low engagement: ${activeRatio7d.toFixed(1)}% active`);
      } else {
        score -= 0.6;
        warnings.push(
          `Very low engagement: ${activeRatio7d.toFixed(2)}% active`
        );
      }
    }

    // === 4. RETENTION ANALYSIS ===
    if (totalActive7d > 0 && totalActive30d > 0) {
      const retention = (totalActive7d / totalActive30d) * 100;

      // Retention thresholds (realistic)
      if (retention > 60) {
        score += 1.8;
        flags.push(
          `🌟 Outstanding retention: ${retention.toFixed(1)}% weekly active`
        );
      } else if (retention > 45) {
        score += 1.4;
        flags.push(`Excellent retention: ${retention.toFixed(1)}%`);
      } else if (retention > 30) {
        score += 1;
        flags.push(`Strong retention: ${retention.toFixed(1)}%`);
      } else if (retention > 20) {
        score += 0.6;
        flags.push(`Good retention: ${retention.toFixed(1)}%`);
      } else if (retention > 15) {
        score += 0.2;
        flags.push(`Fair retention: ${retention.toFixed(1)}%`);
      } else if (retention > 10) {
        warnings.push(`Moderate retention: ${retention.toFixed(1)}%`);
      } else if (retention > 5) {
        score -= 0.3;
        warnings.push(
          `Low retention: ${retention.toFixed(1)}% - users not staying`
        );
      } else {
        score -= 0.7;
        warnings.push(`Poor retention: ${retention.toFixed(1)}% - high churn`);
      }
    } else if (totalActive30d > 0) {
      flags.push(`30-day base: ${totalActive30d.toLocaleString()} addresses`);
    }

    // === 5. TRANSACTION VOLUME ===
    if (totalTransfers24h > 20000) {
      score += 1.5;
      flags.push(`Very high tx: ${totalTransfers24h.toLocaleString()}/day`);
    } else if (totalTransfers24h > 10000) {
      score += 1.2;
      flags.push(`High tx volume: ${totalTransfers24h.toLocaleString()}/day`);
    } else if (totalTransfers24h > 5000) {
      score += 0.9;
      flags.push(`Strong tx: ${totalTransfers24h.toLocaleString()}/day`);
    } else if (totalTransfers24h > 1000) {
      score += 0.6;
      flags.push(`Good tx: ${totalTransfers24h.toLocaleString()}/day`);
    } else if (totalTransfers24h > 500) {
      score += 0.3;
      flags.push(`Moderate tx: ${totalTransfers24h}/day`);
    } else if (totalTransfers24h > 100) {
      score += 0.1;
      flags.push(`Fair tx: ${totalTransfers24h}/day`);
    } else if (totalTransfers24h > 50) {
      warnings.push(`Low tx: ${totalTransfers24h}/day`);
    } else if (totalTransfers24h > 10) {
      score -= 0.3;
      warnings.push(`Very low tx: ${totalTransfers24h}/day`);
    } else if (totalTransfers24h > 0) {
      score -= 0.7;
      warnings.push(`Minimal tx: ${totalTransfers24h}/day`);
    }

    // TX per active user
    if (totalActive7d > 0 && totalTransfers7d > 0) {
      const txPerUser = totalTransfers7d / totalActive7d;
      if (txPerUser > 20) {
        score += 0.6;
        flags.push(`High user activity: ${txPerUser.toFixed(1)} tx/user/week`);
      } else if (txPerUser > 10) {
        score += 0.3;
        flags.push(`Good activity: ${txPerUser.toFixed(1)} tx/user/week`);
      } else if (txPerUser < 2) {
        warnings.push(`Low tx per user: ${txPerUser.toFixed(1)}/week`);
      }
    }

    // === 6. MULTI-CHAIN BENEFITS ===
    if (isMultichain && chainCount > 1) {
      if (chainCount >= 6) {
        score += 1.5;
        flags.push(`🌐 Wide deployment: ${chainCount} blockchains`);
      } else if (chainCount >= 4) {
        score += 1.2;
        flags.push(`Strong multi-chain: ${chainCount} networks`);
      } else if (chainCount >= 3) {
        score += 0.8;
        flags.push(`Multi-chain: ${chainCount} networks`);
      } else {
        score += 0.4;
        flags.push(`Cross-chain: ${chainCount} networks`);
      }

      // Chain balance check
      if (chainList.length > 1) {
        const holderDist = chainList
          .map((c) => c.total_holders || 0)
          .filter((h) => h > 0);
        if (holderDist.length > 1) {
          const maxH = Math.max(...holderDist);
          const minH = Math.min(...holderDist);
          const balance = minH / maxH;

          if (balance > 0.4) {
            score += 0.6;
            flags.push("Well-balanced across chains");
          } else if (balance > 0.2) {
            score += 0.3;
            flags.push("Fairly distributed across chains");
          } else if (balance < 0.05) {
            warnings.push("Highly concentrated on one chain");
          }
        }
      }
    }

    // === 7. GROWTH METRICS (optional) ===
    if (onchainData.address_growth_mom !== undefined) {
      const growth = onchainData.address_growth_mom;
      if (growth > 100) {
        score += 2.5;
        flags.push(`🚀 Explosive growth: +${growth.toFixed(0)}% MoM`);
      } else if (growth > 50) {
        score += 2;
        flags.push(`Very strong growth: +${growth.toFixed(1)}% MoM`);
      } else if (growth > 25) {
        score += 1.5;
        flags.push(`Strong growth: +${growth.toFixed(1)}% MoM`);
      } else if (growth > 10) {
        score += 1;
        flags.push(`Good growth: +${growth.toFixed(1)}% MoM`);
      } else if (growth > 5) {
        score += 0.5;
        flags.push(`Positive growth: +${growth.toFixed(1)}% MoM`);
      } else if (growth > 0) {
        score += 0.2;
        flags.push(`Slight growth: +${growth.toFixed(1)}% MoM`);
      } else if (growth > -5) {
        warnings.push(`Minor decline: ${growth.toFixed(1)}% MoM`);
      } else if (growth > -15) {
        score -= 0.6;
        warnings.push(`Declining: ${growth.toFixed(1)}% MoM`);
      } else if (growth > -30) {
        score -= 1.5;
        redFlags.push(`Sharp decline: ${growth.toFixed(1)}% MoM`);
      } else {
        score -= 2.5;
        redFlags.push(`🚨 COLLAPSING: ${growth.toFixed(1)}% MoM`);
      }
    }

    if (onchainData.tvl_change_7d !== undefined) {
      const tvl = onchainData.tvl_change_7d;
      if (tvl > 50) {
        score += 2;
        flags.push(`TVL surging: +${tvl.toFixed(1)}%/week`);
      } else if (tvl > 25) {
        score += 1.5;
        flags.push(`TVL growing strongly: +${tvl.toFixed(1)}%`);
      } else if (tvl > 10) {
        score += 1;
        flags.push(`TVL increasing: +${tvl.toFixed(1)}%`);
      } else if (tvl > 0) {
        score += 0.4;
        flags.push(`TVL up: +${tvl.toFixed(1)}%`);
      } else if (tvl > -10) {
        warnings.push(`TVL stable: ${tvl.toFixed(1)}%`);
      } else if (tvl > -25) {
        score -= 0.6;
        warnings.push(`TVL declining: ${tvl.toFixed(1)}%`);
      } else if (tvl > -40) {
        score -= 1.5;
        warnings.push(`TVL dropping: ${tvl.toFixed(1)}%`);
      } else {
        score -= 2.5;
        redFlags.push(`TVL CRASH: ${tvl.toFixed(1)}%`);
      }
    }

    if (onchainData.daily_active_ratio !== undefined) {
      const dau_mau = onchainData.daily_active_ratio;
      if (dau_mau > 50) {
        score += 2;
        flags.push(`Outstanding stickiness: ${dau_mau.toFixed(1)}% DAU/MAU`);
      } else if (dau_mau > 40) {
        score += 1.5;
        flags.push(`Excellent DAU/MAU: ${dau_mau.toFixed(1)}%`);
      } else if (dau_mau > 30) {
        score += 1;
        flags.push(`Strong engagement: ${dau_mau.toFixed(1)}% DAU/MAU`);
      } else if (dau_mau > 20) {
        score += 0.6;
        flags.push(`Good engagement: ${dau_mau.toFixed(1)}% DAU/MAU`);
      } else if (dau_mau > 12) {
        score += 0.2;
        flags.push(`Fair engagement: ${dau_mau.toFixed(1)}%`);
      } else if (dau_mau > 5) {
        warnings.push(`Moderate engagement: ${dau_mau.toFixed(1)}% DAU/MAU`);
      } else {
        score -= 0.5;
        warnings.push(`Low engagement: ${dau_mau.toFixed(1)}% DAU/MAU`);
      }
    }

    // === 8. DATA QUALITY ===
    let dataQuality = "unknown";
    const primaryChain = chains[onchainData.chain_info?.primary];

    if (primaryChain) {
      const reliability = primaryChain.reliability;
      const confidence = primaryChain.activity_confidence;

      if (reliability === "high" && confidence === "high") {
        dataQuality = "high";
        flags.push("✓ High data quality");
      } else if (reliability === "high" || confidence === "high") {
        dataQuality = "medium-high";
      } else if (reliability === "medium" || confidence === "medium") {
        dataQuality = "medium";
        warnings.push("⚠ Medium data quality");
      } else {
        score -= 0.5;
        dataQuality = "low";
        warnings.push("⚠ Low data quality - use caution");
      }
    }

    // === 9. RED FLAGS ===

    // Ghost token
    if (totalHolders < 30 && totalActive7d < 3) {
      score -= 3;
      redFlags.push("🚨 GHOST TOKEN: No meaningful activity");
    } else if (
      totalHolders < 100 &&
      totalActive7d < 5 &&
      totalTransfers24h < 3
    ) {
      score -= 2;
      redFlags.push("🚨 Near-dead: Virtually no activity");
    }

    // Whale dominance (adjusted by tier)
    const whaleLimits =
      tier === "micro"
        ? { critical: 95, high: 85 }
        : tier === "small"
        ? { critical: 90, high: 80 }
        : { critical: 85, high: 75 };

    if (concentrationToUse > whaleLimits.critical && totalHolders < 1000) {
      score -= 2.5;
      redFlags.push("🚨 WHALE CONTROLLED: Extreme manipulation risk");
    } else if (concentrationToUse > whaleLimits.high && totalHolders < 2000) {
      score -= 1.5;
      redFlags.push("⚠ High whale dominance risk");
    }

    // Abandoned (chỉ apply cho non-micro)
    if (tier !== "micro" && totalHolders > 2000 && activeRatio7d < 0.5) {
      score -= 2;
      redFlags.push("🚨 LIKELY ABANDONED: <0.5% holders active");
    } else if (tier !== "micro" && totalHolders > 5000 && activeRatio7d < 1) {
      score -= 1.2;
      warnings.push("Possibly abandoned: <1% activity rate");
    }

    // === FINAL SCORE ===
    const finalScore = Math.max(0, Math.min(10, parseFloat(score.toFixed(2))));

    let rating, emoji;
    if (finalScore >= 8.5) {
      rating = "Excellent";
      emoji = "🌟";
    } else if (finalScore >= 7.5) {
      rating = "Very Good";
      emoji = "✨";
    } else if (finalScore >= 6.5) {
      rating = "Good";
      emoji = "👍";
    } else if (finalScore >= 5.5) {
      rating = "Above Average";
      emoji = "👌";
    } else if (finalScore >= 4.5) {
      rating = "Fair";
      emoji = "⚠️";
    } else if (finalScore >= 3.5) {
      rating = "Below Average";
      emoji = "⚠️";
    } else if (finalScore >= 2.5) {
      rating = "Poor";
      emoji = "🔴";
    } else {
      rating = "Very Poor";
      emoji = "🚨";
    }

    return {
      score: finalScore,
      rating: `${emoji} ${rating}`,
      tier: tier.charAt(0).toUpperCase() + tier.slice(1) + " Cap",
      details: {
        total_holders: totalHolders,
        active_addresses_7d: totalActive7d,
        active_addresses_30d: totalActive30d,
        active_ratio_7d:
          activeRatio7d > 0 ? activeRatio7d.toFixed(2) + "%" : "N/A",
        retention_rate:
          totalActive7d && totalActive30d
            ? ((totalActive7d / totalActive30d) * 100).toFixed(1) + "%"
            : "N/A",
        total_transfers_24h: totalTransfers24h,
        total_transfers_7d: totalTransfers7d,
        avg_tx_per_user:
          totalActive7d && totalTransfers7d
            ? (totalTransfers7d / totalActive7d).toFixed(1)
            : "N/A",
        concentration:
          concentrationToUse > 0 ? concentrationToUse.toFixed(1) + "%" : "N/A",
        concentration_range:
          worstConcentration > 0 && bestConcentration < 100
            ? `${bestConcentration.toFixed(1)}%-${worstConcentration.toFixed(
                1
              )}%`
            : "N/A",
        chain_count: chainCount,
        is_multichain: isMultichain,
        chains_detail: chainList.map((c) => ({
          chain: JSON.stringify(c.chain),
          holders: c.total_holders || 0,
          active_7d: c.estimated_active_7d || 0,
          active_30d: c.estimated_active_30d || 0,
          concentration: c.top_10_concentration || 0,
          gini: c.gini_coefficient || 0,
          data_source: c.data_source
        }))
      },
      flags: flags,
      warnings: warnings,
      red_flags: redFlags,
      data_quality: dataQuality,
      data_source: onchainData.data_source,
      confidence_level:
        onchainData.confidence_level ||
        primaryChain?.activity_confidence ||
        "unknown",
      aggregation_note:
        totalHolders !== onchainData.total_holders
          ? "Data aggregated from individual chains"
          : "Using root-level data"
    };
  }
}

module.exports = new ScoringEngine();
