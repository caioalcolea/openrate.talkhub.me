// CSV simples (RFC4180-ish): aspas duplas apenas quando o campo tem vírgula,
// aspas, ponto-e-vírgula ou quebra de linha. Prefixa BOM UTF-8 para o Excel
// (pt-BR) reconhecer os acentos. Separador vírgula, quebra CRLF.
export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const cell = (v: string | number | null | undefined): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))];
  return '\uFEFF' + lines.join('\r\n');
}
