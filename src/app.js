require('dotenv').config();

const http       = require('http');
const path       = require('path');
const express    = require('express');
const cors       = require('cors');
const pool       = require('./config/db');
const socketServer = require('./socket/index');
const authRoutes     = require('./routes/auth');
const userRoutes     = require('./routes/user');
const settingsRoutes = require('./routes/settings');
const serversRoutes  = require('./routes/servers');
const adminRoutes    = require('./routes/admin');
const { track }      = require('./metrics/responseTime');

const app        = express();
const httpServer = http.createServer(app);
const PORT       = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ─── Dashboard (static) ───────────────────────────────────────────────────────

app.use('/dashboard', express.static(path.join(__dirname, '../public/dashboard')));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/auth',     track('/api/auth'),     authRoutes);
app.use('/api/user',     track('/api/user'),     userRoutes);
app.use('/api/settings', track('/api/settings'), settingsRoutes);
app.use('/api/servers',  track('/api/servers'),  serversRoutes);
app.use('/api/admin',    adminRoutes);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// 404 catch-all
app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  // Verify DB connection before accepting traffic
  try {
    await pool.query('SELECT 1');
    console.log('PostgreSQL connected.');
  } catch (err) {
    console.error('Failed to connect to PostgreSQL:', err.message);
    process.exit(1);
  }

  // Attach Socket.io to the http server
  socketServer.init(httpServer);

  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  });
}

start();
