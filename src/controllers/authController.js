const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const pool     = require('../config/db');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;

// ─── Helper ─────────────────────────────────────────────────────────────────

function signToken(userId) {
  return jwt.sign(
    { sub: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────

async function register(req, res) {
  const { username, email, password } = req.body;

  try {
    // Check for existing username or email in one query
    const existing = await pool.query(
      'SELECT id, username, email FROM users WHERE username = $1 OR email = $2 LIMIT 1',
      [username, email]
    );

    if (existing.rowCount > 0) {
      const taken = existing.rows[0];
      const field = taken.username === username ? 'username' : 'email';
      return res.status(409).json({ error: `That ${field} is already in use.` });
    }

    // Hash password — never store plaintext
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username, email, passwordHash]
    );

    const user  = result.rows[0];
    const token = signToken(user.id);

    return res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: {
        id:         user.id,
        username:   user.username,
        email:      user.email,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error('register error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// ─── POST /api/auth/login ────────────────────────────────────────────────────

async function login(req, res) {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT id, username, email, password_hash FROM users WHERE email = $1 LIMIT 1',
      [email]
    );

    if (result.rowCount === 0) {
      // Use the same message for both "no account" and "wrong password" to
      // avoid leaking which emails are registered (user enumeration).
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = signToken(user.id);

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        id:       user.id,
        username: user.username,
        email:    user.email,
      },
    });
  } catch (err) {
    console.error('login error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = { register, login };
