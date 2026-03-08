const { Router } = require('express');
const { requireInternal } = require('../middleware/requireInternal');
const { searchUsers, getUserById } = require('../controllers/internalController');

const router = Router();

// All routes require the shared internal key
router.use(requireInternal);

// GET /api/internal/users/search?q=<prefix>
router.get('/users/search', searchUsers);

// GET /api/internal/users/:id
router.get('/users/:id', getUserById);

module.exports = router;
