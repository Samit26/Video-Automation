const cron = require("cron");
const logger = require("../utils/logger");
const processVideos = require("../process-videos");

class SchedulerService {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
  }

  /**
   * Start the main cron job for video processing
   */
  startVideoProcessingJob() {
    try {
      const cronSchedule = process.env.CRON_SCHEDULE || "0 8,14,20 * * *"; // 3 times a day

      logger.info("Starting video processing cron job", {
        schedule: cronSchedule,
      });

      const job = new cron.CronJob(
        cronSchedule,
        this.runVideoProcessing.bind(this),
        null,
        true, // Start immediately
        "UTC" // Timezone
      );

      this.jobs.set("videoProcessing", job);
      logger.info("Video processing cron job started successfully");
    } catch (error) {
      logger.error("Failed to start video processing cron job", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Execute video processing
   */
  async runVideoProcessing() {
    if (this.isRunning) {
      logger.warn(
        "Video processing already running, skipping this scheduled run"
      );
      return;
    }

    try {
      this.isRunning = true;
      logger.info("Starting scheduled video processing");

      const result = await processVideos();

      logger.info("Scheduled video processing completed", { result });
    } catch (error) {
      logger.error("Scheduled video processing failed", {
        error: error.message,
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Stop all cron jobs
   */
  stopAllJobs() {
    try {
      this.jobs.forEach((job, name) => {
        job.stop();
        logger.info(`Stopped cron job: ${name}`);
      });

      this.jobs.clear();
      logger.info("All cron jobs stopped");
    } catch (error) {
      logger.error("Failed to stop cron jobs", { error: error.message });
    }
  }

  /**
   * Get status of all jobs
   */
  getJobsStatus() {
    const status = {};

    this.jobs.forEach((job, name) => {
      status[name] = {
        running: job.running,
        lastDate: job.lastDate(),
        nextDate: job.nextDate(),
      };
    });

    return {
      jobs: status,
      isProcessing: this.isRunning,
    };
  }
}

module.exports = new SchedulerService();
