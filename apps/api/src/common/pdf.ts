// Gerador de PDF mínimo, SEM dependências: usa as fontes base-14 (Helvetica e
// Helvetica-Bold, que não precisam ser embutidas) e codificação WinAnsi (cobre
// os acentos do pt-BR). Suficiente para recibos simples de texto — não embute
// fontes nem imagens. A tabela xref é montada com offsets de byte exatos.

export interface PdfLine {
  text: string;
  y: number; // distância do topo, em pontos (1 pt ≈ 1/72")
  x?: number; // margem esquerda (default 56)
  size?: number; // corpo (default 11)
  bold?: boolean;
}

// Escapa os caracteres especiais de string literal PDF: \ ( )
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

const PAGE_W = 595; // A4 em pontos
const PAGE_H = 842;

export function simplePdf(lines: PdfLine[]): Buffer {
  // Stream de conteúdo: cada linha é posicionada de forma absoluta via Tm.
  // O eixo Y do PDF cresce de baixo p/ cima, então convertemos a partir do topo.
  const content = lines
    .map((l) => {
      const size = l.size ?? 11;
      const font = l.bold ? '/F2' : '/F1';
      const x = l.x ?? 56;
      const y = PAGE_H - l.y;
      return `BT ${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${esc(l.text)}) Tj ET`;
    })
    .join('\n');

  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}]` +
    ' /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[6] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;

  // latin1 é usado em todo o arquivo: cada char (≤ 255) ocupa exatamente 1 byte,
  // então byteLength/from batem com as posições da xref.
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i <= 6; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n0 7\n';
  pdf += '0000000000 65535 f \n'; // entrada 0 (livre), 20 bytes
  for (let i = 1; i <= 6; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`; // 20 bytes cada
  }
  pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}
