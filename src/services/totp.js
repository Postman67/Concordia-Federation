/**
 * Minimal RFC 6238 TOTP (SHA-1, 6 digits, 30-second step) using node:crypto.
 * Compatible with Google Authenticator, Authy, 1Password, etc.
 */
const { createHmac, randomBytes, timingSafeEqual } = require('crypto');

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ─── Base32 (RFC 4648, no padding) ───────────────────────────────────────────

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ─── TOTP ─────────────────────────────────────────────────────────────────────

function generateSecret() {
  return base32Encode(randomBytes(20)); // 160-bit, RFC 4226 recommendation
}

function hotp(secretBuf, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secretBuf).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Verifies a 6-digit code against the secret, tolerating ±1 time step
 * (clock skew). Constant-time comparison.
 */
function verifyCode(secret, code) {
  if (!/^\d{6}$/.test(String(code))) return false;
  const secretBuf = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  const supplied = Buffer.from(String(code));
  for (const c of [counter, counter - 1, counter + 1]) {
    const expected = Buffer.from(hotp(secretBuf, c));
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) {
      return true;
    }
  }
  return false;
}

/** otpauth:// provisioning URI — feed to a QR generator or paste manually. */
function provisioningUri(secret, accountName, issuer = 'Concordia') {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

module.exports = { generateSecret, verifyCode, provisioningUri };
