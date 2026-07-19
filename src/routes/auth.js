const { Router }                  = require('express');
const { body }                    = require('express-validator');
const rateLimit                   = require('express-rate-limit');
const { handleValidationErrors }  = require('../middleware/validate');
const { requireAuth }             = require('../middleware/requireAuth');
const {
  register, login, refresh, logout, serverToken,
  requestEmailVerify, confirmEmailVerify,
  requestPasswordReset, confirmPasswordReset,
} = require('../controllers/authController');
const mfa = require('../controllers/mfaController');

const router = Router();

// ─── Rate limits ──────────────────────────────────────────────────────────────
// The Federation holds password hashes — credential endpoints get a tight
// per-IP budget on top of the per-account lockout in the controller.

const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,                       // 10 attempts / 15 min / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,                        // 5 emails / hour / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' },
});

// Token exchange happens every ~10 min per server — generous but bounded.
const exchangeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});

// ─── Validation chains ────────────────────────────────────────────────────────

const passwordRules = (field = 'password') => [
  body(field)
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long.')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter.')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number.'),
];

const registerRules = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be between 3 and 50 characters.')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username may only contain letters, numbers, underscores, or hyphens.'),

  body('email')
    .trim()
    .normalizeEmail()
    .isEmail()
    .withMessage('A valid email address is required.'),

  ...passwordRules(),
];

const loginRules = [
  body('email')
    .trim()
    .normalizeEmail()
    .isEmail()
    .withMessage('A valid email address is required.'),

  body('password')
    .notEmpty()
    .withMessage('Password is required.'),
];

const serverTokenRules = [
  body('server')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('A server address is required.'),
];

const resetRequestRules = [
  body('email')
    .trim()
    .normalizeEmail()
    .isEmail()
    .withMessage('A valid email address is required.'),
];

const resetConfirmRules = [
  body('token').notEmpty().withMessage('Token is required.'),
  ...passwordRules(),
];

// ─── Routes ───────────────────────────────────────────────────────────────────

router.post('/register', credentialLimiter, registerRules, handleValidationErrors, register);
router.post('/login',    credentialLimiter, loginRules,    handleValidationErrors, login);
router.post('/refresh',  credentialLimiter, refresh);
router.post('/logout',   requireAuth, logout);
router.post('/server-token', exchangeLimiter, requireAuth, serverTokenRules, handleValidationErrors, serverToken);

// Email verification
router.post('/verify-email/request', emailLimiter, requireAuth, requestEmailVerify);
router.post('/verify-email/confirm', credentialLimiter, confirmEmailVerify);

// Password reset
router.post('/password-reset/request', emailLimiter, resetRequestRules, handleValidationErrors, requestPasswordReset);
router.post('/password-reset/confirm', credentialLimiter, resetConfirmRules, handleValidationErrors, confirmPasswordReset);

// TOTP 2FA
router.post('/mfa/setup',   requireAuth, mfa.setup);
router.post('/mfa/enable',  requireAuth, body('code').notEmpty(), handleValidationErrors, mfa.enable);
router.post('/mfa/disable', requireAuth, body('code').notEmpty(), handleValidationErrors, mfa.disable);
router.post('/mfa/verify',  credentialLimiter, mfa.verify);

module.exports = router;
