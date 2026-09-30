---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-09-30
scope_description: "Decisões técnicas para upload, armazenamento, processamento assíncrono, streaming e download de vídeos na Fase 03."
---

# Technical Decisions — Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — API, persistência, coordenação do upload, publicação de jobs e endpoints de streaming/download.
- `docs/` — decisões arquiteturais e artefatos do pipeline de planejamento.
- `next-frontend/` — participa apenas do contrato de upload/streaming; a interface de vídeos permanece fora do escopo desta fase.

As escolhas abaixo foram resolvidas pelo usuário em 30 de setembro de 2026, todas pela opção A. Os contratos detalhados de API, autorização, erros e testes permanecem como pendências de planejamento a serem formalizadas antes da implementação.

---

## TD-01: Tecnologia da fila de processamento

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O processamento de metadados e thumbnail não deve bloquear a API. A solução precisa rodar localmente em Docker, integrar-se ao ecossistema Node/NestJS e oferecer retries, backoff e concorrência.

**Options:**

### Option A: BullMQ + Redis
- BullMQ usa Redis como backend e oferece filas, workers, retries, backoff, concorrência e recuperação de jobs.
- **Pros:** integração natural com Node/NestJS; operação simples no Compose; bom suporte a retries e controle de concorrência.
- **Cons:** adiciona Redis à infraestrutura e exige disciplina para idempotência e configuração de conexão.

### Option B: RabbitMQ
- RabbitMQ fornece broker de mensagens com acknowledgements, roteamento e consumidores independentes.
- **Pros:** mensageria madura e roteamento flexível.
- **Cons:** maior custo operacional para uma fila de jobs simples.

### Option C: Amazon SQS
- A API publica jobs em uma fila gerenciada na AWS e o worker consome remotamente.
- **Pros:** reduz operação de infraestrutura em produção.
- **Cons:** prejudica a reprodução local e introduz dependência externa.

**Recommendation:** BullMQ + Redis — atende ao processamento assíncrono com menor complexidade operacional.

**Decision:** Option A — BullMQ + Redis.

**Libraries:** `bullmq`, Redis service.

---

## TD-02: Upload de arquivos de até 10 GB

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** O arquivo grande não deve atravessar a API NestJS. A API cria e controla a sessão, enquanto o cliente envia os dados diretamente ao storage.

**Options:**

### Option A: Multipart upload direto ao S3/MinIO com URLs pré-assinadas
- A API inicia o multipart upload, gera URLs para as partes e finaliza o upload após receber os ETags.
- **Pros:** evita conexões longas na API; permite retomar partes com falha; reduz memória e tráfego do backend.
- **Cons:** exige persistir upload id/partes e implementar expiração e limpeza.

### Option B: Upload streaming passando pela API
- O cliente envia o arquivo para a API, que transmite o body para o storage.
- **Pros:** contrato inicial mais simples.
- **Cons:** mantém a API como gargalo de rede.

### Option C: PUT único pré-assinado
- A API gera uma URL para um único upload completo.
- **Pros:** implementação menor.
- **Cons:** falhas exigem repetir o arquivo inteiro.

**Recommendation:** Multipart direto ao S3/MinIO com URLs pré-assinadas.

**Decision:** Option A — multipart direto ao S3/MinIO com URLs pré-assinadas.

**Libraries:** AWS SDK for JavaScript v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`).

---

## TD-03: Object storage local e contrato de produção

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** O projeto utiliza S3 como contrato de storage em produção. O desenvolvimento local precisa ser reproduzível sem credenciais externas.

**Options:**

### Option A: MinIO local compatível com S3
- O Compose executa MinIO e a aplicação usa APIs S3 para buckets, objetos e multipart upload.
- **Pros:** sem custo cloud; executável localmente; preserva o contrato S3.
- **Cons:** diferenças operacionais de produção precisam ser verificadas no deploy.

### Option B: AWS S3 também no desenvolvimento
- O ambiente local usa diretamente um bucket AWS.
- **Pros:** proximidade com produção.
- **Cons:** exige conta, credenciais, custos e conectividade.

### Option C: Filesystem em volume Docker
- Os arquivos são gravados em um volume local compartilhado.
- **Pros:** simples para protótipos.
- **Cons:** diverge do contrato de object storage.

**Recommendation:** MinIO local com contrato compatível com S3.

**Decision:** Option A — MinIO local compatível com S3.

**Libraries:** `@aws-sdk/client-s3`, MinIO Docker image.

---

## TD-04: Worker e processamento de mídia

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Capability:** Geração automática de thumbnail a partir de um frame do vídeo

**Context:** ffprobe e ffmpeg são operações de CPU/I/O potencialmente demoradas e devem ficar fora do processo HTTP.

**Options:**

### Option A: Worker dedicado em container separado
- Um processo/container consome jobs e executa ffprobe e ffmpeg sobre uma cópia temporária do objeto.
- **Pros:** isola carga da API; permite escalar workers; facilita healthcheck e limites de recursos.
- **Cons:** exige imagem própria e política de retry/idempotência.

### Option B: Processar no mesmo processo da API
- A API executa os comandos após finalizar o upload.
- **Pros:** menos serviços.
- **Cons:** mistura carga pesada com tráfego HTTP.

### Option C: Serviço gerenciado de vídeo
- Um provedor externo processa o objeto.
- **Pros:** reduz operação de FFmpeg.
- **Cons:** aumenta custo e acoplamento.

**Recommendation:** Worker dedicado com ffprobe para metadados e ffmpeg para thumbnail.

**Decision:** Option A — worker dedicado em container separado.

**Libraries:** FFmpeg/ffprobe no container do worker; `bullmq` para consumo da fila.

---

## TD-05: URL pública e streaming

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Capability:** Reprodução via streaming (sem necessidade de download completo)

**Capability:** Download do vídeo pelo usuário

**Context:** A URL não deve depender do título e o player precisa solicitar intervalos do objeto.

**Options:**

### Option A: `publicId` técnico estável + HTTP Range
- Cada vídeo recebe um UUID/ULID público independente do título; o endpoint aceita `Range` e responde `206 Partial Content` quando aplicável.
- **Pros:** unicidade, estabilidade e compatibilidade com players.
- **Cons:** exige tratamento de ranges e cabeçalhos.

### Option B: Slug derivado do título + resposta completa
- A URL usa o título normalizado e retorna o arquivo inteiro.
- **Pros:** URL legível.
- **Cons:** colisões e ausência de streaming real.

### Option C: URL do storage exposta diretamente
- O cliente recebe URL pré-assinada do objeto.
- **Pros:** reduz carga da API.
- **Cons:** expõe detalhes do storage e dificulta autorização centralizada.

**Recommendation:** `publicId` técnico estável com endpoint de streaming/download que suporte HTTP Range.

**Decision:** Option A — `publicId` estável + HTTP Range.

---

## TD-06: Ciclo de status e falhas de processamento

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** O banco precisa refletir o progresso e impedir que um vídeo incompleto seja tratado como pronto.

**Options:**

### Option A: Máquina de estados explícita
- Estados: `DRAFT -> UPLOADING -> UPLOADED -> PROCESSING -> READY | ERROR`, com transições validadas.
- **Pros:** representa o fluxo real e facilita autorização, observabilidade, retries e testes.
- **Cons:** exige regras de transição e timestamps.

### Option B: Booleanos independentes
- Campos booleanos representam upload, processamento e falha.
- **Pros:** modelo inicial curto.
- **Cons:** combinações inválidas são fáceis de criar.

### Option C: Status implícito por presença de objetos
- O estado é inferido pela existência dos objetos.
- **Pros:** menos persistência explícita.
- **Cons:** não representa corretamente falhas e retries.

**Recommendation:** Máquina de estados explícita com `errorReason`, timestamps por etapa e jobs idempotentes.

**Decision:** Option A — máquina de estados explícita.

---

## Restrições operacionais resolvidas

### Autorização e visibilidade
- Iniciar, assinar, concluir e cancelar uploads exige usuário autenticado e proprietário do canal associado.
- Reprocessamento exige usuário autenticado e proprietário do vídeo.
- Streaming e download anônimos ficam restritos a vídeos `READY` e públicos.
- O proprietário autenticado pode consultar sua mídia não pública; regras de publicação detalhadas permanecem para a Fase 04.

### Contratos de API
O plano deve especificar, no mínimo:
- `POST /videos/uploads` para pré-cadastro e início do multipart;
- `POST /videos/:publicId/uploads/parts` para URLs pré-assinadas;
- `POST /videos/:publicId/uploads/complete` para finalizar o upload;
- `POST /videos/:publicId/process` para reprocessamento do proprietário;
- `GET /videos/:publicId/stream` para streaming com `Range`;
- `GET /videos/:publicId/download` para download.

### Testes de infraestrutura
- Testes unitários isolam regras de domínio.
- Testes de integração exercitam PostgreSQL, MinIO e Redis reais no Compose.
- Testes e2e validam os endpoints HTTP e o fluxo de autorização; o worker deve ser observado por estados persistidos e processamento de um fixture pequeno.
- O ambiente de teste deve limpar objetos, filas e registros entre cenários e executar suites compartilhadas com `--runInBand`.

### Formato de erros
A API de vídeos reutilizará o filtro global e o formato de erro já existente no backend; os contratos do plano deverão listar os códigos/status específicos para validação, estado inválido, vídeo inexistente, acesso negado, range inválido e falha do storage.

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Backend | Tecnologia da fila | BullMQ + Redis | Option A |
| TD-02 | Cross-layer | Upload de até 10 GB | Multipart direto via URLs pré-assinadas | Option A |
| TD-03 | Repo-wide | Object storage | MinIO local compatível com S3 | Option A |
| TD-04 | Backend | Worker e processamento | Worker dedicado com ffprobe/ffmpeg | Option A |
| TD-05 | Cross-layer | URL e streaming | `publicId` + HTTP Range | Option A |
| TD-06 | Backend | Ciclo de status | Máquina de estados explícita | Option A |

## Research references

- BullMQ: workers, concurrency, retries and backoff. citeturn0search1turn0search3turn0search7
- AWS SDK for JavaScript v3: S3 multipart, presigned URLs and streaming responses. citeturn0search0turn0search12
- MinIO: S3-compatible object storage in containers. citeturn0search5
- FFmpeg ffprobe: JSON output, format and stream inspection. citeturn0search2turn0search8
