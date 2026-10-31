import { PNG } from 'pngjs';

// Turns the picture of a receipt into what an ESC/POS printer takes: the printer reset, the
// picture in bands of raster bits, paper fed out and cut. The same bytes work on the Epson,
// Xprinter, Sunmi and other 80 mm printers that follow ESC/POS over port 9100.

const ESC = 0x1b;
const GS = 0x1d;
// Rows per band: a whole receipt in one command overruns the buffer of some printers.
const BAND_ROWS = 256;
// Darker than this is ink. Anti-aliased edges of the text fall on the ink side.
const INK_BELOW = 160;

export interface Bitmap {
  width: number;
  height: number;
  // One bit per dot, rows of ceil(width / 8) bytes, the leftmost dot in the high bit.
  rows: Buffer;
  bytesPerRow: number;
}

// A PNG (any colours, with or without transparency) as black dots on white.
export function bitmapFromPng(png: Buffer): Bitmap {
  const image = PNG.sync.read(png);
  const bytesPerRow = Math.ceil(image.width / 8);
  const rows = Buffer.alloc(bytesPerRow * image.height);

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const at = (y * image.width + x) * 4;
      const alpha = image.data[at + 3] ?? 0;
      // What shows over white paper.
      const r = image.data[at] ?? 0;
      const g = image.data[at + 1] ?? 0;
      const b = image.data[at + 2] ?? 0;
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) * (alpha / 255) + 255 * (1 - alpha / 255);
      if (luma < INK_BELOW) {
        const index = y * bytesPerRow + (x >> 3);
        rows[index] = (rows[index] ?? 0) | (0x80 >> (x & 7));
      }
    }
  }
  return { width: image.width, height: image.height, rows, bytesPerRow };
}

// GS v 0: one band of raster bits.
function rasterBand(bitmap: Bitmap, from: number, count: number): Buffer {
  const header = Buffer.from([
    GS,
    0x76,
    0x30,
    0x00,
    bitmap.bytesPerRow & 0xff,
    (bitmap.bytesPerRow >> 8) & 0xff,
    count & 0xff,
    (count >> 8) & 0xff,
  ]);
  const start = from * bitmap.bytesPerRow;
  return Buffer.concat([header, bitmap.rows.subarray(start, start + count * bitmap.bytesPerRow)]);
}

export function escposFromBitmap(bitmap: Bitmap): Buffer {
  const parts: Buffer[] = [
    // Reset, then left-aligned.
    Buffer.from([ESC, 0x40, ESC, 0x61, 0x00]),
  ];
  for (let from = 0; from < bitmap.height; from += BAND_ROWS) {
    parts.push(rasterBand(bitmap, from, Math.min(BAND_ROWS, bitmap.height - from)));
  }
  // Feed four lines, then cut (GS V 66: feed to the cutter and cut, leaving the paper attached
  // on one side so a hand tears it off).
  parts.push(Buffer.from([ESC, 0x64, 0x04, GS, 0x56, 0x42, 0x00]));
  return Buffer.concat(parts);
}

export const escposFromPng = (png: Buffer): Buffer => escposFromBitmap(bitmapFromPng(png));
