import { COMMISSION_RULE_WEIGHTS } from './enums';

// Motor de comissão — resolução da regra "mais específica vence" e rateio.
// Puro (sem I/O), para ser coberto por testes de tabela-verdade na API.

export interface CommissionRule {
  id: string;
  organizationId: string | null; // null = regra global de plataforma
  storeId: string | null;
  productId: string | null;
  categoryId: string | null;
  platform: string | null;
  creatorPct: number;
  storePct: number;
  platformPct: number;
}

export interface SaleContext {
  organizationId: string;
  storeId: string | null;
  productId: string | null;
  categoryId: string | null;
  platform: string | null;
}

// priority espelha o GENERATED da coluna commission_rules.priority.
export function rulePriority(rule: CommissionRule): number {
  let p = 0;
  if (rule.productId) p += COMMISSION_RULE_WEIGHTS.product;
  if (rule.categoryId) p += COMMISSION_RULE_WEIGHTS.category;
  if (rule.storeId) p += COMMISSION_RULE_WEIGHTS.store;
  if (rule.organizationId) p += COMMISSION_RULE_WEIGHTS.organization;
  p += COMMISSION_RULE_WEIGHTS.platform; // toda regra vale ao menos como global
  return p;
}

function ruleMatches(rule: CommissionRule, sale: SaleContext): boolean {
  if (rule.organizationId && rule.organizationId !== sale.organizationId) return false;
  if (rule.storeId && rule.storeId !== sale.storeId) return false;
  if (rule.productId && rule.productId !== sale.productId) return false;
  if (rule.categoryId && rule.categoryId !== sale.categoryId) return false;
  if (rule.platform && rule.platform !== sale.platform) return false;
  return true;
}

// Seleciona a regra aplicável de maior especificidade. Desempate determinístico
// por id (evita não-determinismo quando duas regras têm a mesma priority).
export function resolveRule(rules: CommissionRule[], sale: SaleContext): CommissionRule | null {
  const applicable = rules.filter((r) => ruleMatches(r, sale));
  if (applicable.length === 0) return null;
  return applicable.sort((a, b) => {
    const pd = rulePriority(b) - rulePriority(a);
    return pd !== 0 ? pd : a.id.localeCompare(b.id);
  })[0];
}

export interface CommissionSplit {
  creator: number;
  store: number;
  platform: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Rateio de uma venda. A parcela platform absorve o resíduo de centavos para
// garantir Σ = round2(base * Σpct / 100). Se Σpct < 100, a sobra não é lançada.
export function splitCommission(base: number, rule: CommissionRule): CommissionSplit {
  const creator = round2((base * rule.creatorPct) / 100);
  const store = round2((base * rule.storePct) / 100);
  const totalPct = rule.creatorPct + rule.storePct + rule.platformPct;
  const total = round2((base * totalPct) / 100);
  const platform = round2(total - creator - store);
  return { creator, store, platform };
}
