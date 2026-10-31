import { z } from 'zod';
import { localizedTextSchema } from './localized';
import { printerKindSchema, printerSchema } from './branch-config';

// Printing without the browser (docs/specs/028-print-bridge.md): the till draws the receipt or
// the slip as a picture and leaves it for the branch's print bridge, which sends it to the
// printer.

// What is printed. A bill and a receipt go to a receipt printer, a slip to a kitchen printer.
export const printJobKinds = ['receipt', 'bill', 'kitchen'] as const;
export const printJobKindSchema = z.enum(printJobKinds);
export type PrintJobKind = z.infer<typeof printJobKindSchema>;

export const printJobStatuses = ['queued', 'printing', 'done', 'failed'] as const;
export const printJobStatusSchema = z.enum(printJobStatuses);
export type PrintJobStatus = z.infer<typeof printJobStatusSchema>;

// The printer kind a job needs.
export const printerKindFor = (kind: PrintJobKind) => (kind === 'kitchen' ? 'kitchen' : 'receipt');

// The picture: a PNG, as wide as the paper of an 80 mm printer (576 dots), black on white.
export const PRINT_IMAGE_WIDTH = 576;
export const MAX_PRINT_IMAGE_BYTES = 400_000;
// How many times the bridge may take the same job before it is given up (a bridge that stops
// in the middle of a job leaves it "printing"; after this long it is offered again).
export const PRINT_JOB_MAX_ATTEMPTS = 3;
export const PRINT_JOB_STALE_SECONDS = 60;
// After this long a job that is still queued is reported to the cashier as not printed.
export const PRINT_JOB_WAIT_SECONDS = 30;

const imageField = z
  .string()
  .min(1, 'PRINT_IMAGE_REQUIRED')
  .max(Math.ceil((MAX_PRINT_IMAGE_BYTES * 4) / 3) + 4, 'PRINT_IMAGE_TOO_LARGE')
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'PRINT_IMAGE_INVALID');

export const createPrintJobRequestSchema = z.strictObject({
  branchId: z.uuid(),
  printerId: z.uuid(),
  kind: printJobKindSchema,
  orderNumber: z.number().int().min(1).optional(),
  // The PNG, base64.
  image: imageField,
});
export type CreatePrintJobRequest = z.infer<typeof createPrintJobRequestSchema>;

export const printJobSchema = z.object({
  id: z.uuid(),
  branchId: z.uuid(),
  printerId: z.uuid(),
  printerName: z.string(),
  kind: printJobKindSchema,
  status: printJobStatusSchema,
  orderNumber: z.number().int().nullable(),
  attempts: z.number().int(),
  // Why it failed, in plain words from the bridge.
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type PrintJob = z.infer<typeof printJobSchema>;

// A job as the bridge takes it: with the picture and the printer's address.
export const bridgePrintJobSchema = printJobSchema.extend({
  image: imageField,
  printer: z.object({ host: z.string(), port: z.number().int() }),
});
export type BridgePrintJob = z.infer<typeof bridgePrintJobSchema>;

export const failPrintJobRequestSchema = z.strictObject({
  error: z.string().trim().min(1, 'PRINT_ERROR_REQUIRED').max(500, 'PRINT_ERROR_TOO_LONG'),
});

// What the bridge learns about itself when it starts.
export const printBridgeInfoSchema = z.object({
  branchId: z.uuid(),
  branchName: localizedTextSchema,
  printers: z.array(printerSchema),
});
export type PrintBridgeInfo = z.infer<typeof printBridgeInfoSchema>;

// The key of a branch's bridge, made on the Printers tab. The key itself is shown once.
export const PRINT_BRIDGE_KEY_PREFIX = 'pb_';
export const printBridgeKeySchema = z.object({
  key: z.string().startsWith(PRINT_BRIDGE_KEY_PREFIX),
  createdAt: z.iso.datetime(),
});
export type PrintBridgeKey = z.infer<typeof printBridgeKeySchema>;

export const printBridgeKeyInfoSchema = z.object({
  // When the branch's key was made, or null when it has none yet.
  createdAt: z.iso.datetime().nullable(),
});
export type PrintBridgeKeyInfo = z.infer<typeof printBridgeKeyInfoSchema>;

// The printers of a branch as its till sees them: enough to pick one for a job.
export const menuPrinterSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: printerKindSchema,
});
export type MenuPrinter = z.infer<typeof menuPrinterSchema>;
