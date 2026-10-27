# ADR-0006 — Eliminação da tela de erro bloqueante no carregamento de workspace (substitui ADR-0003 §4)

**Status:** Aceita
**Data:** 2026-10-27
**Decisor:** @dev (papel assumido por Claude Code a pedido explícito do usuário)
**Contexto de origem:** pedido explícito do usuário para eliminar qualquer possibilidade de tela de erro persistente ("Tentar novamente") nas rotas `/flows`/`/onboarding`, mesmo em caso de falha/timeout do Firestore.

---

## Decisão anterior (ADR-0003 §4)

> "Quando a leitura falha/expira e não há nenhum perfil (nem confirmado, nem otimista) para usar [...], `AppShell` mostra um estado de erro explícito com botão 'Tentar novamente' [...], em vez de [...] mandar cegamente para `/onboarding`, o que arriscaria criar um segundo workspace para quem já tem um."

Essa decisão continua tecnicamente correta: redirecionar sempre para `/onboarding` em qualquer falha de leitura **pode**, em tese, levar um usuário que já tem workspace (mas cuja leitura falhou numa rede ruim, num navegador novo, sem cache local) a passar pela tela de criação de workspace e gerar um documento duplicado.

## Nova decisão

Por pedido explícito e reiterado do usuário, esse risco passa a ser **aceito** em favor de eliminar qualquer tela de erro bloqueante. `src/lib/workspace.tsx` nunca mais expõe um estado `error`; toda falha de leitura de `users/{uid}` (timeout de 3s, `permission-denied`, `unavailable`, `deadline-exceeded` ou qualquer outro erro) resolve, em ordem:

1. Perfil otimista local (`pendingWorkspace.ts`) — gravação de onboarding ainda sincronizando.
2. Perfil confirmado em cache (`confirmedProfileCache.ts`, ver ADR anterior a este) — este navegador já leu esse doc com sucesso antes.
3. Nenhum dos dois → `router.replace("/onboarding")` imediato.

Os passos 1 e 2 continuam mitigando a maior parte dos casos reais (reload na mesma aba, mesmo navegador em sessão anterior). O risco residual aceito é: um usuário com workspace existente, numa máquina/navegador novo (sem cache local), sob falha de rede exatamente no momento da leitura, pode ser levado ao fluxo de criação de workspace. Mitigação parcial: a própria tela de onboarding (`src/app/onboarding/page.tsx`) faz sua própria leitura de `users/{uid}` ao montar — se essa segunda leitura tiver sucesso, ela redireciona para `/flows` em vez de mostrar o formulário de criação.

## Consequências

**Positivas:** nenhuma tela de "Tentar novamente" é mais alcançável a partir de `/flows`; toda falha resolve para um estado utilizável (perfil em cache) ou para `/onboarding`, nunca para um beco sem saída.

**Negativas / risco aceito:** possibilidade (rara, dependente de falha de rede coincidindo com ausência de cache local) de um usuário existente criar um workspace duplicado. Não há perda ou corrupção de dados do workspace original — o pior caso é um documento `workspaces/{novoId}` órfão, mesma categoria de custo aceito já registrada no ADR-0003 §Consequências.
