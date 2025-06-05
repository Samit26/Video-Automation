# Cron Job Configuration Templates

## cron-job.org Configuration

### Basic Setup:

- **Service:** cron-job.org (Free)
- **URL:** https://your-app.onrender.com/process
- **Method:** POST
- **Schedule:** 0 8,14,20 \* \* \* (8AM, 2PM, 8PM daily)
- **Timezone:** UTC (adjust as needed)

### Headers:

```
Authorization: Bearer your_secure_auth_token_here
Content-Type: application/json
```

### Request Body:

```json
{
  "trigger": "cron",
  "source": "cron-job.org"
}
```

## GitHub Actions Cron (.github/workflows/cron-trigger.yml)

```yaml
name: Video Processing Cron
on:
  schedule:
    # Run at 8AM, 2PM, 8PM UTC daily
    - cron: "0 8,14,20 * * *"
  workflow_dispatch: # Allow manual trigger

jobs:
  trigger-processing:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Video Processing
        run: |
          curl -X POST "${{ secrets.RENDER_SERVICE_URL }}/process" \
               -H "Authorization: Bearer ${{ secrets.CRON_AUTH_TOKEN }}" \
               -H "Content-Type: application/json" \
               -d '{"trigger":"github-actions","workflow":"${{ github.workflow }}"}'
```

### Required GitHub Secrets:

- `RENDER_SERVICE_URL`: https://your-app.onrender.com
- `CRON_AUTH_TOKEN`: your_secure_auth_token

## UptimeRobot Configuration

### Monitor Setup:

- **Monitor Type:** HTTP(s)
- **URL:** https://your-app.onrender.com/process
- **Monitoring Interval:** 480 minutes (8 hours)
- **HTTP Method:** POST
- **Custom HTTP Headers:**
  ```
  Authorization: Bearer your_auth_token
  Content-Type: application/json
  ```
- **POST Body:**
  ```json
  { "trigger": "uptimerobot", "monitor": "video-automation" }
  ```

## Webhook.site Testing

### Test your cron setup:

1. Go to https://webhook.site
2. Copy your unique URL
3. Set up cron job to POST to that URL first
4. Verify the requests are coming through
5. Then switch to your real Render URL

## Cron Schedule Examples

```bash
# Every 8 hours starting at 8AM UTC
0 8,16,0 * * *

# Three times daily (8AM, 2PM, 8PM UTC)
0 8,14,20 * * *

# Every 6 hours
0 */6 * * *

# Weekdays only at 9AM, 1PM, 5PM UTC
0 9,13,17 * * 1-5

# Weekend only at 10AM UTC
0 10 * * 6,0
```

## Time Zone Considerations

### Popular Timezones:

- **UTC:** 8AM, 2PM, 8PM = 08:00, 14:00, 20:00
- **EST/EDT:** 8AM, 2PM, 8PM EST = 13:00, 19:00, 01:00 UTC
- **PST/PDT:** 8AM, 2PM, 8PM PST = 16:00, 22:00, 04:00 UTC
- **Central:** 8AM, 2PM, 8PM CST = 14:00, 20:00, 02:00 UTC

### Cron Expression Calculator:

Use https://crontab.guru/ to validate your cron expressions.

## Monitoring Commands

### Check if cron is working:

```bash
# Check processing status
curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://your-app.onrender.com/status

# Check logs
curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://your-app.onrender.com/logs

# Manual trigger for testing
curl -X POST \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"trigger":"manual-test"}' \
     https://your-app.onrender.com/process
```

## Troubleshooting Cron Jobs

### Common Issues:

1. **Cron not triggering:**

   - Verify cron service is enabled/active
   - Check URL is correct
   - Verify auth token is set

2. **403/401 Errors:**

   - Check Authorization header format
   - Verify token matches service config
   - Ensure token is not expired

3. **Service sleeping:**

   - Render free tier sleeps after 15min inactivity
   - First cron call wakes it up (~30-60 seconds)
   - Subsequent calls are fast

4. **Processing already running:**
   - Service prevents concurrent processing
   - Returns 429 status if already busy
   - Wait for current process to complete

### Debug Steps:

1. Test manual trigger first
2. Check service health endpoint
3. Verify cron service logs
4. Monitor Render service logs
5. Check processing status endpoint

## Security Best Practices

1. **Strong Auth Token:**

   ```bash
   # Generate secure token
   openssl rand -hex 32
   ```

2. **Environment Variables:**

   - Never commit tokens to Git
   - Use Render environment variables
   - Rotate tokens periodically

3. **Monitor Access:**
   - Check logs for unauthorized requests
   - Set up alerts for failures
   - Monitor processing frequency

## Production Checklist

- [ ] Cron service configured and tested
- [ ] Auth token generated and secured
- [ ] Schedule verified (3x daily)
- [ ] Manual trigger tested successfully
- [ ] Service health monitoring setup
- [ ] Logs accessible and monitored
- [ ] Backup cron service configured (optional)
- [ ] Time zone settings correct
- [ ] Error alerting configured
