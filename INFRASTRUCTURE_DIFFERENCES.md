# 🔄 Localhost vs Production Environment Differences

## 1. **Server Port Configuration**

| Setting | Localhost | Production |
|---------|-----------|------------|
| **Default Port** | `3001` (in your `config.json`) | `3000` (in `config.example.json`) |
| **Port Source** | `process.env.PORT` → `config.server.port` → `3000` fallback |
| **Binding** | `0.0.0.0` (all interfaces) | Same |

---

## 2. **OAuth Redirect URI**

| Environment | Redirect URI |
|-------------|--------------|
| **Localhost** | `http://localhost:3001/auth/clickup/callback` |
| **Production** | `https://yourdomain.com/auth/clickup/callback` |
| **Development (ngrok)** | `https://lili-monasterial-messiah.ngrok-free.dev/auth/clickup/callback` |

**Key Difference:** The `CLICKUP_REDIRECT_URI` environment variable must be updated in ClickUp's OAuth app settings AND your `.env` file when switching environments.

---

## 3. **Approval Email URLs**

| Environment | Approval URL |
|-------------|--------------|
| **Localhost** | `http://localhost:3000/approve/{token}` |
| **Production** | `https://yourdomain.com/approve/{token}` |

---

## 4. **Cursor CLI & WSL Configuration**

| Setting | Localhost (Windows) | Production (Linux Server) |
|---------|---------------------|---------------------------|
| **CLI Path** | `D:/Program Files/cursor/resources/app/bin/cursor.cmd` | `cursor` |
| **Use WSL** | `true` | `false` |
| **WSL Distribution** | `Ubuntu` | N/A |
| **Agent Trigger Method** | `cli` | `api` |

---

## 5. **Web Server Architecture**

### Localhost:
- **Direct Node.js** server running on port 3000/3001
- No reverse proxy
- Optional: ngrok tunnel for external webhook access

### Production (Cloudways):
- **Apache with `.htaccess`** reverse proxy to Node.js
- **PM2** process manager for Node.js
- **Nginx** (Cloudways default) or Apache proxying to `http://127.0.0.1:3000`

---

## 6. **OAuth Callback Handler**

| Environment | Handler |
|-------------|---------|
| **Localhost** | Node.js route in `server.ts` |
| **Production** | PHP script (`auth/clickup/callback.php`) via Apache rewrite |

The PHP callback exists for production environments where Apache handles the OAuth callback directly before proxying to Node.js.

---

## 7. **Process Management**

| Environment | Process Manager |
|-------------|-----------------|
| **Localhost** | `npm run dev` (ts-node-dev with hot reload) |
| **Production** | PM2 with ecosystem config |

---

## 8. **Webhook Access**

| Environment | Webhook URL |
|-------------|-------------|
| **Localhost (direct)** | `http://localhost:3000/webhook/clickup` (not accessible externally) |
| **Localhost (ngrok)** | `https://[ngrok-id].ngrok-free.dev/webhook/clickup` |
| **Production** | `https://yourdomain.com/webhook/clickup` |

---

## 9. **File Paths & Storage**

| Component | Localhost | Production |
|-----------|-----------|------------|
| **Client Websites** | `./client-websites` | `/home/master/applications/[app]/public_html/client-websites` |
| **Tokens** | `./tokens/` | `/home/master/applications/[app]/public_html/tokens/` |
| **Logs** | `./logs/` | `./logs/` + PM2 logs (`./logs/pm2-error.log`, `./logs/pm2-out.log`) |
| **State** | `./state/` | Same |
| **npm global bin** | `process.env.npm_config_prefix/bin` | `/home/master/.npm-global/bin` |

---

## 10. **Environment Variables**

**Required for both environments:**
```env
CLICKUP_CLIENT_ID=...
CLICKUP_CLIENT_SECRET=...
CLICKUP_REDIRECT_URI=...       # Different per environment!
CLICKUP_WEBHOOK_SECRET=...
GITHUB_TOKEN=...
```

**Additional for Production:**
```env
NODE_ENV=production
PORT=3000
SMTP_HOST=...
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM=...
```

---

## 11. **SSL/HTTPS**

| Environment | Protocol |
|-------------|----------|
| **Localhost** | HTTP (`http://localhost:3000`) |
| **Localhost (ngrok)** | HTTPS (ngrok provides SSL) |
| **Production** | HTTPS (Let's Encrypt via Cloudways) |

---

## 12. **SMTP Email Configuration**

| Environment | SMTP Status |
|-------------|-------------|
| **Localhost** | Often placeholder values; emails are skipped |
| **Production** | Real SMTP configured (Gmail App Password, etc.) |

---

## Summary Table

| Aspect | Localhost | Production |
|--------|-----------|------------|
| **Port** | 3001 | 3000 |
| **Protocol** | HTTP | HTTPS |
| **Process Manager** | ts-node-dev | PM2 |
| **Web Server** | Node.js direct | Apache/Nginx → Node.js |
| **OAuth Callback** | Node.js route | PHP file |
| **Cursor CLI** | Windows path + WSL | Linux native |
| **useWsl** | `true` | `false` |
| **agentTriggerMethod** | `cli` | `api` |
| **External Access** | ngrok tunnel | Direct domain |
| **SMTP** | Placeholder/disabled | Real config |
| **NODE_ENV** | undefined | `production` |



