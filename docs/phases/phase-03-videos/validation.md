---
kind: phase
name: phase-03-videos
status: dirty
issue_count: 9
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-09-30T14:54:24Z"
  docs/decisions/technical-decisions-upload-processing.md: "2026-09-29T19:42:39Z"
issues:
  - id: AMB-1
    status: open
    summary: "Endpoints e contratos de upload não estão definidos"
  - id: AMB-2
    status: open
    summary: "Política de acesso para streaming e download está incompleta"
  - id: MD-1
    status: open
    summary: "Formato de erros da API de vídeos não foi decidido"
  - id: MD-2
    status: open
    summary: "Política de autenticação do contrato de upload não foi definida"
  - id: DG-1
    status: open
    summary: "Relação exata entre vídeo e canal precisa ser confirmada"
  - id: DG-2
    status: open
    summary: "Estratégia de testes com MinIO Redis e worker não está definida"
  - id: OQ-1
    status: open
    summary: "TD-01 fila de processamento permanece pendente"
  - id: OQ-2
    status: open
    summary: "TD-02 protocolo de upload permanece pendente"
  - id: OQ-3
    status: open
    summary: "TD-03 a TD-06 permanecem pendentes"
advisories: []
---

# phase-03-videos — Validation

## Findings

### Inconsistências

_None._

### Ambiguidades

- **AMB-1** — O contexto define a arquitetura de upload, mas não especifica os endpoints, seus métodos HTTP, payloads, respostas, regras de expiração, idempotência ou os dados obrigatórios para iniciar, assinar partes e concluir um multipart upload. Explicit choice: detalhar esses contratos no `plan-resolve` e incorporá-los ao plano.

- **AMB-2** — O contexto menciona streaming e download por `publicId`, mas não define se o acesso será anônimo apenas para vídeos prontos/públicos, se o proprietário poderá acessar rascunhos e erros, nem quais respostas devem ser usadas para estados não reproduzíveis. Explicit choice: definir a matriz de autorização e os comportamentos HTTP no `plan-resolve`.

### Missing Decisions

- **MD-1** — A fase expõe endpoints REST de upload, processamento, streaming e download, mas não há uma decisão que defina o formato de erros da API de vídeos, incluindo validação, objeto inexistente, estado inválido, range inválido e falha do storage. Explicit choice: adicionar uma decisão ou contrato explícito para o formato de erros, reutilizando o padrão global existente quando aplicável.

- **MD-2** — O contexto exige autorização por proprietário do canal, mas não define o contrato de autenticação para iniciar uploads, finalizar multipart uploads, reprocessar vídeos e acessar mídia privada. Explicit choice: definir a matriz de autorização dos endpoints e a relação com o guard JWT global.

### Dependency Gaps

- **DG-1** — O contexto afirma que os vídeos pertencem a um canal, mas não confirma a coluna, cardinalidade, foreign key e estratégia de carregamento necessárias para integrar a entidade `Video` à entidade `Channel`. Explicit choice: especificar a dependência de persistência no plano e validar o modelo existente de canais antes da migration.

- **DG-2** — A Definition of Done exige testes unitários, integração e e2e, enquanto o contexto exige MinIO, Redis e worker reais no Compose; porém não há estratégia definida para provisionamento, isolamento, limpeza e execução desses serviços nos testes. Explicit choice: definir no plano quais testes exercitam serviços reais e como o ambiente compartilhado será controlado.

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

- **OQ-1** — TD-01 pendente — tecnologia da fila de processamento. Resolution: preencher a decisão de TD-01 no documento de decisões e registrar a biblioteca/versão em `library-refs.md` durante `plan-resolve`.

- **OQ-2** — TD-02 pendente — protocolo de upload de arquivos de até 10 GB. Resolution: preencher a decisão de TD-02 no documento de decisões e transformar a recomendação em contratos de implementação durante `plan-resolve`.

- **OQ-3** — TD-03, TD-04, TD-05 e TD-06 pendentes — storage, worker, streaming e ciclo de status. Resolution: preencher as decisões pendentes no documento de decisões e confirmar bibliotecas, limites e políticas durante `plan-resolve`.

### UI Coverage Gaps

_None._

### Custom rule findings

_None._

## Resolved Issues

_No issues resolved yet._

## Validation Verdict

`status: dirty`

A fase ainda não pode avançar para o plano executável. Os problemas devem ser tratados pelo `plan-resolve`, que deverá consolidar as decisões pendentes, especificar os contratos ausentes, confirmar dependências do modelo de canais e definir a estratégia de testes de infraestrutura.
