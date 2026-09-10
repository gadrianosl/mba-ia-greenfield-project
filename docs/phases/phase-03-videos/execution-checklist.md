# Execução da Fase 03 — Checklist Guiado

Status geral: **Não iniciado**

## Como usar este arquivo
- Marque cada item com `[x]` quando concluído.
- Registre evidências (links de commit/arquivo) ao final de cada passo.
- Não pule etapas: o arquivo de orientações reprova execução fora da ordem.

---

## Passo a passo com rastreabilidade (arquivo `Orientacoes`)

### 1) Setup inicial do ambiente
- [ ] Fazer fork e subir backend com Docker Compose.
- [ ] Instalar dependências e rodar migrations.
- [ ] Confirmar suíte atual verde.

**Onde foi pedido:** linhas **189-190**.

### 2) Research das decisões técnicas da Fase 03
- [ ] Pesquisar e decidir tecnologia de fila.
- [ ] Definir estratégia de upload de até 10GB sem travar API.
- [ ] Definir estratégia de streaming e URL única.
- [ ] Definir estratégia de processamento (metadados + thumbnail) com worker.
- [ ] Registrar trade-offs e decisão final em `docs/decisions/technical-decisions-phase-03-videos.md`.

**Onde foi pedido:** linhas **92-101**, **103-106**, **191**.

### 3) Planejamento em pipeline (obrigatório)
- [ ] Gerar `docs/phases/phase-03-videos/context.md` (plan-context).
- [ ] Gerar `docs/phases/phase-03-videos/validation.md` (plan-validate).
- [ ] Iterar validate ↔ resolve até status **clean**.
- [ ] Gerar `docs/phases/phase-03-videos/library-refs.md` (quando houver libs novas).
- [ ] Gerar `docs/phases/phase-03-videos/phase-03-videos.md` com SIs + Tech Specs + Dependency Map + Deliverables.

**Onde foi pedido:** linhas **107-115**, **134-136**, **153**, **192**.

### 4) Implementação SI a SI
- [ ] Implementar módulo de vídeos no backend (`nestjs-project/src/videos/...`).
- [ ] Adicionar infraestrutura no `compose.yaml` (storage + fila + worker).
- [ ] Criar migration da tabela de vídeos.
- [ ] Implementar fluxo de upload com pré-cadastro em rascunho.
- [ ] Implementar processamento automático pós-upload (metadados + thumbnail).
- [ ] Implementar URL única por vídeo.
- [ ] Implementar streaming (range/206) e download.
- [ ] Atualizar `docs/phases/phase-03-videos/progress.md` a cada SI.
- [ ] Rodar testes por SI antes de avançar.

**Onde foi pedido:** linhas **116-125**, **137-145**, **193**.

### 5) Atualização da documentação de IA
- [ ] Atualizar `CLAUDE.md` (ou equivalente) com módulo de vídeos/endpoints/fila/worker/storage.

**Onde foi pedido:** linhas **126-127**, **149-150**.

### 6) Fechamento e Definition of Done
- [ ] Garantir testes relevantes e suíte completa verdes.
- [ ] Rodar `npx tsc --noEmit` com código 0.
- [ ] Rodar `npm run lint` sem erros.
- [ ] Validar critérios de aceite item a item antes do push.

**Onde foi pedido:** linhas **71**, **146**, **194**.

### 7) Regras de fluxo Git
- [ ] Trabalhar em `feature/*` saindo de `dev` e voltando para `dev`.
- [ ] Não fazer commit direto na `main`.

**Onde foi pedido:** linhas **74**, **147**, **157**.

### 8) Itens que causam reprovação automática (check de risco)
- [ ] Não pular research/planning/implementação com artefatos.
- [ ] Não deixar `validation.md` sem status clean.
- [ ] Não enviar arquivo de 10GB passando pela API de modo a travar sistema.
- [ ] Não deixar de subir fila/worker/storage reais no Compose.
- [ ] Não entregar com `tsc`, `lint` ou testes quebrados.

**Onde foi pedido:** linhas **151-159**.

---

## Evidências (preencher durante execução)

### Passo 1 — Setup
- Evidências:
### Passo 1 — Setup
- Evidências:
  - Ambiente local preparado com Node.js **v20.20.2** e npm **10.8.2**.
  - Infra do backend subida com Docker Compose em `nestjs-project/`.
  - Serviços identificados no compose: `db`, `mailpit`, `nestjs-api`.
  - Banco PostgreSQL respondeu como pronto para conexões (log: `database system is ready to accept connections`).
  - Migration executada com uso explícito de DataSource (comando no container da API).
  - Testes executados para baseline do ambiente:
    - `npm test` executado no serviço `nestjs-api`.
    - Resultado observado: execução parcial com falhas pré-existentes do baseline (não bloqueante para o setup inicial).
  - Decisão de processo: seguir para etapa de **Research** após validação de infraestrutura/migrations, conforme ordem das orientações.

- Observações:
  - Durante o setup foi identificado que o nome correto do serviço de aplicação no compose é `nestjs-api` (não `api`).
  - Também foi necessário informar o `dataSource` para comando de migration no TypeORM CLI.

### Passo 2 — Research
- Evidências:

### Passo 3 — Planejamento
- Evidências:

### Passo 4 — Implementação
- Evidências:

### Passo 5 — Docs IA
- Evidências:

### Passo 6 — Fechamento
- Evidências:

### Passo 7 — Git Flow
- Evidências:

### Passo 8 — Reprovação automática (checagem final)
- Evidências:
