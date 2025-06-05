const path = require("path");
const fs = require("fs-extra");
const logger = require("../utils/logger");

class VideoService {
  constructor() {
    logger.info(
      "VideoService initialized (watermarking disabled for faster processing)"
    );
  }

  /**
   * Process video (simplified - no watermarking)
   * Simply copies the video to output directory with consistent naming
   */
  async processVideo(inputVideoPath, outputDir) {
    try {
      // Validate input video
      if (!(await fs.pathExists(inputVideoPath))) {
        throw new Error(`Input video not found: ${inputVideoPath}`);
      }

      // Ensure output directory exists
      await fs.ensureDir(outputDir);

      const inputFilename = path.basename(
        inputVideoPath,
        path.extname(inputVideoPath)
      );
      const outputPath = path.join(outputDir, `${inputFilename}_processed.mp4`);

      logger.info("Processing video (no watermark)", {
        input: inputVideoPath,
        output: outputPath,
      });

      // Simply copy the file
      await fs.copy(inputVideoPath, outputPath);

      logger.info("Video processed successfully", {
        outputPath,
        note: "Video copied without watermark for faster processing",
      });

      return outputPath;
    } catch (error) {
      logger.error("Video processing failed", { error: error.message });
      throw error;
    }
  }

  /**
   * Legacy method for backward compatibility - redirects to processVideo
   */
  async addWatermarkWithFallback(inputVideoPath, outputDir) {
    logger.info("Watermarking disabled - using simple video processing");
    return await this.processVideo(inputVideoPath, outputDir);
  }

  /**
   * Get basic video information using file system
   */
  async getVideoInfo(videoPath) {
    try {
      if (!(await fs.pathExists(videoPath))) {
        throw new Error(`Video file not found: ${videoPath}`);
      }

      const stats = await fs.stat(videoPath);
      const fileExtension = path.extname(videoPath).toLowerCase();

      // Basic video info without FFmpeg
      const info = {
        size: stats.size,
        format: fileExtension.substring(1), // Remove the dot
        path: videoPath,
        modified: stats.mtime,
        created: stats.birthtime,
        note: "Basic info only - FFmpeg removed for faster processing",
      };

      logger.debug("Video info retrieved", { videoPath, info });
      return info;
    } catch (error) {
      logger.error("Failed to get video info", {
        error: error.message,
        videoPath,
      });
      throw error;
    }
  }

  /**
   * Convert video for Instagram (simplified - just copy for now)
   */
  async convertForInstagram(inputPath, outputDir) {
    try {
      const inputFilename = path.basename(inputPath, path.extname(inputPath));
      const outputPath = path.join(outputDir, `${inputFilename}_instagram.mp4`);

      logger.info("Converting video for Instagram (simplified)", {
        input: inputPath,
        output: outputPath,
        note: "Using simple copy - FFmpeg conversion disabled",
      });

      // Simply copy the file with Instagram naming
      await fs.copy(inputPath, outputPath);

      logger.info("Video converted for Instagram", { outputPath });
      return outputPath;
    } catch (error) {
      logger.error("Instagram conversion failed", { error: error.message });
      throw error;
    }
  }

  /**
   * Create a thumbnail (simplified - not available without FFmpeg)
   */
  async createThumbnail(videoPath, outputDir, timeSeek = "00:00:01") {
    logger.warn(
      "Thumbnail creation disabled - FFmpeg removed for faster processing"
    );
    return null;
  }

  /**
   * Validate video file (simplified)
   */
  async validateVideo(videoPath) {
    try {
      if (!(await fs.pathExists(videoPath))) {
        throw new Error(`Video file not found: ${videoPath}`);
      }

      const stats = await fs.stat(videoPath);

      if (stats.size === 0) {
        throw new Error("Video file is empty");
      }

      logger.info("Video validation successful (basic check)", {
        videoPath,
        size: stats.size,
        note: "Basic validation only - FFmpeg removed",
      });

      return true;
    } catch (error) {
      logger.error("Video validation failed", {
        error: error.message,
        videoPath,
      });
      throw error;
    }
  }

  /**
   * Validate video file extension
   */
  isValidVideoFile(filename) {
    const validExtensions = [".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"];
    const ext = path.extname(filename).toLowerCase();
    return validExtensions.includes(ext);
  }

  /**
   * Get output filename for processed video
   */
  getOutputFilename(inputPath, suffix = "_processed") {
    const parsedPath = path.parse(inputPath);
    return `${parsedPath.name}${suffix}.mp4`;
  }

  /**
   * Clean up video files
   */
  async cleanupVideoFiles(filePaths) {
    const results = [];

    for (const filePath of filePaths) {
      try {
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
          results.push({ path: filePath, status: "deleted" });
          logger.debug("Video file cleaned up", { path: filePath });
        } else {
          results.push({ path: filePath, status: "not_found" });
        }
      } catch (error) {
        results.push({ path: filePath, status: "error", error: error.message });
        logger.warn("Failed to cleanup video file", {
          path: filePath,
          error: error.message,
        });
      }
    }

    return results;
  }
}

module.exports = new VideoService();
