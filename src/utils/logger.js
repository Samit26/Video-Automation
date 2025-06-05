const winston = require("winston");
const path = require("path");
const fs = require("fs-extra");

// Ensure logs directory exists
const logsDir = path.join(__dirname, "../../logs");
fs.ensureDirSync(logsDir);

// Create logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss",
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: "video-automation",
    version: "1.0.0",
  },
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, "app.log"),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

// Add console logging for development
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length
            ? JSON.stringify(meta, null, 2)
            : "";
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      ),
    })
  );
}

// Add console logging for production (structured)
if (process.env.NODE_ENV === "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    })
  );
}

// Create a stream for morgan HTTP logging
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

// Helper method to log with context
logger.logWithContext = (level, message, context = {}) => {
  logger.log(level, message, {
    ...context,
    timestamp: new Date().toISOString(),
  });
};

// Helper method to log performance
logger.logPerformance = (operation, duration, context = {}) => {
  logger.info(`Performance: ${operation}`, {
    ...context,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString(),
  });
};

// Helper method to log API calls
logger.logAPICall = (service, method, success, duration, context = {}) => {
  const level = success ? "info" : "error";
  logger.log(level, `API Call: ${service}.${method}`, {
    ...context,
    service,
    method,
    success,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString(),
  });
};

// Method to get recent logs
logger.getRecentLogs = async (lines = 100) => {
  try {
    const logFile = path.join(logsDir, "app.log");
    if (await fs.pathExists(logFile)) {
      const content = await fs.readFile(logFile, "utf8");
      return content.split("\n").slice(-lines).join("\n");
    }
    return "No logs available";
  } catch (error) {
    logger.error("Failed to read logs", { error: error.message });
    return "Error reading logs";
  }
};

// Method to clear old logs
logger.clearOldLogs = async (daysToKeep = 7) => {
  try {
    const logFiles = await fs.readdir(logsDir);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    for (const file of logFiles) {
      const filePath = path.join(logsDir, file);
      const stats = await fs.stat(filePath);

      if (stats.mtime < cutoffDate) {
        await fs.remove(filePath);
        logger.info(`Removed old log file: ${file}`);
      }
    }
  } catch (error) {
    logger.error("Failed to clear old logs", { error: error.message });
  }
};

module.exports = logger;
