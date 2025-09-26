import mongoose from 'mongoose';

// Error handler middleware
export const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  console.error('Error:', err);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: 404 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = { message, statusCode: 400 };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { message, statusCode: 400 };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { message, statusCode: 401 };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { message, statusCode: 401 };
  }

  // Yup validation errors
  if (err.name === 'ValidationError' && err.inner) {
    const errors = err.inner.map(e => ({
      field: e.path,
      message: e.message
    }));
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  // Rate limit errors
  if (err.statusCode === 429) {
    return res.status(429).json({
      success: false,
      message: err.message || 'Too many requests',
      retryAfter: err.retryAfter
    });
  }

  // Ethereum/blockchain errors
  if (err.code === 'NETWORK_ERROR' || err.code === 'SERVER_ERROR') {
    const message = 'Blockchain network error';
    error = { message, statusCode: 503 };
  }

  if (err.code === 'INSUFFICIENT_FUNDS') {
    const message = 'Insufficient funds for transaction';
    error = { message, statusCode: 400 };
  }

  if (err.code === 'UNPREDICTABLE_GAS_LIMIT') {
    const message = 'Cannot estimate gas for transaction';
    error = { message, statusCode: 400 };
  }

  // Default error
  const statusCode = error.statusCode || err.statusCode || 500;
  const message = error.message || 'Internal server error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

// 404 handler
export const notFound = (req, res, next) => {
  const error = new Error(`Not found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

// Async error handler wrapper
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};