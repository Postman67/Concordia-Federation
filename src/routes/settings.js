const { Router }                 = require('express');
const { body }                   = require('express-validator');
const { requireAuth }            = require('../middleware/requireAuth');
const { handleValidationErrors } = require('../middleware/validate');
const { getSettings, updateSettings } = require('../controllers/settingsController');

const router = Router();

const updateRules = [
  body('display_name')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Display name must be 100 characters or fewer.'),

  body('avatar_url')
    .optional()
    .trim()
    .isURL()
    .withMessage('avatar_url must be a valid URL.'),

  body('theme')
    .optional()
    .isIn(['dark', 'light'])
    .withMessage('theme must be "dark" or "light".'),
];

router.get('/',  requireAuth, getSettings);
router.put('/',  requireAuth, updateRules, handleValidationErrors, updateSettings);

module.exports = router;
