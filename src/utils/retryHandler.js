const logger = require("./logger");

class RetryHandler {
  constructor() {
    this.defaultMaxRetries = parseInt(process.env.MAX_RETRIES) || 3;
    this.defaultDelay = parseInt(process.env.RETRY_DELAY) || 1000;
  }

  /**
   * Execute a function with retry logic and exponential backoff
   */
  async withRetry(
    operation,
    maxRetries = this.defaultMaxRetries,
    operationName = "Operation",
    baseDelay = this.defaultDelay,
    backoffMultiplier = 2
  ) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug(`${operationName} - Attempt ${attempt}/${maxRetries}`);

        const startTime = Date.now();
        const result = await operation();
        const duration = Date.now() - startTime;

        logger.info(`${operationName} succeeded`, {
          attempt,
          duration: `${duration}ms`,
        });

        return result;
      } catch (error) {
        lastError = error;

        logger.warn(
          `${operationName} failed - Attempt ${attempt}/${maxRetries}`,
          {
            error: error.message,
            attempt,
            maxRetries,
          }
        );

        // Don't wait after the last attempt
        if (attempt < maxRetries) {
          const delay = this.calculateDelay(
            baseDelay,
            attempt - 1,
            backoffMultiplier
          );

          logger.debug(`Waiting ${delay}ms before retry`, {
            operationName,
            attempt,
            delay,
          });

          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    logger.error(`${operationName} failed after ${maxRetries} attempts`, {
      error: lastError.message,
      maxRetries,
    });

    throw new Error(
      `${operationName} failed after ${maxRetries} attempts. Last error: ${lastError.message}`
    );
  }

  /**
   * Calculate delay with exponential backoff
   */
  calculateDelay(baseDelay, attemptNumber, multiplier = 2) {
    const exponentialDelay = baseDelay * Math.pow(multiplier, attemptNumber);

    // Add some jitter to avoid thundering herd
    const jitter = Math.random() * 0.1 * exponentialDelay;

    return Math.floor(exponentialDelay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Retry with circuit breaker pattern
   */
  async withCircuitBreaker(
    operation,
    operationName = "Operation",
    options = {}
  ) {
    const {
      maxRetries = this.defaultMaxRetries,
      baseDelay = this.defaultDelay,
      circuitBreakerThreshold = 5,
      circuitBreakerTimeout = 60000, // 1 minute
      isRetriableError = () => true,
    } = options;

    // Simple circuit breaker state (in production, use external storage)
    const circuitKey = `circuit_${operationName}`;

    // Check if circuit is open
    if (this.isCircuitOpen(circuitKey, circuitBreakerTimeout)) {
      throw new Error(`Circuit breaker is open for ${operationName}`);
    }

    try {
      const result = await this.withRetry(
        operation,
        maxRetries,
        operationName,
        baseDelay
      );

      // Reset circuit breaker on success
      this.resetCircuitBreaker(circuitKey);

      return result;
    } catch (error) {
      // Check if error is retriable
      if (isRetriableError(error)) {
        this.recordCircuitBreakerFailure(circuitKey);
      }

      throw error;
    }
  }

  /**
   * Check if circuit breaker is open
   */
  isCircuitOpen(circuitKey, timeout) {
    // Simple implementation using memory (use Redis/DB for production)
    if (!this.circuitState) {
      this.circuitState = {};
    }

    const state = this.circuitState[circuitKey];
    if (!state) {
      return false;
    }

    if (state.isOpen && Date.now() - state.openedAt > timeout) {
      // Reset circuit breaker after timeout
      delete this.circuitState[circuitKey];
      return false;
    }

    return state.isOpen;
  }

  /**
   * Record circuit breaker failure
   */
  recordCircuitBreakerFailure(circuitKey, threshold = 5) {
    if (!this.circuitState) {
      this.circuitState = {};
    }

    if (!this.circuitState[circuitKey]) {
      this.circuitState[circuitKey] = {
        failures: 0,
        isOpen: false,
      };
    }

    this.circuitState[circuitKey].failures++;

    if (this.circuitState[circuitKey].failures >= threshold) {
      this.circuitState[circuitKey].isOpen = true;
      this.circuitState[circuitKey].openedAt = Date.now();

      logger.warn(`Circuit breaker opened for ${circuitKey}`, {
        failures: this.circuitState[circuitKey].failures,
        threshold,
      });
    }
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(circuitKey) {
    if (this.circuitState && this.circuitState[circuitKey]) {
      delete this.circuitState[circuitKey];
      logger.info(`Circuit breaker reset for ${circuitKey}`);
    }
  }

  /**
   * Retry with specific error handling
   */
  async withErrorHandling(
    operation,
    operationName = "Operation",
    errorHandlers = {}
  ) {
    try {
      return await this.withRetry(operation, undefined, operationName);
    } catch (error) {
      // Check for specific error handlers
      for (const [errorType, handler] of Object.entries(errorHandlers)) {
        if (error.message.includes(errorType) || error.name === errorType) {
          logger.info(`Handling specific error: ${errorType}`, {
            operationName,
            error: error.message,
          });

          return await handler(error);
        }
      }

      // No specific handler found, re-throw
      throw error;
    }
  }

  /**
   * Batch retry - retry multiple operations with different strategies
   */
  async batchRetry(operations, options = {}) {
    const { parallel = false, failFast = false, maxConcurrency = 5 } = options;

    const results = [];
    const errors = [];

    if (parallel) {
      // Execute operations in parallel with concurrency limit
      const chunks = this.chunkArray(operations, maxConcurrency);

      for (const chunk of chunks) {
        const chunkPromises = chunk.map(async (op, index) => {
          try {
            const result = await this.withRetry(
              op.operation,
              op.maxRetries || this.defaultMaxRetries,
              op.name || `Operation ${index}`,
              op.baseDelay || this.defaultDelay
            );
            return { success: true, result, index: op.index || index };
          } catch (error) {
            const errorResult = {
              success: false,
              error,
              index: op.index || index,
            };

            if (failFast) {
              throw errorResult;
            }

            return errorResult;
          }
        });

        const chunkResults = await Promise.allSettled(chunkPromises);

        for (const result of chunkResults) {
          if (result.status === "fulfilled") {
            if (result.value.success) {
              results.push(result.value);
            } else {
              errors.push(result.value);
            }
          } else {
            errors.push({ success: false, error: result.reason });
          }
        }
      }
    } else {
      // Execute operations sequentially
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];

        try {
          const result = await this.withRetry(
            op.operation,
            op.maxRetries || this.defaultMaxRetries,
            op.name || `Operation ${i}`,
            op.baseDelay || this.defaultDelay
          );

          results.push({ success: true, result, index: i });
        } catch (error) {
          const errorResult = { success: false, error, index: i };
          errors.push(errorResult);

          if (failFast) {
            break;
          }
        }
      }
    }

    return {
      results,
      errors,
      successCount: results.length,
      errorCount: errors.length,
      totalCount: operations.length,
    };
  }

  /**
   * Utility to chunk array for batch processing
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Create a retry-enabled version of any async function
   */
  retryify(fn, options = {}) {
    const {
      maxRetries = this.defaultMaxRetries,
      baseDelay = this.defaultDelay,
      operationName = fn.name || "Anonymous Function",
    } = options;

    return async (...args) => {
      return await this.withRetry(
        () => fn(...args),
        maxRetries,
        operationName,
        baseDelay
      );
    };
  }
}

module.exports = new RetryHandler();
