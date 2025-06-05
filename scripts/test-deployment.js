#!/usr/bin/env node

/**
 * Deployment Verification Script
 * Tests the deployed service endpoints
 */

const axios = require("axios");

class DeploymentVerifier {
  constructor(baseUrl, authToken) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.authToken = authToken;
    this.axios = axios.create({
      timeout: 30000,
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
  }

  async runTests() {
    console.log("🚀 Starting deployment verification...\n");

    const tests = [
      () => this.testRoot(),
      () => this.testHealth(),
      () => this.testStatus(),
      () => this.testProcessTrigger(),
      () => this.testLogs(),
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      try {
        await test();
        passed++;
      } catch (error) {
        failed++;
        console.error(`❌ Test failed: ${error.message}\n`);
      }
    }

    console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

    if (failed === 0) {
      console.log("✅ All tests passed! Deployment looks good.");
    } else {
      console.log("⚠️  Some tests failed. Check the errors above.");
    }

    return failed === 0;
  }

  async testRoot() {
    console.log("Testing root endpoint...");
    const response = await this.axios.get(`${this.baseUrl}/`);

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    if (!response.data.service || !response.data.endpoints) {
      throw new Error("Root response missing expected fields");
    }

    console.log("✅ Root endpoint working\n");
  }

  async testHealth() {
    console.log("Testing health endpoint...");
    const response = await this.axios.get(`${this.baseUrl}/health`);

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    if (response.data.status !== "healthy") {
      throw new Error(`Expected 'healthy', got '${response.data.status}'`);
    }

    console.log(`✅ Health check passed - Service is ${response.data.status}`);
    console.log(`   Uptime: ${Math.round(response.data.uptime)} seconds`);
    console.log(
      `   Memory: ${Math.round(
        response.data.memoryUsage.heapUsed / 1024 / 1024
      )}MB used\n`
    );
  }

  async testStatus() {
    console.log("Testing status endpoint...");
    const response = await this.axios.get(`${this.baseUrl}/status`);

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    console.log(`✅ Status endpoint working`);
    console.log(
      `   Processing: ${response.data.isProcessing ? "Active" : "Idle"}`
    );
    console.log(
      `   Last process: ${response.data.lastProcessTime || "Never"}\n`
    );
  }

  async testProcessTrigger() {
    console.log("Testing process trigger endpoint...");

    if (!this.authToken) {
      console.log(
        "⚠️  Skipping process trigger test (no auth token provided)\n"
      );
      return;
    }

    const response = await this.axios.post(`${this.baseUrl}/process`);

    if (response.status !== 200 && response.status !== 429) {
      throw new Error(`Expected 200 or 429, got ${response.status}`);
    }

    if (response.status === 429) {
      console.log("✅ Process trigger working (already processing)\n");
    } else {
      console.log("✅ Process trigger working (processing started)\n");
    }
  }

  async testLogs() {
    console.log("Testing logs endpoint...");

    if (!this.authToken) {
      console.log("⚠️  Skipping logs test (no auth token provided)\n");
      return;
    }

    const response = await this.axios.get(`${this.baseUrl}/logs`);

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    console.log("✅ Logs endpoint working\n");
  }
}

// Command line usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log("Usage: node test-deployment.js <service-url> [auth-token]");
    console.log(
      "Example: node test-deployment.js https://your-app.onrender.com your_auth_token"
    );
    process.exit(1);
  }

  const serviceUrl = args[0];
  const authToken = args[1];

  const verifier = new DeploymentVerifier(serviceUrl, authToken);

  verifier
    .runTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error("❌ Verification failed:", error.message);
      process.exit(1);
    });
}

module.exports = DeploymentVerifier;
