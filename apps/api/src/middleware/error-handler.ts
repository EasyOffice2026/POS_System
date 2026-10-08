import { apiError } from '@pos/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(apiError('NOT_FOUND', 'Route not found'));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  console.error(err);
  res.status(500).json(apiError('INTERNAL_ERROR', 'Something went wrong'));
};
