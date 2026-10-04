/**
 * A tiny single-page PDF writer (Helvetica, text only) for documents like payslips. It keeps the
 * API free of a PDF dependency. Text is limited to Latin-1; anything else is replaced with `?`.
 */
export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Extra space above this line, in points. */
  gap?: number;
  /** Right-aligned value on the same line (the first `text` stays left). */
  right?: string;
}

const PAGE = { width: 595, height: 842, margin: 56 };

const latin1 = (text: string) => text.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const escapePdf = (text: string) => latin1(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Approximate Helvetica width, good enough to right-align short numbers. */
const approxWidth = (text: string, size: number) => text.length * size * 0.52;

export function renderPdf(lines: PdfLine[], title: string): Buffer {
  let y = PAGE.height - PAGE.margin;
  const ops: string[] = [];
  for (const line of lines) {
    const size = line.size ?? 11;
    y -= (line.gap ?? 0) + size * 1.5;
    const font = line.bold ? '/F2' : '/F1';
    ops.push(`BT ${font} ${size} Tf ${PAGE.margin} ${y.toFixed(1)} Td (${escapePdf(line.text)}) Tj ET`);
    if (line.right !== undefined) {
      const x = PAGE.width - PAGE.margin - approxWidth(line.right, size);
      ops.push(`BT ${font} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${escapePdf(line.right)}) Tj ET`);
    }
  }
  const stream = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${escapePdf(title)}) /Producer (Baseline) >>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
