import {
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import * as config_1 from '@nestjs/config';
import storageConfig from '../config/storage.config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { VideoException } from '../videos/video.exception';

@Injectable()
export class StorageService {
  private readonly internalClient: S3Client;
  private readonly publicClient: S3Client;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: config_1.ConfigType<typeof storageConfig>,
  ) {
    this.internalClient = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });

    this.publicClient = new S3Client({
      endpoint: this.config.publicBaseUrl,
      region: this.config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.internalClient.send(
        new HeadBucketCommand({
          Bucket: this.config.bucket,
        }),
      );
      return;
    } catch (error) {
      const statusCode = this.getStatusCode(error);

      if (statusCode !== 404 && statusCode !== 403) {
        throw new InternalServerErrorException(
          'Unable to verify object storage bucket',
        );
      }
    }

    try {
      await this.internalClient.send(
        new CreateBucketCommand({
          Bucket: this.config.bucket,
        }),
      );
    } catch (error) {
      const errorName = this.getErrorName(error);

      if (
        errorName !== 'BucketAlreadyOwnedByYou' &&
        errorName !== 'BucketAlreadyExists'
      ) {
        throw new InternalServerErrorException(
          'Unable to create object storage bucket',
        );
      }
    }
  }

  buildVideoKey(publicId: string): string {
    return `videos/${publicId}/source`;
  }

  async initiateMultipart(
    storageKey: string,
    contentType: string,
  ): Promise<string> {
    await this.ensureBucket();
    const result = await this.request(() =>
      this.internalClient.send(
        new CreateMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: storageKey,
          ContentType: contentType,
        }),
      ),
    );
    if (!result.UploadId)
      throw new VideoException(
        'STORAGE_UNAVAILABLE',
        503,
        'Storage did not return an upload ID',
      );
    return result.UploadId;
  }

  async signPart(
    storageKey: string,
    uploadId: string,
    partNumber: number,
    size: number,
  ): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new UploadPartCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
        UploadId: uploadId,
        PartNumber: partNumber,
        ContentLength: size,
      }),
      { expiresIn: this.config.presignedExpiresInSeconds },
    );
  }

  async listParts(
    storageKey: string,
    uploadId: string,
  ): Promise<{ part_number: number; etag: string; size: number }[]> {
    const parts: { part_number: number; etag: string; size: number }[] = [];
    let marker: string | undefined;
    do {
      const result = await this.request(() =>
        this.internalClient.send(
          new ListPartsCommand({
            Bucket: this.config.bucket,
            Key: storageKey,
            UploadId: uploadId,
            PartNumberMarker: marker,
          }),
        ),
      );
      for (const part of result.Parts || []) {
        if (
          part.PartNumber !== undefined &&
          part.ETag &&
          part.Size !== undefined
        ) {
          parts.push({
            part_number: part.PartNumber,
            etag: part.ETag,
            size: part.Size,
          });
        }
      }
      marker = result.IsTruncated ? result.NextPartNumberMarker : undefined;
    } while (marker);
    return parts;
  }

  async completeMultipart(
    storageKey: string,
    uploadId: string,
    parts: { part_number: number; etag: string }[],
  ): Promise<void> {
    await this.request(() =>
      this.internalClient.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: storageKey,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({
              PartNumber: part.part_number,
              ETag: part.etag,
            })),
          },
        }),
      ),
    );
  }

  async abortMultipart(storageKey: string, uploadId: string): Promise<void> {
    await this.request(() =>
      this.internalClient.send(
        new AbortMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: storageKey,
          UploadId: uploadId,
        }),
      ),
    );
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (this.getErrorName(error) === 'NoSuchUpload') {
        throw new VideoException(
          'UPLOAD_EXPIRED',
          410,
          'Multipart upload is no longer available',
        );
      }
      if (this.getErrorName(error) === 'InvalidRange') {
        throw new VideoException(
          'RANGE_NOT_SATISFIABLE',
          416,
          'Requested range is outside the video',
        );
      }
      throw new VideoException(
        'STORAGE_UNAVAILABLE',
        503,
        'Object storage operation failed',
      );
    }
  }

  async createPresignedPutUrl(
    storageKey: string,
    contentType: string,
  ): Promise<string> {
    await this.ensureBucket();

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey,
      ContentType: contentType,
    });

    return getSignedUrl(this.publicClient, command, {
      expiresIn: this.config.presignedExpiresInSeconds,
    });
  }

  async getPresignedGetUrl(
    storageKey: string,
    expiresIn = this.config.presignedExpiresInSeconds,
  ): Promise<string> {
    await this.ensureBucket();

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey,
    });

    return getSignedUrl(this.publicClient, command, {
      expiresIn,
    });
  }

  async getProcessingUrl(storageKey: string): Promise<string> {
    return getSignedUrl(
      this.internalClient,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
      }),
      {
        expiresIn: Math.min(
          604800,
          Number(process.env.VIDEO_PROCESSING_TIMEOUT_SECONDS || 600) + 300,
        ),
      },
    );
  }

  async getObjectStream(
    storageKey: string,
    range?: string,
  ): Promise<{
    stream: Readable;
    contentLength?: number;
    contentRange?: string;
    acceptRanges?: string;
    contentType?: string;
  }> {
    await this.ensureBucket();

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey,
      ...(range && { Range: range }),
    });

    const response = await this.request(() =>
      this.internalClient.send(command),
    );

    if (!response.Body) {
      throw new InternalServerErrorException(
        `Object body is empty for key: ${storageKey}`,
      );
    }

    return {
      stream: response.Body as Readable,
      contentLength: response.ContentLength,
      contentRange: response.ContentRange,
      acceptRanges: response.AcceptRanges ?? 'bytes',
      contentType: response.ContentType ?? 'video/mp4',
    };
  }

  async headObject(storageKey: string): Promise<HeadObjectCommandOutput> {
    await this.ensureBucket();

    return this.request(() =>
      this.internalClient.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: storageKey,
        }),
      ),
    );
  }

  async downloadFile(storageKey: string, localPath: string): Promise<void> {
    await this.ensureBucket();

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey,
    });

    const response = await this.internalClient.send(command);

    if (!response.Body) {
      throw new InternalServerErrorException(
        `Object body is empty for key: ${storageKey}`,
      );
    }

    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await pipeline(response.Body as Readable, fs.createWriteStream(localPath));
  }

  async uploadFile(
    storageKey: string,
    localPath: string,
    contentType: string,
  ): Promise<void> {
    await this.ensureBucket();

    const fileBody = await fs.promises.readFile(localPath);

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey,
      Body: fileBody,
      ContentLength: fileBody.length,
      ContentType: contentType,
    });

    await this.internalClient.send(command);
  }

  private getStatusCode(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) {
      return undefined;
    }

    const metadata = Reflect.get(error, '$metadata');

    if (typeof metadata !== 'object' || metadata === null) {
      return undefined;
    }

    const statusCode = Reflect.get(metadata, 'httpStatusCode');

    return typeof statusCode === 'number' ? statusCode : undefined;
  }

  private getErrorName(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) {
      return undefined;
    }

    const name = Reflect.get(error, 'name');

    return typeof name === 'string' ? name : undefined;
  }
}
