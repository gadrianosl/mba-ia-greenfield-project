# StreamTube — instruções para Codex

Leia `CLAUDE.md`, `nestjs-project/CLAUDE.md`, `Orientacoes` e as regras relevantes em `.claude/rules/` antes de alterar o backend. As regras de arquitetura e testes dessas fontes também se aplicam ao Codex.

## Workflow da Fase 03

Use o checkout existente; não crie worktrees sem pedido explícito. Trabalhe em `feature/*` a partir de `dev`, sem commits em main. Preserve alterações do usuário. O workflow é research → context → validate/resolve → plan → implement. Seus artefatos ficam em `docs/decisions/` e `docs/phases/phase-03-videos/`. Execute as etapas na ordem do plano, registre resultados reais em `progress.md` e comunique cada etapa ao usuário. A autorização para executar as correções cobre essas etapas; não solicite novamente a mesma autorização.

As skills de `.claude/skills/` podem ser seguidas manualmente no Codex. Consulte `implement/SKILL.md` e `testing-guide-nestjs-project/SKILL.md`. Use subagentes para executar testes quando solicitado pelo workflow. Não marque uma etapa concluída com testes falhos ou não executados.

## Comandos e qualidade

Todos os comandos Node/npm/TypeScript do backend executam no container `nestjs-api`, com `docker compose exec -T nestjs-api`. Hosts internos são `db`, `redis` e `minio`. O endereço público de MinIO é configurável para clientes fora do Docker.

Não use synchronize em produção/desenvolvimento; use migrations. Não altere migrations já executadas. Testes usam banco e fila separados do desenvolvimento, infraestrutura real e execução serial. Fechamento exige suíte principal, E2E, `npx tsc --noEmit`, `npm run build` e lint verdes.

Consulte APIs na documentação oficial antes de implementar. Context7 é configurado no exemplo `.codex/config.toml`; se não estiver disponível nesta sessão, registre a indisponibilidade e use fontes oficiais verificáveis, sem inventar consultas. Nunca registre valores de credenciais.
