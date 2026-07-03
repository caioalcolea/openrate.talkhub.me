import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { env } from './env';
import { logger } from './logger';

// Transcreve o áudio via faster-whisper (CLI), gerando SRT. Retorna o caminho do
// SRT e o texto concatenado. Se o CLI não estiver disponível, retorna null
// (o pipeline segue sem legenda em vez de falhar o job inteiro).
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
      const p = spawn('faster-whisper', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => (err += d.toString()));
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`faster-whisper ${code}: ${err.slice(-1000)}`))));
    });
  } catch (err) {
    logger.warn({ err }, 'faster-whisper indisponível/falhou; seguindo sem legenda');
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
