/**
 * Federation signing keys (EdDSA / Ed25519).
 *
 * The private key lives in the JWT_PRIVATE_KEY env var as a PKCS8 PEM
 * (newlines may be escaped as \n for .env files). The public half is
 * derived at boot and published as a JWKS document via
 * GET /.well-known/jwks.json so Server and Social instances can verify
 * tokens locally — no shared secrets, no introspection round-trips.
 *
 * Generate a keypair with: node scripts/generate-keys.js
 */
const { createPrivateKey, createPublicKey } = require('crypto');
const { exportJWK, calculateJwkThumbprint } = require('jose');

let cached = null;

async function getKeys() {
  if (cached) return cached;

  const raw = process.env.JWT_PRIVATE_KEY;
  if (!raw) {
    throw new Error(
      'JWT_PRIVATE_KEY is not set. Generate one with: node scripts/generate-keys.js'
    );
  }

  // .env files often store the PEM on one line with literal \n sequences.
  const pem = raw.replace(/\\n/g, '\n');

  const privateKey = createPrivateKey(pem);
  const publicKey  = createPublicKey(privateKey);

  const publicJwk = await exportJWK(publicKey);
  // RFC 7638 thumbprint — a stable key id that changes iff the key changes.
  const kid = await calculateJwkThumbprint(publicJwk);

  publicJwk.kid = kid;
  publicJwk.alg = 'EdDSA';
  publicJwk.use = 'sig';

  cached = {
    privateKey,
    kid,
    jwks: { keys: [publicJwk] },
  };
  return cached;
}

module.exports = { getKeys };
