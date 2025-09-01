# Collaborative Drawing App

A real-time collaborative drawing application built with React, Node.js, Socket.io, and Redis.

## Features

- Real-time drawing synchronization across multiple users
- Multiple colors and brush sizes
- Clean and responsive UI
- Redis for horizontal scaling
- Docker support for easy deployment

## Prerequisites

- Node.js 18+ (recommended)
- Docker and Docker Compose (optional)

## Getting Started

### With Docker (Optional)

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd collaborative-drawing-app
   ```

2. Start the application:
   ```bash
   docker-compose up --build
   ```

3. Open your browser: http://localhost

### Without Docker

#### Backend Setup (Local)

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the backend server:
   ```bash
   npm start
   ```

#### Frontend Setup (Local)

1. In a new terminal, navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

4. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Development

### Environment Variables

Backend (`backend/.env` or provider env settings):

```
# CORS allow-list (comma-separated). Must include your frontend URL.
FRONTEND_ORIGINS=https://live-canvas.netlify.app, http://localhost:3000

# Optional services
# MONGODB_URI=mongodb+srv://...
# MONGODB_DB=drawing_app
# REDIS_URL=redis://localhost:6379

# Port (Render sets this automatically)
# PORT=5000
```

Frontend (Netlify Site settings → Environment variables):

```
# Backend public URL (used by Socket.IO client and REST calls)
REACT_APP_SOCKET_URL=https://<your-backend>.onrender.com
```

### Available Scripts

#### Backend

- `npm start` - Start the production server
- `npm run dev` - Start the development server with nodemon

#### Frontend

- `npm start` - Start the development server
- `npm run build` - Build for production
- `npm test` - Run tests
- `npm run eject` - Eject from create-react-app

## Deployment

### Frontend → Netlify

We include `frontend/netlify.toml` for SPA routing. Deploy either via UI or CLI.

- Netlify UI:
  - New site from Git → pick your repo
  - Base directory: `collaborative-drawing-app/frontend`
  - Build command: `npm run build`
  - Publish directory: `build`
  - Add env var: `REACT_APP_SOCKET_URL = https://<your-backend>.onrender.com`

- Netlify CLI (from `collaborative-drawing-app/frontend/`):
  ```bash
  npm i -g netlify-cli
  netlify login
  netlify init                    # create site
  netlify env:set REACT_APP_SOCKET_URL https://<your-backend>.onrender.com
  netlify deploy --prod           # builds and deploys
  ```

### Backend → Render

We provide a Render Blueprint: `render.yaml` at repo root (`collaborative-drawing-app/render.yaml`).

Option A: Blueprint
- Push repo to GitHub.
- Render → New → Blueprint → select your repo.
- Confirm service (auto-detected):
  - Type: Web, Root: `backend`, Build: `npm install`, Start: `node server.js`, Health: `/health`
  - Env var: `FRONTEND_ORIGINS = https://<your-netlify>.netlify.app, http://localhost:3000`
- Create. After deploy, copy the public URL, e.g. `https://<service>.onrender.com`.

Option B: Manual Web Service
- Render → New → Web Service → connect repo.
- Root directory: `collaborative-drawing-app/backend/`
- Build: `npm install`
- Start: `node server.js`
- Health check path: `/health`
- Env vars: `FRONTEND_ORIGINS = https://<your-netlify>.netlify.app, http://localhost:3000`

### Wire frontend ↔ backend
1. In Render, ensure `FRONTEND_ORIGINS` includes your Netlify URL exactly (https and domain).
2. In Netlify, set `REACT_APP_SOCKET_URL` to the Render backend URL.
3. Redeploy the frontend.

### Verify
- Backend health: `https://<your-backend>.onrender.com/health` → `{ ok: true }`
- Open app: `https://<your-netlify>.netlify.app/?room=alpha`
- Draw from two browsers; verify real-time sync. Try Save/Load snapshot.

### Troubleshooting
- CORS blocked:
  - Ensure Render `FRONTEND_ORIGINS` matches your Netlify URL exactly.
  - Our server also allows `http://localhost:3000` by default for local dev.
- Frontend can’t connect to Socket:
  - Check Netlify `REACT_APP_SOCKET_URL` and redeploy.
- 404 on refresh/deep-link:
  - `frontend/netlify.toml` includes SPA redirect; ensure it’s present.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
