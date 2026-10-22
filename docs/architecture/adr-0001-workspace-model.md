# ADR-0001 — Modelo de Workspace (resolução de OQ-1)

**Status:** Aceita
**Data:** 2026-09-24
**Decisor:** @architect (Aria)
**Contexto de origem:** `docs/stories/shell-auth/spec/requirements.json` → `openQuestions.OQ-1`

---

## Contexto

O usuário delegou explicitamente ao `@architect` a decisão sobre o modelo de conta/workspace do AgentFlow ("ainda não sei, decidir depois"), pois isso não estava resolvido no design system nem no protótipo `app.html`. É uma decisão de arquitetura de dados de alto nível, dentro do escopo exclusivo do `@architect` (ver `.claude/rules/agent-authority.md`).

Duas forças em tensão:

1. **O que está confirmado hoje:** `app.html` e `design-system.html` mostram uma única sidebar, sem seletor de workspace/organização, sem tela de "criar workspace". Cadastro é fechado, apenas por convite (FR-4). Construir uma UI multi-workspace agora violaria o Artigo IV da Constitution (No Invention) — não há nenhuma referência visual para isso.
2. **Risco de retrabalho:** se o AgentFlow crescer para atender múltiplas organizações (uso comercial plausível para "uma plataforma avançada de agentes de IA"), adicionar `workspaceId` a coleções já em produção exige migração de dados e reescrita de regras de segurança do Firestore — caro e arriscado.

## Decisão

- Todas as entidades de dados (`User`, `Invite`, e futuras: `flows`, `flowRuns`, `connectors`) carregam `workspaceId` desde o primeiro commit do schema, mesmo que a v1 opere como **single-tenant**.
- Um único `workspace` "default" é provisionado automaticamente (seed) na primeira execução — não existe tela de "criar workspace" nem seletor de workspace na v1, consistente com o protótipo.
- Regras de segurança do Firestore (`firestore.rules`) já filtram por `workspaceId` desde a v1, mesmo havendo apenas um workspace em produção.
- Multi-tenant (múltiplos workspaces por usuário, seletor de workspace) fica como evolução futura de **produto/UX**, não de schema — quando aprovado, não exige migração, apenas remover a suposição "1 workspace" da camada de aplicação.

## Consequências

**Positivas:**
- Nenhuma migração de dados necessária se o produto evoluir para multi-tenant.
- Regras de segurança do Firestore já nascem corretas (menor risco de vazamento de dados entre workspaces no futuro).
- Não introduz nenhuma tela/fluxo sem referência no design system (mantém conformidade com Artigo IV).

**Negativas / custos aceitos:**
- Leve overhead: toda query no v1 inclui um filtro `where('workspaceId', '==', DEFAULT_WORKSPACE_ID)` mesmo havendo um único workspace.
- `OQ-2` (quem pode convidar) e `OQ-3` (verificação de e-mail obrigatória) permanecem em aberto, atribuídas a `@pm`, e não bloqueiam esta decisão.

## Alternativas consideradas

1. **Sem `workspaceId` na v1, adicionar depois:** rejeitada — custo de migração e reescrita de regras de segurança é maior do que o custo de incluir o campo agora.
2. **Multi-tenant completo já na v1 (com seletor de workspace):** rejeitada — não há nenhuma referência de design para essa UI; violaria Artigo IV (No Invention) e infla o escopo do módulo Shell/Auth sem necessidade comprovada.
