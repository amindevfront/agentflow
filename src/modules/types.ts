// Contrato do Registro de Módulos Verticais (Gavetas) — AgentFlow.
//
// Premissa arquitetural: o AgentFlow não é um app customizado por cliente.
// É uma infraestrutura SaaS multi-tenant onde cada nicho ativado é uma
// "gaveta" plugável — isolada, com seus próprios guardrails, calculadoras de
// ROI e widgets — que se liga ao motor comum sem alterar seu núcleo
// (`@/lib/shared`, ver cabeçalho daquele arquivo).
//
// Deliberadamente SEM import de React (nem `import type`): este arquivo é
// consumido por `./registry.ts`, que por sua vez é importado por código
// SERVER-ONLY (`@/lib/server/roiDashboard`). A UI injetada por módulo
// ("InboxExtras") é um contrato PARALELO, resolvido só no lado cliente por
// `./registry.client` — ver o header daquele arquivo para o porquê da
// separação.

import type { Moeda, NicheKey, PiiKind } from "@/types";
import type { Idioma, Jurisdicao } from "@/lib/jurisdiction";

/**
 * Contexto que a Neural Inbox entrega a um componente `InboxExtras` de
 * gaveta (ver `./registry.client`). Um único formato serve os módulos hoje
 * existentes — cada um lê só os campos que precisa:
 *   - Imobiliário (BR/EUA): `inserirNaResposta` / `mensagensClienteRecentes`.
 *   - Clínicas (BR/PT): `conversaSelecionada` (lembretes de agendamento).
 *   - Logística: `ultimaMensagemCliente` + `inserirNaResposta` (triagem de carga).
 *   - Reformas/Empreiteiras (EUA): `mensagensClienteRecentes` + `inserirNaResposta`.
 *   - E-commerce: nenhum (painel autossuficiente via `useWorkspace`).
 */
export interface InboxModuleContext {
  conversaSelecionada: { id: string; nome: string } | null;
  inserirNaResposta: (texto: string) => void;
  ultimaMensagemCliente?: string;
  /**
   * Últimas mensagens do cliente nesta conversa, mais recente primeiro —
   * extração multi-mensagem (orçamento, objeção, interesse) precisa de mais
   * que a última mensagem isolada (ver `@/lib/server/imobiliarioAltoPadrao`
   * e `@/lib/server/usRealEstateLuxury` para os extratores que a consomem).
   */
  mensagensClienteRecentes?: string[];
}

/**
 * Metadados SERVER-SAFE de uma gaveta — o que o core precisa saber sobre um
 * módulo vertical sem nunca importar sua UI. `temInboxExtras` é só um sinal
 * documentado de que existe uma UI registrada em `./registry.client` para
 * este `id`; a dupla fonte (aqui + lá) é verificada por
 * `tests/moduleRegistry.test.ts`, para as duas listas nunca divergirem
 * silenciosamente.
 */
export interface VerticalModuleDefinition {
  id: NicheKey;
  nome: string;
  descricao: string;
  /**
   * Referencia um id de `POLITICAS_PREDEFINIDAS` (`@/lib/guardrails/policy`).
   * É a política RECOMENDADA para esta gaveta — a aplicação efetiva a um nó
   * de fluxo continua sendo decisão explícita de quem configura o fluxo
   * (`resolverPolitica`), nunca automática por `setor`: isto é documentação
   * acionável, não um gatilho oculto de comportamento.
   */
  guardrailPolicyId: string;

  // --- Camada de Localização e Conformidade (Expansão Enterprise Global) ---

  /** Moeda NATIVA do ticket médio desta vertical — ver `valorMedioPipelineMoedaLocal`. */
  moeda: Moeda;
  /**
   * Valor médio ESTIMADO de pipeline por agendamento confirmado, na moeda
   * NATIVA desta vertical (`moeda`) — nunca pré-convertido. `0` = nenhum
   * protocolo de confirmação de agendamento implementado ainda para este
   * nicho — nunca inventado (Artigo IV).
   */
  valorMedioPipelineMoedaLocal: number;
  /**
   * Equivalente em BRL de `valorMedioPipelineMoedaLocal`, ao câmbio de
   * REFERÊNCIA de `ROI_CONFIG_PADRAO` (`@/lib/roi`) — mantém o contrato
   * legado de `VALOR_MEDIO_PIPELINE_PADRAO_BRL` (`@/lib/server/roiDashboard`),
   * que agrega pipeline de múltiplos workspaces em uma única moeda de
   * cálculo. Cada workspace real deve recalibrar via o parâmetro
   * `valorMedioPipelineBrl` de `calcularMetricasPipelineVertical` — este
   * campo é só o valor de partida, nunca uma conversão em tempo real.
   */
  valorMedioPipelineBrl: number;
  /**
   * Jurisdição/regime de dados padrão desta vertical (ver `@/lib/jurisdiction`
   * — `inferirJurisdicaoPorTelefone` continua a fonte dinâmica por conversa;
   * este campo é só o padrão ESPERADO do mercado-alvo da gaveta, para UI/
   * documentação, nunca uma afirmação de conformidade legal completa).
   */
  jurisdicao: Jurisdicao;
  /** Idioma padrão esperado dos leads/clientes desta vertical (ver `@/lib/jurisdiction`). */
  idiomaPadrao: Idioma;
  /**
   * Fuso horário IANA típico do mercado-alvo desta gaveta — metadado
   * informativo (relatórios/UI), não consumido por nenhum motor de
   * agendamento hoje: o AgentFlow ainda trata `Workspace.horarioFuncionamento`
   * como horas locais implícitas, sem um campo de fuso formal (ver `@/types`).
   */
  fusoHorario: string;
  /**
   * Categorias de PII (`@/types`, `PiiKind`) tipicamente relevantes neste
   * mercado — documentação de quais detectores do Shield-Layer
   * (`@/lib/guardrails/pii`) importam mais aqui. A DETECÇÃO em si já cobre
   * todas as categorias para qualquer workspace, sempre — este campo nunca
   * restringe nem substitui isso, é só o destaque esperado da vertical.
   */
  piiKindsRelevantes: PiiKind[];

  temInboxExtras: boolean;
}

export type ModuleRegistryMap = Partial<Record<NicheKey, VerticalModuleDefinition>>;
