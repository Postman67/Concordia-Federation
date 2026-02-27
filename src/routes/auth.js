const { Router }                  = require('express');
const { body }                    = require('express-validator');
const { handleValidationErrors }  = require('../middleware/validate');
const { register, login }         = require('../controllers/authController');

const router = Router();

// ─── Validation chains ────────────────────────────────────────────────────────

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

  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long.')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter.')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number.'),
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

// ─── Routes ───────────────────────────────────────────────────────────────────

router.post('/register', registerRules, handleValidationErrors, register);
router.post('/login',    loginRules,    handleValidationErrors, login);

module.exports = router;
