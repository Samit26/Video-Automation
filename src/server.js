#!/usr/bin/env node

/**
 * Express Web Server for Render.com Deployment
 * Provides HTTP endpoints for external cron job triggers
 */

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const logger = require("./utils/logger");
const { spawn } = require("child_process");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Track processing status
let isProcessing = false;
let lastProcessTime = null;
let lastProcessResult = null;

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    isProcessing,
    lastProcessTime,
    lastProcessResult: lastProcessResult
      ? {
          success: lastProcessResult.success,
          message: lastProcessResult.message,
          timestamp: lastProcessResult.timestamp,
        }
      : null,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || "development",
  });
});

/**
 * Status endpoint for monitoring
 */
app.get("/status", (req, res) => {
  res.json({
    service: "Video Automation Service",
    version: "1.0.0",
    isProcessing,
    lastProcessTime,
    lastProcessResult,
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

/**
 * Process video endpoint - triggered by external cron
 */
app.post("/process", async (req, res) => {
  try {
    // Check if already processing
    if (isProcessing) {
      return res.status(429).json({
        success: false,
        message: "Processing already in progress",
        isProcessing: true,
        lastProcessTime,
      });
    }

    // Validate authorization if provided
    const authToken = req.headers.authorization || req.query.token;
    const expectedToken = process.env.CRON_AUTH_TOKEN;

    if (
      expectedToken &&
      authToken !== `Bearer ${expectedToken}` &&
      authToken !== expectedToken
    ) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Start processing
    logger.info("Starting video processing via HTTP trigger");
    isProcessing = true;
    lastProcessTime = new Date().toISOString();

    // Respond immediately to prevent timeout
    res.json({
      success: true,
      message: "Video processing started",
      timestamp: lastProcessTime,
      isProcessing: true,
    });

    // Run processing in background
    runVideoProcessing();
  } catch (error) {
    logger.error("Error starting video processing", { error: error.message });
    isProcessing = false;

    res.status(500).json({
      success: false,
      message: "Failed to start processing",
      error: error.message,
    });
  }
});

/**
 * Run video processing in background
 */
async function runVideoProcessing() {
  try {
    const processorPath = path.join(__dirname, "..", "production-processor.js");

    logger.info("Spawning video processor", { processorPath });

    const processor = spawn("node", [processorPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let output = "";
    let errorOutput = "";

    processor.stdout.on("data", (data) => {
      const chunk = data.toString();
      output += chunk;
      logger.info("Processor output", { chunk: chunk.trim() });
    });

    processor.stderr.on("data", (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      logger.warn("Processor error output", { chunk: chunk.trim() });
    });

    processor.on("close", (code) => {
      isProcessing = false;

      const success = code === 0;
      lastProcessResult = {
        success,
        message: success
          ? "Processing completed successfully"
          : "Processing failed",
        exitCode: code,
        output: output.slice(-1000), // Last 1000 chars
        errorOutput: errorOutput.slice(-1000),
        timestamp: new Date().toISOString(),
      };

      logger.info("Video processing completed", {
        exitCode: code,
        success,
        outputLength: output.length,
        errorLength: errorOutput.length,
      });
    });

    processor.on("error", (error) => {
      isProcessing = false;
      lastProcessResult = {
        success: false,
        message: `Processing error: ${error.message}`,
        error: error.message,
        timestamp: new Date().toISOString(),
      };

      logger.error("Video processor spawn error", { error: error.message });
    });
  } catch (error) {
    isProcessing = false;
    lastProcessResult = {
      success: false,
      message: `Failed to start processor: ${error.message}`,
      error: error.message,
      timestamp: new Date().toISOString(),
    };

    logger.error("Failed to run video processing", { error: error.message });
  }
}

/**
 * Force stop processing (emergency endpoint)
 */
app.post("/stop", (req, res) => {
  try {
    const authToken = req.headers.authorization || req.query.token;
    const expectedToken = process.env.CRON_AUTH_TOKEN;

    if (
      expectedToken &&
      authToken !== `Bearer ${expectedToken}` &&
      authToken !== expectedToken
    ) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!isProcessing) {
      return res.json({
        success: true,
        message: "No processing to stop",
      });
    }

    // Force reset processing state
    isProcessing = false;
    lastProcessResult = {
      success: false,
      message: "Processing stopped manually",
      timestamp: new Date().toISOString(),
    };

    logger.warn("Processing manually stopped via HTTP endpoint");

    res.json({
      success: true,
      message: "Processing stopped",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to stop processing",
      error: error.message,
    });
  }
});

/**
 * Logs endpoint for debugging
 */
app.get("/logs", (req, res) => {
  try {
    const authToken = req.headers.authorization || req.query.token;
    const expectedToken = process.env.CRON_AUTH_TOKEN;

    if (
      expectedToken &&
      authToken !== `Bearer ${expectedToken}` &&
      authToken !== expectedToken
    ) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const logs = {
      lastProcessResult,
      isProcessing,
      lastProcessTime,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      environment: process.env.NODE_ENV,
    };

    res.json(logs);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get logs",
      error: error.message,
    });
  }
});

/**
 * Root endpoint
 */
app.get("/", (req, res) => {
  res.json({
    service: "Video Automation Service",
    version: "1.0.0",
    status: "running",
    endpoints: {
      health: "GET /health",
      status: "GET /status",
      process: "POST /process",
      stop: "POST /stop",
      logs: "GET /logs",
    },
    documentation: "Use POST /process to trigger video processing",
  });
});

// Error handling
app.use((error, req, res, next) => {
  logger.error("Express error", {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    message: "Internal server error",
    error:
      process.env.NODE_ENV === "development"
        ? error.message
        : "Something went wrong",
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found",
    availableEndpoints: [
      "/",
      "/health",
      "/status",
      "/process",
      "/stop",
      "/logs",
    ],
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");

  if (isProcessing) {
    logger.warn("Shutting down while processing is active");
  }

  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");

  if (isProcessing) {
    logger.warn("Shutting down while processing is active");
  }

  process.exit(0);
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  logger.info(`Video Automation Service started on port ${PORT}`, {
    port: PORT,
    environment: process.env.NODE_ENV || "development",
    nodeVersion: process.version,
  });
});

module.exports = app;
