const { validationResult } = require('express-validator');

/**
 * Runs after a chain of express-validator checks.
 * If any validation errors exist, immediately returns 400 with a clear list.
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

module.exports = { handleValidationErrors };
