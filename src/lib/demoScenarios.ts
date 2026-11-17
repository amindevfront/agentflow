// Cenários de Demonstração (Vitrine Enterprise) — definição pura.
//
// Um "cenário" é o conjunto mínimo de dados que faz as telas do AgentFlow
// contarem a história de UMA vertical de ponta a ponta numa reunião de
// diretoria: leads coerentes na Neural Inbox, cargas sob Demurrage Clock, e
// o motor vertical correspondente ativo na Governança.
//
// Três regras que este módulo nunca quebra:
//
//  1. **Nada é injetado sozinho.** Carregar um cenário é sempre uma ação
//     explícita do operador (ver `@/components/demo/DemoScenarioSwitcher`) —
//     nenhum dado de demonstração nasce por efeito colateral de login,
//     navegação ou troca de nicho.
//  2. **Tudo é rotulado como demonstração.** As conversas semeadas nascem
//     com `origemSandbox: true` (a mesma marca do Simulador de Payload), o
//     que já as exclui de todo agregado financeiro real — ver
//     `subscribeConversations` (`@/lib/inbox/firestore`) e
//     `obterMetricasPipelineVerticalAdmin` (`@/lib/server/roiDashboard`). As
//     cargas usam o prefixo `DEMO-` no código de rastreio.
//  3. **Nenhum nome é um cliente real.** "Incorporadora Atlântica" e
//     "TransAtlântica Logística" são fictícios por desenho, como todo dado
//     de exemplo deste código (ver `@/lib/flowDemoData`).
//
// Puro: sem Firestore, sem React. A semeadura propriamente dita vive em
// `@/lib/demoScenarioSeed` (client, escreve), e a persistência da escolha
// vive em `lerCenarioAtivo`/`salvarCenarioAtivo` abaixo (localStorage).

import type { Canal, NicheKey, ShipmentStatus } from "@/types";
import type { VerticalEngineId } from "./verticalTelemetry";

export type DemoScenarioId = "incorporadora-atlantica" | "transatlantica-logistica";

/** Lead simulado: uma conversa de demonstração com as mensagens que o cliente teria mandado. */
export interface DemoLeadSeed {
  nome: string;
  /** Identificador de contato — passa pelo mesmo Shield-Layer de um contato real, então nunca fica em claro. */
  identificador: string;
  canal: Canal;
  assunto: string;
  /** Mensagens do cliente, na ordem em que teriam chegado. */
  mensagens: string[];
}

/** Carga simulada: registro operacional que acende o Demurrage Clock e a triagem de SLA. */
export interface DemoCargaSeed {
  codigoRastreio: string;
  origem: string;
  destino: string;
  status: ShipmentStatus;
  /** Dias a partir de agora para a previsão de entrega — negativo coloca a carga em atraso de propósito. */
  previsaoEmDias: number;
  freeTimeDias?: number;
  custoDiarioDemurrageBrl?: number;
  valorFreteUsd?: number;
  cambioContratadoBrl?: number;
}

export interface DemoScenario {
  id: DemoScenarioId;
  /** Nome de vitrine, exibido no seletor. */
  rotulo: string;
  descricao: string;
  /** Nicho que este cenário representa — o motor vertical correspondente é derivado dele. */
  setor: NicheKey;
  vertical: VerticalEngineId;
  leads: DemoLeadSeed[];
  cargas: DemoCargaSeed[];
}

export const CENARIO_IMOBILIARIO: DemoScenario = {
  id: "incorporadora-atlantica",
  rotulo: "Incorporadora Atlântica — Alto Padrão (Itajaí/SC)",
  descricao:
    "Leads investidores de madrugada perguntando por plantas de 4 suítes, estrutura de pagamento indexada " +
    "(INCC) e visita ao showroom VIP na Praia Brava.",
  setor: "construtora-imobiliaria",
  vertical: "imobiliario-alto-padrao",
  leads: [
    {
      nome: "Marina Castello",
      identificador: "demo-imob-01",
      canal: "whatsapp",
      assunto: "Cobertura 4 suítes — Praia Brava",
      mensagens: [
        "Boa noite! Vi o lançamento da Praia Brava agora, não consegui dormir pensando nisso.",
        "Tenho interesse na planta de 4 suítes com vista mar. Meu orçamento é até 2 milhões.",
        "Dá para agendar uma visita ao decorado neste sábado de manhã?",
      ],
    },
    {
      nome: "Eduardo Bittencourt",
      identificador: "demo-imob-02",
      canal: "instagram",
      assunto: "Investimento — unidades de Itajaí",
      mensagens: [
        "Trabalho com investimento imobiliário e estou olhando Itajaí para alocar capital este ano.",
        "Quero entender a tabela de pagamento: qual o indexador do saldo devedor na planta, INCC?",
        "Se fizer sentido, fecho duas unidades. Pode me mandar uma proposta formal?",
      ],
    },
    {
      nome: "Renata Villas-Bôas",
      identificador: "demo-imob-03",
      canal: "webchat",
      assunto: "Showroom VIP — Balneário Camboriú",
      mensagens: [
        "Estou em São Paulo e vou passar o fim de semana em Balneário Camboriú.",
        "Consigo uma visita privativa ao showroom? Prefiro fora do horário de movimento.",
      ],
    },
  ],
  cargas: [],
};

export const CENARIO_LOGISTICA: DemoScenario = {
  id: "transatlantica-logistica",
  rotulo: "TransAtlântica Logística — Frete & Operações B2B",
  descricao:
    "Cotações spot com peso e cubagem na própria mensagem, consulta de status/CT-e de cargas em trânsito e " +
    "fila de agendamento de doca com ocorrência crítica.",
  setor: "logistica-portuaria",
  vertical: "logistica-b2b",
  leads: [
    {
      nome: "Setor de Suprimentos — Metalúrgica Andrade",
      identificador: "demo-log-01",
      canal: "whatsapp",
      assunto: "Cotação spot — Itajaí → Campinas",
      mensagens: [
        "Preciso de cotação spot para amanhã: 2.400 kg, 6 m³, Itajaí/SC para Campinas/SP.",
        "São 8 volumes paletizados de 1,20 x 0,80 x 1,00. Tem disponibilidade de coleta hoje à tarde?",
      ],
    },
    {
      nome: "Expedição — Nordeste Distribuidora",
      identificador: "demo-log-02",
      canal: "webchat",
      assunto: "Status de carga DEMO-004521",
      mensagens: [
        "Qual o status da carga DEMO-004521? O cliente final está cobrando a entrega.",
        "Preciso também do número do CT-e para dar baixa no nosso sistema.",
      ],
    },
    {
      nome: "Torre de Controle — Cliente Vexpress",
      identificador: "demo-log-03",
      canal: "telegram",
      assunto: "Ocorrência crítica — parada de linha",
      mensagens: [
        "Temos uma ocorrência: o veículo da carga DEMO-004522 quebrou na BR-101.",
        "Essa carga é de insumo de linha de produção, parada de linha custa caro. Preciso de redespacho urgente hoje.",
      ],
    },
  ],
  cargas: [
    {
      codigoRastreio: "DEMO-004521",
      origem: "Porto de Itajaí/SC",
      destino: "Campinas/SP",
      status: "aduana",
      previsaoEmDias: 3,
      freeTimeDias: 7,
      custoDiarioDemurrageBrl: 850,
      valorFreteUsd: 4200,
      cambioContratadoBrl: 5.4,
    },
    {
      codigoRastreio: "DEMO-004522",
      origem: "Navegantes/SC",
      destino: "Cajamar/SP",
      status: "em-transito",
      previsaoEmDias: -1,
      freeTimeDias: 5,
      custoDiarioDemurrageBrl: 620,
    },
  ],
};

export const CENARIOS_DEMO: Record<DemoScenarioId, DemoScenario> = {
  "incorporadora-atlantica": CENARIO_IMOBILIARIO,
  "transatlantica-logistica": CENARIO_LOGISTICA,
};

export const ORDEM_CENARIOS: DemoScenarioId[] = ["incorporadora-atlantica", "transatlantica-logistica"];

/** Cenário por id, ou `null` quando o id não corresponde a nenhum (valor legado no localStorage, por exemplo). */
export function obterCenario(id: string | null | undefined): DemoScenario | null {
  if (!id) return null;
  return CENARIOS_DEMO[id as DemoScenarioId] ?? null;
}

// ---------------------------------------------------------------------------
// Persistência local da escolha
// ---------------------------------------------------------------------------
//
// localStorage, não Firestore, e deliberadamente: o cenário de demonstração
// é uma preferência do DISPOSITIVO de quem está apresentando (o notebook da
// reunião), nunca uma configuração do tenant. Gravá-lo no workspace faria
// uma demonstração local mudar o que o cliente vê em produção no mesmo
// workspace — exatamente o contrário do que uma vitrine deve fazer.

const CHAVE_CENARIO = "agentflow:demo-scenario";

/** Cenário ativo neste navegador, ou `null` (inclusive em SSR, onde não há `localStorage`). */
export function lerCenarioAtivo(): DemoScenario | null {
  if (typeof window === "undefined") return null;
  try {
    return obterCenario(window.localStorage.getItem(CHAVE_CENARIO));
  } catch {
    // Acesso a localStorage pode ser negado (modo privativo, política de
    // terceiros). Sem cenário ativo é o estado seguro: a UI cai no nicho
    // real do workspace.
    return null;
  }
}

/** Persiste (ou limpa, com `null`) o cenário ativo deste navegador. */
export function salvarCenarioAtivo(id: DemoScenarioId | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id === null) window.localStorage.removeItem(CHAVE_CENARIO);
    else window.localStorage.setItem(CHAVE_CENARIO, id);
  } catch {
    // Mesma razão de `lerCenarioAtivo`: nunca derrubar a tela por uma
    // preferência de apresentação que não pôde ser gravada.
  }
}
