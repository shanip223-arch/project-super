const crypto = require('crypto');

class AppError extends Error {
  constructor(status, errorCode, message, options = {}) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.retryAfter = options.retryAfter;
    this.details = options.details;
  }
}

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const attachTraceId = (req, res, next) => {
  const incoming = req.headers['x-trace-id'];
  req.traceId = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : crypto.randomUUID();
  res.setHeader('x-trace-id', req.traceId);
  next();
};

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error_code: 'NOT_FOUND',
    message: 'Resource not found.',
    trace_id: req.traceId
  });
};

const errorHandler = (err, req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    err.status = 400;
    err.errorCode = 'FILE_TOO_LARGE';
    err.message = 'Uploaded file exceeds 2MB limit.';
  }
  const status = err.status || 500;
  const payload = {
    success: false,
    error_code: err.errorCode || 'INTERNAL_SERVER_ERROR',
    message: status >= 500 ? 'Internal server error.' : err.message,
    trace_id: req.traceId
  };

  if (err.retryAfter) payload.retry_after = err.retryAfter;
  if (err.details && status < 500) payload.details = err.details;

  if (status >= 500) {
    console.error(`[${req.traceId}]`, err);
  }

  res.status(status).json(payload);
};

module.exports = {
  AppError,
  asyncHandler,
  attachTraceId,
  notFoundHandler,
  errorHandler
};
