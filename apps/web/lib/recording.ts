'use client';

// Negocia o mimeType suportado pelo navegador. Chrome Android costuma dar
// WebM/VP9; Safari iOS dá MP4/H.264. O worker normaliza tudo para MP4 depois.
export function pickMimeType(): string {
  const candidates = [
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  if (typeof MediaRecorder === 'undefined') return 'video/webm';
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? 'video/webm';
}

export interface Recorder {
  stream: MediaStream;
  start: () => void;
  stop: () => Promise<{ blob: Blob; contentType: string }>;
}

export async function createRecorder(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1080 }, height: { ideal: 1920 } },
    audio: true,
  });
  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return {
    stream,
    start: () => rec.start(1000),
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve({ blob: new Blob(chunks, { type: mimeType }), contentType: mimeType });
        };
        rec.stop();
      }),
  };
}
