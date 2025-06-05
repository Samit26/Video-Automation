const fs = require("fs-extra");
const path = require("path");
const logger = require("./logger");

class FileManager {
  constructor() {
    this.tempDir = process.env.TEMP_DIR || "./temp";
    this.outputDir = process.env.OUTPUT_DIR || "./output";
  }

  /**
   * Ensure directory exists
   */
  async ensureDir(dirPath) {
    try {
      await fs.ensureDir(dirPath);
      return true;
    } catch (error) {
      logger.error(`Failed to create directory: ${dirPath}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Clean up temporary files in a directory
   */
  async cleanupTempFiles(dirPath) {
    try {
      if (!(await fs.pathExists(dirPath))) {
        return;
      }

      const files = await fs.readdir(dirPath);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);

        if (stats.isFile()) {
          await fs.remove(filePath);
          deletedCount++;
          logger.debug(`Deleted temp file: ${filePath}`);
        } else if (stats.isDirectory()) {
          await fs.remove(filePath);
          deletedCount++;
          logger.debug(`Deleted temp directory: ${filePath}`);
        }
      }

      if (deletedCount > 0) {
        logger.info(
          `Cleaned up ${deletedCount} temporary files/directories from ${dirPath}`
        );
      }
    } catch (error) {
      logger.error(`Failed to cleanup temp files in ${dirPath}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Clean up old files based on age
   */
  async cleanupOldFiles(dirPath, maxAgeHours = 24) {
    try {
      if (!(await fs.pathExists(dirPath))) {
        return;
      }

      const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;
      const files = await fs.readdir(dirPath);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime.getTime() < cutoffTime) {
          await fs.remove(filePath);
          deletedCount++;
          logger.debug(`Deleted old file: ${filePath}`);
        }
      }

      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} old files from ${dirPath}`);
      }
    } catch (error) {
      logger.error(`Failed to cleanup old files in ${dirPath}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get file size in bytes
   */
  async getFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      logger.error(`Failed to get file size: ${filePath}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get human readable file size
   */
  formatFileSize(bytes) {
    const sizes = ["Bytes", "KB", "MB", "GB"];
    if (bytes === 0) return "0 Bytes";

    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = (bytes / Math.pow(1024, i)).toFixed(2);

    return `${size} ${sizes[i]}`;
  }

  /**
   * Check available disk space
   */
  async checkDiskSpace(dirPath) {
    try {
      // This is a simple implementation
      // For production, consider using a library like 'check-disk-space'
      const stats = await fs.stat(dirPath);
      return {
        available: true, // Simplified for now
        path: dirPath,
      };
    } catch (error) {
      logger.error(`Failed to check disk space for ${dirPath}`, {
        error: error.message,
      });
      return {
        available: false,
        path: dirPath,
        error: error.message,
      };
    }
  }

  /**
   * Safe file copy with retry
   */
  async safeCopy(src, dest, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        await fs.copy(src, dest);
        logger.debug(`Successfully copied file: ${src} -> ${dest}`);
        return true;
      } catch (error) {
        logger.warn(`Copy attempt ${i + 1} failed: ${src} -> ${dest}`, {
          error: error.message,
        });

        if (i === retries - 1) {
          throw error;
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  /**
   * Safe file move with retry
   */
  async safeMove(src, dest, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        await fs.move(src, dest);
        logger.debug(`Successfully moved file: ${src} -> ${dest}`);
        return true;
      } catch (error) {
        logger.warn(`Move attempt ${i + 1} failed: ${src} -> ${dest}`, {
          error: error.message,
        });

        if (i === retries - 1) {
          throw error;
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  /**
   * Safe file deletion
   */
  async safeDelete(filePath) {
    try {
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
        logger.debug(`Safely deleted file: ${filePath}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Failed to delete file: ${filePath}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Create unique filename to avoid conflicts
   */
  createUniqueFilename(originalPath, suffix = null) {
    const dir = path.dirname(originalPath);
    const ext = path.extname(originalPath);
    const basename = path.basename(originalPath, ext);

    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);

    let uniqueName = `${basename}_${timestamp}_${random}`;
    if (suffix) {
      uniqueName += `_${suffix}`;
    }
    uniqueName += ext;

    return path.join(dir, uniqueName);
  }

  /**
   * Get directory size
   */
  async getDirectorySize(dirPath) {
    try {
      if (!(await fs.pathExists(dirPath))) {
        return 0;
      }

      let totalSize = 0;
      const files = await fs.readdir(dirPath);

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);

        if (stats.isFile()) {
          totalSize += stats.size;
        } else if (stats.isDirectory()) {
          totalSize += await this.getDirectorySize(filePath);
        }
      }

      return totalSize;
    } catch (error) {
      logger.error(`Failed to get directory size: ${dirPath}`, {
        error: error.message,
      });
      return 0;
    }
  }

  /**
   * Monitor disk usage and cleanup if needed
   */
  async monitorAndCleanup() {
    try {
      const tempSize = await this.getDirectorySize(this.tempDir);
      const outputSize = await this.getDirectorySize(this.outputDir);

      logger.info("Disk usage monitoring", {
        tempDir: this.formatFileSize(tempSize),
        outputDir: this.formatFileSize(outputSize),
        total: this.formatFileSize(tempSize + outputSize),
      });

      // Clean up if temp directory is too large (>500MB)
      if (tempSize > 500 * 1024 * 1024) {
        logger.warn("Temp directory too large, cleaning up");
        await this.cleanupTempFiles(this.tempDir);
      }

      // Clean up old output files (>7 days)
      await this.cleanupOldFiles(this.outputDir, 24 * 7);
    } catch (error) {
      logger.error("Failed to monitor and cleanup", { error: error.message });
    }
  }
}

module.exports = new FileManager();
