kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-09-30T00:00:00-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-09-30T18:25:37-03:00"
  docs/phases/phase-03-videos/context.md: "2026-09-30T00:00:00-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-09-30T20:15:47-03:00"
  docs/phases/phase-01-configuracao-base/phase-01-configuracao-base.md: "2026-04-08T14:58:57-03:00"
  docs/phases/phase-02-auth/phase-02-auth.md: "2026-05-12T00:00:00-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver the video upload pipeline for the StreamTube backend: large-file uploads up to 10 GB without blocking the API, persistent draft metadata, asynchronous background processing, object storage, thumbnail generation, unique public URLs, and streaming/download support.

---

## Technical Specifications

### Data Model

`Video` pertence a `Channel` por `channel_id`; `public_id` é UUID único e estável. Campos existentes: título, descrição, `storage_key`, `thumbnail_key`, tamanho bigint, MIME, duração, dimensões, metadata JSONB, erro e timestamps. Novos campos: `upload_id` (identificador multipart), `upload_part_size`, `upload_expires_at`. IDs internos de upload não são divulgados em consultas públicas.

Estados: `DRAFT → UPLOADING → UPLOADED → PROCESSING → READY`; erros de processamento levam a `ERROR`. Reprocessamento do proprietário leva ERROR a UPLOADED; cancelamento do upload retorna a DRAFT. READY é público nesta fase; regras de publicação/visibilidade pertencem à Fase 04. O estado legado FAILED será convertido para ERROR por nova migration, preservando o histórico das migrations existentes.

### API Contracts

| Método/rota | Entrada | Saída/status |
|---|---|---|
| POST /videos/drafts | title, description opcional | vídeo DRAFT / 201 |
| POST /videos/uploads | title, description?, file_size, mime_type | rascunho criado automaticamente + sessão / 201 |
| POST /videos/:publicId/upload | file_size inteiro positivo ≤ 10 GiB, MIME video/* | sessão multipart / 201 |
| POST /videos/:publicId/uploads/parts | part_numbers (1..part_count, no máximo 100 por chamada) | URLs PUT pré-assinadas, tamanho e número de cada parte / 201 |
| POST /videos/:publicId/uploads/complete | parts [{part_number, etag}] | UPLOADED, job enfileirado / 202 |
| DELETE /videos/:publicId/upload | sem corpo | upload abortado, DRAFT / 204 |
| POST /videos/:publicId/process | sem corpo | reprocessamento ERROR enfileirado / 202 |
| GET /videos/mine | sem corpo | vídeos do proprietário / 200 |
| GET /videos/:publicId | autenticação do proprietário | detalhes, URLs se READY / 200 |
| GET /videos | page/limit inteiros positivos, limit ≤ 100 | lista pública READY / 200 |
| GET /videos/:publicId/stream | Range opcional (um único intervalo bytes) | mídia / 200 ou 206 |
| GET /videos/:publicId/download | sem corpo | mídia com Content-Disposition attachment / 200 |

A sessão inclui `public_id`, `storage_key`, `part_size`, `part_count` e `expires_in`. O cliente envia bytes diretamente ao storage; a API recebe apenas JSON. ListParts do storage valida números/ETags/tamanhos reais antes da conclusão. URLs podem ser renovadas enquanto UPLOADING; partes existentes podem ser reenviadas sem reiniciar todo o arquivo. O callback legado `/upload/complete` usa o mesmo contrato de partes.

### Authorization Matrix

| Operação | Anônimo | Outro usuário | Proprietário |
|---|---|---|---|
| Criar rascunho/iniciar upload | 401 | somente canal próprio | permitido |
| Consultar estado/assinar/concluir/cancelar/reprocessar | 401 | 404 (não revelar vídeo privado) | permitido no estado adequado |
| Listar READY/stream/download | permitido se READY | permitido se READY | permitido se READY |

### Error Catalog

Formato global `{statusCode, error, message}`. Códigos: VIDEO_NOT_FOUND (404), VIDEO_STATE_CONFLICT (409), INVALID_VIDEO_UPLOAD (400), UPLOAD_EXPIRED (410), STORAGE_UNAVAILABLE (503), RANGE_NOT_SATISFIABLE (416). ValidationPipe usa VALIDATION_ERROR (400). Erros desconhecidos permanecem 500; não transformar falhas de infraestrutura em arquivo inexistente.

### Events/Messages

Fila `VIDEO_QUEUE_NAME` (padrão video-processing). Job `process-video`: `{videoId, storageKey}`. ID determinístico por vídeo; 3 tentativas com backoff exponencial (1 s inicial), concorrência configurável (padrão 2). Jobs falhos permanecem na fila para diagnóstico; limite de retenção de concluídos. ERROR conserva causa no banco. READY é idempotente: jobs repetidos não regeneram mídia. Completar upload novamente em UPLOADED recupera uma falha anterior de publicação na fila, sem repetir multipart. Worker separado executa ffprobe/FFmpeg com timeout e diretório temporário por job, removido ao terminar.

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
- The module compilation test plus Compose readiness checks validate dependency registration, storage/queue connectivity and the worker process.

**Dependencies:** None

**Acceptance criteria:**

- `docker compose up` starts `nestjs-api`, `db`, `redis`, `minio`, and the worker service successfully.
- The backend can reach Redis and MinIO using Compose service names instead of `localhost`.
- FFmpeg and ffprobe are available inside the worker container.
- Application startup rejects invalid storage/worker configuration; documented local development defaults are supported.

---

### SI-03.2 — Entidade de vídeo e migration inicial

**Description:** Create the persistence model for videos and related upload state. The entity must support draft lifecycle, storage keys, public URL metadata, processing status, and error reporting, while using a TypeORM migration for schema creation.

**Technical actions:**

- Create `src/videos/entities/video.entity.ts` with fields such as: `id`, `channel_id`, `title`, `description`, `status`, `public_id`, `storage_key`, `thumbnail_key`, `duration_seconds`, `width`, `height`, `file_size`, `mime_type`, `metadata`, `created_at`, `updated_at`, `processed_at`, `error_reason`.
- Create a proper enum for video lifecycle states: `DRAFT`, `UPLOADING`, `UPLOADED`, `PROCESSING`, `READY`, `ERROR`.
- Add `@ManyToOne` relation to `Channel` and/or user owner as required by the architecture.
- Add indexes for `channelId`, `status`, `publicId`, and `createdAt`.
- Generate and review migration SQL using `npm run migration:generate -- src/database/migrations/CreateVideosTable`.
- Add `VideosModule` and export the repository provider.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/video-processing.integration-spec.ts` | Integration | Valid status transitions, unique `publicId`, nullable fields, timestamps |
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
- Create DTOs for: `CreateVideoDraftDto`, `StartVideoUploadDto`, `InitializeVideoUploadDto`, `SignUploadPartsDto`, `CompleteVideoUploadDto`.
- Implement `VideosService.createDraft(userId, dto)` to create a record with `status = DRAFT` and a unique `publicId`.
- Implement storage callback logic using AWS S3 client to start multipart upload sessions and return presigned URLs for each part.
- Implement `completeUpload` flow that verifies ETags/parts and updates status to `UPLOADED`.
- Add controller endpoints for draft creation, upload initialization/signing/completion/cancellation and owner status retrieval.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | Draft creation, publicId generation, upload session state |
| `test/videos.e2e-spec.ts` | E2E | API contract for draft and upload lifecycle |

**Dependencies:** SI-03.2

**Acceptance criteria:**

- A channel owner can create a video draft via API.
- The initial video record is persisted before upload begins.
- Upload session creation returns presigned multipart URLs without exposing raw storage credentials.
- Completing upload moves the record to `UPLOADED` and triggers the processing job.
- Failed or partial upload sessions do not mark the video as ready.

---

### SI-03.4 — Fila de processamento com BullMQ e worker de mídia

**Description:** Implement a dedicated queue and worker pipeline that consumes video uploads and performs metadata extraction plus thumbnail generation in the background. This keeps the API responsive while allowing retries and failure observability. FFmpeg/ffprobe read the object via an internal presigned GET URL with HTTP seeking; only the thumbnail is written locally. Signed URLs are omitted from metadata and errors.

**Technical actions:**

- Use `VideosService.enqueue` and `VideoQueueModule` to enqueue `process-video` jobs for newly uploaded videos.
- Create a `VideoProcessingService` that reads the object through signed internal HTTP Range requests without duplicating a 10 GiB file locally, runs `ffprobe` to extract metadata/duration, and `ffmpeg` to create a thumbnail.
- Use idempotent job keys based on video ID and processing attempt/version.
- Add retry and backoff settings in BullMQ configuration.
- Update the video status to `PROCESSING` before work starts and to `READY` or `ERROR` after completion.
- Persist `errorReason` and timestamps when processing fails.
- Define a dead-letter or failed-job policy for unprocessable videos.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | Job enqueues correct payload and queue names |
| `src/videos/video-processing.integration-spec.ts` | Integration | ffprobe/ffmpeg job completes and updates database state |

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
- Expose only READY media publicly; defer publish/unlisted/private controls to Phase 04.
- Implement a download endpoint that uses the same underlying storage service but returns the video file with valid headers.
- Centralize authorization checks in the `VideosService` for channel ownership or public visibility.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/streaming-range.spec.ts` | Unit | Range parsing and invalid range handling |
| `test/videos.e2e-spec.ts` | E2E | Public endpoint returns `206` on range requests and correct headers |

**Dependencies:** SI-03.3, SI-03.4

**Acceptance criteria:**

- A video can be served by `GET /videos/:publicId` and uses its stable public identifier.
- Range-based requests begin playback before the full file is downloaded.
- The API returns `416` for invalid ranges and does not crash on malformed `Range` headers.
- Download and streaming share the same storage security rules.

---

### SI-03.6 — Gestão de rascunho e validação de fluxo end-to-end

**Description:** Close the Phase 03 lifecycle by listing owner videos and validating upload to READY, without adding the publication UI or Phase 04 visibility controls.

**Technical actions:**

- Keep READY videos publicly accessible; preserve owner-only draft queries.
- Add ownership validation and status guards for upload/cancel/reprocessing operations.
- Add end-to-end tests exercising: draft creation → upload session → processing → ready → public access.
- Validate the flow via dockerized integration tests and/or application-level API tests.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `test/videos.e2e-spec.ts` | E2E | Full upload/processing/READY/public-media flow |
| `src/videos/video-processing.integration-spec.ts` | Integration | Status transitions and authorization checks |

**Dependencies:** SI-03.3, SI-03.4, SI-03.5

**Acceptance criteria:**

- A user can create a video draft and its media becomes accessible after processing reaches READY.
- Videos remain accessible through their public URL once ready.
- Failed processing leaves the video in `ERROR` state without exposing it as ready.
- API returns stable error payloads on invalid state transitions.

---

## Dependency Map

SI-03.1 (no deps)
├── SI-03.2
│   └── SI-03.3
│       ├── SI-03.4
│       │   └── SI-03.5
│       └── SI-03.6


## Deliverables

- [x] Docker Compose has `redis`, `minio`, and dedicated worker services for video processing
- [x] Backend environment configuration includes storage and queue settings
- [x] `videos` module exists with TypeORM entity and migrations
- [x] Upload API supports draft creation and multipart upload session coordination
- [x] Queue and worker pipeline process metadata and thumbnails asynchronously
- [x] Stable `publicId` + streaming/download endpoints support range requests
- [x] Draft-to-ready lifecycle and error handling are persisted to the database
- [x] Integration/E2E tests cover upload → processing → ready → public access flow
- [x] Project builds and the NestJS backend compiles with all new dependencies
- [x] Local dev environment is reproducible without external cloud services

---

## Notes

This phase intentionally does not include the frontend video player or UI screens. The goal is to complete the backend contract and infrastructure needed by the next phases, while keeping the system consistent with the architecture defined in `docs/decisions/technical-decisions-phase-03-videos.md`.
