# AgentFlow — Project Brief & Plano Mestre de Desenvolvimento

**Status:** DRAFT — aguardando aprovação
**Autor:** Orion (aios-master) via Spec Pipeline, Fase 1 (Gather)
**Data:** 2026-09-24
**Fontes de verdade usadas:** `design-system.html` (raiz do projeto), `app.html` (protótipo estático do módulo Fluxos), `package.json`, `AGENTS.md`

> Nota de rastreabilidade (Artigo IV — No Invention): tudo marcado como **[Confirmado]** vem diretamente do design system ou do protótipo estático existentes. Tudo marcado como **[Proposto]** é uma inferência necessária para um app funcional completo (ex.: autenticação) e **precisa da sua aprovação explícita** antes de virar epic/story — não deve ser tratado como requisito já validado.

---

## 1. Visão Geral do Produto

AgentFlow é uma plataforma de orquestração de agentes de IA apresentada como um **console operacional de fluxos** (ex.: triagem de contratos, fechamento mensal, onboarding de cliente), não como um dashboard de métricas decorativas. A filosofia central do design system, que rege todo o produto:

> "Cada tela é um fluxo em andamento — nunca uma coleção de cartões parados."

Princípios de produto **[Confirmado]** extraídos da seção "antes/depois" do design system — o produto rejeita explicitamente:
- Hero sections com números inventados → usa recorte real da interface.
- Grades de cards idênticos → cada linha carrega estado e conteúdo próprios.
- Texto com gradiente decorativo → hierarquia vem de peso/tamanho tipográfico.
- Painéis de vidro/blur sem função → superfícies planas com borda de 1px.
- Rótulos minúsculos em maiúsculo decorativo → mono reservado a valor real (timestamps, IDs).
- Sidebar escura com cards de métrica → navegação clara, rotulada, sobre fundo claro.

---

## 2. Design System — Fonte Única de Verdade (regra obrigatória para todos os agentes)

**Todos os agentes (`@architect`, `@ux-design-expert`, `@dev`, `@qa`, `@po`, `@sm`, `@pm`, `@data-engineer`) devem consultar `design-system.html` e `app.html` antes de propor, especificar, implementar ou aprovar qualquer tela, componente ou estilo.** Nenhuma cor, fonte, espaçamento ou componente novo pode ser inventado fora do que está tokenizado abaixo.

### 2.1 Tokens confirmados

| Categoria | Tokens |
|---|---|
| Neutros (ink) | `--ink-950:#0A0F1A` → `--ink-100:#E4E9EE`, `--mist-50:#F5F7F9`, `--white:#FFFFFF` (azulados, nunca cinza puro) |
| Sinal (marca/ação) | `--signal-700:#0B3FCB`, `--signal-600:#1450F0`, `--signal-500:#2C6BFF`, `--signal-100:#E4ECFF`, `--signal-50:#F2F6FB` |
| Estado — execução | `--state-run-ink:#FFB020`, bg `#FFF3DC` |
| Estado — concluído | `--state-done-ink:#1AA16B`, bg `#E1F5EB` |
| Estado — erro | `--state-error-ink:#E5484D`, bg `#FBE7E7` |
| Estado — ocioso | `--state-idle:#7A8AA0`, bg `#EDF1F4` |
| Tipografia | `--font-display:'Archivo'` (UI geral), `--font-mono:'IBM Plex Mono'` (valores reais: timestamps, IDs, tokens — nunca rótulos decorativos) |
| Forma | `--radius-sm:6px`, `--radius-btn:8px`, `--radius-md:10px`, `--radius-lg:16px` |
| Elevação | `--shadow-sm`, `--shadow-md` (sombra sutil, nunca blur/glass) |
| Layout | `--sidebar-w:240px` |

### 2.2 Biblioteca de componentes confirmada (`design-system.html`)

- Botões (hover, active, foco, desabilitado, carregando)
- Campos de formulário com validação reativa (erro/ok inline, ex.: `f-webhook-help`)
- Indicadores de status (`pill pill-run|pill-done|pill-error`, com `pill-dot`)
- **Trilho de fluxo** (`rail-step`/`rail-node`/`rail-line`) — visualização de progresso passo-a-passo, usado tanto no detalhe desktop quanto na tela mobile
- Trilho de navegação lateral (`nav-item`, estado `is-active`)
- Linha de lista densa (`list-row`, com avatar, meta, progress-dots, timestamp, pill de status)
- Estado vazio (empty state)
- Modal de confirmação destrutiva (ex.: circuit breaker "Parar tudo")
- Banner de aviso persistente (ex.: "Execuções pausadas manualmente")

**Ação de governança (a executar após aprovação deste plano):** criar `.claude/rules/design-system-compliance.md` como regra sempre carregada, referenciando este documento e obrigando qualquer criação de UI a mapear para os tokens/componentes acima, com bloqueio no QA gate (`@qa`) para qualquer cor/componente fora da lista.

---

## 3. Stack Técnico [Confirmado via package.json]

- **Framework:** Next.js 15 (App Router) + React 19
- **Estilo:** Tailwind CSS 4
- **Backend/Dados:** Firebase 11 (`src/lib/firebase.ts` já inicializado)
- **PWA:** `next-pwa` já incluso
- **Linguagem:** TypeScript
- Estrutura atual: `src/app/`, `src/components/ui/` (vazio), `src/lib/firebase.ts`, `src/types/index.ts` (vazio) — projeto ainda no esqueleto inicial, nenhuma tela implementada.

**[Proposto]** Serviços Firebase a confirmar com `@architect`: Firebase Auth (login), Firestore (dados de fluxos/execuções/conectores/equipe), Cloud Functions (execução real de fluxos) ou integração com backend de orquestração de agentes externo. Isso precisa de uma decisão arquitetural explícita antes da Fase de Implementação.

---

## 4. Arquitetura de Informação — Módulos e Páginas Detalhados

Navegação principal **[Confirmado]** (sidebar, `app.html` linhas 355-359 e design-system.html seção "telas"): 5 itens — **Fluxos, Execuções, Conectores, Equipe, Configurações** — mais o rodapé de usuário com avatar, nome e papel (ex.: "operações").

### 4.1 Módulo: Fluxos (`/flows`) — [Confirmado, núcleo do produto]

Página mestre em layout de 2/3 painéis:

1. **Lista de fluxos** (painel esquerdo)
   - Contador "N fluxos · M em execução"
   - Busca por nome do fluxo
   - Botão primário "Novo fluxo"
   - Cada linha (`list-row`): avatar/iniciais, nome do fluxo, gatilho/origem (ex. "novo e-mail em contratos@", "agendado · dia 1º 06:00", "formulário no site"), progress-dots (etapas concluídas/atual/pendentes), tempo relativo ("há 2 min", "ontem"), pill de status (`em execução` / `concluído` / `falhou`)
2. **Configurações do fluxo selecionado** (painel de detalhe/edição)
   - Campo: Nome do fluxo (validação: mínimo 3 caracteres)
   - Campo: Gatilho (trigger)
   - Campo: URL do webhook (validação reativa de formato `https://` + domínio válido)
   - Campo: Token de API (oculto por padrão, revelável por ícone)
   - Ação: Salvar configurações
3. **Detalhe de execução ativa — Trilho de fluxo**
   - Nome do fluxo + pill de status + ID da execução (mono, ex. "execução #4471")
   - Lista de etapas em trilho vertical com nó/linha (concluída / em execução / ociosa), ex.: Receber contrato → Validar com jurídico → Notificar responsável
   - Versão mobile dedicada: header com voltar/menu, mesmo trilho com timestamps e duração por etapa (mono), ações fixas no rodapé: "Pausar fluxo" / "Ver execuções"
4. **Simulador de payload** (sandbox de teste)
   - Campo: Payload de teste (JSON), com validação de sintaxe
   - Ação: Executar teste (não afeta execuções reais, roda isolado/local)
   - Painel: Execução simulada (output)
   - Painel: Histórico de testes da sessão (estado vazio: "Nenhum teste executado nesta sessão ainda")
5. **Circuit breaker global** ("Parar tudo")
   - Botão no topbar
   - Banner persistente quando ativado: "Execuções pausadas manualmente — os fluxos em andamento foram congelados" + ação "Retomar execuções"
   - Modal de confirmação destrutiva: "Parar todas as execuções?" com aviso de que é reversível

### 4.2 Módulo: Execuções (`/runs`) — [Proposto — item de nav confirmado, tela não detalhada no protótipo]

Precisa de especificação por `@ux-design-expert` + validação sua, mas a estrutura mínima coerente com o design system:
- Log global de execuções de **todos** os fluxos (não só o selecionado), reaproveitando `list-row` + pill de status
- Filtros: por fluxo, por status (execução/concluído/falhou), por período
- Drill-down para o **trilho de fluxo** (mesmo componente do módulo Fluxos) ao clicar em uma execução
- Ação de retry/cancelar execução individual

### 4.3 Módulo: Conectores (`/connectors`) — [Proposto — item de nav confirmado]

- Lista de integrações/conectores disponíveis e conectados (ex.: e-mail, webhook, armazenamento, APIs de terceiros usadas como gatilho dos fluxos vistos no protótipo: "contratos@", "formulário no site")
- Estado de conexão (conectado/erro/não configurado) usando as mesmas pills de status
- Fluxo de conectar/reautenticar/revogar credencial (reaproveita os campos de formulário com validação reativa do módulo Fluxos, ex. token de API)

### 4.4 Módulo: Equipe (`/team`) — [Proposto — item de nav confirmado, papel "operações" confirmado no rodapé da sidebar]

- Lista de membros com avatar, nome, papel/role (ex.: "operações")
- Convite de novo membro
- Gestão de permissões por papel (quem pode: criar fluxo, acionar circuit breaker, gerenciar conectores, gerenciar equipe)

### 4.5 Módulo: Configurações (`/settings`) — [Proposto — item de nav confirmado]

- Configurações do workspace/organização
- Gestão de tokens de API globais (reaproveita padrão de campo oculto/revelável)
- Preferências de notificação
- Segurança (ex.: sessões ativas, se aplicável)

### 4.6 Camada transversal / Shell do app — [Confirmado nos tokens e componentes]

- **AppShell**: Sidebar fixa (240px) com marca, nav-items, rodapé de usuário (avatar + nome + papel); overlay + hambúrguer para mobile
- **Topbar**: título da página ativa, busca contextual, ação primária (ex. "Novo fluxo"), botão de circuit breaker
- **Sistema de banners persistentes** (ex. aviso de execuções pausadas)
- **Estados vazios** padronizados (empty state component)
- **Modais de confirmação destrutiva** padronizados

### 4.7 Autenticação & Onboarding — [Proposto, necessário mas fora do protótipo estático]

O protótipo é explicitamente "estático, sem backend real" (rodapé de `app.html`). Como o stack já inclui Firebase, propõe-se:
- Tela de Login (e-mail/senha e/ou provedor social via Firebase Auth)
- Recuperação de senha
- Onboarding inicial de workspace (primeiro acesso, criação da organização)

**Estas 3 telas não têm nenhuma referência visual no design system atual — precisarão ser desenhadas por `@ux-design-expert` seguindo os mesmos tokens antes de qualquer implementação.**

---

## 5. Modelo de Dados Preliminar (alto nível — detalhamento é escopo de `@data-engineer`)

Coleções inferidas a partir das telas confirmadas (não são um schema final):
- `flows` (nome, trigger, webhookUrl, apiToken, status, steps[], createdBy, workspaceId)
- `flowRuns` (flowId, status, startedAt, steps[{nome, status, timestamp, durationMs}])
- `connectors` (tipo, status, credenciais, workspaceId)
- `teamMembers` (uid, nome, papel, workspaceId)
- `workspaces` / `settings`

`@architect` decide a arquitetura (Firestore puro vs. Firestore + Cloud Functions vs. backend de execução externo); `@data-engineer` executa o DDL/regras de segurança detalhadas.

---

## 6. Plano de Execução Proposto

### Fase 0 — Governança (imediata, após aprovação deste brief)
- `@aios-master`: criar regra `.claude/rules/design-system-compliance.md` (sempre carregada)
- `@ux-design-expert`: formalizar `design-system.html` em tokens reutilizáveis (Tailwind theme + CSS vars) dentro de `src/`

### Fase 1 — Spec Pipeline (por módulo)
| Fase | Agente | Output |
|---|---|---|
| Gather | `@pm` | `requirements.json` por módulo, a partir deste brief |
| Assess complexidade | `@architect` | `complexity.json` (decide Firebase Auth/Functions vs. alternativa) |
| Research (se necessário) | `@analyst` | benchmarks de ferramentas de automação de fluxo, se `@architect` classificar como COMPLEX |
| Write Spec | `@pm` | `spec.md` por módulo |
| Critique | `@qa` | veredito APPROVED / NEEDS_REVISION / BLOCKED |
| Plan | `@architect` | `implementation.yaml` |

### Fase 2 — Story Development Cycle (por módulo, ordem sugerida)
1. **Shell + Design tokens** (base para tudo)
2. **Autenticação** (bloqueia acesso às demais telas)
3. **Fluxos** (núcleo do produto, já prototipado — maior fidelidade ao protótipo)
4. **Execuções**
5. **Conectores**
6. **Equipe**
7. **Configurações**

Cada story segue: `@sm *draft` → `@po *validate-story-draft` (checklist de 10 pontos **+ verificação de conformidade com o design system**) → `@dev *develop-story` (bloqueado a usar apenas tokens/componentes de `design-system.html`) → `@qa *qa-gate` (7 checks + conformidade visual) → `@devops *push`.

---

## 7. Riscos e Pontos Abertos para sua Decisão

1. **Motor de execução dos fluxos:** o protótipo simula execuções, mas não define quem/o que efetivamente executa os agentes de IA por trás de cada fluxo (orquestração real). Precisa de decisão arquitetural antes da Fase 2.
2. **Autenticação/Equipe/Conectores/Configurações** não têm design visual de referência — precisam passar por `@ux-design-expert` antes de virar código, para não violar o Artigo IV (No Invention).
3. **Localização do design system:** hoje `design-system.html` e `app.html` estão na raiz do projeto, não em `docs/`. Recomenda-se movê-los para `docs/design-system/` para consistência com a estrutura AIOS — a confirmar com você.

---

## 8. Aprovação

Este documento é o artefato de Fase 1 (Gather) do Spec Pipeline. **Nenhuma story será criada nem código será escrito até aprovação explícita.**
