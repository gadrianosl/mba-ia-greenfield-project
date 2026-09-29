# Technical Decisions — Phase 03 Videos

## Context
Fase 03 exige upload até 10GB, processamento assíncrono, thumbnail, URL única, streaming e download, com infraestrutura em Docker.

## Decision 1 — Queue technology
### Options considered
- BullMQ + Redis
- RabbitMQ
- SQS

### Trade-offs
- BullMQ + Redis: integração simples com Node/NestJS, boa ergonomia para retries/backoff e operação local fácil no Compose.
- RabbitMQ: robusto, porém maior custo operacional e complexidade para o escopo atual.
- SQS: excelente em cloud, mas adiciona dependência externa e complica ambiente local.

### Decision
**BullMQ + Redis**.

### Consequences
- Adicionar serviço Redis no `compose.yaml`.
- Criar producer no módulo de vídeos e consumer no worker.

---

## Decision 2 — Upload strategy for 10GB
### Options considered
- Upload passando pela API NestJS
- Upload direto ao object storage via pre-signed URL (multipart)

### Trade-offs
- Via API: aumenta uso de CPU/memória/rede da API e risco de travamento.
- Direto ao storage: API apenas coordena sessão de upload; melhor escalabilidade para arquivos grandes.

### Decision
**Upload direto ao MinIO/S3 com pre-signed URL multipart**.

### Consequences
- Endpoints para iniciar upload, receber partes e finalizar upload.
- Pré-cadastro do vídeo antes do envio.

---

## Decision 3 — Worker and media processing
### Options considered
- Processar no mesmo processo da API
- Worker dedicado em container separado

### Trade-offs
- Mesmo processo: concorrência com tráfego da API.
- Worker separado: isolamento de carga, melhor resiliência.

### Decision
**Worker dedicado**, consumindo fila e usando **ffprobe** (metadados/duração) e **ffmpeg** (thumbnail).

### Consequences
- Novo serviço no Compose para worker.
- Pipeline de job com retries, timeout e dead-letter policy (ou equivalente).

---

## Decision 4 — Unique URL and streaming
### Options considered
- Slug por título
- Identificador técnico único (UUID/ULID) + slug opcional

### Trade-offs
- Slug por título gera colisões e regras extras.
- UUID/ULID garante unicidade simples.

### Decision
- **publicId único (UUID/ULID)** por vídeo.
- Streaming com suporte a **HTTP Range** e retorno **206 Partial Content**.

### Consequences
- Endpoint de playback resolve por `publicId`.
- Implementar cabeçalhos de range/content-length/content-range.

---

## Decision 5 — Video status lifecycle
### Proposed lifecycle
`DRAFT -> UPLOADING -> UPLOADED -> PROCESSING -> READY | ERROR`

### Failure handling
- Em falha de processamento: status `ERROR`, com `errorReason`.
- Permitir reprocessamento por novo job (idempotente por `videoId` + versão/attempt).
- Registrar timestamps por etapa.

### Consequences
- Modelo de dados com status, metadados e campos de erro.
- Regras de autorização por dono do canal.

---

## Libraries and versions validation
As bibliotecas e versões devem ser validadas no fluxo de `plan-resolve` e registradas em `library-refs.md` (quando aplicável).
