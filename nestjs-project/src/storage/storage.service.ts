import {
  CreateBucketCommand,
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

  async headObject(storageKey: string): Promise<HeadObjectCommandOutput> {
    await this.ensureBucket();

    return this.internalClient.send(
      new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
      }),
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
    await pipeline(
      response.Body as Readable,
      fs.createWriteStream(localPath),
    );
  }

  async uploadFile(
    storageKey: string,
    localPath: string,
    contentType: string,
  ): Promise<void> {
    await this.ensureBucket();

    const fileStream = fs.createReadStream(localPath);

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey,
      Body: fileStream,
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