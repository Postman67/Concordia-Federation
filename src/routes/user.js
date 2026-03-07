const { Router }      = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { getMe }       = require('../controllers/userController');

const router = Router();

router.get('/me', requireAuth, getMe);

module.exports = router;
