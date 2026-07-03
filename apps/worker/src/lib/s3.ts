import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { env } from './env';

// Endpoint INTERNO (minio_minio:9000) para o worker — não passa pelo Traefik.
export const s3 = new S3Client({
  endpoint: env.s3Endpoint,
  region: env.s3Region,
  forcePathStyle: env.s3ForcePathStyle,
  credentials: { accessKeyId: env.s3AccessKey, secretAccessKey: env.s3SecretKey },
});

export async function downloadTo(key: string, destPath: string): Promise<void> {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
  const body = res.Body as Readable;
  await pipeline(body, createWriteStream(destPath));
}

export async function uploadFile(
  key: string,
  srcPath: string,
  contentType: string,
): Promise<void> {
  const body = await readFile(srcPath);
  await s3.send(
    new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, Body: body, ContentType: contentType }),
  );
}
