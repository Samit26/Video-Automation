const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("../utils/logger");

class AIService {
  constructor() {
    this.genAI = null;
    this.model = null;
    this.initializeAI();
  }

  /**
   * Initialize Google Gemini AI
   */
  initializeAI() {
    try {
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        logger.warn(
          "Gemini API key not configured, AI features will be disabled"
        );
        return;
      }
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      logger.info("Gemini AI initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize Gemini AI", { error: error.message });
    }
  }

  /**
   * Generate Instagram caption for a video
   */
  async generateCaption(videoName, context = "") {
    try {
      if (!this.model) {
        logger.warn("AI model not available, using default caption");
        return null;
      }

      // Create a prompt for caption generation
      const prompt = this.buildCaptionPrompt(videoName, context);

      logger.info("Generating AI caption for video", { videoName });

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const caption = response.text();

      if (caption && caption.trim()) {
        logger.info("Successfully generated AI caption", {
          videoName,
          captionLength: caption.length,
        });
        return caption.trim();
      } else {
        logger.warn("AI generated empty caption, using default");
        return null;
      }
    } catch (error) {
      logger.error("Failed to generate AI caption", {
        error: error.message,
        videoName,
      });
      return null;
    }
  }

  /**
   * Build prompt for caption generation
   */
  buildCaptionPrompt(videoName, context = "") {
    const basePrompt = `
Generate an engaging Instagram caption for a video file named: "${videoName}"

Requirements:
- Keep it under 200 characters
- Make it engaging and fun
- Include relevant emojis
- Don't include hashtags (they will be added separately)
- Make it suitable for a general audience
- Focus on the content suggested by the filename

${context ? `Additional context: ${context}` : ""}

Generate only the caption text, no extra formatting or quotes.
    `.trim();

    return basePrompt;
  }

  /**
   * Generate hashtags based on video name and content
   */
  async generateHashtags(videoName, caption = "") {
    try {
      if (!this.model) {
        return "#aivideo #artificialintelligence #ai #tech #automation #viral #video #content #innovation #amazing #trending";
      }
      const prompt = `
Generate relevant Instagram hashtags for a video named: "${videoName}"
${caption ? `Caption: "${caption}"` : ""}

This is likely an AI-generated or technology-related video. 

Requirements:
- Generate 15-20 relevant hashtags
- Mix popular and niche hashtags
- Focus on AI, technology, automation, innovation themes
- Include general video engagement hashtags
- Popular AI hashtags: #aivideo #artificialintelligence #ai #tech #automation #innovation #machinelearning #deeplearning #aiart #digital #future #algorithm #computer #technology
- Engagement hashtags: #viral #trending #amazing #creative #content #video #cool #awesome #mind-blowing #fascinating
- Return as a single line separated by spaces
- Start each hashtag with #
- No duplicate hashtags

Generate only the hashtags, no extra text.
      `.trim();

      logger.info("Generating AI hashtags", { videoName });

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const hashtags = response.text();

      if (hashtags && hashtags.trim()) {
        logger.info("Successfully generated AI hashtags", { videoName });
        return hashtags.trim();
      } else {
        return (
          process.env.DEFAULT_HASHTAGS ||
          "#aivideo #artificialintelligence #ai #tech #automation #viral #video #content #innovation #amazing #trending"
        );
      }
    } catch (error) {
      logger.error("Failed to generate AI hashtags", {
        error: error.message,
        videoName,
      });
      return (
        process.env.DEFAULT_HASHTAGS ||
        "#aivideo #artificialintelligence #ai #tech #automation #viral #video #content #innovation #amazing #trending"
      );
    }
  }

  /**
   * Generate complete Instagram post content
   */
  async generatePostContent(videoName, context = "") {
    try {
      if (!this.model) {
        return {
          caption: process.env.DEFAULT_CAPTION || "Amazing video! 🎥✨",
          hashtags:
            process.env.DEFAULT_HASHTAGS ||
            "#aivideo #artificialintelligence #ai #tech #automation #viral #video #content #innovation #amazing #trending",
        };
      }

      // Generate caption and hashtags in parallel
      const [caption, hashtags] = await Promise.all([
        this.generateCaption(videoName, context),
        this.generateHashtags(videoName, context),
      ]);
      return {
        caption:
          caption || process.env.DEFAULT_CAPTION || "Amazing video! 🎥✨",
        hashtags:
          hashtags ||
          process.env.DEFAULT_HASHTAGS ||
          "#aivideo #artificialintelligence #ai #tech #automation #viral #video #content #innovation #amazing #trending",
      };
    } catch (error) {
      logger.error("Failed to generate post content", {
        error: error.message,
        videoName,
      });

      return {
        caption: process.env.DEFAULT_CAPTION || "Amazing video! 🎥✨",
        hashtags:
          process.env.DEFAULT_HASHTAGS ||
          "#aivideo #artificialintelligence #ai #tech #automation #viral #video #content #innovation #amazing #trending",
      };
    }
  }

  /**
   * Analyze video filename for content hints
   */
  analyzeVideoName(videoName) {
    const name = videoName.toLowerCase();
    const hints = [];

    // Common video content patterns
    const patterns = {
      tutorial: ["tutorial", "howto", "guide", "learn"],
      funny: ["funny", "comedy", "hilarious", "laugh"],
      travel: ["travel", "vacation", "trip", "adventure"],
      food: ["food", "recipe", "cooking", "chef"],
      fitness: ["workout", "fitness", "exercise", "gym"],
      music: ["music", "song", "dance", "beat"],
      tech: ["tech", "review", "unbox", "gadget"],
      lifestyle: ["lifestyle", "vlog", "daily", "routine"],
    };

    for (const [category, keywords] of Object.entries(patterns)) {
      if (keywords.some((keyword) => name.includes(keyword))) {
        hints.push(category);
      }
    }

    return hints;
  }

  /**
   * Test AI service
   */
  async testService() {
    try {
      if (!this.model) {
        return { success: false, message: "AI service not initialized" };
      }

      const testCaption = await this.generateCaption("test_video.mp4");

      return {
        success: true,
        message: "AI service working",
        testCaption,
      };
    } catch (error) {
      logger.error("AI service test failed", { error: error.message });
      return {
        success: false,
        message: error.message,
      };
    }
  }
}

module.exports = new AIService();
