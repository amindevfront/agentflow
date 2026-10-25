# ADR-0003 — Resiliência do onboarding (timeout + fallback otimista) e hardening de autenticação

**Status:** Aceita
**Data:** 2026-10-24
**Decisor:** @architect / @security (papéis assumidos por Claude Code a pedido explícito do usuário)
**Contexto de origem:** bug relatado — `/signup` autentica com sucesso, mas `/onboarding` trava em "Preparando sua conta…" sob latência/erro de rede no Firestore.

---

## Causa raiz do bug relatado

`src/app/onboarding/page.tsx` chamava `getAppUser(user.uid).then(...)` **sem `.catch()`**. Qualquer rejeição dessa Promise — rede instável, erro transitório do Firestore — deixava o estado (`step`) parado em `"checking"` para sempre, e a tela em "Preparando sua conta…" permanentemente. Não era um problema de regra de segurança (as regras já permitiam a leitura do próprio doc, existente ou não) nem de projeto Firebase mal configurado — era puramente a ausência de tratamento de erro nessa cadeia de promises.

## Decisão

### 1. Timeout explícito em toda leitura crítica do onboarding

`src/lib/promiseUtils.ts` adiciona `withTimeout` (rejeita após N ms) e `retryWithTimeout` (N tentativas com backoff exponencial, cada uma com timeout próprio — nunca lança, sempre resolve `{ok, value}` ou `{ok:false, error}`). Toda leitura/escrita de onboarding passa por eles:

- Leitura de `users/{uid}` (onboarding e `WorkspaceProvider`): timeout de 3s.
- Escrita de `workspaces/{id}` + `users/{uid}` no submit do onboarding: até 3 tentativas, 3s cada, backoff 0.8s/1.6s.
- Reconciliação em segundo plano (quando o primeiro-plano esgota): até 4 tentativas, 5s cada, backoff 2s/4s/8s.

### 2. Fallback otimista — NUNCA um workspace compartilhado

Rejeitamos deliberadamente a forma mais simples de "fallback seguro" (cair num workspace `"default"` compartilhado) porque isso reabriria exatamente o vazamento de dados entre tenants que o `ADR-0002` corrigiu. Em vez disso:

- `prepareWorkspace()` (`src/lib/firestore.ts`) gera o `id` do novo workspace **no cliente**, sem round-trip de rede (`doc(collection(db,'workspaces'))` só aloca um id, não grava nada). Esse id é definitivo desde o primeiro instante — não existe reconciliação de "id otimista vs. id real" depois.
- Se a gravação em primeiro plano esgota as tentativas, `src/lib/pendingWorkspace.ts` guarda esse perfil (específico do uid, em `sessionStorage`, TTL de 30min) e o onboarding navega para `/flows` mesmo assim. `WorkspaceProvider` lê esse cache quando `users/{uid}` ainda não existir ou a leitura falhar — o usuário nunca fica bloqueado.
- Uma sincronização em segundo plano (`backgroundSync` no onboarding, e um reconciliador equivalente em `WorkspaceProvider` para sobreviver a um reload no meio do caminho) continua tentando até confirmar, e só então limpa o cache otimista.

### 3. Ordem de escrita importa para o retry ser seguro sem afrouxar regras

A escrita acontece sempre `upsertAppUser` → depois `persistWorkspace`, nunca o contrário. Motivo: `users/{uid}` é sempre gravável pelo próprio uid, com ou sem o doc existir — repetir essa escrita em qualquer tentativa é sempre seguro. Depois que esse doc existe, `isAdminOf(workspaceId)` passa a ser verdadeiro, o que torna repetir a escrita de `workspaces/{id}` igualmente segura (seja `create` ou `update`) **sem precisar afrouxar `firestore.rules`**.

Consideramos e rejeitamos a alternativa óbvia — permitir `update` em `workspaces/{id}` para qualquer usuário autenticado sem perfil ainda —, porque isso permitiria a uma conta recém-criada (sem custo, qualquer um pode se cadastrar) sobrescrever campos de um workspace de **outro tenant** só por ainda não ter um documento em `users/{uid}`. Reordenar a escrita resolve o problema de idempotência sem abrir essa brecha.

### 4. Estado de erro recuperável — nunca spinner infinito, nunca redirecionamento "cego"

Quando a leitura falha/expira e não há nenhum perfil (nem confirmado, nem otimista) para usar — ex.: usuário antigo, rede ruim, sem cache local — `AppShell` mostra um estado de erro explícito com botão "Tentar novamente" (`EmptyState` + `retry()`), em vez de (a) ficar girando para sempre ou (b) mandar cegamente para `/onboarding`, o que arriscaria criar um segundo workspace para quem já tem um.

### 5. Hardening de autenticação (user enumeration + senha forte)

- `translateAuthError` (`src/lib/auth.tsx`): todo código `auth/*` cai numa mensagem genérica por categoria; nenhum `case` repassa `error.message` do SDK/backend. A única exceção documentada é um `Error` **sem** `code` — esses são gerados pelo nosso próprio código (política de senha, "senhas não coincidem") e não revelam nada sobre contas existentes.
- `src/lib/passwordPolicy.ts`: mínimo de 8 caracteres + minúscula + maiúscula + número + símbolo, aplicado tanto na validação reativa das telas (`/signup`, `/invite/[token]`) quanto — como reforço — dentro de `signUpWithEmail` no provider, para que nenhuma tela possa pular a checagem.
- `sanitizeEmail()` (trim + lowercase) centralizado no `AuthProvider`, aplicado a toda chamada ao Firebase Auth.

## Consequências

**Positivas:** o bug relatado (loop infinito) fica estruturalmente impossível de se repetir — toda cadeia de promises do onboarding tem tratamento de erro e timeout. Degradação de rede nunca bloqueia o usuário, e a sincronização pendente é visível (banner "Sincronizando…" no `AppShell`) e recuperável (reconciliação sobrevive a reload).

**Negativas / custos aceitos:** existe uma janela — entre a navegação otimista e a confirmação real — em que o workspace do usuário pode não existir ainda no Firestore. Nessa janela, páginas que leem dados do workspace (Fluxos, Conectores etc.) mostram listas vazias (comportamento idêntico a "workspace novo sem dados", não um erro) até a sincronização confirmar. Se a rede permanecer indisponível além do TTL de 30 minutos do cache otimista, o usuário é tratado como "sem perfil" na próxima sessão e passa pelo onboarding novamente — o workspace anterior (se a escrita acabou tendo sucedido tarde) fica orfão, sem dono; aceitável porque não expõe nem corrompe dados de ninguém, só gera um documento não utilizado.
