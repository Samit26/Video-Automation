/**
 * Video Processing Manager
 * Handles video selection and tracking to ensure different videos are processed each run
 */

const logger = require("../utils/logger");

class VideoManager {
  constructor(database) {
    this.database = database;
    this.maxVideosPerRun = parseInt(process.env.MAX_VIDEOS_PER_RUN) || 3;
    this.processingStrategy =
      process.env.VIDEO_PROCESSING_STRATEGY || "sequential"; // 'sequential', 'random', 'oldest_first'
  }

  /**
   * Select videos to process based on strategy
   */
  async selectVideosToProcess(availableVideos) {
    try {
      // Get already processed videos
      const processedVideos = await this.database.getProcessedVideos();
      const processedIds = new Set(processedVideos.map((v) => v.id));

      // Filter out already processed videos
      const newVideos = availableVideos.filter(
        (video) => !processedIds.has(video.id)
      );

      logger.info("Video selection summary", {
        totalAvailable: availableVideos.length,
        alreadyProcessed: processedIds.size,
        newVideos: newVideos.length,
        maxPerRun: this.maxVideosPerRun,
      });

      if (newVideos.length === 0) {
        logger.warn(
          "No new videos to process. All videos have been processed."
        );
        return [];
      }

      // Apply processing strategy
      let selectedVideos = [];

      switch (this.processingStrategy) {
        case "random":
          selectedVideos = this.selectRandomVideos(newVideos);
          break;
        case "oldest_first":
          selectedVideos = this.selectOldestVideos(newVideos);
          break;
        case "sequential":
        default:
          selectedVideos = this.selectSequentialVideos(newVideos);
          break;
      }

      logger.info("Videos selected for processing", {
        strategy: this.processingStrategy,
        selectedCount: selectedVideos.length,
        videos: selectedVideos.map((v) => ({ id: v.id, name: v.name })),
      });

      return selectedVideos;
    } catch (error) {
      logger.error("Failed to select videos for processing", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Select videos sequentially (first N videos)
   */
  selectSequentialVideos(videos) {
    return videos.slice(0, this.maxVideosPerRun);
  }

  /**
   * Select videos randomly
   */
  selectRandomVideos(videos) {
    const shuffled = [...videos].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, this.maxVideosPerRun);
  }

  /**
   * Select oldest videos first (based on creation date if available)
   */
  selectOldestVideos(videos) {
    const sorted = [...videos].sort((a, b) => {
      // If videos have creation dates, use them
      if (a.createdTime && b.createdTime) {
        return new Date(a.createdTime) - new Date(b.createdTime);
      }
      // Otherwise, sort by name (assuming names might have dates/numbers)
      return a.name.localeCompare(b.name);
    });
    return sorted.slice(0, this.maxVideosPerRun);
  }

  /**
   * Get processing statistics
   */
  async getProcessingStats() {
    try {
      const processedVideos = await this.database.getProcessedVideos();
      const stats = await this.database.getStats();

      const today = new Date().toISOString().split("T")[0];
      const todayProcessed = processedVideos.filter(
        (v) => v.processedAt && v.processedAt.startsWith(today)
      );

      return {
        totalProcessed: processedVideos.length,
        processedToday: todayProcessed.length,
        successfulUploads: processedVideos.filter(
          (v) => v.uploadResult?.success
        ).length,
        failedUploads: processedVideos.filter((v) => !v.uploadResult?.success)
          .length,
        averageProcessingTime:
          this.calculateAverageProcessingTime(processedVideos),
        lastProcessedAt:
          processedVideos.length > 0
            ? Math.max(
                ...processedVideos.map((v) => new Date(v.processedAt || 0))
              )
            : null,
        stats: stats,
      };
    } catch (error) {
      logger.error("Failed to get processing stats", { error: error.message });
      return {
        totalProcessed: 0,
        processedToday: 0,
        successfulUploads: 0,
        failedUploads: 0,
        averageProcessingTime: 0,
        lastProcessedAt: null,
        stats: {},
      };
    }
  }

  /**
   * Calculate average processing time
   */
  calculateAverageProcessingTime(processedVideos) {
    const timesWithProcessingTime = processedVideos
      .filter((v) => v.processingTime && v.processingTime > 0)
      .map((v) => v.processingTime);

    if (timesWithProcessingTime.length === 0) {
      return 0;
    }

    const sum = timesWithProcessingTime.reduce((a, b) => a + b, 0);
    return Math.round(sum / timesWithProcessingTime.length);
  }

  /**
   * Reset processed videos (for testing or maintenance)
   */
  async resetProcessedVideos() {
    try {
      await this.database.clearProcessedVideos();
      logger.info("All processed videos have been reset");
      return true;
    } catch (error) {
      logger.error("Failed to reset processed videos", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Mark video as failed and optionally retry later
   */
  async markVideoAsFailed(videoId, error, retryable = false) {
    try {
      await this.database.markVideoAsProcessed(videoId, {
        processedAt: new Date().toISOString(),
        success: false,
        error: error.message,
        retryable: retryable,
      });

      logger.info("Video marked as failed", {
        videoId,
        error: error.message,
        retryable,
      });
    } catch (dbError) {
      logger.error("Failed to mark video as failed", {
        videoId,
        error: dbError.message,
      });
    }
  }

  /**
   * Get retryable failed videos
   */
  async getRetryableVideos() {
    try {
      const processedVideos = await this.database.getProcessedVideos();
      const retryableVideos = processedVideos.filter(
        (v) => !v.success && v.retryable
      );

      logger.info("Found retryable videos", {
        count: retryableVideos.length,
      });

      return retryableVideos;
    } catch (error) {
      logger.error("Failed to get retryable videos", { error: error.message });
      return [];
    }
  }

  /**
   * Should process more videos today?
   */
  async shouldProcessMoreToday() {
    const stats = await this.getProcessingStats();
    const dailyLimit = parseInt(process.env.DAILY_VIDEO_LIMIT) || 10;

    const shouldProcess = stats.processedToday < dailyLimit;

    logger.info("Daily processing check", {
      processedToday: stats.processedToday,
      dailyLimit: dailyLimit,
      shouldProcess: shouldProcess,
    });

    return shouldProcess;
  }
}

module.exports = VideoManager;
