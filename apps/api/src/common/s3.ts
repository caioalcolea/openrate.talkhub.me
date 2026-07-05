import { Injectable } from '@nestjs/common';
import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  UploadPartCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

// Dois clientes: interno (minio_minio:9000) para operações server-side, e
// público (bucketss3.talkhub.me) para ASSINAR as URLs que o browser usa —
// a assinatura precisa casar com o host público (senão quebra no Traefik).
@Injectable()
export class S3Service {
  private readonly internal = new S3Client({
    endpoint: env.s3Endpoint,
    region: env.s3Region,
    forcePathStyle: env.s3ForcePathStyle,
    credentials: { accessKeyId: env.s3AccessKey, secretAccessKey: env.s3SecretKey },
  });

  private readonly publicClient = new S3Client({
    endpoint: env.s3PublicEndpoint,
    region: env.s3Region,
    forcePathStyle: env.s3ForcePathStyle,
    credentials: { accessKeyId: env.s3AccessKey, secretAccessKey: env.s3SecretKey },
  });

  async createMultipart(key: string, contentType: string): Promise<string> {
    const res = await this.internal.send(
      new CreateMultipartUploadCommand({ Bucket: env.s3Bucket, Key: key, ContentType: contentType }),
    );
    if (!res.UploadId) throw new Error('MinIO não retornou UploadId');
    return res.UploadId;
  }

  // URLs presigned de cada parte (o app envia direto, parte a parte).
  async presignParts(key: string, uploadId: string, partCount: number): Promise<{ partNumber: number; url: string }[]> {
    const parts: { partNumber: number; url: string }[] = [];
    for (let n = 1; n <= partCount; n++) {
      const url = await getSignedUrl(
        this.publicClient,
        new UploadPartCommand({ Bucket: env.s3Bucket, Key: key, UploadId: uploadId, PartNumber: n }),
        { expiresIn: 3600 },
      );
      parts.push({ partNumber: n, url });
    }
    return parts;
  }

  async completeMultipart(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void> {
    await this.internal.send(
      new CompleteMultipartUploadCommand({
        Bucket: env.s3Bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  // Presigned PUT (upload único) — para imagens leves (logo de marca, imagem de
  // produto). O browser faz PUT direto no host público; a mídia não passa pela API.
  async presignPut(key: string, contentType: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
  }

  // Presigned GET (leitura) de curta duração para o player/painel.
  async presignGet(key: string, expiresIn = 900): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }),
      { expiresIn },
    );
  }
}
