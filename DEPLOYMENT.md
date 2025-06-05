# Render.com Deployment Guide

## Overview

This guide walks you through deploying your video automation service on Render.com's free tier, triggered by external cron jobs 3 times daily.

## Prerequisites

1. **Render.com Account** - Sign up at https://render.com
2. **GitHub Repository** - Your code must be in a GitHub repository
3. **External Cron Service** - We'll use cron-job.org (free)
4. **Required API Keys** - Google Drive, Instagram, Gemini AI

## Step 1: Prepare Your Repository

1. **Push your code to GitHub:**

   ```bash
   git add .
   git commit -m "Prepare for Render deployment"
   git push origin main
   ```

2. **Verify these files exist:**
   - `render.yaml` ✅
   - `src/server.js` ✅
   - `production-processor.js` ✅
   - `package.json` ✅

## Step 2: Deploy on Render.com

1. **Login to Render.com** and click "New +"
2. **Select "Web Service"**
3. **Connect your GitHub repository**
4. **Configure the service:**
   - **Name:** `video-automation-service`
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free

## Step 3: Set Environment Variables

In Render dashboard, go to your service → Environment tab and add:

### Required Variables:

```bash
# Google Drive (OAuth2 - from Google Cloud Console)
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REFRESH_TOKEN=your_google_refresh_token_here
GOOGLE_DRIVE_LINKS=https://drive.google.com/drive/folders/YOUR_FOLDER_ID

# Instagram Credentials
INSTAGRAM_USERNAME=your_instagram_username
INSTAGRAM_PASSWORD=your_instagram_password

# AI Service (from Google AI Studio)
GEMINI_API_KEY=AIza...

# Security Token (generate random string)
CRON_AUTH_TOKEN=your_secure_random_token_123
```

### Optional Variables:

```bash
MOCK_INSTAGRAM=false
DEFAULT_HASHTAGS=#video #content #viral #tech #ai
DEFAULT_CAPTION=Amazing video! 🎥✨
WATERMARK_PATH=./assets/watermark.png
```

## Step 4: Deploy and Test

1. **Deploy your service** (Render will build and start automatically)
2. **Check health:** Visit `https://your-app.onrender.com/health`
3. **Test manual trigger:**
   ```bash
   curl -X POST "https://your-app.onrender.com/process" \
        -H "Authorization: Bearer your_secure_random_token_123"
   ```

## Step 5: Setup External Cron Jobs

### Option A: cron-job.org (Recommended - Free)

1. **Sign up at** https://cron-job.org
2. **Create new cron job:**
   - **Title:** Video Automation Trigger
   - **URL:** `https://your-app.onrender.com/process`
   - **Schedule:** `0 8,14,20 * * *` (8AM, 2PM, 8PM daily)
   - **HTTP Method:** POST
   - **Headers:** `Authorization: Bearer your_secure_random_token_123`
   - **Request Body:** `{"trigger": "cron"}`

### Option B: GitHub Actions (Alternative)

Create `.github/workflows/cron-trigger.yml`:

```yaml
name: Trigger Video Processing
on:
  schedule:
    - cron: "0 8,14,20 * * *" # 8AM, 2PM, 8PM UTC
  workflow_dispatch:

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Processing
        run: |
          curl -X POST "${{ secrets.RENDER_APP_URL }}/process" \
               -H "Authorization: Bearer ${{ secrets.CRON_AUTH_TOKEN }}"
```

### Option C: UptimeRobot (Monitoring + Cron)

1. **Sign up at** https://uptimerobot.com
2. **Create HTTP(s) monitor:**
   - **URL:** `https://your-app.onrender.com/process`
   - **Interval:** Every 8 hours
   - **HTTP Method:** POST
   - **Custom Headers:** `Authorization: Bearer your_token`

## Step 6: Monitoring and Management

### Available Endpoints:

- `GET /health` - Service health check
- `GET /status` - Processing status
- `POST /process` - Trigger video processing
- `POST /stop` - Emergency stop processing
- `GET /logs` - Get processing logs

### Monitoring Commands:

```bash
# Check service health
curl https://your-app.onrender.com/health

# Check processing status
curl https://your-app.onrender.com/status

# Trigger processing manually
curl -X POST https://your-app.onrender.com/process \
     -H "Authorization: Bearer your_token"

# View logs (with auth)
curl https://your-app.onrender.com/logs \
     -H "Authorization: Bearer your_token"
```

## Step 7: Render.com Free Tier Considerations

### Free Tier Limits:

- **Sleep after 15 minutes** of inactivity
- **750 hours/month** runtime
- **512MB RAM** maximum
- **100GB bandwidth** per month

### Keep-Alive Strategy:

The external cron jobs will automatically wake up your service, so no additional keep-alive is needed.

### Processing Time Optimization:

- Service processes **1 video per run**
- Average processing time: **~71 seconds**
- Designed to stay within free tier limits

## Step 8: Troubleshooting

### Common Issues:

1. **Service won't start:**

   - Check environment variables are set
   - Verify Google credentials JSON is valid
   - Check Render logs for specific errors

2. **Processing fails:**

   - Verify Instagram credentials
   - Check Google Drive folder permissions
   - Ensure watermark file exists

3. **Cron not triggering:**
   - Verify cron service is active
   - Check authorization token matches
   - Test manual trigger first

### Debug Commands:

```bash
# Check if service is responsive
curl https://your-app.onrender.com/

# Check detailed health
curl https://your-app.onrender.com/health

# View processing status
curl -H "Authorization: Bearer your_token" \
     https://your-app.onrender.com/logs
```

## Step 9: Production Checklist

- [ ] Code pushed to GitHub
- [ ] Render service deployed successfully
- [ ] All environment variables configured
- [ ] Health endpoint returns "healthy"
- [ ] Manual processing trigger works
- [ ] External cron job configured
- [ ] First automated run successful
- [ ] Instagram uploads working
- [ ] File cleanup functioning
- [ ] Monitoring/alerts setup

## Cost Optimization

### Free Tier Usage:

- **3 runs/day × 71 seconds** = ~213 seconds/day
- **213 seconds × 30 days** = ~106 minutes/month
- **Well within 750 hours/month limit** ✅

### Scaling Options:

If you need more processing:

- Upgrade to Render **Starter Plan** ($7/month)
- Increase to 6 runs/day or more
- Process multiple videos per run

## Security Notes

1. **Protect your auth token** - Don't commit to Git
2. **Use environment variables** for all secrets
3. **Monitor unauthorized access** via logs
4. **Rotate credentials** periodically

## Support

- **Render Docs:** https://render.com/docs
- **GitHub Issues:** Create issues in your repository
- **Logs:** Available via `/logs` endpoint

Your video automation service is now ready for production! 🚀
