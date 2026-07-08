// Validadores puros (isomórficos) reutilizados por DTOs e pela UI.
// Sem dependências externas: só dígitos verificadores e formatos.

export function onlyDigits(v: string): string {
  return (v ?? '').replace(/\D+/g, '');
}

// CPF: 11 dígitos + 2 dígitos verificadores (mod 11). Rejeita sequências iguais.
export function isValidCpf(input: string): boolean {
  const c = onlyDigits(input);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

// CNPJ: 14 dígitos + 2 verificadores (pesos 5..2 / 6..2). Rejeita sequências iguais.
export function isValidCnpj(input: string): boolean {
  const c = onlyDigits(input);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (len: number): number => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

// Documento genérico: valida como CPF (11) ou CNPJ (14) conforme o tamanho.
export function isValidCpfCnpj(input: string): boolean {
  const len = onlyDigits(input).length;
  if (len === 11) return isValidCpf(input);
  if (len === 14) return isValidCnpj(input);
  return false;
}

// CEP brasileiro: 8 dígitos (com ou sem hífen).
export function isValidCep(input: string): boolean {
  return /^\d{5}-?\d{3}$/.test((input ?? '').trim());
}

// Telefone BR em dígitos: 10 (fixo) ou 11 (celular) dígitos, com DDD.
export function isValidPhoneBR(input: string): boolean {
  const d = onlyDigits(input);
  return d.length === 10 || d.length === 11;
}
