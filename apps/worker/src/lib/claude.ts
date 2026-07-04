import Anthropic from '@anthropic-ai/sdk';
import { videoIdeasBatchSchema, type VideoIdea } from '@openrate/shared';
import { env } from './env';
import { logger } from './logger';

const client = new Anthropic({ apiKey: env.anthropicApiKey });

interface IdeaPromptInput {
  productName: string;
  productDescription?: string | null;
  categoryName?: string | null;
  videoTypeName: string;
  promptTemplate?: string | null;
  count: number;
}

function buildPrompt(i: IdeaPromptInput): string {
  return [
    `Você é roteirista de vídeos curtos de venda (UGC) para redes sociais.`,
    `Gere EXATAMENTE ${i.count} ideias de vídeo para o produto abaixo, no formato do tipo "${i.videoTypeName}".`,
    i.promptTemplate ? `Diretriz do tipo: ${i.promptTemplate}` : '',
    ``,
    `Produto: ${i.productName}`,
    i.categoryName ? `Categoria: ${i.categoryName}` : '',
    i.productDescription ? `Descrição: ${i.productDescription}` : '',
    ``,
    `Responda SOMENTE com JSON válido no formato:`,
    `{"ideas":[{"hook":string,"script":[{"step":number,"instruction":string,"durationSeconds":number}],"caption":string,"hashtags":[string],"targetDurationSeconds":number}]}`,
    `Sem texto fora do JSON.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('resposta sem JSON');
  return JSON.parse(text.slice(start, end + 1));
}

async function callModel(model: string, prompt: string): Promise<VideoIdea[]> {
  const msg = await client.messages.create({
    model,
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = msg.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
  const parsed = videoIdeasBatchSchema.parse(extractJson(text));
  return parsed.ideas;
}

// Gera as ideias com o modelo primário; em erro (rede/JSON inválido) cai para o
// fallback econômico. Lança se ambos falharem (o job então dá retry/backoff).
export async function generateIdeas(input: IdeaPromptInput): Promise<VideoIdea[]> {
  const prompt = buildPrompt(input);
  try {
    return await callModel(env.aiModelPrimary, prompt);
  } catch (err) {
    logger.warn({ msg_err: err instanceof Error ? err.message : String(err) }, 'modelo primário falhou; tentando fallback');
    return callModel(env.aiModelFallback, prompt);
  }
}
