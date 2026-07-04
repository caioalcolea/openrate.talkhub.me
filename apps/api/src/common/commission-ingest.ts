import type { PoolClient } from 'pg';
import {
  resolveRule,
  splitCommission,
  DEFAULT_PAYOUT_GRACE_DAYS,
  type CommissionRule,
  type SaleContext,
} from '@openrate/shared';

// Carrega as regras aplicáveis (org + globais de plataforma). O RLS já limita à
// org do claim; o motor puro (@openrate/shared) resolve a mais específica.
export async function loadApplicableRules(
  client: PoolClient,
  orgId: string,
): Promise<CommissionRule[]> {
  const res = await client.query(
    `SELECT id, organization_id, store_id, product_id, category_id, platform,
            creator_pct, store_pct, platform_pct
       FROM openrate.commission_rules
      WHERE active = true
        AND (valid_until IS NULL OR valid_until > now())`,
    [],
  );
  return res.rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    storeId: r.store_id,
    productId: r.product_id,
    categoryId: r.category_id,
    platform: r.platform,
    creatorPct: Number(r.creator_pct),
    storePct: Number(r.store_pct),
    platformPct: Number(r.platform_pct),
  }));
}

export interface AffiliateLinkRef {
  id: string;
  userId: string;
  storeId: string | null;
  productId: string | null;
}

export interface IngestSaleParams {
  orgId: string;
  platform: string;
  externalId: string;
  grossAmount: number;
  commissionableAmount?: number | null;
  occurredAt: string; // ISO
  link: AffiliateLinkRef | null; // null p/ venda avulsa sem link
  categoryId: string | null;
  rawPayload?: unknown;
  graceDays?: number;
}

export interface IngestResult {
  saleId: string | null;
  duplicated: boolean;
  ruleId: string | null;
  entries: number;
}

// Registra uma venda CONFIRMADA (idempotente por platform+external_id) e gera os
// lançamentos de comissão (creator/store/platform) via motor de regras. Roda
// dentro de uma transação (client de withTenant).
export async function ingestConfirmedSale(
  client: PoolClient,
  p: IngestSaleParams,
): Promise<IngestResult> {
  const grace = p.graceDays ?? DEFAULT_PAYOUT_GRACE_DAYS;
  const base = p.commissionableAmount ?? p.grossAmount;

  const sale = await client.query(
    `INSERT INTO openrate.affiliate_sales
       (organization_id, store_id, affiliate_link_id, user_id, product_id, platform,
        external_id, status, gross_amount, commissionable_amount, occurred_at, confirmed_at, raw_payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$10, now(), $11)
     ON CONFLICT (platform, external_id) DO NOTHING
     RETURNING id`,
    [
      p.orgId,
      p.link?.storeId ?? null,
      p.link?.id ?? null,
      p.link?.userId ?? null,
      p.link?.productId ?? null,
      p.platform,
      p.externalId,
      p.grossAmount,
      base,
      p.occurredAt,
      JSON.stringify(p.rawPayload ?? {}),
    ],
  );
  if ((sale.rowCount ?? 0) === 0) {
    return { saleId: null, duplicated: true, ruleId: null, entries: 0 };
  }
  const saleId: string = sale.rows[0].id;

  const ctx: SaleContext = {
    organizationId: p.orgId,
    storeId: p.link?.storeId ?? null,
    productId: p.link?.productId ?? null,
    categoryId: p.categoryId,
    platform: p.platform,
  };
  const rule = resolveRule(await loadApplicableRules(client, p.orgId), ctx);
  if (!rule) {
    return { saleId, duplicated: false, ruleId: null, entries: 0 };
  }

  const split = splitCommission(base, rule);

  const rows: Array<{ type: 'creator' | 'store' | 'platform'; pct: number; amount: number }> = [
    { type: 'creator', pct: rule.creatorPct, amount: split.creator },
    { type: 'store', pct: rule.storePct, amount: split.store },
    { type: 'platform', pct: rule.platformPct, amount: split.platform },
  ];

  let entries = 0;
  for (const row of rows) {
    if (row.amount <= 0) continue;
    const userId = row.type === 'creator' ? (p.link?.userId ?? null) : null;
    const storeId = row.type === 'store' ? (p.link?.storeId ?? null) : null;
    if (row.type === 'creator' && !userId) continue;
    if (row.type === 'store' && !storeId) continue;
    const r = await client.query(
      `INSERT INTO openrate.commission_entries
         (organization_id, affiliate_sale_id, commission_rule_id, beneficiary_type,
          user_id, store_id, percentage, base_amount, amount, status, payable_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending', now() + ($10 || ' days')::interval)
       ON CONFLICT (affiliate_sale_id, beneficiary_type) WHERE reversal_of IS NULL DO NOTHING`,
      [p.orgId, saleId, rule.id, row.type, userId, storeId, row.pct, base, row.amount, String(grace)],
    );
    entries += r.rowCount ?? 0;
  }
  return { saleId, duplicated: false, ruleId: rule.id, entries };
}

// Estorno: espelha cada lançamento vivo da venda com valor negativo (razão
// append-only — nunca UPDATE/DELETE do original) e marca a venda cancelada.
export async function reverseSale(client: PoolClient, saleId: string, orgId: string): Promise<number> {
  const entries = await client.query(
    `SELECT id, beneficiary_type, user_id, store_id, percentage, base_amount, amount, commission_rule_id
       FROM openrate.commission_entries
      WHERE affiliate_sale_id = $1 AND reversal_of IS NULL AND amount > 0`,
    [saleId],
  );
  let reversed = 0;
  for (const e of entries.rows) {
    await client.query(
      `INSERT INTO openrate.commission_entries
         (organization_id, affiliate_sale_id, commission_rule_id, beneficiary_type,
          user_id, store_id, percentage, base_amount, amount, status, reversal_of)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'cancelled',$10)`,
      [
        orgId,
        saleId,
        e.commission_rule_id,
        e.beneficiary_type,
        e.user_id,
        e.store_id,
        e.percentage,
        e.base_amount,
        -Number(e.amount),
        e.id,
      ],
    );
    reversed++;
  }
  await client.query(
    `UPDATE openrate.affiliate_sales SET status = 'cancelled', cancelled_at = now() WHERE id = $1`,
    [saleId],
  );
  return reversed;
}
