---
paths: **/*
---

# Design System Compliance — AgentFlow

## Fonte de verdade

O design system do AgentFlow **não é um documento de referência opcional** — é a especificação vinculante de qualquer UI do projeto. Fontes canônicas (raiz do repositório):

- `design-system.html` — tokens, princípios de produto, biblioteca de componentes, exemplos de telas reais (desktop + mobile)
- `app.html` — protótipo estático de referência do módulo Fluxos
- `docs/prd/agentflow-project-brief.md` — plano mestre aprovado, com a lista de módulos/páginas e o que é confirmado vs. proposto

**TODOS os agentes** (`@architect`, `@ux-design-expert`, `@pm`, `@po`, `@sm`, `@dev`, `@qa`, `@data-engineer`) devem consultar essas fontes antes de especificar, desenhar, implementar, revisar ou aprovar qualquer tela ou componente do AgentFlow.

## Regra inegociável

Nenhuma cor, fonte, espaçamento, raio, sombra ou componente pode ser introduzido fora do que já está tokenizado em `design-system.html`. Não inventar variações "só desta vez" — se um padrão novo for necessário, ele precisa ser adicionado primeiro ao design system (via `@ux-design-expert`) antes de ser usado em qualquer tela.

### Tokens obrigatórios

| Categoria | Valores |
|---|---|
| Neutros | `--ink-950` a `--ink-100`, `--mist-50`, `--white` (azulados — nunca cinza puro) |
| Marca/ação | `--signal-700/600/500/100/50` |
| Estado execução | `--state-run-ink:#FFB020` / bg `#FFF3DC` |
| Estado concluído | `--state-done-ink:#1AA16B` / bg `#E1F5EB` |
| Estado erro | `--state-error-ink:#E5484D` / bg `#FBE7E7` |
| Estado ocioso | `--state-idle:#7A8AA0` / bg `#EDF1F4` |
| Tipografia | `Archivo` (UI geral) e `IBM Plex Mono` (reservada a valores reais: timestamps, IDs, tokens — nunca rótulos decorativos em maiúsculo) |
| Forma | `--radius-sm:6px`, `--radius-btn:8px`, `--radius-md:10px`, `--radius-lg:16px` |
| Elevação | Superfícies planas com borda de 1px + `--shadow-sm`/`--shadow-md`. **Proibido:** glass/blur, gradientes decorativos, sidebar escura com cards de métrica |

### Componentes obrigatórios (reaproveitar, nunca recriar do zero)

Botões (com estados hover/active/foco/disabled/loading), campos com validação reativa inline, pills de status (`pill-run`/`pill-done`/`pill-error`), **trilho de fluxo** (rail-step/rail-node/rail-line), trilho de navegação lateral, linha de lista densa (list-row), estado vazio, modal de confirmação destrutiva, banner persistente de aviso.

## Aplicação por agente

- **`@ux-design-expert`**: dono da formalização do design system em tokens reutilizáveis (Tailwind theme/CSS vars) e do desenho de qualquer tela sem referência visual ainda (ex.: Autenticação, Equipe, Conectores, Configurações) — sempre derivando dos tokens/componentes acima, nunca inventando novos.
- **`@architect`**: garante que decisões de arquitetura de frontend não contornem o design system (ex.: escolha de biblioteca de componentes deve ser compatível com os tokens existentes).
- **`@pm` / `@sm`**: toda story de UI deve referenciar explicitamente quais telas/componentes do design system ela usa.
- **`@po`**: o checklist de validação de story (10 pontos) inclui verificação de conformidade com este documento antes de marcar GO.
- **`@dev`**: implementação só pode usar classes/tokens definidos a partir de `design-system.html`; qualquer gap de token/componente é bloqueante e deve ser escalado ao `@ux-design-expert`, não resolvido por invenção.
- **`@qa`**: o QA gate inclui checagem de conformidade visual (cores, tipografia, componentes) contra `design-system.html` como um dos 7 checks de qualidade.

## Quando um padrão novo é genuinamente necessário

1. `@dev` ou `@po` identifica o gap durante a story.
2. Escalar para `@ux-design-expert`, que propõe a extensão do design system.
3. `@architect` valida impacto arquitetural, se houver.
4. Só então a story pode prosseguir com o novo padrão — e `design-system.html` deve ser atualizado para refletir a decisão.
