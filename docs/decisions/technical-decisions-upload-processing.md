---
scope_type: phase
related_phases: [3]
status: pending
date: 2026-09-29
scope_description: "Research técnico para upload, armazenamento, processamento assíncrono, streaming e download de vídeos na Fase 03."
---

# Technical Decisions — Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — API, persistência, coordenação do upload, publicação de jobs e endpoints de streaming/download.
- `docs/` — decisões arquiteturais e artefatos do pipeline de planejamento.
- `next-frontend/` — participa apenas do contrato de upload/streaming; a interface de vídeos permanece fora do escopo desta fase.

Este documento registra recomendações técnicas para a Fase 03. Os campos `Decision` permanecem como `_pending_` até a etapa de resolução do pipeline.

---

## TD-01: Tecnologia da fila de processamento

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O processamento de metadados e thumbnail não deve bloquear a API. A solução precisa rodar localmente em Docker, integrar-se ao ecossistema Node/NestJS e oferecer retries, backoff, concorrência e recuperação após falha.

**Options:**

### Option A: BullMQ + Redis
- BullMQ usa Redis como backend e oferece filas, workers, retries, backoff, concorrência e recuperação de jobs.
- **Pros:** integração natural com Node/NestJS; operação simples no Compose; bom suporte a retries e controle de concorrência.
- **Cons:** adiciona Redis à infraestrutura e exige disciplina para idempotência e configuração de conexão.

### Option B: RabbitMQ
- RabbitMQ fornece broker de mensagens com acknowledgements, roteamento e consumidores independentes.
- **Pros:** mensageria madura e roteamento flexível.
- **Cons:** maior custo operacional para uma fila de jobs simples; exige mais decisões de broker, exchanges e bindings.

### Option C: Amazon SQS
- A API publica jobs em uma fila gerenciada na AWS e o worker consome remotamente.
- **Pros:** reduz operação de infraestrutura em produção.
- **Cons:** prejudica a reprodução local, requer credenciais/cloud e introduz dependência externa nesta fase.

**Recommendation:** BullMQ + Redis — atende ao processamento assíncrono com menor complexidade operacional e mantém toda a stack reproduzível localmente.

**Decision:** _[pending]_

---

## TD-02: Upload de arquivos de até 10 GB

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** O arquivo grande não deve atravessar a API NestJS. O backend precisa criar e controlar a sessão, enquanto o cliente envia os dados diretamente ao storage. O contrato afeta endpoints da API e o fluxo futuro do frontend.

**Options:**

### Option A: Multipart upload direto ao S3/MinIO com URLs pré-assinadas
- A API inicia o multipart upload, gera URLs para as partes e finaliza o upload após receber os ETags das partes.
- **Pros:** evita conexões longas na API; permite retomar partes com falha; reduz memória e tráfego do backend.
- **Cons:** exige persistir upload id/partes e implementar expiração e limpeza de sessões incompletas.

### Option B: Upload streaming passando pela API
- O cliente envia o arquivo para a API, que transmite o body para o storage sem carregar tudo em memória.
- **Pros:** contrato inicial mais simples e controle centralizado de autorização.
- **Cons:** mantém a API como gargalo de rede; conexões longas consomem recursos e tornam falhas mais custosas.

### Option C: PUT único pré-assinado
- A API gera uma URL para um único upload e o cliente envia o arquivo completo em uma requisição.
- **Pros:** implementação menor que multipart.
- **Cons:** falha ou retomada exigem repetir o arquivo inteiro; menos adequado para 10GB e redes instáveis.

**Recommendation:** Multipart direto ao S3/MinIO com URLs pré-assinadas — separa coordenação e transferência, permitindo retomada granular sem sobrecarregar a API.

**Decision:** _[pending]_

---

## TD-03: Object storage local e contrato de produção

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** A fase exige object storage e o projeto já define S3 como contrato. O ambiente de desenvolvimento precisa ser executável sem credenciais de cloud, mas sem criar uma implementação local incompatível com a futura produção.

**Options:**

### Option A: MinIO local compatível com S3
- O Compose executa MinIO e a aplicação usa SDK/contratos S3 para buckets, objetos e multipart upload.
- **Pros:** sem custo de cloud; executável localmente; aproxima o desenvolvimento da API de produção.
- **Cons:** diferenças operacionais entre MinIO e o provedor de produção ainda precisam ser verificadas no deploy.

### Option B: AWS S3 também no desenvolvimento
- O ambiente local usa diretamente um bucket AWS.
- **Pros:** maior proximidade com produção.
- **Cons:** exige conta, credenciais, custos, conectividade e limpeza de recursos; dificulta testes isolados.

### Option C: Filesystem em volume Docker
- Os arquivos são gravados em um volume local compartilhado.
- **Pros:** simples para protótipos.
- **Cons:** não atende adequadamente ao contrato de object storage, dificulta escala e diverge da arquitetura-alvo.

**Recommendation:** MinIO local com contrato compatível com S3 — preserva o contrato de storage sem adicionar dependência externa ao desenvolvimento.

**Decision:** _[pending]_

---

## TD-04: Worker e processamento de mídia

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Capability:** Geração automática de thumbnail a partir de um frame do vídeo

**Context:** ffprobe e ffmpeg são operações de CPU/I/O potencialmente demoradas. A API não deve executar essas tarefas no mesmo processo que atende requisições HTTP.

**Options:**

### Option A: Worker dedicado em container separado
- Um processo/container consome jobs e baixa o objeto temporariamente para executar ffprobe e ffmpeg.
- **Pros:** isola carga da API; permite escalar workers; facilita healthcheck e limites de recursos.
- **Cons:** exige imagem própria, ciclo de shutdown e política de retry/idempotência.

### Option B: Processar no mesmo processo da API
- A API executa os comandos após finalizar o upload.
- **Pros:** menor número inicial de serviços.
- **Cons:** mistura carga pesada com tráfego HTTP e torna a API vulnerável a saturação.

### Option C: Serviço gerenciado de vídeo
- Um provedor externo processa o objeto e retorna metadados/thumbnails.
- **Pros:** reduz operação de FFmpeg.
- **Cons:** aumenta custo e acoplamento e não atende ao objetivo de construir a infraestrutura da fase.

**Recommendation:** Worker dedicado com ffprobe para metadados e ffmpeg para thumbnail — mantém a API responsiva e torna o processamento escalável e observável.

**Decision:** _[pending]_

---

## TD-05: URL pública e streaming

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Capability:** Reprodução via streaming (sem necessidade de download completo)

**Capability:** Download do vídeo pelo usuário

**Context:** A URL não deve depender do título, que pode mudar e gerar colisões. O player precisa solicitar intervalos do objeto para iniciar a reprodução sem baixar tudo.

**Options:**

### Option A: `publicId` técnico estável + HTTP Range
- Cada vídeo recebe um UUID/ULID público independente do título; o endpoint aceita `Range` e responde `206 Partial Content` quando aplicável.
- **Pros:** unicidade garantida; URL estável; compatível com players e retomada de download.
- **Cons:** exige tratamento de ranges inválidos e cabeçalhos de conteúdo.

### Option B: Slug derivado do título + resposta completa
- A URL usa o título normalizado e o servidor retorna o arquivo inteiro.
- **Pros:** URL legível e implementação inicial simples.
- **Cons:** colisões e renomeações; pior experiência para arquivos grandes; não atende ao streaming real.

### Option C: URL do storage exposta diretamente
- O cliente recebe uma URL pré-assinada do objeto e acessa o storage sem passar pela API.
- **Pros:** reduz carga da API.
- **Cons:** expõe detalhes do storage e dificulta a aplicação uniforme das regras de autorização e visibilidade.

**Recommendation:** `publicId` técnico estável com endpoint de streaming/download que suporte HTTP Range — combina estabilidade de URL, autorização centralizada e playback parcial.

**Decision:** _[pending]_

---

## TD-06: Ciclo de status e falhas de processamento

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** O banco precisa refletir o progresso sem permitir que um vídeo incompleto seja tratado como pronto. Falhas devem ser persistidas e o reprocessamento deve ser seguro.

**Options:**

### Option A: Máquina de estados explícita
- Estados: `DRAFT -> UPLOADING -> UPLOADED -> PROCESSING -> READY | ERROR`, com transições validadas.
- **Pros:** representa o fluxo real; facilita autorização, observabilidade, retries e testes.
- **Cons:** exige regras de transição e mais campos/timestamps no modelo.

### Option B: Booleanos independentes
- Campos como `uploadCompleted`, `processed` e `processingFailed` representam o estado.
- **Pros:** modelo inicial curto.
- **Cons:** combinações inválidas são fáceis de criar e o fluxo fica difícil de auditar.

### Option C: Status implícito por presença de objetos
- O sistema infere o estado pela existência do objeto original e da thumbnail.
- **Pros:** menos persistência explícita.
- **Cons:** não representa uploads em andamento, falhas, retries ou processamento duplicado de forma confiável.

**Recommendation:** Máquina de estados explícita com `errorReason`, timestamps por etapa e job idempotente por vídeo/tentativa — torna o ciclo auditável e impede que estados incompletos sejam publicados.

**Decision:** _[pending]_

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Backend | Tecnologia da fila | BullMQ + Redis | _[pending]_ |
| TD-02 | Cross-layer | Upload de até 10 GB | Multipart direto via URLs pré-assinadas | _[pending]_ |
| TD-03 | Repo-wide | Object storage | MinIO local compatível com S3 | _[pending]_ |
| TD-04 | Backend | Worker e processamento | Worker dedicado com ffprobe/ffmpeg | _[pending]_ |
| TD-05 | Cross-layer | URL e streaming | `publicId` + HTTP Range | _[pending]_ |
| TD-06 | Backend | Ciclo de status | Máquina de estados explícita | _[pending]_ |

## Research references

- BullMQ documentation: workers, concurrency, retries and Redis connections.
- Amazon S3 documentation: multipart upload and presigned requests.
- MinIO documentation: S3-compatible object storage and multipart behavior.
- FFmpeg documentation: `ffprobe`, `-show_format` and `-show_streams`.

The concrete library versions must be confirmed in `plan-resolve` and recorded in `docs/phases/phase-03-videos/library-refs.md` before implementation.
