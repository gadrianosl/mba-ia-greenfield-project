---
libs:
  bullmq: { version: "6.3.11" }
  "@nestjs/bullmq": { version: "12.0.0" }
  "@aws-sdk/client-s3": { version: "3.1147.0" }
  "@aws-sdk/s3-request-presigner": { version: "3.1147.0" }
  ffmpeg: { observed_version: "5.1.9-0+deb12u1" }
  minio: { version: "2025.4.22", image_digest: "sha256:a26e42a4d6550d2fb7708c8ceefc60474b42c124b6f3273a081721ddf1d86b20" }
---

# Library References — Phase 03 Videos

Revisão em 2026-10-13. Versões Node/dependências verificadas no container e package-lock. FFmpeg é instalado por APT nos Dockerfiles e a versão acima é a observada nesta validação. MinIO e Node estão fixados no Compose/Dockerfiles.

Context7 não foi exposto como ferramenta nativa nesta sessão. O adaptador stdio 4.3.0 foi iniciado e resolve-library-id foi solicitado, mas retornou fetch failed; nenhuma documentação veio dessa tentativa. Foram consultadas fontes oficiais verificáveis via GitHub e assinaturas das APIs das versões instaladas. A configuração equivalente para novas sessões Codex está em `.codex/config.toml`. Não se atribuem a Context7 resultados que não foram obtidos.

## S3 multipart — AWS SDK v3

Fonte oficial: https://github.com/awsdocs/amazon-s3-userguide/blob/main/doc_source/mpuoverview.md

O protocolo cria UploadId, assina UploadPart (PartNumber e ContentLength), lista partes para verificar tamanhos/ETags e conclui com CompleteMultipartUpload. AbortMultipartUpload libera partes de sessões canceladas. Assinaturas verificadas nos tipos do SDK 3.1147.0. Parte mínima de 5 MiB, exceto a última; máximo 10.000 partes. A escolha local de 64 MiB produz 160 partes para 10 GiB. Upload e conclusão reais foram testados com MinIO, incluindo o tamanho de 10 GiB.

## BullMQ + Nest

Fontes oficiais:
- https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/guide/workers/README.md
- https://github.com/nestjs/bull/blob/master/packages/bullmq/lib/bull.module.ts
- Tipos instalados de Queue/Worker em bullmq 6.3.11 e @nestjs/bullmq 12.0.0.

Queue.add usa jobId determinístico, attempts:3, backoff exponencial. Apenas WorkerModule registra o Processor; API registra produtor/repositórios. Worker.waitUntilReady demonstra conexão com Redis. Contexto Nest trata encerramento e fechamento das conexões. Jobs falhos retidos para diagnóstico/reprocessamento.

## FFmpeg / ffprobe

Fonte oficial da linha testada: https://github.com/FFmpeg/FFmpeg/blob/n5.1.9/doc/protocols.texi (HTTP, seekable) e https://github.com/FFmpeg/FFmpeg/blob/n5.1.9/doc/ffprobe.texi.

ExecFile executa sem shell, com timeout/maxBuffer. FFprobe lê JSON de format/streams e FFmpeg extrai um frame; entrada HTTP interna assinada suporta seeking, sem baixar outra cópia integral do vídeo. Formatos de mídia aceitos pelo worker: MOV/MP4, Matroska/WebM, AVI, MPEG/TS, Ogg e FLV; manifestos/playlists não são habilitados. URLs não são persistidas. Thumbnail temporário isolado é removido em finally. Os testes usaram mídia real, inclusive subsegundo, e arquivo inválido. Fluent-ffmpeg não é usado no novo pipeline.

## MinIO

Fonte oficial do servidor: https://github.com/minio/minio/tree/RELEASE.2025-04-22T22-12-26Z

Imagem Bitnami 2025.4.22 fixada por digest; servidor, bucket, multipart, head/get/delete e HTTP Range foram exercitados. Credenciais do Compose são apenas de desenvolvimento local. Sem conta S3 externa requerida.
