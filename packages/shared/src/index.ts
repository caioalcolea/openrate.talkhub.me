export * from './enums';
export * from './auth';
export * from './queues';
export * from './schemas';
export * from './commission';

// Prefixos do bucket openrate-media (MinIO).
export const S3_PREFIXES = {
  raw: 'raw/',
  final: 'final/',
  thumbs: 'thumbs/',
  legal: 'legal/',
} as const;

// Chave do objeto bruto: raw/{org}/{store}/{video}/source.ext
export function rawVideoKey(orgId: string, storeId: string, videoId: string, ext = 'mp4'): string {
  return `${S3_PREFIXES.raw}${orgId}/${storeId}/${videoId}/source.${ext}`;
}
export function finalVideoKey(videoId: string): string {
  return `${S3_PREFIXES.final}${videoId}.mp4`;
}
export function thumbKey(videoId: string): string {
  return `${S3_PREFIXES.thumbs}${videoId}.jpg`;
}
