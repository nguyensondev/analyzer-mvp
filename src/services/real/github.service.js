const axios = require('axios');
const logger = require('../../utils/logger');
const db = require('../../utils/database');

class GitHubService {
  constructor() {
    this.token = process.env.GITHUB_TOKEN;
    this.baseUrl = 'https://api.github.com';
    this.timeout = 10000;
  }

  async getDevActivity(ticker, coinName) {
    const startTime = Date.now();
    
    try {
      // Step 1: Search for repositories
      const repo = await this.findMainRepository(ticker, coinName);
      
      if (!repo) {
        logger.info(`No GitHub repository found for ${ticker}`);
        return null;
      }

      // Step 2: Get repository details
      const repoResponse = await axios.get(
        `${this.baseUrl}/repos/${repo.owner}/${repo.name}`,
        {
          headers: this.getHeaders(),
          timeout: this.timeout
        }
      );

      const repoData = repoResponse.data;

      // Step 3: Get commit activity
      const commitActivity = await this.getCommitActivity(repo.owner, repo.name);

      // Step 4: Get contributors
      const contributors = await this.getContributors(repo.owner, repo.name);

      // Step 5: Get recent commits
      const recentCommits = await this.getRecentCommits(repo.owner, repo.name);

      const result = {
        repository: `${repo.owner}/${repo.name}`,
        full_name: repoData.full_name,
        description: repoData.description,
        homepage: repoData.homepage,
        
        // Core metrics
        stars: repoData.stargazers_count,
        watchers: repoData.watchers_count,
        forks: repoData.forks_count,
        open_issues: repoData.open_issues_count,
        
        // Activity metrics
        commits_last_year: commitActivity.total_commits,
        commits_last_month: commitActivity.last_month_commits,
        commits_last_week: commitActivity.last_week_commits,
        avg_commits_per_week: commitActivity.avg_per_week,
        
        // Contributor metrics
        total_contributors: contributors.total,
        active_contributors_30d: contributors.active_30d,
        top_contributor_percentage: contributors.top_contributor_pct,
        
        // Recent activity
        last_commit_date: recentCommits.last_commit_date,
        days_since_last_commit: recentCommits.days_since_last,
        commits_last_7d: recentCommits.count_7d,
        
        // Repository health
        created_at: repoData.created_at,
        updated_at: repoData.updated_at,
        pushed_at: repoData.pushed_at,
        repo_age_days: this.calculateAge(repoData.created_at),
        is_archived: repoData.archived,
        has_issues: repoData.has_issues,
        has_wiki: repoData.has_wiki,
        
        // License
        license: repoData.license?.name || 'Unknown',
        
        data_source: 'github_api',
        reliability: 'high',
        timestamp: new Date().toISOString()
      };

      await db.logApiCall('github', `/repos/${repo.owner}/${repo.name}`, 200, Date.now() - startTime);
      logger.info(`GitHub data fetched for ${ticker}`, {
        repo: result.repository,
        stars: result.stars,
        commits_last_month: result.commits_last_month,
        responseTime: Date.now() - startTime
      });

      return result;

    } catch (error) {
      const status = error.response?.status || 500;
      await db.logApiCall('github', `/search/${ticker}`, status, Date.now() - startTime);
      
      if (status === 403) {
        logger.warn(`GitHub API rate limit exceeded for ${ticker}`);
      } else {
        logger.error(`GitHub API error for ${ticker}:`, error.message);
      }
      
      return null;
    }
  }

  async findMainRepository(ticker, coinName) {
    try {
      // Search queries
      const queries = [
        coinName,
        ticker,
        `${ticker} blockchain`,
        `${coinName} official`
      ].filter(Boolean);

      for (const query of queries) {
        const response = await axios.get(
          `${this.baseUrl}/search/repositories`,
          {
            params: {
              q: query,
              sort: 'stars',
              order: 'desc',
              per_page: 5
            },
            headers: this.getHeaders(),
            timeout: this.timeout
          }
        );

        const repos = response.data.items;
        
        if (repos.length > 0) {
          // Pick repository with most stars
          const mainRepo = repos[0];
          logger.info(`Found GitHub repo: ${mainRepo.full_name} for ${ticker}`);
          
          return {
            owner: mainRepo.owner.login,
            name: mainRepo.name
          };
        }
      }

      return null;
    } catch (error) {
      logger.error('Error finding GitHub repository:', error.message);
      return null;
    }
  }

  async getCommitActivity(owner, repo) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/repos/${owner}/${repo}/stats/commit_activity`,
        {
          headers: this.getHeaders(),
          timeout: this.timeout
        }
      );

      const weeks = response.data || [];
      
      if (weeks.length === 0) {
        return {
          total_commits: 0,
          last_month_commits: 0,
          last_week_commits: 0,
          avg_per_week: 0
        };
      }

      const totalCommits = weeks.reduce((sum, week) => sum + week.total, 0);
      const lastWeekCommits = weeks[weeks.length - 1]?.total || 0;
      const lastMonthCommits = weeks.slice(-4).reduce((sum, week) => sum + week.total, 0);
      const avgPerWeek = Math.round(totalCommits / weeks.length);

      return {
        total_commits: totalCommits,
        last_month_commits: lastMonthCommits,
        last_week_commits: lastWeekCommits,
        avg_per_week: avgPerWeek
      };
    } catch (error) {
      logger.error('Error getting commit activity:', error.message);
      return {
        total_commits: 0,
        last_month_commits: 0,
        last_week_commits: 0,
        avg_per_week: 0
      };
    }
  }

  async getContributors(owner, repo) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/repos/${owner}/${repo}/contributors`,
        {
          params: { per_page: 100 },
          headers: this.getHeaders(),
          timeout: this.timeout
        }
      );

      const contributors = response.data || [];
      
      if (contributors.length === 0) {
        return {
          total: 0,
          active_30d: 0,
          top_contributor_pct: 0
        };
      }

      const totalContributions = contributors.reduce((sum, c) => sum + c.contributions, 0);
      const topContributorPct = contributors.length > 0 
        ? parseFloat(((contributors[0].contributions / totalContributions) * 100).toFixed(2))
        : 0;

      return {
        total: contributors.length,
        active_30d: Math.min(contributors.length, 10), // Estimate
        top_contributor_pct: topContributorPct
      };
    } catch (error) {
      logger.error('Error getting contributors:', error.message);
      return {
        total: 0,
        active_30d: 0,
        top_contributor_pct: 0
      };
    }
  }

  async getRecentCommits(owner, repo) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/repos/${owner}/${repo}/commits`,
        {
          params: { per_page: 100 },
          headers: this.getHeaders(),
          timeout: this.timeout
        }
      );

      const commits = response.data || [];
      
      if (commits.length === 0) {
        return {
          last_commit_date: null,
          days_since_last: 9999,
          count_7d: 0
        };
      }

      const lastCommitDate = new Date(commits[0].commit.committer.date);
      const now = new Date();
      const daysSinceLast = Math.ceil((now - lastCommitDate) / (1000 * 60 * 60 * 24));

      // Count commits in last 7 days
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const count7d = commits.filter(c => {
        const commitDate = new Date(c.commit.committer.date);
        return commitDate > sevenDaysAgo;
      }).length;

      return {
        last_commit_date: lastCommitDate.toISOString(),
        days_since_last: daysSinceLast,
        count_7d: count7d
      };
    } catch (error) {
      logger.error('Error getting recent commits:', error.message);
      return {
        last_commit_date: null,
        days_since_last: 9999,
        count_7d: 0
      };
    }
  }

  getHeaders() {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'CryptoFundamentalAnalyzer'
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    return headers;
  }

  calculateAge(createdAt) {
    const created = new Date(createdAt);
    const now = new Date();
    const diffTime = Math.abs(now - created);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
}

module.exports = new GitHubService();