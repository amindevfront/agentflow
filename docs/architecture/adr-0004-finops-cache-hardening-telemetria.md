# ADR-0004 — FinOps de cache client-side, hardening de segurança e telemetria de falhas

**Status:** Aceita
**Data:** 2026-10-25
**Decisor:** @architect / @security / growth (papéis assumidos por Claude Code a pedido explícito do usuário)
**Contexto de origem:** expansão corporativa pós-ADR-0003 — reduzir custo de leitura no Firestore, endurecer a superfície de entrada do produto e tornar falhas silenciosas visíveis, sem reescrever o que já funcionava.

---

## 1. FinOps de leitura — cache client-side seletivo, não substituição do tempo real

**Diagnóstico:** a maior parte do produto (`subscribeFlows`, `subscribeFlowRuns`, `subscribeConnectors`, `subscribeTeamMembers`, `subscribeConversations`, `subscribeCampaigns` — ver `src/lib/firestore.ts`) já lê via `onSnapshot`. Isso já é eficiente: o Firestore cobra uma leitura por documento no attach do listener e uma leitura por documento que muda depois — não existe "refetch" redundante para cortar aí, e envolver esses listeners em React Query teria sido retrabalho sem ganho.

O desperdício real estava em leituras **one-shot** (`getDoc`) de um documento que raramente muda: `workspaces/{id}`, lido via `getWorkspace()` a cada montagem de `/flows` (para sugerir playbooks) e de `/settings` (para exibir nome/nicho). Sem cache, dez visitas a essas telas pagavam dez leituras idênticas.

**Decisão:** `@tanstack/react-query` (`src/lib/queryClient.tsx`, provider global em `src/app/layout.tsx`) com `staleTime: 5min`, `gcTime: 30min`, `refetchOnWindowFocus: false`. `src/lib/queries/workspace.ts` expõe `useWorkspaceDoc(workspaceId)` — adotado em `/flows` e `/settings`, substituindo o `getWorkspace().then(setState)` ad hoc de cada tela. Qualquer escrita em `workspaces/{id}` (hoje: `updateWorkspaceName`) chama `useInvalidarWorkspace()` explicitamente — o cache nunca mostra um valor que o próprio usuário acabou de mudar.

**Rejeitado:** envolver os `onSnapshot` existentes em React Query. Um listener em tempo real já é a forma mais barata de manter um dado atualizado — React Query adicionaria uma camada de polling/revalidação sobre algo que já empurra mudanças, sem reduzir leituras.

## 2. Sanitização na fronteira de escrita, não em cada tela

**Decisão:** `src/lib/sanitize.ts` (Zod cobre forma/tipo; DOMPurify — via `isomorphic-dompurify`, que resolve para `dompurify` puro no bundle do navegador e cai para jsdom apenas em Node/teste — cobre conteúdo) é aplicado dentro de `src/lib/firestore.ts`, no momento da escrita (`prepareWorkspace`, `updateWorkspaceName`, `upsertAppUser`, `createInvite`, `createFlow`/`updateFlow`, `createConnector`), não espalhado pelas telas. React já escapa toda interpolação JSX — o risco real que isto fecha é um consumidor FUTURO que não escapa (exportação, e-mail transacional, painel administrativo, integração de terceiro). Sanitizar na escrita garante que todo documento nasce seguro, independente de quem o lê depois.

`src/lib/validation/schemas.ts` adiciona uma segunda camada (Zod), independente do estado de componente, em `/signup`, `/login`, `/team` (convite) e `/connectors` — redundante por desenho com a validação reativa de cada tela: a validação de UI pode ser contornada (chamada direta ao handler, extensão futura); o schema é o último portão antes do Firestore ou do Firebase Auth.

## 3. Fricção anti-força-bruta client-side — complemento, não substituto

**Decisão:** `src/lib/authThrottle.ts` — backoff exponencial (30s → 1min → 2min…, teto de 15min) por identificador (e-mail digitado), em `sessionStorage`. Documentado explicitamente como NÃO sendo a defesa real: essa é o próprio Firebase Auth (`auth/too-many-requests`, já traduzido em `auth.tsx`) e, nas rotas de API internas, o token bucket distribuído de `src/lib/server/distributedRateLimit.ts`. Um contador client-side é trivial de contornar (aba anônima); o que ele compra é fricção contra um script ingênuo e feedback imediato ao usuário legítimo, sem esperar o backend.

**Rejeitado:** implementar um gate server-side pré-autenticação (ex.: uma Cloud Function checando tentativas antes de chamar `signInWithEmailAndPassword`). O Firebase Auth client SDK não expõe um "dry run" de autenticação — construir esse gate exigiria replicar a lógica de autenticação fora do SDK, superfície de ataque maior que o problema que resolve.

## 4. Verificação de JWT já existe — o middleware de borda é uma camada diferente

**Diagnóstico:** `src/lib/server/auth.ts` (`verificarIdToken`) já verifica assinatura RS256 contra o JWKS do Google, emissor, público e validade temporal — sem Firebase Admin SDK, só Web Crypto. `src/lib/server/http.ts` (`comGuarda`) já aplica isso e limite de taxa distribuído a toda rota `/api/*`. Isso já era Zero-Trust real antes desta ADR.

**Decisão:** `src/middleware.ts` (Edge) não duplica essa verificação — adiciona a camada de transporte que toda resposta (página ou API) compartilha e que nenhuma rota individual lembraria de configurar: CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` restritiva, HSTS de 2 anos com `preload`. Deliberadamente sem nenhuma dependência além de `next/server`: o runtime de borda não suporta as APIs de Node de que Zod/DOMPurify/Web Crypto (do jeito que `auth.ts` usa) dependeriam se fossem importados ali.

**Custo aceito:** a CSP mantém `script-src 'self' 'unsafe-inline'` mesmo em produção — a hidratação do App Router do Next.js injeta scripts inline sem suporte a nonce nesta versão. Endurecer para CSP por nonce é trabalho futuro que exige instrumentar cada layout, não uma mudança local ao middleware.

## 5. Telemetria de falhas silenciosas — o problema que o ADR-0003 já mostrou ser real

**Decisão:** `src/lib/telemetry/logger.ts` (log estruturado em JSON, uma linha por evento) + `src/lib/telemetry/errorReporting.ts` (buffer observável, deduplicado por 10s, para não inundar a UI com a mesma falha repetindo em retry) + `src/components/telemetry/TelemetryProvider.tsx`, que cobre as três fontes de falha silenciosa:

1. Erro de renderização React → error boundary de classe (único mecanismo que React oferece para isso) → estado de recuperação em vez de tela branca.
2. `window.onerror` → exceções síncronas fora do ciclo de render.
3. `unhandledrejection` → a categoria que importava desde o bug original do ADR-0003: uma chamada ao SDK do Firebase/`fetch` que falha sem ninguém com `.catch()` olhando.

Um banner discreto (reaproveita `Banner`, já no design system — nenhum componente novo foi inventado) avisa o operador sem bloquear a tela.

## Consequências

**Positivas:** leituras redundantes de `workspaces/{id}` eliminadas nas duas telas que mais pesavam; toda escrita de texto livre do produto sanitizada num único lugar; segunda camada de validação independente de UI nos quatro formulários mais expostos a entrada externa; cabeçalhos de segurança de transporte aplicados globalmente sem exigir que cada rota lembre disso; nenhuma falha de rede ou SDK desaparece mais sem deixar rastro.

**Negativas / custos aceitos:** CSP ainda permite `unsafe-inline` em produção (ver item 4); o throttle de login é client-side e contornável por desenho (ver item 3); `isomorphic-dompurify` traz `jsdom` como dependência de produção no `package.json` — mitigado pelo campo `browser` do pacote, que garante que o bundle do navegador nunca inclui `jsdom` (confirmado pelo tamanho do middleware/páginas após o build).
