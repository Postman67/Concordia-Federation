const { Router } = require('express');
const { body, param } = require('express-validator');
const requireAdmin = require('../middleware/requireAdmin');
const { handleValidationErrors } = require('../middleware/validate');
const { listUsers, getUser, updateUser, deleteUser, getStats } = require('../controllers/adminController');

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

module.exports = router;
