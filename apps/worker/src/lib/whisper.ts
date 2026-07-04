import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { env } from './env';
import { logger } from './logger';

// Binário do CLI de transcrição (whisper-ctranslate2 — usa faster-whisper por
// baixo). Sobreponível por env caso a imagem use outro (ex.: whisper).
const WHISPER_BIN = process.env.WHISPER_BIN ?? 'whisper-ctranslate2';

// Transcreve o áudio via CLI, gerando SRT. Retorna o caminho do SRT e o texto
// concatenado. Se o CLI não estiver disponível/falhar, retorna null (o pipeline
// segue sem legenda em vez de derrubar o job inteiro).
export async function transcribeToSrt(
  input: string,
  outDir: string,
): Promise<{ srtPath: string; text: string } | null> {
  const args = [
    input,
    '--model', env.whisperModel,
    '--language', 'pt',
    '--output_format', 'srt',
    '--output_dir', outDir,
    '--task', 'transcribe',
  ];
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(WHISPER_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => (err += d.toString()));
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${WHISPER_BIN} ${code}: ${err.slice(-1000)}`))));
    });
  } catch (err) {
    logger.warn({ err }, 'CLI de transcrição indisponível/falhou; seguindo sem legenda');
    return null;
  }
  const srtPath = join(outDir, basename(input).replace(/\.[^.]+$/, '') + '.srt');
  try {
    const raw = await readFile(srtPath, 'utf8');
    const text = raw
      .split('\n')
      .filter((l) => l && !/^\d+$/.test(l) && !l.includes('-->'))
      .join(' ')
      .trim();
    return { srtPath, text };
  } catch {
    logger.warn({ srtPath, dir: dirname(srtPath) }, 'SRT não encontrado após transcrição');
    return null;
  }
}
