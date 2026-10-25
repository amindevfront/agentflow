# ADR-0002 — Self-serve signup, workspace por tenant e verticalização por nicho

**Status:** Aceita
**Data:** 2026-10-24
**Decisor:** @architect (papel assumido por Claude Code a pedido explícito do usuário — "Atue como Principal Enterprise Architect")
**Supersede:** FR-4 e CON-3 de `docs/stories/shell-auth/spec/requirements.json`; estende (não contradiz) `ADR-0001`.

---

## Contexto

O usuário pediu explicitamente, para viabilizar contratos B2B em nichos verticais (Construtoras/Imobiliárias, Logística Portuária, Clínicas de Alto Padrão), que o AgentFlow deixe de ser cadastro-fechado-por-convite e passe a oferecer **self-serve signup** com uma triagem de nicho que personalize a experiência inicial ("vestir a roupa exata da operação do cliente").

Isso contradiz diretamente `FR-4`/`CON-3` (cadastro fechado, só por convite), decididos antes desta conversa. `ADR-0001`, porém, já previu esta exata evolução como um passo futuro de produto que "não exige migração, apenas remover a suposição de 1 workspace da camada de aplicação" — o que esta decisão agora executa.

## Decisão

1. **Self-serve signup cria um novo workspace (tenant).** `/signup` (e o primeiro login via Google sem convite pendente) não entra mais automaticamente no workspace `"default"` como `admin` — é roteado para `/onboarding`, onde escolhe o nome do workspace e o setor primário, e só então um workspace novo é criado (`createWorkspace`, `src/lib/firestore.ts`) com um id próprio gerado pelo Firestore.
2. **Convite continua sendo o único caminho para entrar em um workspace EXISTENTE.** `/invite/{token}` não muda de comportamento conceitual — adiciona o convidado ao `workspaceId` do próprio convite (antes gravado incorretamente como o workspace `"default"` fixo; corrigido nesta mudança).
3. **Verticalização é só conteúdo, nunca componente novo.** O setor escolhido grava `playbooksSugeridos: string[]` no documento do workspace (`src/lib/niches.ts`), consumido hoje apenas como texto no estado vazio de Fluxos (`EmptyState` já existente). Nenhum token, cor ou componente novo foi introduzido — conforme `.claude/rules/design-system-compliance.md`. Navegação, nomes de módulo e componentes do shell permanecem exatamente os confirmados em `design-system.html`/`app.html`.
4. **A camada de aplicação para os módulos centrais (Fluxos, Execuções, Conectores, Equipe, Configurações) passa a ser multi-tenant de fato.** As funções de leitura/escrita correspondentes em `src/lib/firestore.ts` deixam de usar `DEFAULT_WORKSPACE_ID` implicitamente e passam a exigir `workspaceId` explícito do chamador — resolvido, em cada página, pelo novo `WorkspaceProvider`/`useWorkspace()` (`src/lib/workspace.tsx`), que lê o workspace real do usuário logado (via o próprio doc em `users/{uid}`).
5. **Módulos de governança avançada ficam fora do escopo desta mudança.** `roi.ts`, `humanInTheLoop.ts`, `credentials.ts`, `campaigns/firestore.ts`, `auditLog.ts` e `inbox/firestore.ts` já aceitavam `workspaceId` como parâmetro opcional com fallback para `DEFAULT_WORKSPACE_ID` — mantidos como estão. Só o painel de ROI (`BusinessROIWidget`, visível em `/runs` e `/governance`) passou a receber o workspace real explicitamente, porque é o único ponto desses módulos diretamente renderizado nas rotas verificadas nesta tarefa. Os demais sub-painéis de Governança (guardrails, cofre, auditoria, transbordo, Neural Inbox) **continuam operando sobre o workspace `"default"`** até uma migração dedicada — ver "Pendências" abaixo.
6. **`firestore.rules`**: `workspaces/{id}` passa a permitir `create` para qualquer usuário autenticado (`isSignedIn()`), já que a criação acontece antes de existir um documento em `users/{uid}` (mesmo problema de ovo-e-galinha já resolvido para convites). Leitura e atualização continuam exigindo pertencimento/admin.

## Consequências

**Positivas:**
- Prospects de nicho conseguem se auto-provisionar sem esperar um convite manual — desbloqueia o motion de vendas B2B self-serve.
- Nenhuma migração de dados foi necessária: workspaces antigos sob `"default"` continuam funcionando (os módulos de governança ainda os leem por padrão).
- O bug pré-existente de convites sempre apontarem para `"default"` (independente do workspace do convidante) foi corrigido como efeito colateral direto desta mudança.

**Negativas / custos aceitos:**
- Multi-tenant é **parcial**: apenas os módulos centrais listados no item 4 isolam corretamente por tenant. Um segundo workspace criado via `/onboarding` verá os painéis de Governança/Neural Inbox misturados com os dados do workspace `"default"` até essa migração ser feita — **pendência explícita**, não um bug silencioso: é um corte de escopo deliberado para não introduzir risco de regressão em código crítico de segurança (cofre de credenciais, trilha de auditoria) numa entrega focada em autenticação/onboarding.
- `ensureDefaultWorkspace()` foi removida (não tinha mais nenhum chamador depois que o bootstrap automático de admin saiu do `AppShell`).

## Pendência para o usuário

Se os clientes de nicho (ex.: a Clínica de Alto Padrão) também precisarem de isolamento total nos módulos de Governança e Neural Inbox — e não só em Fluxos/Execuções/Conectores/Equipe — é necessário um follow-up dedicado para propagar `workspaceId` real através de `roi.ts`, `humanInTheLoop.ts`, `credentials.ts`, `campaigns/firestore.ts`, `auditLog.ts` e `inbox/firestore.ts` e seus respectivos painéis em `src/components/governance/*` e `src/components/chat/NeuralInbox.tsx`. Recomenda-se tratar como uma story própria, com `@qa` revisando especificamente regressão nos testes de `auditChainStore`, `piiVault`, `distributedRateLimit`, `guardrails`, `hitlStore` e `swarm` (todos já cobertos por testes existentes em `tests/`).
