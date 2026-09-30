---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-09-30T00:00:00-03:00"
  docs/decisions/technical-decisions-upload-processing.md: "2026-09-30T18:25:37-03:00"
  docs/phases/phase-03-videos/context.md: "2026-09-30T00:00:00-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-09-30T20:15:47-03:00"
  docs/phases/phase-01-configuracao-base/phase-01-configuracao-base.md: "2026-04-08T14:58:57-03:00"
  docs/phases/phase-02-auth/phase-02-auth.md: "2026-05-12T00:00:00-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver the video upload pipeline for the StreamTube backend: large-file uploads up to 10 GB without blocking the API, persistent draft metadata, asynchronous background processing, object storage, thumbnail generation, unique public URLs, and streaming/download support.

---

## Step Implementations

### SI-03.1 — Infraestrutura Docker: Redis, MinIO e worker de vídeo

**Description:** Extend the local Docker Compose environment with the services required by the upload pipeline: object storage compatible with S3, Redis for job processing, and a dedicated worker image containing FFmpeg/ffprobe. Update environment config so the backend can connect to all services without hard-coded local addresses.

**Technical actions:**

- Add `redis` service to `nestjs-project/compose.yaml` with a stable service name and port for the queue broker.
- Add `minio` service to `nestjs-project/compose.yaml` with console and API ports, default bucket setup, and healthchecks.
- Add a dedicated video worker service (separate container) with `ffmpeg` and `ffprobe` installed and dependent on Redis and MinIO.
- Add queue/storage environment variables to `src/config/env.validation.ts` and `.env.example`: Redis host/port, MinIO endpoint/region, access key, secret key, bucket name, public URL base, and worker settings.
- Install backend production dependencies: `bullmq`, `@aws-sdk/client-s3`, and `@aws-sdk/s3-request-presigner`.

**Tests:**

- Docker healthchecks confirm `db`, `redis`, and `minio` are healthy.
- A focused integration test validates the application bootstraps with all new environment variables set.

**Dependencies:** None

**Acceptance criteria:**

- `docker compose up` starts `nestjs-api`, `db`, `redis`, `minio`, and the worker service successfully.
- The backend can reach Redis and MinIO using Compose service names instead of `localhost`.
- FFmpeg and ffprobe are available inside the worker container.
- Application startup fails early if required storage/queue environment variables are absent.

---

### SI-03.2 — Entidade de vídeo e migration inicial

**Description:** Create the persistence model for videos and related upload state. The entity must support draft lifecycle, storage keys, public URL metadata, processing status, and error reporting, while using a TypeORM migration for schema creation.

**Technical actions:**

- Create `src/videos/entities/video.entity.ts` with fields such as: `id`, `channelId`, `title`, `description`, `status`, `publicId`, `storageKey`, `thumbnailKey`, `durationSeconds`, `width`, `height`, `fileSize`, `mimeType`, `metadata`, `createdAt`, `updatedAt`, `processedAt`, `errorReason`.
- Create a proper enum for video lifecycle states: `DRAFT`, `UPLOADING`, `UPLOADED`, `PROCESSING`, `READY`, `ERROR`.
- Add `@ManyToOne` relation to `Channel` and/or user owner as required by the architecture.
- Add indexes for `channelId`, `status`, `publicId`, and `createdAt`.
- Generate and review migration SQL using `npm run migration:generate -- src/database/migrations/CreateVideosTable`.
- Add `VideosModule` and export the repository provider.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/entities/video.entity.integration-spec.ts` | Integration | Valid status transitions, unique `publicId`, nullable fields, timestamps |
| `src/videos/videos.module.spec.ts` | Unit | Module compiles and registers repository |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `npm run migration:run` creates the videos table with all required columns and indexes.
- The entity rejects invalid status values via enum or validation rules.
- A new video can be created as `DRAFT` without processing metadata.
- Storage keys and `publicId` are persisted before the processing worker runs.

---

### SI-03.3 — Módulo de vídeos, DTOs e coordenação de upload

**Description:** Implement the API-side orchestration layer for video drafts and upload sessions. The backend must create videos in draft mode and coordinate presigned uploads without streaming the full file through the NestJS process.

**Technical actions:**

- Create `src/videos/videos.module.ts`, `videos.controller.ts`, `videos.service.ts`, and repository/service abstractions.
- Create DTOs for: `CreateVideoDraftDto`, `UpdateVideoMetadataDto`, `InitiateUploadDto`, `CompleteUploadDto`, `VideoResponseDto`.
- Implement `VideosService.createDraft(channelId, dto)` to create a record with `status = DRAFT` and a unique `publicId`.
- Implement storage callback logic using AWS S3 client to start multipart upload sessions and return presigned URLs for each part.
- Implement `completeUpload` flow that verifies ETags/parts and updates status to `UPLOADED`.
- Add controller endpoints for draft creation, metadata update, upload initialization, upload completion, and status retrieval.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | Draft creation, publicId generation, upload session state |
| `src/videos/videos.controller.integration-spec.ts` | Integration | API contract for draft and upload lifecycle |

**Dependencies:** SI-03.2

**Acceptance criteria:**

- A channel owner can create a video draft via API.
- The initial video record is persisted before upload begins.
- Upload session creation returns presigned multipart URLs without exposing raw storage credentials.
- Completing upload moves the record to `UPLOADED` and triggers the processing job.
- Failed or partial upload sessions do not mark the video as ready.

---

### SI-03.4 — Fila de processamento com BullMQ e worker de mídia

**Description:** Implement a dedicated queue and worker pipeline that consumes video uploads and performs metadata extraction plus thumbnail generation in the background. This keeps the API responsive while allowing retries and failure observability.

**Technical actions:**

- Create a `VideoQueueService` that enqueues `process-video` jobs for newly uploaded videos.
- Create a `VideoProcessorService` that reads the object from MinIO/S3, runs `ffprobe` to extract metadata/duration, and `ffmpeg` to create a thumbnail.
- Use idempotent job keys based on video ID and processing attempt/version.
- Add retry and backoff settings in BullMQ configuration.
- Update the video status to `PROCESSING` before work starts and to `READY` or `ERROR` after completion.
- Persist `errorReason` and timestamps when processing fails.
- Define a dead-letter or failed-job policy for unprocessable videos.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/queue/video-queue.service.spec.ts` | Unit | Job enqueues correct payload and queue names |
| `src/videos/queue/video-processor.integration-spec.ts` | Integration | ffprobe/ffmpeg job completes and updates database state |

**Dependencies:** SI-03.1, SI-03.3

**Acceptance criteria:**

- New uploads automatically queue a processing job.
- Worker consumes jobs without blocking the HTTP API.
- Video metadata such as duration, dimensions, and mime type are persisted.
- Thumbnail is generated and saved to the object storage bucket.
- Failed jobs update the video status to `ERROR` and preserve the reason.

---

### SI-03.5 — Streaming, download e visualização pública por `publicId`

**Description:** Expose a stable public URL for each video and support partial content delivery to enable streaming while preserving authorization logic in the NestJS backend.

**Technical actions:**

- Implement a public fetch endpoint resolved by `publicId` instead of database row ID.
- Support HTTP Range requests with proper `Accept-Ranges`, `Content-Length`, `Content-Range`, and `206 Partial Content` behavior.
- Add visibility handling for published videos and unlisted/private access.
- Implement a download endpoint that uses the same underlying storage service but returns the video file with valid headers.
- Centralize authorization checks in the `VideosService` for channel ownership or public visibility.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/streaming/video-streaming.service.spec.ts` | Unit | Range parsing and invalid range handling |
| `src/videos/videos.controller.integration-spec.ts` | Integration | Public endpoint returns `206` on range requests and correct headers |

**Dependencies:** SI-03.3, SI-03.4

**Acceptance criteria:**

- A video can be served by `GET /videos/:publicId` and uses its stable public identifier.
- Range-based requests begin playback before the full file is downloaded.
- The API returns `416` for invalid ranges and does not crash on malformed `Range` headers.
- Download and streaming share the same storage security rules.

---

### SI-03.6 — Publicação, gestão de rascunho e validação de fluxo end-to-end

**Description:** Close the core lifecycle by allowing a draft to be published, listing videos by owner, and validating the complete flow from upload to ready state with test coverage.

**Technical actions:**

- Add endpoint to publish or update a draft after processing completes.
- Add listing queries for channel videos by status and visibility.
- Add ownership validation and status guards before publication or changes.
- Add end-to-end tests exercising: draft creation → upload session → processing → ready → public access.
- Validate the flow via dockerized integration tests and/or application-level API tests.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `test/videos.e2e-spec.ts` | E2E | Full upload/processing/publication flow |
| `src/videos/videos.service.integration-spec.ts` | Integration | Status transitions and authorization checks |

**Dependencies:** SI-03.3, SI-03.4, SI-03.5

**Acceptance criteria:**

- A user can create a video draft and publish it after processing.
- Videos remain accessible through their public URL once ready.
- Failed processing leaves the video in `ERROR` state without exposing it as ready.
- API returns stable error payloads on invalid state transitions.

---

## Dependency Map

```
SI-03.1 (no deps)
├── SI-03.2
│   └── SI-03.3
│       ├── SI-03.4
│       │   └── SI-03.5
│       └── SI-03.6
```

## Deliverables

- [ ] Docker Compose has `redis`, `minio`, and dedicated worker services for video processing
- [ ] Backend environment configuration includes storage and queue settings
- [ ] `videos` module exists with TypeORM entity and migrations
- [ ] Upload API supports draft creation and multipart upload session coordination
- [ ] Queue and worker pipeline process metadata and thumbnails asynchronously
- [ ] Stable `publicId` + streaming/download endpoints support range requests
- [ ] Draft-to-ready lifecycle and error handling are persisted to the database
- [ ] Integration/E2E tests cover upload → processing → ready → public access flow
- [ ] Project builds and the NestJS backend compiles with all new dependencies
- [ ] Local dev environment is reproducible without external cloud services

---

## Notes

This phase intentionally does not include the frontend video player or UI screens. The goal is to complete the backend contract and infrastructure needed by the next phases, while keeping the system consistent with the architecture defined in `docs/decisions/technical-decisions-upload-processing.md`.
