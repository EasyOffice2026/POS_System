import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const server = createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
