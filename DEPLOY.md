# 🚀 Cloudways Deployment Guide

Complete guide for deploying the ClickUp to Cursor Workflow Tool to a Cloudways server.

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Server Requirements](#server-requirements)
3. [Pre-Deployment Preparation](#pre-deployment-preparation)
4. [Server Setup on Cloudways](#server-setup-on-cloudways)
5. [Application Deployment](#application-deployment)
6. [Configuration](#configuration)
7. [Process Management with PM2](#process-management-with-pm2)
8. [Post-Deployment Configuration](#post-deployment-configuration)
9. [SSL & Domain Setup](#ssl--domain-setup)
10. [Monitoring & Maintenance](#monitoring--maintenance)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before deploying, ensure you have:

- ✅ **Cloudways Account** with an active server
- ✅ **SSH Access** enabled on your Cloudways server
- ✅ **Git Repository** with your codebase
- ✅ **ClickUp API Token** or OAuth credentials
- ✅ **GitHub Personal Access Token** with `repo` scope
- ✅ **Email/SMTP credentials** (if using email approvals) OR **Slack Webhook URL** (if using Slack)
- ✅ **Domain Name** (optional but recommended for production)

---

## Server Requirements

### Minimum Server Specifications
- **RAM**: 2GB (4GB recommended for multiple concurrent tasks)
- **Storage**: 10GB minimum (depends on number of client websites)
- **Node.js**: Version 18.x or higher
- **NPM**: Version 9.x or higher

### Cloudways Server Selection
- **Provider**: Any (DigitalOcean, AWS, Google Cloud, Vultr, Linode)
- **Application**: Node.js Stack
- **Server Size**: Start with 2GB RAM (can scale up later)

---

## Pre-Deployment Preparation

### 1. Local Testing
Ensure everything works locally before deploying:

```bash
# Build the application
npm run build

# Test the production build
npm start

# Verify all endpoints work
curl http://localhost:3000/api/health
```

### 2. Prepare Environment Variables
Create a file locally with all your environment variables (don't commit this!):

**Required Variables:**
```env
# ClickUp Configuration
CLICKUP_API_TOKEN=pk_your_clickup_api_token_here
CLICKUP_WEBHOOK_SECRET=your_webhook_secret_here

# ClickUp OAuth (if using OAuth instead of API token)
CLICKUP_CLIENT_ID=your_client_id
CLICKUP_CLIENT_SECRET=your_client_secret
CLICKUP_REDIRECT_URI=https://yourdomain.com/auth/clickup/callback

# GitHub Configuration
GITHUB_TOKEN=ghp_your_github_personal_access_token_here

# Email Configuration (if using email approval)
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-specific-password
EMAIL_FROM=noreply@yourdomain.com

# Slack Configuration (alternative to email)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Node Environment
NODE_ENV=production
PORT=3000
```

### 3. Update Configuration File
Update `config/config.example.json` with production values:

```json
{
  "approval": {
    "email": {
      "approvalUrl": "https://yourdomain.com/approve/{token}"
    }
  }
}
```

---

## Server Setup on Cloudways

### 1. Create Server on Cloudways

1. Log in to [Cloudways Dashboard](https://platform.cloudways.com/)
2. Click **"Add Server"**
3. Select:
   - **Application**: Node.js
   - **Provider**: DigitalOcean (or preferred)
   - **Server Size**: 2GB or higher
   - **Location**: Choose closest to your users
4. Name your server (e.g., "KWD-Cursor-Tool")
5. Click **"Launch Now"**

### 2. Enable SSH Access

1. In Cloudways Dashboard → **Server Management**
2. Go to **"Master Credentials"**
3. Copy SSH credentials:
   - **Host**: server-ip-address
   - **Username**: master username
   - **Password**: master password
4. Enable **SSH Key Access** (recommended):
   - Go to **Security** → **SSH Public Keys**
   - Add your local SSH public key

### 3. Update Node.js Version

SSH into your server and check Node.js version:

```bash
ssh master@your-server-ip

# Check current Node.js version
node --version

# If version is less than 18.x, update it:
# (Cloudways usually provides a way to switch Node versions via dashboard)
```

If you need to manually update Node.js:

```bash
# Using NVM (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
nvm alias default 18
```

### 4. Install PM2 Globally

```bash
npm install -g pm2
```

---

## Application Deployment

### Method 1: Git Deployment (Recommended)

#### Step 1: Setup Git Repository Access

```bash
# SSH into your Cloudways server
ssh master@your-server-ip

# Generate SSH key for GitHub access
ssh-keygen -t rsa -b 4096 -C "your-email@example.com"

# Copy the public key
cat ~/.ssh/id_rsa.pub

# Add this key to your GitHub account:
# GitHub → Settings → SSH and GPG keys → New SSH key
```

#### Step 2: Clone Repository

```bash
# Navigate to application directory
cd /home/master/applications/your-app-name

# If there's existing code, back it up
mv public_html public_html_backup

# Clone your repository
git clone git@github.com:yourusername/your-repo.git public_html

# Navigate to application directory
cd public_html
```

#### Step 3: Install Dependencies

```bash
# Install production dependencies
npm install --production

# If you need dev dependencies for building:
npm install

# Build the TypeScript application
npm run build

# Remove dev dependencies after build
npm prune --production
```

### Method 2: SFTP/SCP Upload (Alternative)

If you prefer to upload files manually:

1. **Build locally first:**
   ```bash
   npm run build
   ```

2. **Upload via SFTP** (using FileZilla or similar):
   - Host: sftp://your-server-ip
   - Username: master username
   - Password: master password
   - Upload: `dist/`, `node_modules/`, `package.json`, `public/`, `prompts/`, `config/`

---

## Configuration

### 1. Create Environment File

```bash
# SSH into server
ssh master@your-server-ip

# Navigate to application directory
cd /home/master/applications/your-app-name/public_html

# Create .env file
nano .env
```

Paste your environment variables (from Pre-Deployment Preparation):

```env
CLICKUP_API_TOKEN=pk_xxxxx
CLICKUP_WEBHOOK_SECRET=xxxxx
GITHUB_TOKEN=ghp_xxxxx
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-password
EMAIL_FROM=noreply@yourdomain.com
NODE_ENV=production
PORT=3000
```

Save and exit (Ctrl+X, then Y, then Enter)

### 2. Create Production Config File (INCOMPLETE)

```bash
# Copy example config
cp config/config.example.json config/config.json

# Edit production values
nano config/config.json
```

Update these values:
- `approval.email.approvalUrl`: Use your production domain
- `server.port`: Set to 3000 (or your preferred port)
- `git.clientWebsitesDir`: Ensure path is correct for production

### 3. Create Required Directories

```bash
# Create necessary directories
mkdir -p logs
mkdir -p state
mkdir -p client-websites
mkdir -p temp-uploads
mkdir -p downloads
mkdir -p .cursor/queue
mkdir -p .cursor/running
mkdir -p .cursor/done
mkdir -p .cursor/failed

# Set proper permissions
chmod 755 logs state client-websites temp-uploads downloads
chmod 755 .cursor -R
```

### 3. Configure ImageRetriever (Optional)

If you want to use the ImageRetriever tool for automated image sourcing:

1. **Install ImageRetriever separately** (outside the application directory):
   ```bash
   cd /home/master/tools
   # Clone ImageRetriever repository
   git clone git@github.com:yourusername/ImageRetriever.git
   cd ImageRetriever
   npm install
   ```

2. **Add to your `.env` file**:
   ```env
   IMAGE_RETRIEVER_PATH=/home/master/tools/ImageRetriever
   ```

3. **Configure ImageRetriever's own `.env`** with required API keys:
   - See ImageRetriever repository documentation for required API keys
   - Typically includes: Unsplash API key, Google Custom Search API key, etc.

#### Auto-Detection

If `IMAGE_RETRIEVER_PATH` is not set, the application will auto-detect ImageRetriever in:

1. Parent directory: `../ImageRetriever` (recommended for keeping repo lightweight)
2. Application subdirectory: `./ImageRetriever` (backward compatibility)

#### Graceful Degradation

If ImageRetriever is not found at any location:

- The application will start normally without errors
- Image retrieval features will be disabled
- Agents will not receive ImageRetriever instructions in their prompts
- All other features continue to work normally

---

## Process Management with PM2

### 1. Create PM2 Ecosystem File

```bash
# Create ecosystem config
nano ecosystem.config.js
```

Add the following configuration:

```javascript
module.exports = {
  apps: [{
    name: 'kwd-cursor-tool',
    script: './dist/server.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000
  }]
};
```

### 2. Start Application with PM2

```bash
# Start the application
pm2 start ecosystem.config.js

# Save PM2 process list
pm2 save

# Setup PM2 to start on server reboot
pm2 startup

# Copy and run the command that PM2 outputs
# It will look something like:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u master --hp /home/master
```

### 3. Verify Application is Running

```bash
# Check PM2 status
pm2 status

# View logs
pm2 logs kwd-cursor-tool

# Monitor in real-time
pm2 monit
```

---

## Post-Deployment Configuration

### 1. Setup Cloudways Application Settings

1. **In Cloudways Dashboard:**
   - Go to **Application Management**
   - Select your Node.js application
   - Go to **"Deployment Via Git"** (if using Git method)
   - Set Branch: `main` or `master`
   - Enable auto-deployment if desired

2. **Configure Application URL:**
   - Go to **"Access Details"**
   - Note your application URL

### 2. Configure Nginx Reverse Proxy

Cloudways automatically sets up Nginx, but you may need to adjust:

```bash
# Edit Nginx config (if needed)
sudo nano /etc/nginx/sites-available/your-app.conf
```

Ensure the proxy configuration looks like:

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Restart Nginx:
```bash
sudo service nginx restart
```

### 3. Test Application

```bash
# Test from server
curl http://localhost:3000/api/health

# Test from browser
https://your-domain.com/api/health
```

### 4. Configure ClickUp Webhooks

1. Go to ClickUp → **Settings** → **Integrations** → **Webhooks**
2. Create a new webhook:
   - **Endpoint URL**: `https://yourdomain.com/webhook/clickup`
   - **Secret**: Use the same secret from your `.env` file
   - **Events**: Select status change events

### 5. Test OAuth Flow (if using OAuth)

1. Visit: `https://yourdomain.com/auth/clickup`
2. Authorize the application
3. Verify you're redirected back successfully

---

## SSL & Domain Setup

### 1. Add Custom Domain (Optional but Recommended)

1. **In Cloudways Dashboard:**
   - Go to **Application Management**
   - Select **"Domain Management"**
   - Add your custom domain

2. **Update DNS Records:**
   - Add A record pointing to your Cloudways server IP
   - Wait for DNS propagation (can take 24-48 hours)

### 2. Install SSL Certificate

Cloudways provides free Let's Encrypt SSL:

1. **In Cloudways Dashboard:**
   - Go to **"SSL Certificate"**
   - Select **"Let's Encrypt"**
   - Add your domain
   - Click **"Install Certificate"**

2. **Verify SSL:**
   - Visit `https://yourdomain.com`
   - Ensure the padlock icon appears

### 3. Force HTTPS

In your Nginx config, add redirect:

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

---

## Monitoring & Maintenance

### 1. Application Monitoring

```bash
# View real-time logs
pm2 logs kwd-cursor-tool --lines 100

# Check application status
pm2 status

# View detailed info
pm2 info kwd-cursor-tool

# Monitor resources
pm2 monit
```

### 2. Setup Log Rotation

PM2 handles log rotation, but you can also use logrotate:

```bash
sudo nano /etc/logrotate.d/kwd-cursor-tool
```

Add:
```
/home/master/applications/your-app-name/public_html/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    missingok
    copytruncate
}
```

### 3. Server Resource Monitoring

**In Cloudways Dashboard:**
- Monitor CPU, RAM, and Disk usage
- Set up alerts for high resource usage
- Enable backup automation

### 4. Database Backups (if applicable)

The application uses file-based storage (JSON files). Backup strategy:

```bash
# Create backup script
nano ~/backup-kwd-tool.sh
```

Add:
```bash
#!/bin/bash
BACKUP_DIR="/home/master/backups/kwd-tool"
APP_DIR="/home/master/applications/your-app-name/public_html"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup state, config, and client-websites
tar -czf $BACKUP_DIR/backup_$DATE.tar.gz \
    $APP_DIR/state \
    $APP_DIR/config \
    $APP_DIR/client-websites \
    $APP_DIR/logs

# Keep only last 7 days of backups
find $BACKUP_DIR -name "backup_*.tar.gz" -mtime +7 -delete

echo "Backup completed: backup_$DATE.tar.gz"
```

Make executable and schedule:
```bash
chmod +x ~/backup-kwd-tool.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add: 0 2 * * * /home/master/backup-kwd-tool.sh
```

---

## Troubleshooting

### Application Won't Start

```bash
# Check PM2 logs
pm2 logs kwd-cursor-tool --err

# Common issues:
# 1. Port already in use
lsof -i :3000
# Kill process: kill -9 PID

# 2. Missing environment variables
pm2 env 0  # Shows environment for app ID 0

# 3. Permission issues
ls -la /home/master/applications/your-app-name/public_html
chmod 755 dist/ -R
```

### Webhooks Not Working

```bash
# Check if server is receiving requests
tail -f logs/app.log

# Test webhook locally
curl -X POST https://yourdomain.com/webhook/clickup \
  -H "Content-Type: application/json" \
  -d '{"event":"taskStatusUpdated"}'

# Verify webhook secret is correct
cat .env | grep CLICKUP_WEBHOOK_SECRET
```

### Git Push Failures

```bash
# Check GitHub token
cat .env | grep GITHUB_TOKEN

# Test GitHub access
git ls-remote git@github.com:yourusername/test-repo.git

# Check SSH keys
cat ~/.ssh/id_rsa.pub
```

### High Memory Usage

```bash
# Check memory usage
pm2 monit

# Restart application
pm2 restart kwd-cursor-tool

# Increase max memory if needed
pm2 delete kwd-cursor-tool
# Edit ecosystem.config.js: max_memory_restart: '2G'
pm2 start ecosystem.config.js
```

### Email Not Sending

```bash
# Test SMTP connection
telnet smtp.gmail.com 587

# Check email logs in application logs
grep -i "email" logs/app.log

# For Gmail, ensure:
# - 2FA is enabled
# - App-specific password is used
# - "Less secure apps" is allowed (if not using app password)
```

### Application Crashes

```bash
# View crash logs
pm2 logs kwd-cursor-tool --err --lines 50

# Check system resources
top
df -h

# Restart application
pm2 restart kwd-cursor-tool

# If crashes persist, check for:
# - Unhandled promise rejections
# - Memory leaks
# - File permission issues
```

---

## Updating the Application

### Method 1: Git Pull (if using Git)

```bash
cd /home/master/applications/your-app-name/public_html

# Pull latest changes
git pull origin main

# Install any new dependencies
npm install --production

# Rebuild
npm run build

# Restart application
pm2 restart kwd-cursor-tool
```

### Method 2: Manual Upload

1. Build locally: `npm run build`
2. Upload `dist/` folder via SFTP
3. SSH into server and restart: `pm2 restart kwd-cursor-tool`

---

## Security Best Practices

1. **Never commit `.env` or `config/config.json` to Git**
2. **Use strong passwords** for all credentials
3. **Enable Cloudways firewall** and whitelist only necessary IPs
4. **Regularly update dependencies**: `npm update` and `npm audit fix`
5. **Use SSH keys** instead of passwords
6. **Enable two-factor authentication** on Cloudways account
7. **Regularly backup** your data
8. **Monitor logs** for suspicious activity

---

## Performance Optimization

1. **Enable Nginx caching** for static files
2. **Use CDN** for serving public assets (if applicable)
3. **Implement rate limiting** on webhook endpoints
4. **Monitor and clean up** old state files periodically
5. **Scale vertically** (increase server size) if handling many concurrent tasks
6. **Consider Redis** for caching if scaling to multiple servers

---

## Useful Commands Reference

```bash
# PM2 Commands
pm2 start ecosystem.config.js
pm2 stop kwd-cursor-tool
pm2 restart kwd-cursor-tool
pm2 delete kwd-cursor-tool
pm2 logs kwd-cursor-tool
pm2 monit

# Check application health
curl http://localhost:3000/api/health

# View active connections
netstat -tuln | grep 3000

# Check disk usage
df -h

# Check memory
free -m

# View running Node processes
ps aux | grep node

# Check Nginx status
sudo service nginx status

# Restart Nginx
sudo service nginx restart
```

---

## Support & Resources

- **ClickUp API Docs**: https://clickup.com/api
- **GitHub API Docs**: https://docs.github.com/en/rest
- **PM2 Docs**: https://pm2.keymetrics.io/docs/usage/quick-start/
- **Cloudways Docs**: https://support.cloudways.com/
- **Node.js Best Practices**: https://github.com/goldbergyoni/nodebestpractices

---

## Summary

Your ClickUp to Cursor Workflow Tool is now deployed and running on Cloudways! 

**Key Points:**
- Application runs on Node.js with PM2 process manager
- Environment variables stored in `.env` file
- Uses file-based storage (no database needed)
- Nginx reverse proxy handles incoming requests
- SSL certificate ensures secure connections
- Automated backups protect your data
- PM2 ensures application stays running and restarts on crashes

For any issues, check the [Troubleshooting](#troubleshooting) section or review application logs.
