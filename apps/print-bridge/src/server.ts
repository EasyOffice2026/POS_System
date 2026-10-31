import { createBridgeServer } from './app';
import { createBridge } from './bridge';
import { config } from './config';

// The health check, on this computer only.
const server = createBridgeServer().listen(config.PRINT_BRIDGE_PORT, '127.0.0.1', () => {
  console.log(`Print bridge listening on http://127.0.0.1:${config.PRINT_BRIDGE_PORT}`);
});

// The bridge itself (docs/specs/028-print-bridge.md): with the key of its branch, it takes the
// jobs the tills leave and sends them to the printers.
const bridge = config.PRINT_BRIDGE_KEY
  ? createBridge({
      apiUrl: config.POS_API_URL,
      key: config.PRINT_BRIDGE_KEY,
      printerTimeoutMs: config.PRINTER_TIMEOUT_MS,
    })
  : null;
if (bridge) {
  console.log(`Printing for ${config.POS_API_URL}`);
  void bridge.run();
} else {
  console.log(
    'PRINT_BRIDGE_KEY is not set: nothing is printed. Make a key on the branch’s Printers tab.',
  );
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    bridge?.stop();
    server.close(() => process.exit(0));
  });
}
