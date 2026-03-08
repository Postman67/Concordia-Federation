const { Router }      = require('express');
const { param, body } = require('express-validator');
const { requireAuth } = require('../middleware/requireAuth');
const { handleValidationErrors } = require('../middleware/validate');
const { getMe, setStatus, heartbeat, getStatus } = require('../controllers/userController');

const router = Router();

router.get('/me', requireAuth, getMe);

const VALID_DURATIONS = ['15m', '1h', '8h', '24h', '48h', '3d', 'never'];

router.put(
  '/status',
  requireAuth,
  [
    body('status').notEmpty().withMessage('status is required.'),
    body('custom_status')
      .optional({ nullable: true })
      .isLength({ max: 100 })
      .withMessage('custom_status must be 100 characters or fewer.'),
    body('custom_status_duration')
      .optional({ nullable: true })
      .isIn(VALID_DURATIONS)
      .withMessage(`custom_status_duration must be one of: ${VALID_DURATIONS.join(', ')}.`),
  ],
  handleValidationErrors,
  setStatus
);

router.post('/heartbeat', requireAuth, heartbeat);

router.get(
  '/status/:id',
  requireAuth,
  [param('id').isUUID().withMessage('Invalid user ID.')],
  handleValidationErrors,
  getStatus
);

module.exports = router;
