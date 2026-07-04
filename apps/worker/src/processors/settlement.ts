import type { Job } from 'bullmq';
import type { CommissionSettlementJob } from '@openrate/shared';
import { withTenant } from '../lib/pg';
import { logger } from '../lib/logger';

// Fila commission-settlement: consolida as comissões de CREATOR "due" (carência
// vencida) do período em um payout por creator. Loja/plataforma são razão
// contábil (não têm recebedor Pix), então não geram payout.
//
// Idempotente por construção: só considera lançamentos ainda não liquidados
// (payout_id IS NULL, status <> 'paid'). Reexecução não duplica payouts.
// Invariante: total_amount de cada payout == soma dos lançamentos que ele liquida.
export async function processCommissionSettlement(
  job: Job<CommissionSettlementJob>,
): Promise<void> {
  const period = job.data.period; // "YYYY-MM"
  const [y, m] = period.split('-').map(Number);
  const periodStart = `${period}-01`;
  const periodEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // último dia do mês

  await withTenant(job.data, async (client) => {
    // Só lançamentos ATIVOS de creator com carência vencida. Estornos já
    // cancelaram os originais (ver reverseSale), então não há o que "netar" aqui.
    const groups = await client.query(
      `SELECT user_id,
              SUM(amount)   AS net,
              ARRAY_AGG(id) AS ids
         FROM openrate.commission_entries
        WHERE beneficiary_type = 'creator'
          AND user_id IS NOT NULL
          AND payout_id IS NULL
          AND status IN ('pending','payable')
          AND amount > 0
          AND payable_at < ($1::date + 1)
        GROUP BY user_id`,
      [periodEnd],
    );

    let payouts = 0;
    for (const g of groups.rows) {
      const net = Number(g.net);
      const ids: string[] = g.ids;
      if (net <= 0) continue; // salvaguarda; não deve ocorrer (só positivos ativos)
      const u = await client.query('SELECT pix_key, pix_key_type FROM openrate.users WHERE id = $1', [g.user_id]);
      const payout = await client.query(
        `INSERT INTO openrate.payouts
           (organization_id, user_id, period_start, period_end, total_amount, status, pix_key, pix_key_type)
         VALUES ($1,$2,$3,$4,$5,'pending_approval',$6,$7) RETURNING id`,
        [job.data.orgId, g.user_id, periodStart, periodEnd, net, u.rows[0]?.pix_key ?? null, u.rows[0]?.pix_key_type ?? null],
      );
      await client.query(
        `UPDATE openrate.commission_entries SET payout_id = $1, status = 'settled' WHERE id = ANY($2::uuid[])`,
        [payout.rows[0].id, ids],
      );
      payouts++;
    }
    logger.info({ period, payouts }, 'fechamento concluído');
  });
}
