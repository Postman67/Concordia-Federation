#!/usr/bin/env node
/**
 * Generates an Ed25519 keypair for Federation token signing (EdDSA).
 *
 * Usage:
 *   node scripts/generate-keys.js
 *
 * Prints the private key in PKCS8 PEM (set as JWT_PRIVATE_KEY) and the
 * public key in SPKI PEM (informational — the public key is served to
 * other services via GET /.well-known/jwks.json, derived from the
 * private key at boot).
 *
 * For .env files, newlines in the PEM must be escaped as \n — the
 * single-line form is printed below the PEM blocks.
 */
const { generateKeyPairSync } = require('crypto');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem  = publicKey.export({ type: 'spki', format: 'pem' });

console.log('─── Private key (PKCS8 PEM) — keep secret ─────────────────────');
console.log(privatePem);
console.log('─── Public key (SPKI PEM) — served via JWKS ────────────────────');
console.log(publicPem);
console.log('─── .env single-line form ──────────────────────────────────────');
console.log(`JWT_PRIVATE_KEY="${privatePem.trim().replace(/\n/g, '\\n')}"`);
