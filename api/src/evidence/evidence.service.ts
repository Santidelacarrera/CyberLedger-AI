import { Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { cfg } from '../config';

/** Content-addressed forensic evidence store: MinIO/S3 when S3_ENDPOINT is set, local directory otherwise. */
@Injectable()
export class EvidenceService {
  private s3 = cfg().s3.endpoint
    ? new S3Client({ endpoint: cfg().s3.endpoint, region: 'us-east-1', forcePathStyle: true,
        credentials: { accessKeyId: cfg().s3.accessKey, secretAccessKey: cfg().s3.secretKey } })
    : null;

  async put(content: string | Buffer, ext = 'json'): Promise<string> {
    const key = `${createHash('sha256').update(content).digest('hex')}.${ext}`;
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: cfg().s3.bucket, Key: key, Body: content }));
    } else {
      await mkdir(cfg().evidenceDir, { recursive: true });
      await writeFile(join(cfg().evidenceDir, key), content);
    }
    return key;
  }

  async get(key: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}\.[a-z]+$/.test(key)) throw new Error('bad evidence key');
    if (this.s3) {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: cfg().s3.bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    }
    return readFile(join(cfg().evidenceDir, key));
  }
}
