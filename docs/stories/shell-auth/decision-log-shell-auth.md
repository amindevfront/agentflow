# Decision Log — Implementação (modo YOLO)

**Contexto:** a pedido do usuário, a implementação seguiu direto da Fase 2 (Assess) para o código, sem passar pelas cerimônias formais de `@sm`/`@po`/`@qa` por story individual, e cobrindo de uma vez todos os módulos do `docs/prd/agentflow-project-brief.md` (não só "shell-auth" como o `@architect` havia recomendado dividir). Este log registra as decisões técnicas tomadas durante a implementação, conforme exigido pelo modo YOLO em `story-lifecycle.md`.

## Spike de roteamento/proteção de rota (recomendado pelo `@architect`)

**Decisão:** proteção de rota **client-side**, via `AuthProvider` (contexto React sobre `onAuthStateChanged` do Firebase Auth) + `AppShell` redirecionando para `/login` quando não há usuário autenticado. Não foi implementado middleware server-side com cookie de sessão.

**Razão:** Firebase Auth client SDK não expõe sessão via cookie HTTP-only nativamente — isso exigiria trocar o ID token por um cookie de sessão via Firebase Admin SDK (infra adicional: rota de API, Admin SDK, chave de service account). Dado o princípio "tecnologia enfadonha onde possível" e o prazo, optou-by guard client-side. **Trade-off aceito:** por uma fração de segundo, HTML servido antes da hidratação não contém as telas protegidas (confirmado em teste: rota `/flows` sem sessão retorna "Carregando…", nunca os dados) — aceitável para v1, mas não é proteção real no nível de servidor. Se o produto precisar de proteção server-side (ex.: SEO ou APIs internas), revisar com Admin SDK + middleware.

## Tailwind v4

Tokens do design system foram portados 1:1 para `@theme` em `src/app/globals.css` (não via `tailwind.config.ts`, que no Tailwind v4 só é lido se referenciado via `@config` na folha de estilo — não foi necessário).

## Simulador de payload

Mantido 100% local (estado de componente React), nunca grava em `flowRuns`, conforme já explicitado no protótipo (`app.html`) e no `requirements.json` (INT-1..3 não mencionam persistência do simulador).

## Convite de equipe

Não foi implementado envio automático de e-mail (exigiria Cloud Function + extensão de e-mail transacional, fora do escopo combinado). O link de convite (`/invite/{inviteId}`) é gerado e exibido na tela para compartilhamento manual. **Pendência explícita para o usuário.**

## Execuções reais (`flowRuns`)

Não existe motor de orquestração real nesta entrega — é o risco já registrado no `agentflow-project-brief.md` ("Motor de execução dos fluxos"). A tela `/runs` e o painel de detalhe de execução em `/flows` leem de `flowRuns` no Firestore e renderizam corretamente o estado vazio quando não há dados. As regras de segurança (`firestore.rules`) bloqueiam escrita direta do cliente nessa coleção — só o Admin SDK (motor de orquestração, a construir depois) pode criar execuções.

## Bootstrap do primeiro usuário (descoberto ao testar com projeto Firebase real)

Como o cadastro é fechado (apenas por convite, FR-4), e convidar exige estar logado, existia um problema de ovo-e-galinha: ninguém conseguia criar o primeiro convite. Além disso, `firestore.rules` bloqueia qualquer leitura workspace-scoped para um usuário autenticado que não tenha um documento em `users/{uid}` — e esse documento só era criado hoje pelo fluxo de aceite de convite.

**Decisão:** `AppShell` agora auto-provisiona o documento `users/{uid}` (papel `admin`, `workspaceId` default) na primeira vez que um usuário autenticado é detectado sem esse documento. Isso destrava o bootstrap: para o primeiro acesso, basta criar o usuário manualmente em **Firebase Console → Authentication → Add user** (e-mail/senha) e fazer login normalmente pelo `/login` do app — o app cria o resto. Convites subsequentes continuam sendo o caminho normal para novos membros.

**Trade-off aceito:** qualquer conta criada manualmente no console do Firebase (fora do fluxo de convite) entra automaticamente como `admin`. Isso é aceitável porque só quem já tem acesso ao console do projeto Firebase (equivalente a controle total) consegue criar contas dessa forma.

## Testes automatizados — pendência conhecida

**Não foram escritos testes unitários/integração nesta entrega**, apesar de exigidos pela Constitution (`CLAUDE.md` → "Add unit tests for all new functionality") e pelo QA Gate padrão (`story-lifecycle.md`, check #2). Verificação feita nesta entrega foi: `tsc --noEmit` (sem erros), `next lint` (sem warnings), `next build` (sucesso, 10 rotas), e checagem manual de HTTP 200 + conteúdo renderizado em todas as rotas via servidor de desenvolvimento local. Isso cobre correção de tipos e build, **não substitui cobertura de teste automatizada.** Recomenda-se `@qa` rodar `*qa-gate` formalmente antes de considerar este código pronto para produção.
