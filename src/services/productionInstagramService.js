const { IgApiClient } = require("instagram-private-api");
const fs = require("fs-extra");
const path = require("path");
const logger = require("../utils/logger");
const retryHandler = require("../utils/retryHandler");

class ProductionInstagramService {
  constructor() {
    this.ig = new IgApiClient();
    this.isLoggedIn = false;
    this.username = process.env.INSTAGRAM_USERNAME;
    this.password = process.env.INSTAGRAM_PASSWORD;
    this.mockMode = process.env.MOCK_INSTAGRAM === "true";
    this.sessionPath = "./data/instagram_session.json";
  }

  /**
   * Initialize Instagram session
   */
  async initialize() {
    try {
      // Try to restore previous session if it exists
      if (await fs.pathExists(this.sessionPath)) {
        try {
          const sessionData = await fs.readJson(this.sessionPath);
          this.ig.state.deserialize(sessionData);
          logger.info("Instagram session restored from file");
        } catch (error) {
          logger.warn("Failed to restore Instagram session", {
            error: error.message,
          });
        }
      }

      return true;
    } catch (error) {
      logger.error("Failed to initialize Instagram service", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Save Instagram session
   */
  async saveSession() {
    try {
      const sessionData = this.ig.state.serialize();
      await fs.ensureDir(path.dirname(this.sessionPath));
      await fs.writeJson(this.sessionPath, sessionData);
      logger.debug("Instagram session saved");
    } catch (error) {
      logger.warn("Failed to save Instagram session", { error: error.message });
    }
  }

  /**
   * Login to Instagram with session management
   */
  async login() {
    try {
      if (this.mockMode) {
        logger.info("Instagram mock mode enabled - skipping real login");
        this.isLoggedIn = true;
        return true;
      }

      if (this.isLoggedIn) {
        return true;
      }

      if (!this.username || !this.password) {
        throw new Error("Instagram credentials not configured");
      }

      // Generate device and user agent
      this.ig.state.generateDevice(this.username);

      // Attempt login
      logger.info("Logging into Instagram...");
      await this.ig.account.login(this.username, this.password);

      this.isLoggedIn = true;
      await this.saveSession();
      logger.info("Successfully logged into Instagram");
      return true;
    } catch (error) {
      logger.error("Instagram login failed", {
        error: error.message,
        username: this.username,
      });

      // Handle specific Instagram errors
      if (error.message.includes("checkpoint_required")) {
        throw new Error(
          "Instagram account requires checkpoint verification. Please verify your account manually."
        );
      } else if (error.message.includes("Please wait a few minutes")) {
        throw new Error(
          "Instagram rate limit reached. Please wait before trying again."
        );
      } else if (
        error.message.includes("The password you entered is incorrect")
      ) {
        throw new Error("Instagram login credentials are incorrect.");
      }

      throw error;
    }
  }

  /**
   * Upload video to Instagram with improved error handling
   */
  async uploadVideo(videoPath, caption) {
    try {
      if (this.mockMode) {
        return this.mockUpload(videoPath, caption);
      }

      // Ensure logged in
      await this.login();

      // Validate video file
      if (!(await fs.pathExists(videoPath))) {
        throw new Error(`Video file not found: ${videoPath}`);
      }

      const stats = await fs.stat(videoPath);
      if (stats.size === 0) {
        throw new Error("Video file is empty");
      }

      // Check file size limits (Instagram supports up to 100MB for videos)
      const maxSize = 100 * 1024 * 1024; // 100MB in bytes
      if (stats.size > maxSize) {
        throw new Error(
          `Video file too large: ${stats.size} bytes. Max: ${maxSize} bytes`
        );
      }

      logger.info("Uploading video to Instagram", {
        videoPath,
        fileSize: stats.size,
        captionLength: caption?.length,
      });

      // Prepare caption with hashtags
      const fullCaption = await this.prepareCaption(caption);

      // Try upload with improved error handling
      const publishResult = await this.attemptVideoUpload(
        videoPath,
        fullCaption,
        stats.size
      );

      logger.info("Successfully uploaded video to Instagram", {
        postId: publishResult.media.id,
        videoPath,
      });

      return {
        success: true,
        postId: publishResult.media.id,
        media: publishResult.media,
      };
    } catch (error) {
      logger.error("Failed to upload video to Instagram", {
        error: error.message,
        videoPath,
      });

      throw error;
    }
  }

  /**
   * Attempt video upload with multiple strategies
   */
  async attemptVideoUpload(videoPath, caption, fileSize) {
    const strategies = [
      () => this.uploadAsReel(videoPath, caption),
      () => this.uploadAsVideo(videoPath, caption),
      () => this.uploadAsStory(videoPath, caption),
    ];

    let lastError;

    for (let i = 0; i < strategies.length; i++) {
      try {
        logger.debug(`Trying upload strategy ${i + 1}/${strategies.length}`);
        const result = await strategies[i]();
        logger.info(`Upload strategy ${i + 1} succeeded`);
        return result;
      } catch (error) {
        lastError = error;
        logger.warn(`Upload strategy ${i + 1} failed`, {
          error: error.message,
        });

        // Wait between attempts
        if (i < strategies.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    throw new Error(
      `All upload strategies failed. Last error: ${lastError.message}`
    );
  }
  /**
   * Upload as Instagram Reel
   */
  async uploadAsReel(videoPath, caption) {
    const videoBuffer = await fs.readFile(videoPath);

    // Generate a simple cover image from the video first frame
    const coverImagePath = await this.generateCoverImage(videoPath);
    const coverImageBuffer = await fs.readFile(coverImagePath);

    try {
      const result = await this.ig.publish.video({
        video: videoBuffer,
        coverImage: coverImageBuffer,
        caption: caption,
      });

      // Clean up temporary cover image
      await fs.remove(coverImagePath);
      return result;
    } catch (error) {
      // Clean up temporary cover image on error
      await fs.remove(coverImagePath).catch(() => {});
      throw error;
    }
  }

  /**
   * Upload as regular video
   */
  async uploadAsVideo(videoPath, caption) {
    const videoBuffer = await fs.readFile(videoPath);

    // Generate a simple cover image from the video first frame
    const coverImagePath = await this.generateCoverImage(videoPath);
    const coverImageBuffer = await fs.readFile(coverImagePath);

    try {
      const result = await this.ig.publish.video({
        video: videoBuffer,
        coverImage: coverImageBuffer,
        caption: caption,
      });

      // Clean up temporary cover image
      await fs.remove(coverImagePath);
      return result;
    } catch (error) {
      // Clean up temporary cover image on error
      await fs.remove(coverImagePath).catch(() => {});
      throw error;
    }
  }

  /**
   * Upload as story (fallback)
   */
  async uploadAsStory(videoPath, caption) {
    const videoBuffer = await fs.readFile(videoPath);

    // Generate a simple cover image from the video first frame
    const coverImagePath = await this.generateCoverImage(videoPath);
    const coverImageBuffer = await fs.readFile(coverImagePath);

    try {
      const result = await this.ig.publish.story({
        video: videoBuffer,
        coverImage: coverImageBuffer,
      });

      // Clean up temporary cover image
      await fs.remove(coverImagePath);
      return result;
    } catch (error) {
      // Clean up temporary cover image on error
      await fs.remove(coverImagePath).catch(() => {});
      throw error;
    }
  }

  /**
   * Generate a cover image from video's first frame
   */
  async generateCoverImage(videoPath) {
    const ffmpeg = require("fluent-ffmpeg");
    const tempDir = path.join(process.cwd(), "temp");
    await fs.ensureDir(tempDir);

    const coverImagePath = path.join(tempDir, `cover_${Date.now()}.jpg`);

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: ["00:00:01"],
          filename: path.basename(coverImagePath),
          folder: path.dirname(coverImagePath),
          size: "640x640",
        })
        .on("end", () => {
          resolve(coverImagePath);
        })
        .on("error", (error) => {
          logger.warn("Failed to generate cover image, creating fallback", {
            error: error.message,
          });
          // Create a simple fallback cover image
          this.createFallbackCoverImage(coverImagePath)
            .then(resolve)
            .catch(reject);
        });
    });
  }

  /**
   * Create a simple fallback cover image
   */
  async createFallbackCoverImage(outputPath) {
    const sharp = require("sharp");

    // Create a simple colored square as fallback
    const svgImage = `
      <svg width="640" height="640" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#4267B2"/>
        <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="48" fill="white" text-anchor="middle" dy=".3em">Video</text>
      </svg>
    `;

    await sharp(Buffer.from(svgImage)).jpeg({ quality: 80 }).toFile(outputPath);

    return outputPath;
  }

  /**
   * Mock upload for development/testing
   */
  async mockUpload(videoPath, caption) {
    logger.info("Performing mock Instagram upload", { videoPath });

    // Simulate upload delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const mockId = `mock_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    return {
      success: true,
      postId: mockId,
      media: {
        id: mockId,
        pk: mockId,
        caption: caption,
        uploadedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Upload video with retry logic
   */
  async uploadVideoWithRetry(videoPath, caption) {
    return await retryHandler.withRetry(
      async () => {
        return await this.uploadVideo(videoPath, caption);
      },
      3, // maxRetries
      "Instagram video upload",
      2000, // baseDelay
      2 // backoffMultiplier
    );
  }

  /**
   * Prepare caption with hashtags and formatting
   */
  async prepareCaption(baseCaption) {
    try {
      let caption =
        baseCaption || process.env.DEFAULT_CAPTION || "Amazing video! 🎥✨"; // Add default hashtags if not present
      const defaultHashtags =
        process.env.DEFAULT_HASHTAGS ||
        "#ai #artificialintelligence #machinelearning #deeplearning #neuralnetworks #tech #innovation #automation #robotics #futuretech #digitalart #aiart #techtrends #coding #programming #data #analytics #smarttech #aivideo #viral #trending #amazing #content #video";

      // Check if caption already has hashtags
      if (!caption.includes("#")) {
        caption += "\n\n" + defaultHashtags;
      }

      // Ensure caption is within Instagram limits (2200 characters)
      if (caption.length > 2200) {
        caption = caption.substring(0, 2150) + "...";
        logger.warn("Caption truncated to fit Instagram limits");
      }

      return caption;
    } catch (error) {
      logger.error("Failed to prepare caption", { error: error.message });
      return "🤖 Amazing AI content! Check this out! ✨ #ai #tech #innovation #viral";
    }
  }

  /**
   * Test Instagram connection
   */
  async testConnection() {
    try {
      if (this.mockMode) {
        logger.info("Instagram connection test successful (mock mode)");
        return true;
      }

      await this.login();
      const userInfo = await this.getUserInfo();

      logger.info("Instagram connection test successful", {
        username: userInfo.username,
        mediaCount: userInfo.mediaCount,
      });

      return true;
    } catch (error) {
      logger.error("Instagram connection test failed", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Get user info
   */
  async getUserInfo() {
    try {
      if (this.mockMode) {
        return {
          userId: "mock_user_id",
          username: this.username || "mock_user",
          fullName: "Mock User",
          followerCount: 1000,
          followingCount: 500,
          mediaCount: 100,
        };
      }

      await this.login();

      const userInfo = await this.ig.user.info(
        await this.ig.user.getIdByUsername(this.username)
      );

      return {
        userId: userInfo.pk,
        username: userInfo.username,
        fullName: userInfo.full_name,
        followerCount: userInfo.follower_count,
        followingCount: userInfo.following_count,
        mediaCount: userInfo.media_count,
      };
    } catch (error) {
      logger.error("Failed to get user info", { error: error.message });
      throw error;
    }
  }

  /**
   * Logout from Instagram
   */
  async logout() {
    try {
      if (this.mockMode) {
        logger.info("Instagram logout (mock mode)");
        return;
      }

      if (this.isLoggedIn) {
        await this.ig.account.logout();
        this.isLoggedIn = false;

        // Remove session file
        if (await fs.pathExists(this.sessionPath)) {
          await fs.remove(this.sessionPath);
        }

        logger.info("Successfully logged out from Instagram");
      }
    } catch (error) {
      logger.warn("Error during Instagram logout", { error: error.message });
    }
  }

  /**
   * Enable or disable mock mode
   */
  setMockMode(enabled) {
    this.mockMode = enabled;
    logger.info(`Instagram mock mode ${enabled ? "enabled" : "disabled"}`);
  }
}

module.exports = new ProductionInstagramService();
