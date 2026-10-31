import { Fragment } from 'react';
import type { PrintDocument, PrintLine, PrintSize, PrintText } from './print-document';

const sizeClass: Record<PrintSize, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-2xl',
};

function Text({ text }: { text: PrintText }) {
  if (typeof text === 'string') return text;
  return text.map((piece, index) =>
    typeof piece === 'string' ? (
      <Fragment key={index}>{piece}</Fragment>
    ) : (
      <bdi key={index} dir="ltr">
        {piece.ltr}
      </bdi>
    ),
  );
}

function classesOf(line: Extract<PrintLine, { kind: 'text' | 'row' }>): string {
  return [
    sizeClass[line.size ?? (line.kind === 'row' ? 'sm' : 'sm')],
    line.bold ? 'font-semibold' : '',
    line.muted ? 'text-slate-600 print:text-black' : '',
    line.kind === 'text' && line.italic ? 'italic' : '',
    line.kind === 'text' && line.upper ? 'uppercase' : '',
    line.kind === 'text' && line.indent ? 'ps-4' : '',
    line.kind === 'text' && line.align === 'center' ? 'text-center' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// The receipt or the slip on the screen, and what the browser prints when there is no printer
// on the network. The kind of document names the test id.
//
// Printed, it fills the roll (up to 80 mm, the widest receipt roll) at the text size of the
// screen, with a small padding of its own, since the page has no margins (index.css): on a 58 mm
// roll as on an 80 mm one, nothing is cut off and nothing is shrunk. Black only: grey prints
// faint on thermal paper.
export function PrintDocumentView({ document }: { document: PrintDocument }) {
  return (
    <div
      className="mx-auto max-w-xs space-y-1 text-sm text-slate-900 print:w-full print:max-w-[80mm] print:px-[2mm] print:py-[3mm] print:text-black"
      data-testid={document.kind}
    >
      {document.lines.map((line, index) => {
        switch (line.kind) {
          case 'rule':
            return <hr key={index} className="my-2 border-t border-dashed border-slate-300" />;
          case 'gap':
            return <div key={index} className="h-2" aria-hidden="true" />;
          case 'image':
            return (
              <img
                key={index}
                src={line.url}
                alt=""
                data-testid="receipt-logo"
                className="mx-auto mb-2 max-h-20 max-w-40 object-contain"
              />
            );
          case 'row':
            return (
              <div key={index} className={`flex justify-between gap-3 ${classesOf(line)}`}>
                <span className="min-w-0">
                  <Text text={line.start} />
                </span>
                <span className="whitespace-nowrap">
                  <Text text={line.end} />
                </span>
              </div>
            );
          default:
            return (
              <p key={index} className={classesOf(line)}>
                <Text text={line.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
