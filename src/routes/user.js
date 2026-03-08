const { Router }      = require('express');
const { param, body } = require('express-validator');
const { requireAuth } = require('../middleware/requireAuth');
const { handleValidationErrors } = require('../middleware/validate');
const { getMe, setStatus, heartbeat, getStatus } = require('../controllers/userController');

const router = Router();

router.get('/me', requireAuth, getMe);

router.put(
  '/status',
  requireAuth,
  [body('status').notEmpty().withMessage('status is required.')],
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
