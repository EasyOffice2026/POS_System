import { createApp } from './app';
import { config } from './config';

const server = createApp().listen(config.API_PORT, () => {
  console.log(`API listening on http://localhost:${config.API_PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
