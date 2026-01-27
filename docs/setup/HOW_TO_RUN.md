# How to Run KWD Dev

This project consists of a **Backend (TypeScript/Node.js API)** and a **Frontend (Static Dashboard)**.

## 🚀 Quick Start

### 1. Build & Start (Standard)
```powershell
npm run build
npm start
```

### 2. Development Mode (Auto-reload)
```powershell
npm run dev
```

---

## 🖥️ Backend (Server)
The backend handles ClickUp webhooks, GitHub operations, and serves the frontend.
- **Port**: `3000` (default)
- **Main Entry**: `src/server.ts`
- **Health Check**: `http://localhost:3000/health`

## 🌐 Frontend (Dashboard)
The frontend is a set of static files served from the `/public` directory.
- **Access**: `http://localhost:3000`
- **Features**: Dashboard, Settings, Mappings, and Task View.

---

## 🔗 Webhook Support (ngrok)
To receive webhooks from ClickUp, you **must** have a public URL.

1. **Start ngrok** (in a separate terminal):
   ```powershell
   npx ngrok http 3000
   ```
2. **Copy the HTTPS URL** (e.g., `https://xyz.ngrok-free.app`) and use it for your ClickUp webhooks and OAuth redirect.

---

## 📝 Summary of Access Points

| Component | Local URL | Public URL (via ngrok) |
|-----------|-----------|------------------------|
| **Dashboard** | `http://localhost:3000` | `https://[ngrok-id].ngrok-free.app` |
| **Settings** | `http://localhost:3000/settings.html` | `https://[ngrok-id].ngrok-free.app/settings.html` |
| **OAuth** | `http://localhost:3000/auth/clickup` | `https://[ngrok-id].ngrok-free.app/auth/clickup` |
| **Webhook** | `http://localhost:3000/webhook/clickup` | `https://[ngrok-id].ngrok-free.app/webhook/clickup` |

---

## 🛠️ Requirements Checklist
- [ ] `npm install` (Install dependencies)
- [ ] `.env` file configured (ClickUp IDs/Secrets)
- [ ] `config/config.json` configured
