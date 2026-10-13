---
name: phase-03-workflow
description: Implementar ou retomar a Fase 03 de vídeos do StreamTube com os mesmos artefatos do workflow original Claude Code, usando Codex.
---

Leia AGENTS.md, Orientacoes e os documentos em docs/phases/phase-03-videos/. Use o checkout existente e branch feature, sem worktrees não solicitados. A fundação original continua em .claude/skills e .claude/rules; suas convenções também valem no Codex.

Siga research → plan-context → validate/resolve → plan-build → implement. Em retomadas, confira decisões/contexto e os contratos antes de alterar código; registre emendas sem inventar evidências passadas. validation.md deve estar clean antes da implementação. O plano tem SIs, Data Model, API Contracts, Authorization Matrix, Error Catalog, Events/Messages, Dependency Map e Deliverables. progress.md registra testes efetivamente executados por SI e limitações pendentes.

Execute comandos da aplicação dentro do container nestjs-api. Use infraestrutura real, banco/fila/bucket de testes isolados e execução serial. Delegue testes a subagentes para obter diagnóstico preciso; não fragmente a mesma suíte em execuções concorrentes contra o mesmo banco. Preserve asserts e rate limit. Ao final, rode suíte principal, E2E, tsc, build e lint. Para o limite de tamanho, test:large-upload transfere e processa 10 GiB reais e limpa seus dados.

Consulte Context7 quando exposto; configuração está em .codex/config.toml. Se indisponível, verifique versões instaladas e fontes oficiais, registre explicitamente a alternativa em library-refs.md e não atribua consultas fictícias ao MCP. Não exponha credenciais ou URLs assinadas em logs/artefatos. Comunique resultados por etapa para acompanhamento do usuário.
