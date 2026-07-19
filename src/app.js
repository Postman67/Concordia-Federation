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
const internalRoutes = require('./routes/internal');
const { track }      = require('./metrics/responseTime');
const { getKeys }    = require('./config/keys');

const rateLimit  = require('express-rate-limit');

const app        = express();
const httpServer = http.createServer(app);
const PORT       = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

// Behind Railway/NGINX — required for express-rate-limit to see client IPs.
app.set('trust proxy', 1);

// CORS: comma-separated allowlist via CORS_ORIGINS. Unset = permissive with a
// loud warning (dev convenience only — set it in production).
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

if (corsOrigins.length > 0) {
  app.use(cors({ origin: corsOrigins }));
} else {
  console.warn('[cors] CORS_ORIGINS not set — allowing all origins. Set it in production.');
  app.use(cors());
}

app.use(express.json());

// Global API budget (endpoint-specific limits live in the route files).
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ─── Dashboard + account pages (static) ───────────────────────────────────────

app.use('/dashboard', express.static(path.join(__dirname, '../public/dashboard')));
app.use('/account',   express.static(path.join(__dirname, '../public/account')));

// ─── Routes ───────────────────────────────────────────────────────────────────

// Public signing keys (JWKS) — Server and Social instances fetch this to
// verify Federation-issued tokens locally. Cacheable; key rotation appends
// a new key here while old tokens finish expiring.
app.get('/.well-known/jwks.json', async (_req, res) => {
  try {
    const { jwks } = await getKeys();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(jwks);
  } catch (err) {
    console.error('jwks error:', err.message);
    res.status(500).json({ error: 'Signing keys unavailable.' });
  }
});

app.use('/api/auth',     track('/api/auth'),     authRoutes);
app.use('/api/user',     track('/api/user'),     userRoutes);
app.use('/api/settings', track('/api/settings'), settingsRoutes);
app.use('/api/servers',  track('/api/servers'),  serversRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/internal', internalRoutes);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// 404 catch-all
app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  // Load signing keys before accepting traffic — fail fast on bad config
  try {
    const { kid } = await getKeys();
    console.log(`Signing keys loaded (kid=${kid}).`);
  } catch (err) {
    console.error('Failed to load signing keys:', err.message);
    process.exit(1);
  }

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
