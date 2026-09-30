# Contexto da Fase 03 — Upload e Processamento de Vídeos

## Visão geral

A Fase 03 do StreamTube entrega as capacidades de upload de vídeos até 10 GB, processamento assíncrono em background, armazenamento de mídia em object storage, geração automática de thumbnail, URL pública única por vídeo, streaming com range requests e download final. O escopo desta fase impacta principalmente o backend NestJS e a infraestrutura Docker, com consequências mínimas no frontend além do contrato de upload/streaming.

## Base atual do projeto

### Backend (`nestjs-project/`)
- NestJS 11 com TypeORM, PostgreSQL 17 e serviços auxiliares.
- Módulos existentes: `auth`, `users`, `channels`, `mail`, `common`, `config`, `database`, `swagger`.
- Estrutura de domínio já definida por módulos, services, controllers e repositories.
- Configuração externa via Joi e arquivos de configuração em `src/config/`.
- Banco configurado por `AppDataSource` com migrations e entidades via `src/**/*.entity.ts`.

### Infraestrutura atual
- `compose.yaml` já inclui `nestjs-api`, `db` e `mailpit`.
- O backend se comunica com PostgreSQL via `db` e com Mailpit via `mailpit`, respeitando a regra de usar nomes de serviço do Compose.
- O ambiente ainda não possui object storage, fila de jobs, worker de vídeo e FFmpeg.

### Frontend
- O frontend está em `next-frontend/` e segue um modelo BFF mais estrito, mas a fase atual não exige a implementação de UI de vídeo.
- O contrato de upload/streaming deve ser compatível com a arquitetura futura do frontend, mas não precisa ser implementado nesta fase.

## Requisitos da fase

A Fase 03 exige:
- upload de arquivo grande sem travar a API;
- pré-cadastro do vídeo como rascunho;
- processamento automático após upload;
- extração de metadados e duração;
- geração de thumbnail;
- URL única por vídeo;
- streaming e download;
- persistência em banco de vídeos ligados ao canal;
- infraestrutura real em Docker com storage, fila e worker.

## Decisões e contextos que orientam a implementação

### 1) Arquitetura de upload
O upload de 10 GB exige separar a coordenação do transporte. A API deve criar registros de vídeo iniciais e coordinar os passos do fluxo, mas não deve receber o arquivo completo em um endpoint que consome memória ou mantém conexões longas ativas por tempo excessivo.

A decisão recomendada para esta fase é: multipart upload direto ao object storage com URLs pré-assinadas.

### 2) Armazenamento de mídia
O projeto já aponta para S3 em produção. Em ambiente local, a solução compatível é MinIO. Isso mantém o contrato de object storage consistentemente compatível com `aws-sdk`/S3 sem depender de uma conta cloud.

### 3) Fila e worker
O processamento de vídeo é pesado, dependente de FFmpeg/ffprobe e potencialmente demorado; por isso, o worker deve ser um processo separado, rodando em container isolado, consumindo uma fila assíncrona.

### 4) Modelo de dados do vídeo
A entidade de vídeo precisa refletir: canal, título, status, `publicId`, chaves de storage, duração, metadata, thumbnail, timestamps e erros de processamento. O status deve evoluir de rascunho para pronto ou erro, com transição explícita de estados.

### 5) Streaming e acesso
A reprodução deve ser eficiente. Para o player, o ideal é supportar range requests em um endpoint por `publicId`, com cabeçalhos `Accept-Ranges`, `Content-Type`, `Content-Length` e `Content-Range` quando necessário.

## Dependências técnicas para implementação

### Infraestrutura necessária
- MinIO (object storage compatível com S3)
- Redis (broker da fila)
- Worker de vídeo com FFmpeg/ffprobe
- PostgreSQL (persistência de vídeos)
- NestJS API (coordenação do upload e endpoints)

### Estruturas de código previstas
- `src/videos/` — módulo de vídeos
- `src/videos/entities/video.entity.ts`
- `src/videos/dto/` — DTOs de upload, metadata e response
- `src/videos/services/` — upload service, processing service, queue producer
- `src/videos/controllers/` — endpoints REST
- `src/videos/repositories/` ou repository pattern com TypeORM
- `src/videos/jobs/` — payloads de fila e worker

## Regras de arquitetura

- usar nomes de serviço do Docker (`db`, `redis`, `minio`) em vez de `localhost`;
- manter a API responsável pela coordenação e validação, não pelo processamento pesado;
- usar migrations para a criação da tabela de vídeos;
- separar o processamento em jobs idempotentes;
- manter a massa de lógica de storage e ffmpeg fora do controller.

## Riscos e requisitos de qualidade

- upload com 10GB não pode bloquear a API;
- falha no processamento deve ser rastreada e reprocessável;
- o `publicId` precisa ser único e estável;
- duração e metadados devem ser extraídos de forma consistente;
- status e erros devem ser observáveis em banco;
- o worker e o storage precisam subir via Docker Compose na fase.

## Resultado esperado da fase

Ao fim da implementação, a Fase 03 deve entregar uma API funcional para:
- iniciar upload de vídeo;
- persistir vídeo em rascunho;
- processar automaticamente após upload;
- gerar thumbnail;
- expor URL única e estável;
- servir streaming e download;
- refletir estados e erros em banco;
- rodar em infraestrutura Docker real com storage, fila e worker.

## Observação de rastreabilidade

Este contexto deriva diretamente dos requisitos da fase em `docs/project-plan.md` e das decisões registradas em `docs/decisions/technical-decisions-upload-processing.md`. A implementação e os testes devem seguir precisamente este escopo e não ampliar o desenho sem uma nova decisão formal.
