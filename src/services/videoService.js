const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs-extra");
const logger = require("../utils/logger");

class VideoService {
  constructor() {
    this.watermarkPath = process.env.WATERMARK_PATH || "./assets/watermark.png";
    this.setupFFmpeg();
  }

  /**
   * Setup FFmpeg configuration
   */
  setupFFmpeg() {
    try {
      // For Render.com deployment, FFmpeg should be available in PATH
      // If not, you might need to install it via buildpack or apt-packages

      // Test FFmpeg availability
      ffmpeg.getAvailableFormats((err, formats) => {
        if (err) {
          logger.warn("FFmpeg might not be available", { error: err.message });
        } else {
          logger.info("FFmpeg is available and ready");
        }
      });
    } catch (error) {
      logger.error("Failed to setup FFmpeg", { error: error.message });
    }
  }

  /**
   * Add watermark to video
   */
  async addWatermark(inputVideoPath, outputDir) {
    return new Promise(async (resolve, reject) => {
      try {
        // Ensure watermark exists
        if (!(await fs.pathExists(this.watermarkPath))) {
          throw new Error(`Watermark file not found: ${this.watermarkPath}`);
        }

        const inputFilename = path.basename(
          inputVideoPath,
          path.extname(inputVideoPath)
        );
        const outputPath = path.join(
          outputDir,
          `${inputFilename}_watermarked.mp4`
        );
        logger.info(`Adding watermark to video: ${inputVideoPath}`);
        ffmpeg(inputVideoPath)
          .input(this.watermarkPath)
          .complexFilter([
            // Scale watermark to 40% of video width for better visibility (increased from 25%)
            "[1:v]scale=iw*0.4:-1[watermark_scaled]",
            // Add a semi-transparent background to make watermark more visible
            "[watermark_scaled]pad=iw+20:ih+20:10:10:color=black@0.5[watermark_bg]",
            // Overlay watermark at top-left corner with padding for visibility
            "[0:v][watermark_bg]overlay=20:20",
          ])
          .outputOptions([
            "-c:a copy", // Copy audio without re-encoding
            "-c:v libx264", // Use H.264 for video
            "-preset medium", // Better quality preset
            "-crf 16", // Higher quality for better watermark visibility (lower CRF = higher quality)
            "-pix_fmt yuv420p", // Ensure compatibility
            "-movflags +faststart", // Optimize for web streaming
          ])
          .output(outputPath)
          .on("start", (commandLine) => {
            logger.debug("FFmpeg started", { command: commandLine });
          })
          .on("progress", (progress) => {
            logger.debug(`Processing: ${progress.percent?.toFixed(2)}% done`);
          })
          .on("end", () => {
            logger.info(`Successfully added watermark: ${outputPath}`);
            resolve(outputPath);
          })
          .on("error", (error) => {
            logger.error("FFmpeg processing failed", {
              error: error.message,
              inputPath: inputVideoPath,
              outputPath: outputPath,
            });
            reject(new Error(`Video processing failed: ${error.message}`));
          })
          .run();
      } catch (error) {
        logger.error("Failed to add watermark", { error: error.message });
        reject(error);
      }
    });
  }

  /**
   * Get video information
   */
  async getVideoInfo(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          logger.error("Failed to get video info", {
            error: err.message,
            videoPath,
          });
          reject(err);
        } else {
          const videoStream = metadata.streams.find(
            (stream) => stream.codec_type === "video"
          );
          const audioStream = metadata.streams.find(
            (stream) => stream.codec_type === "audio"
          );

          const info = {
            duration: metadata.format.duration,
            size: metadata.format.size,
            bitrate: metadata.format.bit_rate,
            format: metadata.format.format_name,
            video: videoStream
              ? {
                  codec: videoStream.codec_name,
                  width: videoStream.width,
                  height: videoStream.height,
                  framerate: videoStream.r_frame_rate,
                  bitrate: videoStream.bit_rate,
                }
              : null,
            audio: audioStream
              ? {
                  codec: audioStream.codec_name,
                  sampleRate: audioStream.sample_rate,
                  channels: audioStream.channels,
                  bitrate: audioStream.bit_rate,
                }
              : null,
          };

          logger.debug("Video info retrieved", { videoPath, info });
          resolve(info);
        }
      });
    });
  }

  /**
   * Convert video to Instagram-compatible format
   */
  async convertForInstagram(inputPath, outputDir) {
    return new Promise(async (resolve, reject) => {
      try {
        const inputFilename = path.basename(inputPath, path.extname(inputPath));
        const outputPath = path.join(
          outputDir,
          `${inputFilename}_instagram.mp4`
        );

        logger.info(`Converting video for Instagram: ${inputPath}`);

        // Get video info first to determine if conversion is needed
        const videoInfo = await this.getVideoInfo(inputPath);

        // Instagram video requirements:
        // - Format: MP4
        // - Max resolution: 1920x1080
        // - Max duration: 60 seconds for feed posts
        // - Max file size: 100MB

        let needsConversion = false;
        const maxWidth = 1920;
        const maxHeight = 1080;
        const maxDuration = 60; // seconds

        if (
          videoInfo.video &&
          (videoInfo.video.width > maxWidth ||
            videoInfo.video.height > maxHeight)
        ) {
          needsConversion = true;
        }

        if (videoInfo.duration > maxDuration) {
          needsConversion = true;
        }

        if (
          !needsConversion &&
          path.extname(inputPath).toLowerCase() === ".mp4"
        ) {
          // No conversion needed, just copy
          await fs.copy(inputPath, outputPath);
          logger.info(`No conversion needed, copied to: ${outputPath}`);
          resolve(outputPath);
          return;
        }

        // Perform conversion
        let command = ffmpeg(inputPath);

        // Limit duration if too long
        if (videoInfo.duration > maxDuration) {
          command = command.setStartTime(0).setDuration(maxDuration);
        }

        // Scale down if resolution is too high
        if (
          videoInfo.video &&
          (videoInfo.video.width > maxWidth ||
            videoInfo.video.height > maxHeight)
        ) {
          command = command.videoFilters(
            `scale='min(${maxWidth},iw)':'min(${maxHeight},ih)':force_original_aspect_ratio=decrease`
          );
        }

        command
          .outputOptions([
            "-c:v libx264",
            "-c:a aac",
            "-preset fast",
            "-crf 23",
            "-maxrate 5000k",
            "-bufsize 10000k",
            "-movflags +faststart",
            "-pix_fmt yuv420p",
          ])
          .output(outputPath)
          .on("end", () => {
            logger.info(`Successfully converted for Instagram: ${outputPath}`);
            resolve(outputPath);
          })
          .on("error", (error) => {
            logger.error("Instagram conversion failed", {
              error: error.message,
              inputPath,
              outputPath,
            });
            reject(new Error(`Instagram conversion failed: ${error.message}`));
          })
          .run();
      } catch (error) {
        logger.error("Failed to convert for Instagram", {
          error: error.message,
        });
        reject(error);
      }
    });
  }

  /**
   * Create a thumbnail from video
   */
  async createThumbnail(videoPath, outputDir, timeSeek = "00:00:01") {
    return new Promise((resolve, reject) => {
      try {
        const inputFilename = path.basename(videoPath, path.extname(videoPath));
        const thumbnailPath = path.join(
          outputDir,
          `${inputFilename}_thumb.jpg`
        );

        ffmpeg(videoPath)
          .seekInput(timeSeek)
          .outputOptions(["-vframes 1", "-q:v 2"])
          .output(thumbnailPath)
          .on("end", () => {
            logger.info(`Thumbnail created: ${thumbnailPath}`);
            resolve(thumbnailPath);
          })
          .on("error", (error) => {
            logger.error("Thumbnail creation failed", { error: error.message });
            reject(error);
          })
          .run();
      } catch (error) {
        logger.error("Failed to create thumbnail", { error: error.message });
        reject(error);
      }
    });
  }

  /**
   * Validate video file
   */
  async validateVideo(videoPath) {
    try {
      const stats = await fs.stat(videoPath);

      if (stats.size === 0) {
        throw new Error("Video file is empty");
      }

      const videoInfo = await this.getVideoInfo(videoPath);

      if (!videoInfo.video) {
        throw new Error("No video stream found");
      }

      if (videoInfo.duration <= 0) {
        throw new Error("Invalid video duration");
      }

      logger.info("Video validation successful", {
        videoPath,
        duration: videoInfo.duration,
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
}

module.exports = new VideoService();
