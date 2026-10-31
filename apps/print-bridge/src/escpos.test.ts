import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { bitmapFromPng, escposFromBitmap, escposFromPng } from './escpos';

// A PNG of the size given, white, with the dots listed painted black (or in the colour given).
function picture(width: number, height: number, dots: [number, number, number?][]): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(255);
  for (const [x, y, grey = 0] of dots) {
    const at = (y * width + x) * 4;
    png.data[at] = grey;
    png.data[at + 1] = grey;
    png.data[at + 2] = grey;
    png.data[at + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe('the picture as printer dots', () => {
  it('packs eight dots to a byte, the leftmost in the high bit, rows padded to whole bytes', () => {
    const bitmap = bitmapFromPng(
      picture(10, 2, [
        [0, 0],
        [7, 0],
        [9, 0],
        [3, 1],
      ]),
    );

    expect(bitmap).toMatchObject({ width: 10, height: 2, bytesPerRow: 2 });
    expect([...bitmap.rows]).toEqual([0b1000_0001, 0b0100_0000, 0b0001_0000, 0b0000_0000]);
  });

  it('counts grey text edges as ink, and light grey as paper', () => {
    const bitmap = bitmapFromPng(
      picture(8, 1, [
        [0, 0, 100],
        [1, 0, 200],
      ]),
    );

    expect([...bitmap.rows]).toEqual([0b1000_0000]);
  });

  it('treats what is transparent as white paper', () => {
    const png = new PNG({ width: 8, height: 1 });
    png.data.fill(0);
    png.data[3] = 255;
    const bitmap = bitmapFromPng(PNG.sync.write(png));

    expect([...bitmap.rows]).toEqual([0b1000_0000]);
  });
});

describe('the bytes sent to the printer', () => {
  it('resets the printer, sends the raster bands, feeds and cuts', () => {
    const data = escposFromPng(picture(16, 3, [[0, 1]]));

    // ESC @ (reset), ESC a 0 (left).
    expect([...data.subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x00]);
    // GS v 0 0, width in bytes (2), height in rows (3), then 2 bytes a row.
    expect([...data.subarray(5, 13)]).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 3, 0]);
    expect([...data.subarray(13, 19)]).toEqual([0, 0, 0x80, 0, 0, 0]);
    // ESC d 4 (feed), GS V 66 0 (cut).
    expect([...data.subarray(19)]).toEqual([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00]);
  });

  it('splits a tall picture into bands of 256 rows', () => {
    const bitmap = { width: 8, height: 600, bytesPerRow: 1, rows: Buffer.alloc(600) };

    const data = escposFromBitmap(bitmap);

    const bands: number[] = [];
    for (let at = 0; at + 8 <= data.length; at++) {
      if (data[at] === 0x1d && data[at + 1] === 0x76 && data[at + 2] === 0x30) {
        bands.push((data[at + 6] ?? 0) + ((data[at + 7] ?? 0) << 8));
      }
    }
    expect(bands).toEqual([256, 256, 88]);
    expect(data.length).toBe(5 + 3 * 8 + 600 + 7);
  });
});
