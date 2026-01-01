# How to Run the Application

## Quick Start

### Step 1: Make sure everything is built
```powershell
npm run build
```

### Step 2: Start the server
```powershell
npm start
```

Or for development with auto-reload:
```powershell
npm run dev
```

### Step 3: Keep ngrok running (in a separate terminal)
```powershell
npx ngrok http 3000
```

---

## Full Setup Checklist

Before running, make sure:

1. ✅ **Dependencies installed**: `npm install` (should already be done)
2. ✅ **Environment variables set**: Check `.env` file has all required values
3. ✅ **OAuth authorized**: Visit `/auth/clickup` once to authorize
4. ✅ **Webhook created**: Already done via API ✅
5. ✅ **ngrok running**: For public URL access

---

## Running the Server

### Option 1: Production Mode (Recommended)
```powershell
npm start
```

This runs the compiled code from `dist/` folder.

### Option 2: Development Mode (Auto-reload on changes)
```powershell
npm run dev
```

This watches for file changes and automatically restarts.

---

## What You'll See

When the server starts, you should see:
```
Server started on port 3000
ClickUp webhook endpoint: http://localhost:3000/webhook/clickup
Health check: http://localhost:3000/health
```

---

## Access Points

Once running:

- **Dashboard**: http://localhost:3000
- **Health Check**: http://localhost:3000/health
- **OAuth Authorization**: http://localhost:3000/auth/clickup
- **Webhook Endpoint**: http://localhost:3000/webhook/clickup

Through ngrok (public URLs):
- **Dashboard**: https://lili-monasterial-messiah.ngrok-free.dev
- **OAuth**: https://lili-monasterial-messiah.ngrok-free.dev/auth/clickup
- **Webhook**: https://lili-monasterial-messiah.ngrok-free.dev/webhook/clickup

---

## Running in Background

### Windows PowerShell:
```powershell
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'c:\Users\yunus\Desktop\KWD Dev'; npm start"
```

### Or use PM2 (if installed):
```powershell
npm install -g pm2
pm2 start dist/server.js --name clickup-cursor
pm2 logs clickup-cursor
```

---

## Troubleshooting

**Port already in use:**
- Stop any existing node processes: `Get-Process -Name node | Stop-Process -Force`
- Or change port in `config/config.json`

**Module not found errors:**
- Run: `npm install`
- Then: `npm run build`

**OAuth errors:**
- Make sure you've visited `/auth/clickup` to authorize
- Check `.env` has `CLICKUP_CLIENT_ID` and `CLICKUP_CLIENT_SECRET`

**Webhook not working:**
- Make sure ngrok is running
- Make sure server is running
- Check server logs for errors

---

## Quick Command Reference

```powershell
# Build the project
npm run build

# Start server (production)
npm start

# Start server (development)
npm run dev

# Check if server is running
Invoke-WebRequest http://localhost:3000/health

# Stop all node processes
Get-Process -Name node | Stop-Process -Force
```



