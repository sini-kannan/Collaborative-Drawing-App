const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();

// --- Security & CORS ---
// Support multiple allowed origins via FRONTEND_ORIGINS (comma-separated) or FRONTEND_ORIGIN (single)
const defaultOrigins = ['http://localhost:3000', 'https://live-canvas.netlify.app'];
const envOrigins = (process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = envOrigins.length ? envOrigins : defaultOrigins;

app.use(cors({
  origin: function (origin, cb) {
    // allow same-origin and non-browser requests
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS not allowed'));
  },
  methods: ['GET', 'POST'],
  credentials: false,
}));

// Basic security headers (lightweight alternative to helmet)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
});

// Body size limits
app.use(express.json({ limit: '100kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  }
});

// Simple JSON file persistence
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function fileForRoom(room) {
  return path.join(dataDir, `${room}.json`);
}

function loadStrokes(room) {
  try {
    const f = fileForRoom(room);
    if (!fs.existsSync(f)) return [];
    const raw = fs.readFileSync(f, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load strokes for room', room, e);
    return [];
  }
}

function saveStrokes(room, strokes) {
  try {
    fs.writeFileSync(fileForRoom(room), JSON.stringify(strokes));
  } catch (e) {
    console.error('Failed to save strokes for room', room, e);
  }
}

function appendStroke(room, stroke) {
  const strokes = loadStrokes(room);
  strokes.push(stroke);
  saveStrokes(room, strokes);
}

function removeLastStroke(room) {
  const strokes = loadStrokes(room);
  // Remove until previous 'start' (inclusive)
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (strokes[i].type === 'start') {
      const newArr = strokes.slice(0, i);
      saveStrokes(room, newArr);
      return newArr;
    }
  }
  saveStrokes(room, []);
  return [];
}

// Snapshot file helpers
const snapshotsDir = path.join(__dirname, 'snapshots');
if (!fs.existsSync(snapshotsDir)) fs.mkdirSync(snapshotsDir, { recursive: true });

function snapshotFile(room, name) {
  const safe = name.replace(/[^a-z0-9_-]/gi, '_');
  return path.join(snapshotsDir, `${room}__${safe}.json`);
}

function saveSnapshotFile(room, name) {
  const data = loadStrokes(room);
  const f = snapshotFile(room, name || new Date().toISOString());
  fs.writeFileSync(f, JSON.stringify({ room, name, data, createdAt: Date.now() }));
  return { room, name, path: f };
}

function listSnapshotsFile(room) {
  const files = fs.readdirSync(snapshotsDir).filter(f => f.startsWith(`${room}__`) && f.endsWith('.json'));
  return files.map(f => {
    const raw = JSON.parse(fs.readFileSync(path.join(snapshotsDir, f), 'utf-8'));
    return { room: raw.room, name: raw.name, createdAt: raw.createdAt };
  });
}

function loadSnapshotFile(room, name) {
  const f = snapshotFile(room, name);
  if (!fs.existsSync(f)) return null;
  const raw = JSON.parse(fs.readFileSync(f, 'utf-8'));
  return raw.data || [];
}

// Optional MongoDB persistence
let useMongo = false;
let StrokeModel = null;
let SnapshotModel = null;

async function setupMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return;
  try {
    await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || 'drawing_app' });
    const pointSchema = new mongoose.Schema({ x: Number, y: Number, type: String, color: String, width: Number, order: Number }, { _id: false });
    const strokeSchema = new mongoose.Schema({ room: String, strokeId: String, points: [pointSchema], createdAt: { type: Date, default: Date.now } });
    const snapshotSchema = new mongoose.Schema({ room: String, name: String, data: [pointSchema], createdAt: { type: Date, default: Date.now } });
    StrokeModel = mongoose.model('Stroke', strokeSchema);
    SnapshotModel = mongoose.model('Snapshot', snapshotSchema);
    useMongo = true;
    console.log('MongoDB connected');
  } catch (e) {
    console.error('MongoDB connection failed, using file persistence:', e.message);
  }
}

async function mongoLoadAllPoints(room) {
  const strokes = await StrokeModel.find({ room }).sort({ createdAt: 1 }).lean();
  const points = [];
  for (const s of strokes) {
    for (const p of s.points) points.push(p);
  }
  return points;
}

async function mongoAppendPoint(room, strokeId, pt) {
  await StrokeModel.updateOne(
    { room, strokeId },
    { $push: { points: { ...pt, order: Date.now() } }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
}

async function mongoClear(room) {
  await StrokeModel.deleteMany({ room });
}

async function mongoUndo(room) {
  // remove the last created stroke for the room
  const last = await StrokeModel.findOne({ room }).sort({ createdAt: -1 });
  if (!last) return [];
  await StrokeModel.deleteOne({ _id: last._id });
  return mongoLoadAllPoints(room);
}

async function mongoSaveSnapshot(room, name) {
  const data = await mongoLoadAllPoints(room);
  const doc = await SnapshotModel.create({ room, name, data });
  return { id: doc._id.toString(), room: doc.room, name: doc.name, createdAt: doc.createdAt };
}

async function mongoListSnapshots(room) {
  const snaps = await SnapshotModel.find({ room }).sort({ createdAt: -1 }).lean();
  return snaps.map(s => ({ id: s._id.toString(), room: s.room, name: s.name, createdAt: s.createdAt }));
}

async function mongoLoadSnapshot(room, idOrName) {
  let snap = null;
  if (idOrName.match && idOrName.match(/^[a-f0-9]{24}$/)) {
    snap = await SnapshotModel.findById(idOrName).lean();
  }
  if (!snap) {
    snap = await SnapshotModel.findOne({ room, name: idOrName }).lean();
  }
  return snap ? snap.data : null;
}

// Setup Redis adapter for scaling
async function setupRedisAdapter() {
  try {
    const pubClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    const subClient = pubClient.duplicate();
    
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log('Redis adapter connected');
  } catch (error) {
    console.error('Failed to connect to Redis, using in-memory adapter:', error);
  }
}

// --- Simple IP rate limiter (per route) ---
function makeRateLimiter({ windowMs = 60_000, max = 60 } = {}) {
  const hits = new Map(); // key -> { count, ts }
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const rec = hits.get(key) || { count: 0, ts: now };
    if (now - rec.ts > windowMs) {
      rec.count = 0; rec.ts = now;
    }
    rec.count += 1;
    hits.set(key, rec);
    if (rec.count > max) return res.status(429).json({ error: 'Too many requests' });
    next();
  };
}

const apiLimiter = makeRateLimiter({ windowMs: 60_000, max: 120 });
const writeLimiter = makeRateLimiter({ windowMs: 60_000, max: 30 });

// --- Input validation ---
function sanitizeRoom(input) {
  const v = String(input || '').trim();
  if (!v) return 'lobby';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(v)) return 'lobby';
  return v;
}

function sanitizeName(input) {
  const v = String(input || '').trim();
  if (!v) return new Date().toISOString();
  // allow readable names but strip dangerous chars for file path safety
  return v.replace(/[^a-zA-Z0-9 _-]/g, '_').slice(0, 100);
}

// Initialize server
async function init() {
  await setupRedisAdapter();
  await setupMongo();
  
  // Basic health endpoint
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Snapshot REST endpoints
  app.get('/api/snapshots', apiLimiter, async (req, res) => {
    const room = sanitizeRoom(req.query.room || 'lobby');
    try {
      const list = useMongo ? await mongoListSnapshots(room) : listSnapshotsFile(room);
      res.json(list);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/snapshots', writeLimiter, async (req, res) => {
    const room = sanitizeRoom(req.body && req.body.room || 'lobby');
    const name = sanitizeName(req.body && req.body.name);
    try {
      const result = useMongo ? await mongoSaveSnapshot(room, name) : saveSnapshotFile(room, name);
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/snapshots/:idOrName', apiLimiter, async (req, res) => {
    const room = sanitizeRoom(req.query.room || 'lobby');
    const key = sanitizeName(req.params.idOrName);
    try {
      const data = useMongo ? await mongoLoadSnapshot(room, key) : loadSnapshotFile(room, key);
      if (!data) return res.status(404).json({ error: 'Not found' });
      res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    // Join room (from query ?room=roomId). Default to 'lobby'
    const { room: rawRoom = 'lobby' } = socket.handshake.query || {};
    const room = sanitizeRoom(rawRoom);
    socket.join(room);
    console.log(`Socket ${socket.id} joined room ${room}`);

    // Send existing strokes history to the newly connected client only
    (async () => {
      const history = useMongo ? await mongoLoadAllPoints(room) : loadStrokes(room);
      socket.emit('history', history);
    })();

    // Handle drawing events
    socket.on('draw', async (data) => {
      // Broadcast to others in the same room
      socket.to(room).emit('draw', data);
      // Persist stroke
      if (useMongo) {
        const { strokeId } = data;
        await mongoAppendPoint(room, strokeId || 'legacy', data);
      } else {
        appendStroke(room, data);
      }
    });

    // Handle clear canvas sync
    socket.on('clear', async () => {
      socket.to(room).emit('clear');
      // Clear persisted strokes
      if (useMongo) await mongoClear(room); else saveStrokes(room, []);
    });

    // Undo last stroke (room-wide)
    socket.on('undo', async () => {
      let history = [];
      if (useMongo) history = await mongoUndo(room); else history = removeLastStroke(room);
      // Tell room to reset with new history
      io.to(room).emit('resetWithHistory', history);
    });

    // Apply a snapshot (broadcast reset to room)
    socket.on('applySnapshot', async (history) => {
      if (!Array.isArray(history)) return;
      // Replace current persistence with this history
      if (useMongo) {
        await mongoClear(room);
        // Re-insert as legacy (single stroke); simple approach
        for (const pt of history) {
          await mongoAppendPoint(room, 'snapshot', pt);
        }
      } else {
        saveStrokes(room, history);
      }
      io.to(room).emit('resetWithHistory', history);
    });

    // Live cursor updates (throttled client-side)
    socket.on('cursor', (data) => {
      // include sender id for client mapping
      socket.to(room).emit('cursor', { id: socket.id, ...data });
    });

    socket.on('disconnect', (reason) => {
      console.log('Client disconnected:', socket.id, 'reason:', reason);
      // Notify others to remove cursor
      socket.to(room).emit('cursor:left', { id: socket.id });
    });
  });

  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

init().catch(console.error);
