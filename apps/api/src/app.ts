import express from 'express';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { healthRouter } from './modules/health/health.router';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use('/api/v1/health', healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
