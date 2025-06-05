#!/usr/bin/env node

/**
 * Production Video Processing Pipeline
 * Simple single-video processor: download one video, watermark it, generate caption, upload to Instagram
 */

require("dotenv").config();
const logger = require("./src/utils/logger");
const database = require("./src/config/database");
const DriveService = require("./src/services/driveService");
const VideoService = require("./src/services/videoService");
const ProductionInstagramService = require("./src/services/productionInstagramService");
const AiService = require("./src/services/aiService");
const fileManager = require("./src/utils/fileManager");

class ProductionVideoProcessor {
  constructor() {
    this.database = database;
    this.driveService = DriveService;
    this.videoService = VideoService;
    this.instagramService = ProductionInstagramService;
    this.aiService = AiService;
    this.fileManager = fileManager;

    this.tempFiles = new Set(); // Track temp files for cleanup
    this.isProcessing = false;
  }

  /**
   * Initialize all services
   */
  async initialize() {
    try {
      logger.info("Initializing production video processor...");

      // Initialize database
      await this.database.init();
      logger.info("✅ Database initialized");

      // Initialize Instagram service
      await this.instagramService.initialize();
      logger.info("✅ Instagram service initialized");

      // Test connections
      const driveConnected = await this.driveService.testConnection();
      if (!driveConnected) {
        throw new Error("Google Drive connection failed");
      }
      logger.info("✅ Google Drive connected");

      const aiConnected = await this.aiService.testService();
      if (!aiConnected || !aiConnected.success) {
        logger.warn(
          "⚠️ AI service connection failed - captions will use defaults"
        );
      } else {
        logger.info("✅ AI service connected");
      }

      const instagramConnected = await this.instagramService.testConnection();
      if (!instagramConnected) {
        logger.warn("⚠️ Instagram connection failed - using mock mode");
        this.instagramService.setMockMode(true);
      } else {
        logger.info("✅ Instagram connected");
      }

      // Ensure output directories exist
      await this.fileManager.ensureDir("./downloads");
      await this.fileManager.ensureDir("./output");
      await this.fileManager.ensureDir("./temp");

      logger.info("🚀 All services initialized successfully");
      return true;
    } catch (error) {
      logger.error("Failed to initialize services", { error: error.message });
      throw error;
    }
  }

  /**
   * Main processing pipeline - Process only ONE video at a time
   */
  async processVideos() {
    if (this.isProcessing) {
      logger.warn("Video processing already in progress, skipping...");
      return;
    }

    this.isProcessing = true;

    try {
      logger.info("🎬 Starting single video processing pipeline...");

      // Get available videos from Google Drive
      logger.info("📁 Fetching videos from Google Drive...");
      const availableVideos = await this.driveService.getNewVideos();

      if (availableVideos.length === 0) {
        logger.warn("No videos found in Google Drive");
        return;
      }

      // Get processed videos to avoid duplicates
      const processedVideos = await this.database.getProcessedVideos();
      const processedIds = processedVideos.map((v) => v.id);

      // Find first unprocessed video
      const videoToProcess = availableVideos.find(
        (video) => !processedIds.includes(video.id)
      );

      if (!videoToProcess) {
        logger.info(
          "No new videos to process - all available videos have been processed"
        );
        return;
      }

      logger.info("📋 Processing single video", {
        totalAvailable: availableVideos.length,
        videoName: videoToProcess.name,
        videoId: videoToProcess.id,
      });

      // Process the single video
      logger.info("🎯 Starting pipeline for video", {
        name: videoToProcess.name,
        id: videoToProcess.id,
      });

      const result = await this.processVideoPipeline(videoToProcess);

      if (result.success) {
        logger.info("✅ Video pipeline completed successfully", {
          name: videoToProcess.name,
          postId: result.postId,
          duration: `${(result.duration / 1000).toFixed(1)}s`,
        });
      } else {
        logger.error("❌ Video pipeline failed", {
          name: videoToProcess.name,
          error: result.error,
        });
      }

      logger.info("🏁 Single video processing completed", {
        video: videoToProcess.name,
        success: result.success,
        duration: `${(result.duration / 1000).toFixed(1)}s`,
      });
    } catch (error) {
      logger.error("💥 Critical error in video processing pipeline", {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    } finally {
      this.isProcessing = false;

      // Final cleanup
      await this.performFinalCleanup();
    }
  }

  /**
   * Process individual video through complete pipeline
   */
  async processVideoPipeline(video) {
    const startTime = Date.now();
    let downloadPath = null;
    let processedPath = null;

    try {
      // Step 1: Download video
      logger.info("📥 Step 1: Downloading video...");
      downloadPath = await this.driveService.downloadVideo(
        video,
        "./downloads"
      );
      this.tempFiles.add(downloadPath);
      logger.info("✅ Video downloaded", {
        path: downloadPath,
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      });

      // Step 2: Process video (no watermarking)
      logger.info("🎬 Step 2: Processing video...");
      const processStartTime = Date.now();
      processedPath = await this.videoService.processVideo(
        downloadPath,
        "./output"
      );
      this.tempFiles.add(processedPath);
      logger.info("✅ Video processed", {
        path: processedPath,
        duration: `${((Date.now() - processStartTime) / 1000).toFixed(1)}s`,
        note: "No watermark applied for faster processing",
      });

      // Step 3: Generate AI caption
      logger.info("🤖 Step 3: Generating AI caption...");
      const captionStartTime = Date.now();
      const caption = await this.aiService.generateCaption(video.name);
      logger.info("✅ AI caption generated", {
        caption: caption.substring(0, 100) + "...",
        duration: `${((Date.now() - captionStartTime) / 1000).toFixed(1)}s`,
      });

      // Step 4: Upload to Instagram
      logger.info("📸 Step 4: Uploading to Instagram...");
      const uploadStartTime = Date.now();
      const uploadResult = await this.instagramService.uploadVideoWithRetry(
        processedPath,
        caption
      );
      logger.info("✅ Instagram upload completed", {
        postId: uploadResult.postId,
        duration: `${((Date.now() - uploadStartTime) / 1000).toFixed(1)}s`,
      });

      // Step 5: Update database
      logger.info("💾 Step 5: Updating database...");
      await this.database.markVideoAsProcessed(video.id, {
        name: video.name,
        processedAt: new Date().toISOString(),
        uploadResult: uploadResult,
        caption: caption,
        processingTime: Date.now() - startTime,
        success: true,
      });

      // Step 6: Cleanup temp files
      await this.cleanupTempFiles([downloadPath, processedPath]);

      const totalDuration = Date.now() - startTime;
      logger.info("🎉 Complete pipeline finished", {
        name: video.name,
        totalDuration: `${(totalDuration / 1000).toFixed(1)}s`,
        postId: uploadResult.postId,
      });

      return {
        success: true,
        video: video.name,
        postId: uploadResult.postId,
        duration: totalDuration,
      };
    } catch (error) {
      logger.error("Pipeline failed for video", {
        name: video.name,
        error: error.message,
        stack: error.stack,
      });

      // Cleanup on failure
      await this.cleanupTempFiles([downloadPath, processedPath]);

      return {
        success: false,
        video: video.name,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Clean up temporary files
   */
  async cleanupTempFiles(filePaths) {
    for (const filePath of filePaths) {
      if (filePath) {
        try {
          await this.fileManager.safeDelete(filePath);
          this.tempFiles.delete(filePath);
          logger.info("🗑️ Cleaned up temp file", { path: filePath });
        } catch (error) {
          logger.warn("Failed to cleanup temp file", {
            path: filePath,
            error: error.message,
          });
        }
      }
    }
  }

  /**
   * Perform final cleanup of all temp files
   */
  async performFinalCleanup() {
    try {
      logger.info("🧹 Performing final cleanup...");

      // Clean up any remaining temp files
      for (const filePath of this.tempFiles) {
        try {
          await this.fileManager.safeDelete(filePath);
          logger.debug("Cleaned up remaining temp file", { path: filePath });
        } catch (error) {
          logger.warn("Failed to cleanup remaining temp file", {
            path: filePath,
            error: error.message,
          });
        }
      }

      // Clear the temp files set
      this.tempFiles.clear();

      // Clean up temp directories
      await this.fileManager.cleanupTempFiles("./temp");

      logger.info("✅ Final cleanup completed");
    } catch (error) {
      logger.warn("Error during final cleanup", { error: error.message });
    }
  }

  /**
   * Get current processing status
   */
  getStatus() {
    return {
      isProcessing: this.isProcessing,
      tempFilesCount: this.tempFiles.size,
      version: "1.0.0",
      environment: process.env.NODE_ENV || "development",
      mockInstagram: this.instagramService.mockMode,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      logger.info("🛑 Initiating graceful shutdown...");

      // Wait for current processing to complete
      while (this.isProcessing) {
        logger.info("⏳ Waiting for current processing to complete...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Perform final cleanup
      await this.performFinalCleanup();

      // Logout from Instagram
      await this.instagramService.logout();

      logger.info("✅ Graceful shutdown completed");
    } catch (error) {
      logger.error("Error during shutdown", { error: error.message });
    }
  }
}

// Handle graceful shutdown
let processor;

process.on("SIGINT", async () => {
  console.log("\nReceived SIGINT, shutting down gracefully...");
  if (processor) {
    await processor.shutdown();
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nReceived SIGTERM, shutting down gracefully...");
  if (processor) {
    await processor.shutdown();
  }
  process.exit(0);
});

// Main execution
async function main() {
  try {
    processor = new ProductionVideoProcessor();
    await processor.initialize();
    await processor.processVideos();

    logger.info("🎬 Production video processing completed successfully");
  } catch (error) {
    logger.error("💥 Production video processing failed", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = ProductionVideoProcessor;
