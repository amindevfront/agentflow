# ADR-0007 — Radares financeiros de nicho fundamentados em pesquisa de mercado (Logística, Clínicas/Salão, E-commerce) e roadmap de resiliência 2027-2028

**Status:** Aceita
**Data:** 2026-10-31
**Decisor:** @architect (papel assumido por Claude Code a pedido explícito do usuário — mesmo padrão de `ADR-0002`/`ADR-0003`)
**Relacionado:** estende `docs/prd/agentflow-project-brief.md`, `src/lib/distrato.ts`, `src/lib/demurrage.ts`; fecha uma lacuna documentada em `src/lib/onboardingQuiz.ts` (preset `no-show-agendamento`).

---

## Contexto

O usuário pediu, explicitamente, que o produto incorporasse **pesquisa de mercado real** (reclamações de empresários/decisores em fóruns, Reddit, Reclame Aqui e fontes equivalentes em inglês) para (a) fortalecer os argumentos de venda com números auditáveis, (b) preencher lacunas reais de nicho — não inventadas — e (c) tornar o produto mais resistente a tendências de mercado/regulação até o final da década, sem violar o Artigo IV da Constitution (No Invention).

Pesquisa conduzida (ver citações por módulo abaixo) confirmou três lacunas concretas, duas delas já **documentadas no próprio código antes desta mudança**:

1. `src/lib/onboardingQuiz.ts`, preset `"no-show-agendamento"`, dizia explicitamente: *"Esta versão não tem um módulo dedicado de agendamento"* — nenhum número de custo de no-show existia, só lembretes.
2. Nenhum módulo de nicho cobria **E-commerce** além do perfil de atendimento (`@/lib/nichePrompts`) — gap estrutural, não uma omissão de pesquisa.
3. O nicho Logística tinha `@/lib/demurrage` (custo de sobre-estadia), mas nenhum radar para a **outra** fonte de custo oculto documentada pelo setor de comex: variação cambial sobre o frete contratado em dólar — especialmente relevante dado que o usuário opera na região portuária de Itajaí/SC.

## Decisão

Implementados três módulos puros e determinísticos, seguindo exatamente o padrão de honestidade de número já estabelecido por `@/lib/distrato.ts` e `@/lib/demurrage.ts` (nunca estimar sem dado configurado; nível de alerta sempre ancorado a um limiar citável):

### 1. `src/lib/noShowCost.ts` — Custo de Agenda Vazia (Clínicas, Salão de Beleza & Barbearia, Serviços de Luxo)

Fecha a lacuna do item 1. Fonte: pesquisa de mercado sobre no-show em salões/clínicas (benchmarks do setor, outubro de 2026) — taxa média de no-show de **15% a 30% sem automação**, caindo a **5% ou menos** com lembrete + confirmação + depósito; perda anual documentada de referência entre US$ 18k-36k para um salão médio. Limiares de alerta (`atencao` a partir de 10%, `critico` a partir de 20%) são ancorados diretamente nessa faixa.

Estendido: `Appointment.valorProcedimentoBrl` (tipo + `CriarAgendamentoInput`). UI: novo card "Custo de agenda vazia (mês)" em `AppointmentRemindersPanel`, com campo opcional de valor no formulário de criação.

### 2. `src/lib/cambio.ts` — Radar de Exposição Cambial (Logística & Portos / Comex)

Fecha a lacuna do item 3. Fonte: pesquisa de mercado sobre comex brasileiro (outubro de 2026) — no frete marítimo internacional, boa parte do custo (básico, GRI, sobretaxas) nasce em dólar, e na importação FOB/FCA é o importador brasileiro quem paga essa parcela; a mesma pesquisa documenta o dólar subindo **~8% em poucos dias após uma eleição**. O limiar de "exposição crítica" (8%) é ancorado diretamente nesse evento real — transformando a instabilidade política em um número de produto, em vez de um discurso vago de venda.

Estendido: `Shipment.valorFreteUsd` / `Shipment.cambioContratadoBrl` (tipo + `CriarCargaInput`). O "câmbio atual" nunca é buscado por API própria — vem de `RoiConfig.cambioUsdBrl`, já configurável pelo workspace. UI: novo bloco "Radar de Exposição Cambial" em `CargoTriagePanel`, ao lado do Demurrage Clock existente, com novos campos de frete/câmbio no formulário de registro de carga.

### 3. `src/lib/chargebackRisk.ts` — Radar de Risco de Chargeback & Devolução (E-commerce)

Fecha a lacuna do item 2. Fonte: pesquisa sobre reclamações de lojistas em comunidades de e-commerce (outubro de 2026) — até **~7,5%** das transações online carregam algum tipo de fraude/contestação/não-entrega; gateways de pagamento (padrão documentado: Shopify Payments) frequentemente **retêm a taxa de processamento (~2,9% + fixo) mesmo em reembolso**, além de uma taxa fixa adicional por disputa de chargeback. O módulo soma os três ralos de caixa num único número.

Novo tipo: `PedidoEcommerce`/`StatusPedidoEcommerce` em `src/types/inbox.ts` — primeiro tipo de domínio do nicho E-commerce no produto.

**Atualização de 2026-10-31:** o painel visual (`src/components/niche/ChargebackRiskPanel.tsx`) foi implementado em sequência, fechando o corte de escopo original. Inclui o CRUD real de pedidos (`src/lib/ecommercePedidos.ts`, coleção `pedidosEcommerce`), a regra correspondente em `firestore.rules` (mesmo padrão simples de `appointments`/`shipments`/`contratosImobiliarios`, adicionada também à auditoria estrutural em `tests/firestoreRulesAudit.test.ts`) e a ligação ao Dual-Layer Workspace View em `NeuralInbox.tsx` (`workspace?.setor === "ecommerce"`). O card de métricas reaproveita o mesmo recorte de `periodoMesAtual` (@/lib/roi) já usado no card de Custo de Agenda Vazia.

### Validação

- `npx tsc --noEmit`: sem erros.
- `npx vitest run`: 48 arquivos de teste, 583 testes, todos passando (20 novos de cálculo: `tests/noShowCost.test.ts`, `tests/cambio.test.ts`, `tests/chargebackRisk.test.ts`; mais 1 caso adicionado à auditoria de `firestore.rules` para a nova coleção `pedidosEcommerce`).
- Nenhum token, cor ou componente novo introduzido — reaproveita `MetricCard`, `Field`, `Button`, pills de estado já existentes (`.claude/rules/design-system-compliance.md` respeitada).

## Consequências

**Positivas:**
- Três lacunas reais (duas já sinalizadas no próprio código) viram número auditável, com citação rastreável à pesquisa de origem — nenhum dos limiares foi inventado.
- O Radar de Exposição Cambial liga diretamente a narrativa de venda "instabilidade política" a uma feature concreta, não a um discurso.
- E-commerce ganhou seu primeiro tipo de domínio — abre caminho para o painel de UI numa story dedicada.

**Negativas / custos aceitos:**
- Os limiares de alerta (5%/8% cambial; 10%/20% no-show; 4%/7,5% chargeback) são âncoras de pesquisa de mercado geral, não calibradas ao contrato específico de cada cliente — cada workspace deve revisá-los com o próprio histórico ao crescer a base de dados real.

## Pendências / Roadmap — resiliência 2027-2028

**Atualização de 2026-10-31 — item 1 implementado:**

### 1. Health Score Preventivo de workspace — IMPLEMENTADO

`src/lib/healthScore.ts` + `src/components/governance/HealthScorePanel.tsx` (nova aba "Health Score" em `/governance`). Mesma filosofia de `@/lib/guardrails/compliancePreventivo`: sinais com peso, determinísticos, auditáveis — **nenhum modelo de ML**, para que o score seja sempre reconstruível manualmente pelo operador numa conversa difícil com o cliente.

Três sinais, cada um já existente nos dados do produto (nenhuma instrumentação nova):
1. Taxa de sucesso de execuções nos últimos 30 dias (penalidade se < 90%, maior se < 70%).
2. Tickets de transbordo abertos/em análise há mais de 48h sem decisão (penalidade a partir de 1, maior a partir de 3).
3. Dias desde a última atividade — execução OU conversa, o que for mais recente (penalidade a partir de 7 dias, maior a partir de 14; penalidade máxima se o workspace nunca teve nenhuma atividade).

Score de 0 a 100, com `nivel` (`saudavel`/`atencao`/`risco`) e a lista de sinais que pesaram, exibida no próprio painel ("Por que este score") — nunca um número opaco. Fundamentação: pesquisa sobre churn preditivo em SaaS B2B (2026) documenta adoção saindo de 38% para 65% das grandes empresas entre 2023-2026, com redução de 15-30% em atrição quando o risco é identificado antes do cancelamento — e a reclamação mais citada contra fornecedores de automação é "depois que contratei, sumiram": ninguém do lado do fornecedor percebeu o problema a tempo. É esse buraco que este painel fecha, para o operador do AgentFlow, não para o cliente final.

9 novos testes (`tests/healthScore.test.ts`). `npx tsc --noEmit` limpo; `npx vitest run`: 49 arquivos, 592 testes passando.

**Atualização de 2026-10-31 (tarde) — 4º sinal, opcional e específico de E-commerce:** `calcularHealthScore` passou a aceitar `pedidos?: PedidoEcommerce[]`. Quando informado e não-vazio, reaproveita `calcularExposicaoChargebackDevolucao` (`@/lib/chargebackRisk`) — mesmos limiares já usados no Radar de Chargeback (4%/7,5%), nunca um segundo critério inventado — e penaliza o score em -10 (atenção) ou -25 (crítico). Racional: um lojista sangrando em chargeback está perdendo dinheiro com o próprio negócio, independente de o AgentFlow estar rodando bem — sinal de risco de churn que a tríade genérica não captura. `HealthScorePanel` só assina a coleção `pedidosEcommerce` quando `workspace.setor === "ecommerce"` (consulta não gasta à toa nos outros nichos), e o 4º card ("Chargeback + devolução (mês)") só aparece quando há dado — nenhum outro nicho vê um campo vazio ou irrelevante. 5 novos testes. `npx vitest run`: 50 arquivos, 608 testes passando.

### 2. Relatório de Prontidão para Regulação de IA (EU AI Act) — IMPLEMENTADO

`src/lib/aiActReadiness.ts` (checklist puro) + `src/components/governance/AiActReadinessPanel.tsx` (nova aba "EU AI Act" em `/governance`) + `src/lib/reports/aiActReadinessPdf.ts` (exportação em PDF, mesmo padrão de `executiveReportPdf.ts`).

**Disciplina de escopo (Artigo IV — No Invention), decisão deliberada de desenho:** o relatório NUNCA declara "o AgentFlow está em conformidade com o AI Act" — isso depende de decisões que só o cliente e o advogado dele podem tomar. Oito itens, dos quais cinco são verificáveis por software (dados reais, nunca estimados) e três são explicitamente marcados `fora_do_escopo` (classificação de risco do caso de uso sob o Anexo III, papel do cliente — provedor vs. implementador —, DPIA/AIPD):

| Item verificável | Base legal | Fonte do dado |
|---|---|---|
| Registro automático de eventos | Art. 12(1) | contagem real de `auditLogs` |
| Integridade da trilha (hash-chain + HMAC) | Art. 12(1) | `verificarTrilhaAuditoria` (mesma rota server-side do `AuditTrailPanel`) |
| Retenção mínima de 180 dias | Art. 12 | idade real da entrada mais antiga carregada (teto de leitura de 2000 entradas — estimativa deliberadamente conservadora: nunca sobre-estima dias de retenção) |
| Minimização de PII antes do processamento por IA | — (controle arquitetural) | sempre `atende` — Shield-Layer é sempre ativo, não depende de configuração |
| Supervisão humana ativa (human-in-the-loop) | — (controle complementar) | `estatisticasFila` sobre tickets de transbordo reais |

Um banner fixo no topo do painel e a primeira seção visível do PDF avisam, antes de qualquer selo verde: "isto não é um certificado de conformidade". O PDF reaproveita o mesmo mecanismo de atestado do Relatório Executivo — cada download sela uma entrada própria (`relatorio.prontidao.gerado`, novo valor em `AuditEventType`, adicionado também à allowlist do servidor em `/api/audit/seal/route.ts` e coberto pelo teste de sincronia já existente `tests/auditSealTypesSync.test.ts`).

10 novos testes (`tests/aiActReadiness.test.ts`). `npx tsc --noEmit` limpo; `npx vitest run`: 50 arquivos, 603 testes passando.

### 3. Relatório de Prontidão para Regulação Brasileira (LGPD) — IMPLEMENTADO (2026-10-31, noite)

`src/lib/lgpdReadiness.ts` (checklist puro) + `src/components/governance/LgpdReadinessPanel.tsx` (nova aba "LGPD" em `/governance`) + `src/lib/reports/lgpdReadinessPdf.ts` (PDF, mesmo padrão de `aiActReadinessPdf.ts`). Par nacional do item 2 — mesma disciplina de escopo: NUNCA declara conformidade, só controles técnicos verificáveis.

Pesquisa de outubro de 2026 confirmou dois pontos que ancoram os limiares/itens: (a) a Resolução CD/ANPD nº 2/2022 dispensa Agentes de Tratamento de Pequeno Porte (ME/EPP/startup) de indicar encarregado formal **desde que mantenham canal de comunicação com o titular** — o que a Neural Inbox já é, de fato; (b) a Resolução CD/ANPD nº 15/2024 fixa prazo de **3 dias úteis** para comunicar incidente de segurança à ANPD/titular (Art. 48), processo que só se aciona com um incidente real — por isso nunca pode ser marcado "atende" preventivamente.

Nove itens: cinco avaliáveis por software (registro de operações — Art. 37; integridade do registro — Art. 46; minimização de dados — Art. 6º, V, sempre `atende`, arquitetural; segurança do cofre Zero-Trust — Art. 46, sempre `atende`; canal de comunicação com o titular — Resolução 2/2022, sempre `atende`, a Neural Inbox já cumpre) e quatro `fora_do_escopo` (base legal do tratamento, indicação de encarregado, RIPD, comunicação de incidente à ANPD).

Novo valor em `AuditEventType` (`relatorio.lgpd.gerado`), adicionado à allowlist do servidor e coberto pelo mesmo teste de sincronia. 9 novos testes (`tests/lgpdReadiness.test.ts`). `npx tsc --noEmit` limpo; `npx vitest run`: 51 arquivos, 618 testes passando.
