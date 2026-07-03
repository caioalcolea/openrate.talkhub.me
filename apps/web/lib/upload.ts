'use client';
import { api } from './api';

const PART_SIZE = 8 * 1024 * 1024; // 8 MB (MinIO exige >= 5 MB por parte, exceto a última)

interface StartResponse {
  videoId: string;
  uploadId: string;
  key: string;
  parts: { partNumber: number; url: string }[];
}

// Envia uma parte com pequenas retentativas; devolve o ETag (exposto via CORS).
async function putPart(url: string, chunk: Blob, contentType: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method: 'PUT', body: chunk, headers: { 'Content-Type': contentType } });
      if (!res.ok) throw new Error(`PUT parte ${res.status}`);
      const etag = res.headers.get('ETag') ?? res.headers.get('etag');
      if (!etag) throw new Error('ETag ausente na resposta (checar CORS do MinIO)');
      return etag.replaceAll('"', '');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('falha no upload da parte');
}

// Upload resumível: pede presigned parts à API, envia direto ao MinIO parte a
// parte (o vídeo NÃO passa pela API) e confirma com CompleteMultipartUpload.
export async function uploadVideo(
  input: { ideaId: string; productId: string; blob: Blob; contentType: string },
  onProgress?: (done: number, total: number) => void,
): Promise<{ videoId: string }> {
  const partCount = Math.max(1, Math.ceil(input.blob.size / PART_SIZE));

  const start = await api<StartResponse>('/v1/videos', {
    method: 'POST',
    body: {
      videoIdeaId: input.ideaId,
      productId: input.productId,
      contentType: input.contentType,
      fileSize: input.blob.size,
      partCount,
    },
  });

  const parts: { partNumber: number; etag: string }[] = [];
  for (const p of start.parts) {
    const from = (p.partNumber - 1) * PART_SIZE;
    const chunk = input.blob.slice(from, from + PART_SIZE);
    const etag = await putPart(p.url, chunk, input.contentType);
    parts.push({ partNumber: p.partNumber, etag });
    onProgress?.(parts.length, partCount);
  }

  await api(`/v1/videos/${start.videoId}/complete-upload`, {
    method: 'POST',
    body: { uploadId: start.uploadId, parts },
  });
  return { videoId: start.videoId };
}
