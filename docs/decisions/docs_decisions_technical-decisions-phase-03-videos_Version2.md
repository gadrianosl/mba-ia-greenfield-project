# Technical Decisions — Phase 03 Videos

## Context
Fase 03 exige upload até 10GB, processamento assíncrono, thumbnail, URL única, streaming e download, com infraestrutura em Docker.

## Decision 1 — Queue technology
### Options considered
- BullMQ + Redis
- RabbitMQ
- SQS
- Kafka

### Trade-offs
- BullMQ + Redis: integração simples com Node/NestJS, boa ergonomia para retries/backoff, controle de concorrência e operação local fácil no Compose.
- RabbitMQ: robusto e adequado para roteamento complexo, porém adiciona maior custo operacional e complexidade para o escopo atual.
- SQS: excelente em produção na AWS e com baixa necessidade de operação, mas adiciona dependência externa, custo e dificulta a reprodução fiel do ambiente local.
- Kafka: poderoso para alto volume de eventos e retenção de streams, mas é excessivo para a fila de jobs desta fase e aumenta bastante a complexidade operacional.

### Decision
**BullMQ + Redis**.

### Rationale
BullMQ é uma escolha adequada ao ecossistema Node/NestJS e fornece os recursos necessários para processamento assíncrono de vídeos: retries, backoff, delays, concorrência e acompanhamento de jobs. Redis funciona como dependência simples e bem suportada para o ambiente local em Docker Compose. A combinação mantém o custo operacional baixo sem impedir uma evolução posterior para uma infraestrutura gerenciada.

### Consequences
- Adicionar serviço Redis no `compose.yaml`.
- Criar producer no módulo de vídeos e consumer no worker.
- Definir política de retry, backoff, timeout e limite de concorrência.

---

## Decision 2 — Upload strategy for 10GB
### Options considered
- Upload passando pela API NestJS
- Upload direto ao object storage via pre-signed URL (multipart)
- Upload único por PUT para o storage

### Trade-offs
- Via API: aumenta uso de CPU/memória/rede da API, mantém conexões longas abertas e eleva o risco de timeout ou travamento.
- Direto ao storage: API apenas coordena a sessão de upload; reduz o tráfego pesado pela API e melhora a escalabilidade.
- PUT único: implementação inicial simples, mas menos resiliente a falhas de rede e inadequado para retomada granular de arquivos muito grandes.

### Decision
**Upload direto ao MinIO/S3 com pre-signed URL multipart**.

### Rationale
Arquivos de até 10GB não devem atravessar a API NestJS. O multipart upload permite dividir o arquivo em partes, repetir somente as partes com falha e retomar o processo sem reiniciar todo o envio. As URLs pré-assinadas permitem que o cliente envie os bytes diretamente ao storage, enquanto a API mantém controle sobre autorização, estado e finalização.

### Consequences
- Endpoints para iniciar upload, receber URLs pré-assinadas das partes e finalizar upload.
- Pré-cadastro do vídeo antes do envio.
- Persistência do upload id, das partes e do estado de conclusão.
- Definição de política de expiração e limpeza de uploads incompletos.

---

## Decision 3 — Object storage
### Options considered
- MinIO local compatível com S3
- AWS S3 diretamente no desenvolvimento
- Filesystem local/container volume
- Google Cloud Storage ou Azure Blob Storage

### Trade-offs
- MinIO: reproduz a API S3 localmente, sem custo de cloud e com operação simples em Docker; exige atenção para manter diferenças de produção sob controle.
- AWS S3 direto: ambiente próximo da produção, porém adiciona custo, credenciais, latência e dependência de uma conta cloud durante o desenvolvimento.
- Filesystem local: simples para prototipagem, mas frágil, pouco escalável, difícil de compartilhar entre réplicas e desalinhado ao requisito de object storage.
- GCS/Azure Blob: opções válidas em cloud, mas desviam do padrão S3 adotado para o contrato de storage desta fase.

### Decision
**MinIO no ambiente local, usando contrato compatível com S3**.

### Rationale
MinIO permite desenvolver e testar localmente os mesmos conceitos usados em S3: buckets, object keys, multipart upload e URLs pré-assinadas. Isso reduz custo e dependências externas sem acoplar a aplicação a uma implementação proprietária. Em produção, o cliente S3 poderá apontar para AWS S3 ou outro storage compatível por configuração.

### Consequences
- Adicionar serviço MinIO ao Compose.
- Configurar endpoint, bucket, região, credenciais e URLs via ambiente.
- Evitar dependência de APIs específicas do MinIO no domínio da aplicação.

---

## Decision 4 — Worker and media processing
### Options considered
- Processar no mesmo processo da API
- Worker dedicado em container separado
- Serviço externo gerenciado de mídia

### Trade-offs
- Mesmo processo: implementação inicial simples, mas mistura carga pesada de CPU/I/O com o tráfego da API.
- Worker separado: isolamento de carga, melhor resiliência e possibilidade de escalar consumidores independentemente.
- Serviço externo: reduz a operação de ffmpeg e infraestrutura, mas aumenta custo, acoplamento a fornecedor e complexidade de integração.

### Decision
**Worker dedicado**, consumindo fila e usando **ffprobe** (metadados/duração) e **ffmpeg** (thumbnail).

### Rationale
A extração de metadados e a geração de thumbnails são tarefas potencialmente demoradas e intensivas em CPU/I/O. Um worker separado impede que essas tarefas degradem a API e permite controlar concorrência, retries e recursos de forma independente. ffprobe é apropriado para leitura de metadados; ffmpeg atende à geração de thumbnails e futuras operações de mídia.

### Consequences
- Novo serviço no Compose para worker.
- Pipeline de job com retries, timeout e dead-letter policy (ou equivalente).
- Imagem do worker deve conter ffmpeg e ffprobe.
- Jobs devem ser idempotentes e atualizar o estado do vídeo de forma transacional quando necessário.

---

## Decision 5 — Unique URL and streaming
### Options considered
- Slug por título
- Identificador técnico único (UUID/ULID) + slug opcional
- Download completo obrigatório

### Trade-offs
- Slug por título gera colisões, exige normalização e pode expor informações do título.
- UUID/ULID garante unicidade simples e desacopla a URL da alteração do título; é menos legível isoladamente.
- Download completo obrigatório piora a experiência e impede iniciar playback antes de transferir todo o arquivo.

### Decision
- **publicId único (UUID/ULID)** por vídeo.
- Streaming com suporte a **HTTP Range** e retorno **206 Partial Content**.

### Rationale
O `publicId` oferece uma referência estável e sem colisões para playback e download, mesmo quando o título muda. O suporte a `Range` permite que clientes de vídeo solicitem somente trechos do arquivo, tornando possível iniciar e controlar a reprodução sem baixar o conteúdo inteiro.

### Consequences
- Endpoint de playback resolve por `publicId`.
- Implementar cabeçalhos de `Accept-Ranges`, `Content-Length`, `Content-Range` e `Content-Type`.
- Tratar ranges inválidos com resposta apropriada, como `416 Range Not Satisfiable`.

---

## Decision 6 — Video status lifecycle
### Proposed lifecycle
`DRAFT -> UPLOADING -> UPLOADED -> PROCESSING -> READY | ERROR`

### Failure handling
- Em falha de processamento: status `ERROR`, com `errorReason`.
- Permitir reprocessamento por novo job (idempotente por `videoId` + versão/attempt).
- Registrar timestamps por etapa.
- Limpar ou marcar uploads incompletos conforme política de retenção.

### Consequences
- Modelo de dados com status, metadados e campos de erro.
- Regras de autorização por dono do canal.
- Transições de estado devem ser validadas para evitar avanço inválido ou processamento duplicado.

---

## Libraries and versions validation
As bibliotecas e versões devem ser validadas no fluxo de `plan-resolve` e registradas em `library-refs.md` (quando aplicável).
