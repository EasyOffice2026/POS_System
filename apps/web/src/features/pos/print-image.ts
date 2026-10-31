import { PRINT_IMAGE_WIDTH } from '@pos/shared';
import {
  type PrintDocument,
  type PrintLine,
  type PrintSize,
  type PrintText,
} from './print-document';

// The receipt or the slip as a picture for the printer (docs/specs/028-print-bridge.md, rule 2),
// drawn by the browser itself so Arabic is shaped and joined the same way as on the screen, on
// any printer. Black text on white, as wide as the paper of an 80 mm printer.

export interface RenderOptions {
  direction: 'ltr' | 'rtl';
  width?: number;
}

const MARGIN = 16;
const INDENT = 28;
const LINE_HEIGHT = 1.3;
const RULE_HEIGHT = 18;
const GAP_HEIGHT = 14;
// The font sizes in dots: paper is read from further away than a screen.
const fontSize: Record<PrintSize, number> = { xs: 22, sm: 26, md: 30, lg: 36, xl: 48 };
const FONT_FAMILY = '"IBM Plex Sans", "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif';

// A piece written left to right stays so inside an Arabic line (an isolate, as <bdi> does).
function plain(text: PrintText): string {
  return typeof text === 'string'
    ? text
    : text.map((piece) => (typeof piece === 'string' ? piece : `⁦${piece.ltr}⁩`)).join('');
}

function font(size: PrintSize, bold: boolean): string {
  return `${bold ? '600' : '400'} ${fontSize[size]}px ${FONT_FAMILY}`;
}

// Breaks a text into lines that fit: at spaces, and inside a word only when the word alone is
// too wide. The first line may be narrower (a row keeps room for its amount).
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  firstWidth = width,
): string[] {
  const lines: string[] = [];
  let current = '';
  const limit = () => (lines.length === 0 ? firstWidth : width);
  const fits = (candidate: string) => ctx.measureText(candidate).width <= limit();

  for (const word of text.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    // The word alone, broken inside when even that is too wide.
    let piece = '';
    for (const char of word) {
      if (fits(piece + char)) piece += char;
      else {
        if (piece) lines.push(piece);
        piece = char;
      }
    }
    current = piece;
  }
  lines.push(current);
  return lines;
}

interface Placed {
  line: PrintLine;
  y: number;
  height: number;
  // The wrapped text of a text line, or the start text of a row.
  parts: string[];
  endText?: string;
}

function layout(ctx: CanvasRenderingContext2D, document: PrintDocument, width: number): Placed[] {
  const placed: Placed[] = [];
  let y = MARGIN;
  const content = width - 2 * MARGIN;

  for (const line of document.lines) {
    if (line.kind === 'rule') {
      placed.push({ line, y, height: RULE_HEIGHT, parts: [] });
      y += RULE_HEIGHT;
      continue;
    }
    if (line.kind === 'gap') {
      placed.push({ line, y, height: GAP_HEIGHT, parts: [] });
      y += GAP_HEIGHT;
      continue;
    }
    const size = line.size ?? 'sm';
    ctx.font = font(size, Boolean(line.bold));
    const step = Math.round(fontSize[size] * LINE_HEIGHT);
    if (line.kind === 'row') {
      const endText = plain(line.end);
      const endWidth = ctx.measureText(endText).width;
      const parts = wrap(ctx, plain(line.start), content, content - endWidth - 12);
      placed.push({ line, y, height: step * parts.length, parts, endText });
      y += step * parts.length;
      continue;
    }
    const available = content - (line.indent ? INDENT : 0);
    const text = line.upper ? plain(line.text).toUpperCase() : plain(line.text);
    const parts = wrap(ctx, text, available);
    placed.push({ line, y, height: step * parts.length, parts });
    y += step * parts.length;
  }
  return placed;
}

// Draws the document and answers the PNG, base64, ready for the API.
export async function renderPrintImage(
  document: PrintDocument,
  { direction, width = PRINT_IMAGE_WIDTH }: RenderOptions,
): Promise<string> {
  // The fonts the page uses, so the picture does not fall back to another while they load.
  await window.document.fonts?.ready;

  const canvas = window.document.createElement('canvas');
  const probe = canvas.getContext('2d');
  if (!probe) throw new Error('This browser cannot draw the receipt');
  probe.direction = direction;
  const placed = layout(probe, document, width);
  const height = (placed.at(-1)?.y ?? MARGIN) + (placed.at(-1)?.height ?? 0) + MARGIN;

  canvas.width = width;
  canvas.height = Math.max(height, 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the receipt');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.direction = direction;
  ctx.textBaseline = 'top';

  const rtl = direction === 'rtl';
  const startX = rtl ? width - MARGIN : MARGIN;
  const endX = rtl ? MARGIN : width - MARGIN;
  const inward = (x: number, by: number) => (rtl ? x - by : x + by);

  for (const item of placed) {
    const { line } = item;
    if (line.kind === 'rule') {
      ctx.save();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(MARGIN, item.y + RULE_HEIGHT / 2);
      ctx.lineTo(width - MARGIN, item.y + RULE_HEIGHT / 2);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    if (line.kind === 'gap') continue;

    const size = line.size ?? 'sm';
    ctx.font = font(size, Boolean(line.bold));
    const step = Math.round(fontSize[size] * LINE_HEIGHT);

    if (line.kind === 'row') {
      item.parts.forEach((part, index) => {
        ctx.textAlign = 'start';
        ctx.fillText(part, startX, item.y + index * step);
      });
      ctx.textAlign = 'end';
      ctx.fillText(item.endText ?? '', endX, item.y);
      continue;
    }

    item.parts.forEach((part, index) => {
      const y = item.y + index * step;
      if (line.align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(part, width / 2, y);
      } else {
        ctx.textAlign = 'start';
        ctx.fillText(part, inward(startX, line.indent ? INDENT : 0), y);
      }
    });
  }

  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
