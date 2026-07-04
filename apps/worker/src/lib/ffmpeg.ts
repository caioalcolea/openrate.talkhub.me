import { spawn } from 'node:child_process';

// Executa um binário e resolve com stdout; rejeita com stderr em código != 0.
function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${bin} saiu ${code}: ${err.slice(-2000)}`))));
  });
}

export interface ProbeResult {
  durationSeconds: number;
  hasAudio: boolean;
}

export async function ffprobe(input: string): Promise<ProbeResult> {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type',
    '-of', 'json',
    input,
  ]);
  const json = JSON.parse(out) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string }>;
  };
  return {
    durationSeconds: Number(json.format?.duration ?? 0),
    hasAudio: (json.streams ?? []).some((s) => s.codec_type === 'audio'),
  };
}

export interface EditOptions {
  input: string;
  srtPath?: string; // legenda a "queimar" (opcional)
  watermarkText?: string; // marca d'água da loja
  output: string; // MP4/H.264
}

// Normaliza para MP4/H.264 (o navegador pode ter gravado WebM/VP9), queima a
// legenda se houver e aplica a marca d'água. Preset limitado a 2 threads
// (nó único compartilhado — ver docs/01 §2.4).
export async function transcode(opts: EditOptions): Promise<void> {
  const filters: string[] = [];
  if (opts.srtPath) filters.push(`subtitles=${opts.srtPath.replace(/[:\\]/g, '\\$&')}`);
  if (opts.watermarkText) {
    const t = opts.watermarkText.replace(/[':]/g, '');
    filters.push(
      `drawtext=text='${t}':x=w-tw-20:y=h-th-20:fontsize=24:fontcolor=white@0.8:box=1:boxcolor=black@0.4:boxborderw=8`,
    );
  }
  const args = ['-y', '-i', opts.input];
  if (filters.length) args.push('-vf', filters.join(','));
  args.push(
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-threads', '2',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    opts.output,
  );
  await run('ffmpeg', args);
}

export async function thumbnail(input: string, output: string, atSeconds = 1): Promise<void> {
  await run('ffmpeg', ['-y', '-ss', String(atSeconds), '-i', input, '-frames:v', '1', '-q:v', '3', output]);
}
