const { Router } = require('express');
const { body, param } = require('express-validator');
const { requireAdmin } = require('../middleware/requireAdmin');
const { handleValidationErrors } = require('../middleware/validate');
const { listUsers, getUser, updateUser, deleteUser, getStats, broadcastNotice, getMetrics, getMetricsHistory, listActiveSessions } = require('../controllers/adminController');

const router = Router();

// All routes require admin JWT
router.use(requireAdmin);

// GET /api/admin/stats
router.get('/stats', getStats);

// GET /api/admin/users
router.get('/users', listUsers);

// GET /api/admin/users/:id
router.get(
  '/users/:id',
  [param('id').isUUID().withMessage('Invalid user ID.')],
  handleValidationErrors,
  getUser
);

// PATCH /api/admin/users/:id
router.patch(
  '/users/:id',
  [
    param('id').isUUID().withMessage('Invalid user ID.'),
    body('username').optional().isLength({ min: 3, max: 50 }).withMessage('Username must be 3–50 characters.'),
    body('email').optional().isEmail().withMessage('Invalid email address.'),
    body('display_name').optional().isLength({ max: 100 }).withMessage('Display name too long.'),
    body('avatar_url').optional().isURL().withMessage('Invalid avatar URL.'),
    body('theme').optional().isIn(['dark', 'light']).withMessage('Theme must be dark or light.'),
    body('status').optional().isIn(['online', 'idle', 'dnd', 'invisible', 'offline']).withMessage('Invalid status value.'),
  ],
  handleValidationErrors,
  updateUser
);

// DELETE /api/admin/users/:id
router.delete(
  '/users/:id',
  [param('id').isUUID().withMessage('Invalid user ID.')],
  handleValidationErrors,
  deleteUser
);

// POST /api/admin/notice — broadcast a federation-wide message to all connected sockets
router.post(
  '/notice',
  [
    body('message').notEmpty().isLength({ max: 500 }).withMessage('Message is required and must be under 500 chars.'),
    body('severity').optional().isIn(['info', 'warning', 'critical']).withMessage('severity must be info, warning, or critical.'),
  ],
  handleValidationErrors,
  broadcastNotice
);

// GET /api/admin/metrics — live snapshot
router.get('/metrics', getMetrics);

// GET /api/admin/metrics/history — daily breakdown (?days=7, max 90)
router.get('/metrics/history', getMetricsHistory);

// GET /api/admin/sessions — currently active WebSocket sessions
router.get('/sessions', listActiveSessions);

module.exports = router;
