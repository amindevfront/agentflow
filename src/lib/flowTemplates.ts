// Templates de Fluxo prontos para produção — implantação em 1 clique.
//
// Diferente de `@/lib/flowDemoData` (que só preenche os CAMPOS de um
// formulário com um exemplo), um template aqui entrega um GRAFO completo:
// nós de qualificação, nós de guardrail apontando para políticas reais de
// `@/lib/guardrails/policy`, nós de handoff que correspondem a motivos reais
// de ticket (`HandoffReason`), e — o que de fato separa um fluxo de
// demonstração de um fluxo de produção — ARESTAS DE FALLBACK: o caminho que
// a execução toma quando a integração falha, quando a consulta não acha o
// registro, ou quando o guardrail exige um humano.
//
// Puro e server-safe: nenhum import de React ou Firestore. A escrita do
// fluxo acontece em `@/components/flows/FlowTemplateGallery`, pelo mesmo
// `createFlow` de um fluxo criado à mão.
//
// Honestidade do que é entregue (Artigo IV): os nós descrevem passos que o
// AgentFlow REALMENTE executa hoje — guardrail de Proteção de Caixa,
// transbordo HITL, triagem de carga, Demurrage Clock. Nenhum nó promete uma
// integração que não existe; o único ponto que depende de configuração
// externa (o webhook de saída do Connect Hub) está marcado como tal na
// própria descrição do nó.

import type { Flow, FlowEdgeDef, FlowGraph, FlowNodeDef, FlowStepDef, NicheKey } from "@/types";
import { POLITICA_IMOBILIARIO_ALTO_PADRAO, POLITICA_NO_CRITICO } from "@/lib/guardrails/policy";

export type FlowTemplateId = "imobiliario-vgv-alto-ticket" | "logistica-triagem-cotacao-ocorrencias";

export interface FlowTemplate {
  id: FlowTemplateId;
  nome: string;
  /** Pitch de uma linha — o que este fluxo resolve para o negócio. */
  resumo: string;
  /** Nicho a que o template pertence — usado para destacá-lo quando bate com o setor do workspace. */
  setor: NicheKey;
  gatilho: "webhook" | "agendado" | "formulario" | "manual";
  origem: string;
  grafo: FlowGraph;
}

// ---------------------------------------------------------------------------
// Template 1 — Qualificação & Agendamento Imobiliário (VGV High-Ticket)
// ---------------------------------------------------------------------------

const NOS_IMOBILIARIO: FlowNodeDef[] = [
  {
    id: "entrada-lead",
    titulo: "Entrada do lead (24/7)",
    tipo: "gatilho",
    descricao:
      "Recebe o lead de qualquer canal plugado (WhatsApp, Instagram, Web Widget, Telegram) a qualquer hora, " +
      "inclusive na janela de madrugada que o motor vertical contabiliza à parte.",
  },
  {
    id: "qualificacao-estruturada",
    titulo: "Qualificação estruturada",
    tipo: "qualificacao",
    descricao:
      "Coleta faixa de orçamento (nunca valor exato), metragem/número de suítes e prazo de decisão, no protocolo " +
      "do nicho — sem repetir pergunta que o lead já respondeu.",
  },
  {
    id: "guardrail-proteccao-caixa",
    titulo: "Guardrail de Proteção de Caixa",
    tipo: "guardrail",
    descricao:
      "Intercepta de forma determinística qualquer valor de tabela, percentual de desconto ou condição de " +
      "parcelamento na saída do agente — violação crítica, resposta bloqueada antes de chegar ao lead.",
    politicaGuardrailId: POLITICA_IMOBILIARIO_ALTO_PADRAO.id,
  },
  {
    id: "detector-intencao-compra",
    titulo: "Detector de intenção explícita de compra",
    tipo: "qualificacao",
    descricao:
      "Pedido de proposta/reserva ou negociação de condição de pagamento encerra a autonomia do agente: daqui " +
      "só sai por humano, nunca por resposta automática.",
  },
  {
    id: "handoff-corretor",
    titulo: "Handoff ao corretor com Resumo Executivo",
    tipo: "handoff",
    descricao:
      "Abre o ticket de visita presencial com o card mastigado (nome, faixa de orçamento, imóvel de interesse, " +
      "objeção mapeada) — é este ticket que alimenta VGV em pipeline no motor vertical.",
  },
  {
    id: "notificar-plantao",
    titulo: "Notificar plantão (Connect Hub)",
    tipo: "notificacao",
    descricao:
      "Despacha o evento de agendamento validado ao webhook de saída do workspace. Requer Connect Hub " +
      "configurado; sem ele, o ticket continua na fila normalmente.",
  },
  {
    id: "fallback-fila-humana",
    titulo: "Fallback — fila humana prioritária",
    tipo: "fallback",
    descricao:
      "Qualquer falha de integração, bloqueio de guardrail ou lead sem qualificação completa cai aqui em vez de " +
      "morrer em silêncio: o lead entra na fila de transbordo com o contexto que já foi coletado.",
  },
];

const ARESTAS_IMOBILIARIO: FlowEdgeDef[] = [
  { de: "entrada-lead", para: "qualificacao-estruturada", tipo: "sucesso" },
  { de: "qualificacao-estruturada", para: "guardrail-proteccao-caixa", tipo: "sucesso" },
  { de: "guardrail-proteccao-caixa", para: "detector-intencao-compra", tipo: "sucesso", rotulo: "resposta aprovada" },
  {
    de: "guardrail-proteccao-caixa",
    para: "fallback-fila-humana",
    tipo: "escalonamento",
    rotulo: "preço/desconto bloqueado",
  },
  {
    de: "detector-intencao-compra",
    para: "handoff-corretor",
    tipo: "escalonamento",
    rotulo: "proposta ou parcelamento pedido",
  },
  { de: "detector-intencao-compra", para: "notificar-plantao", tipo: "sucesso", rotulo: "visita confirmada" },
  { de: "handoff-corretor", para: "notificar-plantao", tipo: "sucesso" },
  { de: "notificar-plantao", para: "fallback-fila-humana", tipo: "falha", rotulo: "webhook indisponível" },
  { de: "qualificacao-estruturada", para: "fallback-fila-humana", tipo: "falha", rotulo: "lead sem dados mínimos" },
];

export const TEMPLATE_IMOBILIARIO: FlowTemplate = {
  id: "imobiliario-vgv-alto-ticket",
  nome: "Qualificação & Agendamento Imobiliário (VGV High-Ticket)",
  resumo:
    "Qualifica o lead de alto padrão 24/7, bloqueia preço/desconto não autorizado e entrega o corretor um " +
    "resumo executivo pronto — com fila humana de fallback em cada ponto de falha.",
  setor: "construtora-imobiliaria",
  gatilho: "webhook",
  origem: "Formulário do site / canais de mensageria",
  grafo: { nos: NOS_IMOBILIARIO, arestas: ARESTAS_IMOBILIARIO },
};

// ---------------------------------------------------------------------------
// Template 2 — Triagem Logística, Cotação & Ocorrências B2B
// ---------------------------------------------------------------------------

const NOS_LOGISTICA: FlowNodeDef[] = [
  {
    id: "entrada-demanda",
    titulo: "Entrada da demanda operacional",
    tipo: "gatilho",
    descricao:
      "Recebe cotação spot, consulta de status/CT-e ou abertura de ocorrência por qualquer canal plugado, " +
      "fora do horário comercial inclusive.",
  },
  {
    id: "extracao-carga",
    titulo: "Extração de peso, cubagem e rota",
    tipo: "qualificacao",
    descricao:
      "Parser determinístico lê peso (kg/t), cubagem (m³ ou dimensões LxAxP), origem/destino e código de " +
      "rastreio direto da mensagem — sem um humano redigitar nada no TMS.",
  },
  {
    id: "consulta-status",
    titulo: "Consulta de status & Demurrage Clock",
    tipo: "consulta",
    descricao:
      "Cruza o código informado com as cargas registradas, calcula desvio de SLA e expõe o custo de " +
      "sobre-estadia em curso antes da fatura do armador chegar.",
  },
  {
    id: "guardrail-margem",
    titulo: "Guardrail de margem & prazo",
    tipo: "guardrail",
    descricao:
      "Nó crítico: nenhum valor de frete fechado, desconto fora da faixa ou promessa de prazo de liberação sai " +
      "sem validação humana — exige fundamentação e múltiplas amostras de consistência.",
    politicaGuardrailId: POLITICA_NO_CRITICO.id,
  },
  {
    id: "escalonamento-torre",
    titulo: "Escalonamento à torre de controle",
    tipo: "handoff",
    descricao:
      "Ocorrência crítica (parada de linha, carga perecível, free time estourando, avaria) abre transbordo " +
      "prioritário para o despachante de plantão, com o contexto já extraído.",
  },
  {
    id: "resposta-operacional",
    titulo: "Resposta operacional ao cliente",
    tipo: "notificacao",
    descricao:
      "Devolve status, janela de doca ou faixa de referência da cotação na linguagem da operação — é esta " +
      "etapa que o motor vertical mede contra o SLA de 30 segundos.",
  },
  {
    id: "fallback-despacho-manual",
    titulo: "Fallback — despacho manual",
    tipo: "fallback",
    descricao:
      "Código não encontrado, carga sem termos de demurrage contratados ou falha de consulta caem aqui: o " +
      "cliente nunca recebe um status inventado, e o caso vai para um humano com o que já foi lido.",
  },
];

const ARESTAS_LOGISTICA: FlowEdgeDef[] = [
  { de: "entrada-demanda", para: "extracao-carga", tipo: "sucesso" },
  { de: "extracao-carga", para: "consulta-status", tipo: "sucesso", rotulo: "código de rastreio presente" },
  { de: "extracao-carga", para: "guardrail-margem", tipo: "sucesso", rotulo: "pedido de cotação" },
  { de: "extracao-carga", para: "fallback-despacho-manual", tipo: "falha", rotulo: "peso/rota ilegíveis" },
  { de: "consulta-status", para: "resposta-operacional", tipo: "sucesso" },
  { de: "consulta-status", para: "fallback-despacho-manual", tipo: "falha", rotulo: "carga não encontrada" },
  {
    de: "consulta-status",
    para: "escalonamento-torre",
    tipo: "escalonamento",
    rotulo: "ocorrência crítica ou SLA estourado",
  },
  { de: "guardrail-margem", para: "resposta-operacional", tipo: "sucesso", rotulo: "faixa dentro da política" },
  { de: "guardrail-margem", para: "escalonamento-torre", tipo: "escalonamento", rotulo: "valor fechado barrado" },
  { de: "escalonamento-torre", para: "resposta-operacional", tipo: "sucesso" },
];

export const TEMPLATE_LOGISTICA: FlowTemplate = {
  id: "logistica-triagem-cotacao-ocorrencias",
  nome: "Triagem Logística, Cotação & Ocorrências B2B",
  resumo:
    "Lê peso e cubagem da própria mensagem, devolve status de carga com Demurrage Clock e escala ocorrência " +
    "crítica à torre de controle — com despacho manual de fallback sempre que o dado não existir.",
  setor: "logistica-portuaria",
  gatilho: "webhook",
  origem: "Portal de clientes / canais de mensageria",
  grafo: { nos: NOS_LOGISTICA, arestas: ARESTAS_LOGISTICA },
};

export const FLOW_TEMPLATES: FlowTemplate[] = [TEMPLATE_IMOBILIARIO, TEMPLATE_LOGISTICA];

/** Template por id, ou `null` — nunca um throw: um id legado vindo de `Flow.templateId` não pode quebrar a tela. */
export function obterTemplate(id: string | null | undefined): FlowTemplate | null {
  if (!id) return null;
  return FLOW_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** Templates ordenados com o do setor do workspace primeiro — relevância antes de ordem alfabética. */
export function templatesParaSetor(setor: NicheKey | null | undefined): FlowTemplate[] {
  if (!setor) return FLOW_TEMPLATES;
  return [...FLOW_TEMPLATES].sort((a, b) => Number(b.setor === setor) - Number(a.setor === setor));
}

/**
 * A sequência linear de passos que o trilho de execução (`FlowRail`) e o
 * contrato legado de `Flow.steps` esperam, derivada do grafo — fonte única:
 * o template declara o grafo, e os `steps` são uma projeção dele, nunca uma
 * segunda lista escrita à mão que possa divergir.
 *
 * Nós de fallback ficam de fora da projeção de propósito: `steps` descreve o
 * caminho que a execução percorre quando tudo dá certo, e um trilho que já
 * nasce exibindo "despacho manual" como etapa normal daria a impressão
 * errada de que toda execução passa por um humano.
 */
export function stepsDoTemplate(template: FlowTemplate): FlowStepDef[] {
  return template.grafo.nos
    .filter((no) => no.tipo !== "fallback")
    .map((no) => ({ id: no.id, titulo: no.titulo }));
}

/** Payload pronto para `createFlow` — o conteúdo exato que o 1-clique persiste. */
export function novoFluxoDoTemplate(template: FlowTemplate): Omit<Flow, "id" | "workspaceId" | "atualizadoEm"> {
  return {
    nome: template.nome,
    gatilho: template.gatilho,
    origem: template.origem,
    steps: stepsDoTemplate(template),
    grafo: template.grafo,
    templateId: template.id,
    status: "ocioso",
  };
}

export interface ProblemaGrafo {
  codigo: "no-orfao" | "aresta-invalida" | "sem-fallback" | "id-duplicado";
  detalhe: string;
}

/**
 * Valida a integridade de um grafo de template. Existe por um motivo
 * concreto: um template é escrito à mão em TypeScript, e um id de nó com
 * erro de digitação em uma aresta produziria um fluxo que parece correto na
 * tela e simplesmente nunca alcança aquele ramo. O teste
 * `tests/flowTemplates.test.ts` roda esta função sobre TODOS os templates.
 */
export function validarGrafoFluxo(grafo: FlowGraph): ProblemaGrafo[] {
  const problemas: ProblemaGrafo[] = [];
  const ids = new Set<string>();

  for (const no of grafo.nos) {
    if (ids.has(no.id)) {
      problemas.push({ codigo: "id-duplicado", detalhe: `Nó "${no.id}" aparece mais de uma vez.` });
    }
    ids.add(no.id);
  }

  const alcancados = new Set<string>();
  for (const aresta of grafo.arestas) {
    if (!ids.has(aresta.de)) {
      problemas.push({ codigo: "aresta-invalida", detalhe: `Aresta parte de um nó inexistente: "${aresta.de}".` });
    }
    if (!ids.has(aresta.para)) {
      problemas.push({ codigo: "aresta-invalida", detalhe: `Aresta aponta para um nó inexistente: "${aresta.para}".` });
    }
    alcancados.add(aresta.de);
    alcancados.add(aresta.para);
  }

  for (const no of grafo.nos) {
    if (!alcancados.has(no.id)) {
      problemas.push({ codigo: "no-orfao", detalhe: `Nó "${no.id}" não participa de nenhuma aresta.` });
    }
  }

  const temFallback = grafo.arestas.some((a) => a.tipo === "falha" || a.tipo === "escalonamento");
  if (!temFallback) {
    problemas.push({
      codigo: "sem-fallback",
      detalhe: "Grafo sem nenhuma aresta de falha/escalonamento — só cobre o caminho feliz.",
    });
  }

  return problemas;
}
