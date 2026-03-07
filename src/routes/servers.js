const { Router }                 = require('express');
const { body, param }            = require('express-validator');
const { requireAuth }            = require('../middleware/requireAuth');
const { handleValidationErrors } = require('../middleware/validate');
const { getServers, addServer, updateServer, removeServer } = require('../controllers/serversController');

const router = Router();

const addRules = [
  body('server_address')
    .trim()
    .notEmpty()
    .withMessage('server_address is required.')
    .isLength({ max: 255 })
    .withMessage('server_address must be 255 characters or fewer.'),

  body('server_name')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('server_name must be 100 characters or fewer.'),
];

const updateRules = [
  param('id').isInt({ min: 1 }).withMessage('Invalid server id.'),

  body('server_name')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('server_name must be 100 characters or fewer.'),

  body('position')
    .optional()
    .isInt({ min: 0 })
    .withMessage('position must be a non-negative integer.'),
];

router.get('/',      requireAuth, getServers);
router.post('/',     requireAuth, addRules,    handleValidationErrors, addServer);
router.patch('/:id', requireAuth, updateRules, handleValidationErrors, updateServer);
router.delete('/:id',requireAuth, updateRules, handleValidationErrors, removeServer);

module.exports = router;
