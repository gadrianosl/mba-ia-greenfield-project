---
libs:
  bullmq:
    version: "latest compatible major; verify with npm install before implementation"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-09-30T00:00:00Z"
  "@aws-sdk/client-s3":
    version: "latest compatible major; verify with npm install before implementation"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-09-30T00:00:00Z"
  "@aws-sdk/s3-request-presigner":
    version: "latest compatible major; verify with npm install before implementation"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-09-30T00:00:00Z"
  ffmpeg:
    version: "container package; pin image/package during SI-03.1"
    context7_id: "official-ffmpeg"
    fetched_at: "2026-09-30T00:00:00Z"
sources_mtime:
  docs/decisions/technical-decisions-upload-processing.md: "2026-09-30T18:25:37Z"
---

# Library References — Phase 03 Videos

## bullmq

Use BullMQ with Redis for the video-processing queue. The implementation must use a dedicated `Worker`, explicit queue/job names, bounded concurrency, retry attempts, and backoff. The worker must throw `Error` instances for failures and must be closed cleanly during shutdown.

Official references consulted:
- BullMQ workers and job lifecycle.
- BullMQ automatic retries and backoff.
- BullMQ Redis connection guidance.

## @aws-sdk/client-s3

Use the AWS SDK for JavaScript v3 S3 client against MinIO in development. The storage adapter must use S3 commands for bucket/object operations and multipart upload lifecycle, without importing MinIO-specific APIs into the domain layer.

## @aws-sdk/s3-request-presigner

Use presigned requests for multipart part uploads and, where appropriate, object access. The API remains responsible for authorization and session coordination; the browser/client transfers file bytes directly to MinIO/S3.

## FFmpeg and ffprobe

The worker image must include `ffmpeg` and `ffprobe`. `ffprobe` is used to extract format/stream metadata and duration; `ffmpeg` is used to generate a deterministic thumbnail frame. Temporary files must be isolated per job and removed on success and failure.

## Version policy

The repository currently does not contain BullMQ or AWS SDK v3 dependencies. The implementation SI that installs them must verify the resolved versions inside the backend container, update `package.json` and `package-lock.json` together, and re-run the relevant library documentation lookup before coding against APIs.
