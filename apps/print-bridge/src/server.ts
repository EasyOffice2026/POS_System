import { createBridgeServer } from './app';
import { config } from './config';

// Loopback only until terminal pairing and authentication are designed (Phase 2).
const server = createBridgeServer().listen(config.PRINT_BRIDGE_PORT, '127.0.0.1', () => {
  console.log(`Print bridge listening on http://127.0.0.1:${config.PRINT_BRIDGE_PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
