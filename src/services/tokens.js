/**
 * Token service — mints and verifies all Federation-issued JWTs.
 *
 * Two token types, both EdDSA-signed (see config/keys.js):
 *
 *  Identity token   aud: ['concordia:federation', 'concordia:social']
 *    Issued by /api/auth/register and /api/auth/login. Used ONLY against
 *    first-party services (Federation REST + socket, Social REST + socket).
 *    Never send this token to a chat server.
 *
 *  Server token     aud: '<normalized server origin>'   ttl: 10 minutes
 *    Issued by /api/auth/server-token in exchange for an identity token.
 *    Scoped to a single chat server: the server verifies the signature
 *    against the Federation JWKS and rejects any token whose `aud` is not
 *    its own configured public origin. A malicious server owner who
 *    harvests one of these can do nothing with it anywhere else, and it
 *    dies within minutes.
 *
 * Every token carries a `jti` so the Phase-2 revocation list can slot in
 * without another format change.
 */
const { randomUUID } = require('crypto');
const { SignJWT, jwtVerify } = require('jose');
const { getKeys } = require('../config/keys');

const AUD_FEDERATION = 'concordia:federation';
const AUD_SOCIAL     = 'concordia:social';
const AUD_MFA        = 'concordia:mfa';

// Short-lived now that refresh tokens exist (was 7d pre-rotation).
const IDENTITY_TTL = process.env.JWT_EXPIRES_IN || '1h';
const SERVER_TOKEN_TTL_SECONDS = parseInt(process.env.SERVER_TOKEN_TTL, 10) || 600;
const MFA_TOKEN_TTL = '5m';

// Issuer claim — the Federation's public origin.
function issuer() {
  return normalizeOrigin(process.env.PUBLIC_URL || 'https://federation.concordiachat.com');
}

/**
 * Normalizes a server address to a canonical origin used as the `aud` claim:
 * lowercase scheme+host, default ports stripped, no path/trailing slash.
 * Accepts bare hosts ("chat.example.com") by assuming https.
 * Throws on anything that isn't a valid http(s) address.
 */
function normalizeOrigin(input) {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withScheme);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Server address must be http or https.');
  }
  return url.origin.toLowerCase();
}

// ─── Minting ─────────────────────────────────────────────────────────────────

async function signIdentityToken(userId) {
  const { privateKey, kid } = await getKeys();
  return new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA', kid })
    .setSubject(String(userId))
    .setAudience([AUD_FEDERATION, AUD_SOCIAL])
    .setIssuer(issuer())
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(IDENTITY_TTL)
    .sign(privateKey);
}

/**
 * Mints a short-lived token scoped to a single chat server.
 * `profile` (username / avatar_url) is embedded so servers can render the
 * member without calling back into the Federation.
 */
async function signServerToken(userId, serverAddress, profile = {}) {
  const { privateKey, kid } = await getKeys();
  const audience = normalizeOrigin(serverAddress);

  const token = await new SignJWT({
    preferred_username: profile.username ?? null,
    avatar_url:         profile.avatar_url ?? null,
  })
    .setProtectedHeader({ alg: 'EdDSA', kid })
    .setSubject(String(userId))
    .setAudience(audience)
    .setIssuer(issuer())
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SERVER_TOKEN_TTL_SECONDS}s`)
    .sign(privateKey);

  return { token, audience, expiresIn: SERVER_TOKEN_TTL_SECONDS };
}

/**
 * Interim token minted when a password checks out but TOTP 2FA is still
 * pending. Only /api/auth/mfa/verify accepts it; it grants nothing else.
 */
async function signMfaToken(userId) {
  const { privateKey, kid } = await getKeys();
  return new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA', kid })
    .setSubject(String(userId))
    .setAudience(AUD_MFA)
    .setIssuer(issuer())
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(MFA_TOKEN_TTL)
    .sign(privateKey);
}

// ─── Verification (Federation-side) ──────────────────────────────────────────

/**
 * Verifies an identity token locally and returns its payload.
 * Rejects server-scoped tokens: their `aud` is a server origin, so a
 * harvested server token can never be replayed against the Federation.
 */
async function verifyIdentityToken(token) {
  const { jwks } = await getKeys();
  // Local key set — same shape createRemoteJWKSet consumes on other services.
  const { createLocalJWKSet } = require('jose');
  const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
    algorithms: ['EdDSA'],
    audience: AUD_FEDERATION,
    issuer: issuer(),
  });
  return payload;
}

async function verifyMfaToken(token) {
  const { jwks } = await getKeys();
  const { createLocalJWKSet } = require('jose');
  const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
    algorithms: ['EdDSA'],
    audience: AUD_MFA,
    issuer: issuer(),
  });
  return payload;
}

module.exports = {
  AUD_FEDERATION,
  AUD_SOCIAL,
  AUD_MFA,
  normalizeOrigin,
  signIdentityToken,
  signServerToken,
  signMfaToken,
  verifyIdentityToken,
  verifyMfaToken,
};
