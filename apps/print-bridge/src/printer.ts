import { createConnection } from 'node:net';

export interface PrinterAddress {
  host: string;
  port: number;
}

// Sends bytes to a printer on the network, the way a network printer takes them: a plain TCP
// connection, the bytes, and the connection closed. The printer says nothing back. It fails
// in plain words when the printer cannot be reached or does not answer in time.
export function sendToPrinter(
  printer: PrinterAddress,
  data: Buffer,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const where = `${printer.host}:${printer.port}`;
    const socket = createConnection({ host: printer.host, port: printer.port });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setTimeout(timeoutMs, () => finish(new Error(`The printer at ${where} did not answer`)));
    socket.on('error', (error: NodeJS.ErrnoException) => {
      const why =
        error.code === 'ECONNREFUSED'
          ? 'refused the connection'
          : error.code === 'EHOSTUNREACH' || error.code === 'ENETUNREACH'
            ? 'cannot be reached'
            : error.code === 'ENOTFOUND'
              ? 'has an address that is not known'
              : (error.message ?? 'failed');
      finish(new Error(`The printer at ${where} ${why}`));
    });
    socket.on('connect', () => {
      socket.end(data, () => finish());
    });
  });
}
