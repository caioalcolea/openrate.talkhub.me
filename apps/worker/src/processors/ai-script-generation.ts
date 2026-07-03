import type { Job } from 'bullmq';
import type { AiScriptGenerationJob } from '@openrate/shared';
import { withTenant } from '../lib/pg';
import { generateIdeas } from '../lib/claude';
import { env } from '../lib/env';
import { logger } from '../lib/logger';

// Fila ai-script-generation: gera as N ideias por produto/tipo via Claude e
// persiste em video_ideas (uma transação, marcadas com o batch_id do job).
export async function processAiScript(job: Job<AiScriptGenerationJob>): Promise<void> {
  const { productId, videoTypeId, batchId, count } = job.data;

  await withTenant(job.data, async (client) => {
    // Idempotência: se o batch já foi persistido, não regerar.
    const existing = await client.query(
      'SELECT 1 FROM openrate.video_ideas WHERE batch_id = $1 LIMIT 1',
      [batchId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      logger.info({ batchId }, 'batch já existe; pulando');
      return;
    }

    const prod = await client.query(
      `SELECT p.name, p.description, c.name AS category_name
         FROM openrate.products p
         LEFT JOIN openrate.categories c ON c.id = p.category_id
        WHERE p.id = $1`,
      [productId],
    );
    if ((prod.rowCount ?? 0) === 0) throw new Error(`produto ${productId} não encontrado`);

    const vt = await client.query(
      'SELECT name, prompt_template FROM openrate.video_types WHERE id = $1',
      [videoTypeId],
    );
    if ((vt.rowCount ?? 0) === 0) throw new Error(`video_type ${videoTypeId} não encontrado`);

    const ideas = await generateIdeas({
      productName: prod.rows[0].name,
      productDescription: prod.rows[0].description,
      categoryName: prod.rows[0].category_name,
      videoTypeName: vt.rows[0].name,
      promptTemplate: vt.rows[0].prompt_template,
      count,
    });

    for (const idea of ideas) {
      await client.query(
        `INSERT INTO openrate.video_ideas
           (organization_id, product_id, video_type_id, batch_id, hook, script,
            caption, hashtags, target_duration_seconds, source, ai_model)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ai',$10)`,
        [
          job.data.orgId,
          productId,
          videoTypeId,
          batchId,
          idea.hook,
          JSON.stringify(idea.script),
          idea.caption,
          idea.hashtags,
          idea.targetDurationSeconds,
          env.aiModelPrimary,
        ],
      );
    }
    logger.info({ batchId, count: ideas.length }, 'ideias persistidas');
  });
}
