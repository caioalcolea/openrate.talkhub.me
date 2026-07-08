import type { Job } from 'bullmq';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  finalVideoKey,
  thumbKey,
  type VideoProcessingJob,
  type NotificationJob,
} from '@openrate/shared';
import { withTenant } from '../lib/pg';
import { downloadTo, uploadFile } from '../lib/s3';
import { ffprobe, transcode, thumbnail } from '../lib/ffmpeg';
import { transcribeToSrt } from '../lib/whisper';
import { enqueueNotification } from '../lib/queues';
import { logger } from '../lib/logger';

// Fila video-processing (concorrência 1): raw → ffprobe → whisper → ffmpeg
// (normaliza MP4/H.264, legenda, watermark, thumb) → final/thumbs no MinIO →
// atualiza status. Concorrência 1 protege a CPU do nó único.
export async function processVideo(job: Job<VideoProcessingJob>): Promise<void> {
  const { videoId, rawKey } = job.data;
  const dir = await mkdtemp(join(tmpdir(), 'openrate-'));
  const rawPath = join(dir, 'source');
  const finalPath = join(dir, 'final.mp4');
  const thumbPath = join(dir, 'thumb.jpg');

  try {
    await downloadTo(rawKey, rawPath);

    const probe = await ffprobe(rawPath);
    if (probe.durationSeconds <= 0 || !probe.hasAudio) {
      throw new Error(`vídeo inválido (duração=${probe.durationSeconds}, áudio=${probe.hasAudio})`);
    }

    // Marca d'água por LOJA: usa o nome da loja do vídeo (fallback OpenRate).
    const storeName = await withTenant(job.data, async (client) => {
      const r = await client.query<{ name: string }>(
        'SELECT s.name FROM openrate.videos v JOIN openrate.stores s ON s.id = v.store_id WHERE v.id = $1',
        [videoId],
      );
      return r.rows[0]?.name;
    });

    const transcript = await transcribeToSrt(rawPath, dir);

    await transcode({
      input: rawPath,
      srtPath: transcript?.srtPath,
      watermarkText: storeName || 'OpenRate',
      output: finalPath,
    });
    // Frame do MEIO do vídeo (mais representativo); vídeos < 2s usam o frame 0.
    // (antes usava Math.min(1, ...), que travava a thumb sempre em ~1s.)
    const thumbAt = probe.durationSeconds >= 2 ? Math.floor(probe.durationSeconds / 2) : 0;
    await thumbnail(finalPath, thumbPath, thumbAt);

    const fKey = finalVideoKey(videoId);
    const tKey = thumbKey(videoId);
    await uploadFile(fKey, finalPath, 'video/mp4');
    await uploadFile(tKey, thumbPath, 'image/jpeg');

    const sizeBytes = (await stat(finalPath)).size;
    const qualityCheck = {
      duration_seconds: Math.round(probe.durationSeconds),
      has_audio: probe.hasAudio,
      width: probe.width,
      height: probe.height,
      video_codec: probe.videoCodec,
      audio_codec: probe.audioCodec,
      size_bytes: sizeBytes,
      checked_at: new Date().toISOString(),
    };

    let creatorUserId = '';
    let creatorPhone: string | null = null;
    await withTenant(job.data, async (client) => {
      const res = await client.query(
        `UPDATE openrate.videos
            SET status = 'ready', final_key = $2, thumb_key = $3,
                transcript = $4, transcript_lang = 'pt',
                duration_seconds = $5, width = $6, height = $7, size_bytes = $8,
                quality_check = $9::jsonb, processed_at = now()
          WHERE id = $1
          RETURNING user_id`,
        [
          videoId,
          fKey,
          tKey,
          transcript?.text ?? null,
          Math.round(probe.durationSeconds),
          probe.width,
          probe.height,
          sizeBytes,
          JSON.stringify(qualityCheck),
        ],
      );
      if ((res.rowCount ?? 0) === 0) throw new Error(`vídeo ${videoId} não encontrado`);
      creatorUserId = res.rows[0].user_id;

      const u = await client.query('SELECT phone FROM openrate.users WHERE id = $1', [creatorUserId]);
      creatorPhone = u.rows[0]?.phone ?? null;

      const notif = await client.query(
        `INSERT INTO openrate.notifications (organization_id, user_id, channel, template, body, status)
         VALUES ($1,$2,'whatsapp','video_ready',$3,'pending') RETURNING id`,
        [job.data.orgId, creatorUserId, 'Seu vídeo está pronto para revisão.'],
      );

      if (creatorPhone) {
        const notification: NotificationJob = {
          orgId: job.data.orgId,
          correlationId: job.data.correlationId,
          userId: creatorUserId,
          notificationId: notif.rows[0].id,
          channel: 'whatsapp',
          template: 'video_ready',
          to: creatorPhone,
          vars: { videoId },
        };
        await enqueueNotification(notification);
      }
    });

    logger.info({ videoId, fKey }, 'vídeo processado');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await withTenant(job.data, (client) =>
      client.query(
        `UPDATE openrate.videos SET status = 'failed', processing_error = $2 WHERE id = $1`,
        [videoId, msg.slice(0, 2000)],
      ),
    ).catch(() => undefined);
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
