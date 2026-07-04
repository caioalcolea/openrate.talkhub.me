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

// priority espelha EXATAMENTE o GENERATED de commission_rules.priority: cada
// dimensão só soma seu peso quando presente (inclusive platform). Somar platform
// incondicionalmente anularia a especificidade de plataforma nos empates.
export function rulePriority(rule: CommissionRule): number {
  let p = 0;
  if (rule.productId) p += COMMISSION_RULE_WEIGHTS.product;
  if (rule.categoryId) p += COMMISSION_RULE_WEIGHTS.category;
  if (rule.storeId) p += COMMISSION_RULE_WEIGHTS.store;
  if (rule.organizationId) p += COMMISSION_RULE_WEIGHTS.organization;
  if (rule.platform) p += COMMISSION_RULE_WEIGHTS.platform;
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

// Rateio de uma venda. Garante Σ parcelas == round2(base * Σpct / 100) e nenhuma
// parcela negativa: creator e store são arredondados e, se juntos passarem do
// total (arredondamento em split 50/50 de centavo ímpar), são limitados para
// caber; a plataforma absorve exatamente o resíduo (>= 0). Se Σpct < 100, a
// sobra simplesmente não é lançada.
export function splitCommission(base: number, rule: CommissionRule): CommissionSplit {
  const totalPct = rule.creatorPct + rule.storePct + rule.platformPct;
  const total = round2((base * totalPct) / 100);

  let creator = round2((base * rule.creatorPct) / 100);
  let store = round2((base * rule.storePct) / 100);

  if (creator > total) creator = total;
  if (creator + store > total) store = round2(total - creator);
  const platform = round2(total - creator - store);

  return { creator, store, platform: platform < 0 ? 0 : platform };
}
