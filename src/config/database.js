const fs = require("fs-extra");
const path = require("path");
const logger = require("../utils/logger");

class Database {
  constructor() {
    this.dataDir = "./data";
    this.processedVideosFile = path.join(this.dataDir, "processed_videos.json");
    this.statsFile = path.join(this.dataDir, "stats.json");
    this.initializeDatabase();
  }

  /**
   * Initialize database files
   */
  async initializeDatabase() {
    try {
      await fs.ensureDir(this.dataDir);

      // Initialize processed videos file
      if (!(await fs.pathExists(this.processedVideosFile))) {
        await fs.writeJson(this.processedVideosFile, {
          videos: {},
          lastUpdated: new Date().toISOString(),
        });
      }

      // Initialize stats file
      if (!(await fs.pathExists(this.statsFile))) {
        await fs.writeJson(this.statsFile, {
          totalProcessed: 0,
          totalUploaded: 0,
          totalFailed: 0,
          lastRun: null,
          firstRun: new Date().toISOString(),
          processingHistory: [],
        });
      }

      logger.info("Database initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize database", { error: error.message });
      throw error;
    }
  }

  /**
   * Get all processed video IDs
   */
  async getProcessedVideoIds() {
    try {
      const data = await fs.readJson(this.processedVideosFile);
      return Object.keys(data.videos || {});
    } catch (error) {
      logger.error("Failed to get processed video IDs", {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Check if a video has been processed
   */
  async isVideoProcessed(videoId) {
    try {
      const data = await fs.readJson(this.processedVideosFile);
      return !!(data.videos && data.videos[videoId]);
    } catch (error) {
      logger.error("Failed to check if video is processed", {
        error: error.message,
        videoId,
      });
      return false;
    }
  }

  /**
   * Mark a video as processed
   */
  async markVideoAsProcessed(videoId, metadata = {}) {
    try {
      const data = await fs.readJson(this.processedVideosFile);

      if (!data.videos) {
        data.videos = {};
      }

      data.videos[videoId] = {
        processedAt: new Date().toISOString(),
        ...metadata,
      };

      data.lastUpdated = new Date().toISOString();

      await fs.writeJson(this.processedVideosFile, data, { spaces: 2 });

      logger.info("Video marked as processed", { videoId, metadata });
    } catch (error) {
      logger.error("Failed to mark video as processed", {
        error: error.message,
        videoId,
      });
      throw error;
    }
  }

  /**
   * Get processed video metadata
   */
  async getProcessedVideoMetadata(videoId) {
    try {
      const data = await fs.readJson(this.processedVideosFile);
      return data.videos && data.videos[videoId] ? data.videos[videoId] : null;
    } catch (error) {
      logger.error("Failed to get processed video metadata", {
        error: error.message,
        videoId,
      });
      return null;
    }
  }

  /**
   * Remove processed video record
   */
  async removeProcessedVideo(videoId) {
    try {
      const data = await fs.readJson(this.processedVideosFile);

      if (data.videos && data.videos[videoId]) {
        delete data.videos[videoId];
        data.lastUpdated = new Date().toISOString();

        await fs.writeJson(this.processedVideosFile, data, { spaces: 2 });

        logger.info("Processed video record removed", { videoId });
      }
    } catch (error) {
      logger.error("Failed to remove processed video", {
        error: error.message,
        videoId,
      });
      throw error;
    }
  }

  /**
   * Get processing statistics
   */
  async getStats() {
    try {
      const data = await fs.readJson(this.statsFile);
      return data;
    } catch (error) {
      logger.error("Failed to get stats", { error: error.message });
      return {
        totalProcessed: 0,
        totalUploaded: 0,
        totalFailed: 0,
        lastRun: null,
        firstRun: new Date().toISOString(),
        processingHistory: [],
      };
    }
  }

  /**
   * Update processing statistics
   */
  async updateStats(results) {
    try {
      const data = await this.getStats();

      data.totalProcessed += results.processed || 0;
      data.totalUploaded += results.processed || 0; // Assuming processed = uploaded
      data.totalFailed += results.failed || 0;
      data.lastRun = new Date().toISOString();

      // Add to processing history (keep last 100 runs)
      data.processingHistory.push({
        timestamp: new Date().toISOString(),
        processed: results.processed || 0,
        failed: results.failed || 0,
        errors: results.errors || [],
      });

      // Keep only last 100 history entries
      if (data.processingHistory.length > 100) {
        data.processingHistory = data.processingHistory.slice(-100);
      }

      await fs.writeJson(this.statsFile, data, { spaces: 2 });

      logger.info("Stats updated", { results });
    } catch (error) {
      logger.error("Failed to update stats", { error: error.message });
      throw error;
    }
  }

  /**
   * Get recent processing history
   */
  async getRecentHistory(limit = 10) {
    try {
      const data = await this.getStats();
      return data.processingHistory.slice(-limit).reverse();
    } catch (error) {
      logger.error("Failed to get recent history", { error: error.message });
      return [];
    }
  }

  /**
   * Clean up old processed video records
   */
  async cleanupOldRecords(daysToKeep = 30) {
    try {
      const data = await fs.readJson(this.processedVideosFile);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      let cleanedCount = 0;

      for (const [videoId, metadata] of Object.entries(data.videos || {})) {
        const processedDate = new Date(metadata.processedAt);

        if (processedDate < cutoffDate) {
          delete data.videos[videoId];
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        data.lastUpdated = new Date().toISOString();
        await fs.writeJson(this.processedVideosFile, data, { spaces: 2 });

        logger.info(`Cleaned up ${cleanedCount} old processed video records`);
      }
    } catch (error) {
      logger.error("Failed to cleanup old records", { error: error.message });
      throw error;
    }
  }

  /**
   * Export data for backup
   */
  async exportData() {
    try {
      const processedVideos = await fs.readJson(this.processedVideosFile);
      const stats = await fs.readJson(this.statsFile);

      return {
        processedVideos,
        stats,
        exportedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Failed to export data", { error: error.message });
      throw error;
    }
  }

  /**
   * Import data from backup
   */
  async importData(backupData) {
    try {
      if (backupData.processedVideos) {
        await fs.writeJson(
          this.processedVideosFile,
          backupData.processedVideos,
          { spaces: 2 }
        );
      }

      if (backupData.stats) {
        await fs.writeJson(this.statsFile, backupData.stats, { spaces: 2 });
      }

      logger.info("Data imported successfully");
    } catch (error) {
      logger.error("Failed to import data", { error: error.message });
      throw error;
    }
  }

  /**
   * Reset all data
   */
  async resetData() {
    try {
      await fs.writeJson(this.processedVideosFile, {
        videos: {},
        lastUpdated: new Date().toISOString(),
      });

      await fs.writeJson(this.statsFile, {
        totalProcessed: 0,
        totalUploaded: 0,
        totalFailed: 0,
        lastRun: null,
        firstRun: new Date().toISOString(),
        processingHistory: [],
      });

      logger.info("Database reset successfully");
    } catch (error) {
      logger.error("Failed to reset data", { error: error.message });
      throw error;
    }
  }

  /**
   * Get database health info
   */
  async getHealthInfo() {
    try {
      const processedVideosExists = await fs.pathExists(
        this.processedVideosFile
      );
      const statsExists = await fs.pathExists(this.statsFile);

      let processedCount = 0;
      let lastUpdate = null;

      if (processedVideosExists) {
        const data = await fs.readJson(this.processedVideosFile);
        processedCount = Object.keys(data.videos || {}).length;
        lastUpdate = data.lastUpdated;
      }

      return {
        healthy: processedVideosExists && statsExists,
        processedVideosFile: processedVideosExists,
        statsFile: statsExists,
        processedCount,
        lastUpdate,
        dataDirectory: this.dataDir,
      };
    } catch (error) {
      logger.error("Failed to get database health info", {
        error: error.message,
      });
      return {
        healthy: false,
        error: error.message,
      };
    }
  }

  /**
   * Get all processed videos with metadata
   */
  async getProcessedVideos() {
    try {
      const data = await fs.readJson(this.processedVideosFile);
      const videos = Object.entries(data.videos || {}).map(
        ([id, metadata]) => ({
          id,
          ...metadata,
        })
      );
      return videos;
    } catch (error) {
      logger.error("Failed to get processed videos", { error: error.message });
      return [];
    }
  }

  /**
   * Clear all processed videos
   */
  async clearProcessedVideos() {
    try {
      await fs.writeJson(this.processedVideosFile, {
        videos: {},
        lastUpdated: new Date().toISOString(),
      });
      logger.info("All processed videos cleared");
      return true;
    } catch (error) {
      logger.error("Failed to clear processed videos", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Update statistics
   */
  async updateStats(newStats) {
    try {
      await fs.writeJson(this.statsFile, {
        ...newStats,
        lastUpdated: new Date().toISOString(),
      });
      logger.debug("Statistics updated successfully");
      return true;
    } catch (error) {
      logger.error("Failed to update statistics", { error: error.message });
      return false;
    }
  }

  /**
   * Initialize database (external call)
   */
  async init() {
    await this.initializeDatabase();
    return true;
  }
}

module.exports = new Database();
