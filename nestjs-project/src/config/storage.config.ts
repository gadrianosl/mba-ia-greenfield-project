import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.MINIO_ENDPOINT || 'http://minio:9000',
  region: process.env.MINIO_REGION || 'us-east-1',
  bucket: process.env.MINIO_BUCKET || 'streamtube',
  accessKeyId: process.env.MINIO_ACCESS_KEY || 'streamtube',
  secretAccessKey: process.env.MINIO_SECRET_KEY || 'streamtube',
  publicBaseUrl: process.env.MINIO_PUBLIC_URL || 'http://localhost:9000',
  uploadPartSize: Number.parseInt(process.env.MINIO_UPLOAD_PART_SIZE || '5242880', 10),
  presignedExpiresInSeconds: Number.parseInt(
    process.env.MINIO_PRESIGNED_EXPIRES_IN_SECONDS || '3600',
    10,
  ),
  maxVideoSizeBytes: Number.parseInt(process.env.MAX_VIDEO_SIZE_BYTES || '10737418240', 10),
}));
