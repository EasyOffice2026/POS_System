import { apiError, type HealthResponse } from '@pos/shared';
import { createServer, type Server, type ServerResponse } from 'node:http';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createBridgeServer(): Server {
  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const body: HealthResponse = { status: 'ok', service: 'print-bridge' };
      sendJson(res, 200, body);
      return;
    }
    sendJson(res, 404, apiError('NOT_FOUND', 'Route not found'));
  });
}
