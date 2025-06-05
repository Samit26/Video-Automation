const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs-extra");
const logger = require("../utils/logger");

class VideoService {
  constructor() {
    // Use absolute path for watermark file
    this.watermarkPath =
      process.env.WATERMARK_PATH ||
      path.join(process.cwd(), "assets", "watermark.png");
    this.setupFFmpeg();
  }
  /**
   * Setup FFmpeg configuration
   */
  setupFFmpeg() {
    try {
      // For Render.com deployment, try to set FFmpeg path
      const possiblePaths = [
        "/usr/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/app/bin/ffmpeg",
        "ffmpeg", // fallback to PATH
      ];

      // Try to find FFmpeg executable
      for (const ffmpegPath of possiblePaths) {
        try {
          ffmpeg.setFfmpegPath(ffmpegPath);
          logger.info(`Attempting to use FFmpeg at: ${ffmpegPath}`);
          break;
        } catch (err) {
          logger.debug(`FFmpeg not found at: ${ffmpegPath}`);
        }
      }

      // Test FFmpeg availability with better diagnostics
      ffmpeg.getAvailableFormats((err, formats) => {
        if (err) {
          logger.error("FFmpeg is not available", {
            error: err.message,
            suggestion: "Install FFmpeg via apt-packages in render.yaml",
            possiblePaths,
          });
        } else {
          logger.info("FFmpeg is available and ready", {
            formatsCount: Object.keys(formats || {}).length,
            sampleFormats: Object.keys(formats || {}).slice(0, 5),
          });
        }
      });

      // Additional FFmpeg diagnostics
      ffmpeg("/dev/null")
        .format("null")
        .on("error", (err) => {
          logger.debug("FFmpeg test command failed (expected)", {
            error: err.message,
          });
        })
        .on("start", (cmd) => {
          logger.info("FFmpeg test command started successfully", {
            command: cmd,
          });
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
        // Validate input video
        if (!(await fs.pathExists(inputVideoPath))) {
          throw new Error(`Input video not found: ${inputVideoPath}`);
        }

        // Ensure watermark exists with better path resolution
        const watermarkExists = await fs.pathExists(this.watermarkPath);
        if (!watermarkExists) {
          // Try alternative watermark paths
          const alternativePaths = [
            path.join(process.cwd(), "assets", "watermark.png"),
            path.join(__dirname, "..", "..", "assets", "watermark.png"),
            "./assets/watermark.png",
          ];

          let foundWatermark = false;
          for (const altPath of alternativePaths) {
            if (await fs.pathExists(altPath)) {
              this.watermarkPath = altPath;
              foundWatermark = true;
              logger.info(`Found watermark at alternative path: ${altPath}`);
              break;
            }
          }

          if (!foundWatermark) {
            throw new Error(
              `Watermark file not found. Tried paths: ${[
                this.watermarkPath,
                ...alternativePaths,
              ].join(", ")}`
            );
          }
        }

        // Ensure output directory exists
        await fs.ensureDir(outputDir);

        const inputFilename = path.basename(
          inputVideoPath,
          path.extname(inputVideoPath)
        );
        const outputPath = path.join(
          outputDir,
          `${inputFilename}_watermarked.mp4`
        );
        logger.info(`Adding watermark to video: ${inputVideoPath}`);
        logger.info(`Watermark file path: ${this.watermarkPath}`);
        logger.info(`Output path: ${outputPath}`); // Add timeout to prevent hanging
        const timeoutMs = 90000; // 90 seconds timeout (increased for complex watermarking)
        let ffmpegProcess;
        let timeoutId;

        const timeoutPromise = new Promise((_, timeoutReject) => {
          timeoutId = setTimeout(() => {
            if (ffmpegProcess) {
              ffmpegProcess.kill("SIGKILL");
            }
            timeoutReject(
              new Error("FFmpeg watermarking timed out after 90 seconds")
            );
          }, timeoutMs);
        });

        const ffmpegPromise = new Promise((ffmpegResolve, ffmpegReject) => {
          ffmpegProcess = ffmpeg(inputVideoPath)
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
              "-preset veryfast", // Very fast preset for cloud environments (faster than ultrafast)
              "-crf 28", // Higher CRF for faster processing (less quality but much faster)
              "-pix_fmt yuv420p", // Ensure compatibility
              "-movflags +faststart", // Optimize for web streaming
              "-threads 0", // Use all available CPU threads
            ])
            .output(outputPath)
            .on("start", (commandLine) => {
              logger.info("FFmpeg started successfully", {
                command: commandLine,
                inputPath: inputVideoPath,
                watermarkPath: this.watermarkPath,
              });
            })
            .on("progress", (progress) => {
              logger.info(
                `Watermarking progress: ${progress.percent?.toFixed(2)}% done`,
                {
                  timemark: progress.timemark,
                  currentFps: progress.currentFps,
                }
              );
            })
            .on("stderr", (stderrLine) => {
              logger.debug("FFmpeg stderr", { line: stderrLine });
            })
            .on("end", () => {
              logger.info(`Successfully added watermark: ${outputPath}`);
              clearTimeout(timeoutId);
              ffmpegResolve(outputPath);
            })
            .on("error", (error) => {
              logger.error("FFmpeg processing failed", {
                error: error.message,
                inputPath: inputVideoPath,
                watermarkPath: this.watermarkPath,
                outputPath: outputPath,
              });
              clearTimeout(timeoutId);
              ffmpegReject(
                new Error(`Video processing failed: ${error.message}`)
              );
            });

          // Start the process
          try {
            ffmpegProcess.run();
          } catch (runError) {
            logger.error("Failed to start FFmpeg process", {
              error: runError.message,
            });
            clearTimeout(timeoutId);
            ffmpegReject(runError);
          }
        });

        // Race between FFmpeg and timeout
        try {
          const result = await Promise.race([ffmpegPromise, timeoutPromise]);
          return result;
        } catch (error) {
          logger.error("Watermarking failed", { error: error.message });
          throw error;
        }
      } catch (error) {
        logger.error("Failed to add watermark", { error: error.message });
        reject(error);
      }
    });
  }
  /**
   * Fallback watermarking - copy video without watermark if FFmpeg fails
   */
  async fallbackWatermark(inputVideoPath, outputDir) {
    try {
      const inputFilename = path.basename(
        inputVideoPath,
        path.extname(inputVideoPath)
      );
      const outputPath = path.join(
        outputDir,
        `${inputFilename}_watermarked.mp4`
      );

      logger.warn("Using fallback watermarking (copy without watermark)", {
        input: inputVideoPath,
        output: outputPath,
        reason: "FFmpeg watermarking failed or unavailable",
      });

      // Ensure output directory exists
      await fs.ensureDir(outputDir);

      // Simply copy the file as fallback
      await fs.copy(inputVideoPath, outputPath);

      logger.info("Fallback copy completed successfully", {
        outputPath,
        note: "Video copied without watermark due to FFmpeg issues",
      });

      return outputPath;
    } catch (error) {
      logger.error("Fallback watermarking failed", { error: error.message });
      throw error;
    }
  }

  /**
   * Add watermark to video with fallback
   */
  async addWatermarkWithFallback(inputVideoPath, outputDir) {
    try {
      // Try the full watermarking first
      return await this.addWatermark(inputVideoPath, outputDir);
    } catch (error) {
      logger.warn("Primary watermarking failed, using fallback", {
        error: error.message,
        fallback: "copy without watermark",
      });

      // Use fallback method
      return await this.fallbackWatermark(inputVideoPath, outputDir);
    }
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
