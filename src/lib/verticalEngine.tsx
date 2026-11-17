"use client";

// Motor Vertical Reativo — máquina de estados type-safe por tenant.
//
// Duas responsabilidades, no mesmo arquivo porque uma existe para a outra:
//
//  1. `DemoScenarioProvider` — qual Cenário de Demonstração está carregado
//     NESTE navegador (ver `@/lib/demoScenarios`). É a única fonte que pode
//     sobrepor o nicho real do workspace, e só para fins de vitrine.
//  2. `useVerticalEngine` — assina as quatro fontes reativas do workspace
//     (conversas, tickets de transbordo, execuções e cargas) e recalcula a
//     telemetria do motor vertical ativo a cada snapshot.
//
// Por que uma máquina de estados explícita, e não três `useState` soltos:
// "ainda carregando", "este nicho não tem motor vertical" e "as fontes
// chegaram, mas vazias" são três situações visualmente idênticas se o
// estado for só `metricas: []` — e a terceira é a única em que mostrar
// zeros é honesto. A união discriminada abaixo torna impossível renderizar
// um zero que na verdade significa "ainda não sei".

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import type { Conversation, FlowRun, HandoffTicket, NicheKey, RoiPeriodo, Shipment } from "@/types";
import { subscribeFlowRuns } from "@/lib/firestore";
import { subscribeConversations } from "@/lib/inbox/firestore";
import { subscribeFilaTransbordo } from "@/lib/humanInTheLoop";
import { subscribeShipments } from "@/lib/shipments";
import { periodoMesAtual } from "@/lib/roi";
import { useWorkspace } from "@/lib/workspace";
import { useWorkspaceDoc } from "@/lib/queries/workspace";
import {
  calcularTelemetriaVertical,
  obterContratoVertical,
  type ContratoVertical,
  type MetricaVertical,
} from "@/lib/verticalTelemetry";
import {
  lerCenarioAtivo,
  salvarCenarioAtivo,
  type DemoScenario,
  type DemoScenarioId,
} from "@/lib/demoScenarios";

// ---------------------------------------------------------------------------
// Contexto do Cenário de Demonstração
// ---------------------------------------------------------------------------

interface DemoScenarioContextValue {
  cenario: DemoScenario | null;
  definirCenario: (id: DemoScenarioId | null) => void;
  /** `false` até o primeiro `useEffect` ler o localStorage — evita divergência de hidratação. */
  hidratado: boolean;
}

const DemoScenarioContext = createContext<DemoScenarioContextValue | undefined>(undefined);

export function DemoScenarioProvider({ children }: { children: ReactNode }) {
  const [cenario, setCenario] = useState<DemoScenario | null>(null);
  const [hidratado, setHidratado] = useState(false);

  // Leitura só no cliente, depois da montagem: `lerCenarioAtivo` devolve
  // `null` em SSR, então ler durante o render faria o primeiro HTML do
  // servidor e o primeiro render do cliente discordarem.
  useEffect(() => {
    setCenario(lerCenarioAtivo());
    setHidratado(true);
  }, []);

  const definirCenario = useCallback((id: DemoScenarioId | null) => {
    salvarCenarioAtivo(id);
    setCenario(id === null ? null : lerCenarioAtivo());
  }, []);

  const valor = useMemo(
    () => ({ cenario, definirCenario, hidratado }),
    [cenario, definirCenario, hidratado]
  );

  return <DemoScenarioContext.Provider value={valor}>{children}</DemoScenarioContext.Provider>;
}

export function useDemoScenario(): DemoScenarioContextValue {
  const ctx = useContext(DemoScenarioContext);
  if (!ctx) throw new Error("useDemoScenario deve ser usado dentro de <DemoScenarioProvider>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Máquina de estados do motor vertical
// ---------------------------------------------------------------------------

/** De onde veio o motor ativo — a UI precisa dizer isto em voz alta quando for demonstração. */
export type OrigemMotorVertical = "workspace" | "cenario-demo";

export type EstadoMotorVertical =
  | { fase: "sem-workspace" }
  | { fase: "sem-motor"; setor: NicheKey | null }
  | { fase: "carregando"; contrato: ContratoVertical; origem: OrigemMotorVertical }
  | {
      fase: "pronto";
      contrato: ContratoVertical;
      origem: OrigemMotorVertical;
      metricas: MetricaVertical[];
      periodo: RoiPeriodo;
      /** Conversas consideradas (já respeitando o filtro de Sandbox) — base de "sem dados ainda". */
      totalConversas: number;
    }
  | { fase: "erro"; contrato: ContratoVertical; origem: OrigemMotorVertical; mensagem: string };

type Fonte = "conversas" | "tickets" | "execucoes" | "cargas";

interface EstadoInterno {
  conversas: Conversation[];
  tickets: HandoffTicket[];
  execucoes: FlowRun[];
  cargas: Shipment[];
  recebidas: Fonte[];
  erro: string | null;
}

type AcaoMotor =
  | { tipo: "reset" }
  | { tipo: "conversas"; dados: Conversation[] }
  | { tipo: "tickets"; dados: HandoffTicket[] }
  | { tipo: "execucoes"; dados: FlowRun[] }
  | { tipo: "cargas"; dados: Shipment[] }
  | { tipo: "erro"; mensagem: string };

const ESTADO_INICIAL: EstadoInterno = {
  conversas: [],
  tickets: [],
  execucoes: [],
  cargas: [],
  recebidas: [],
  erro: null,
};

function marcarRecebida(recebidas: Fonte[], fonte: Fonte): Fonte[] {
  return recebidas.includes(fonte) ? recebidas : [...recebidas, fonte];
}

function reducerMotor(estado: EstadoInterno, acao: AcaoMotor): EstadoInterno {
  switch (acao.tipo) {
    case "reset":
      return ESTADO_INICIAL;
    case "conversas":
      return { ...estado, conversas: acao.dados, recebidas: marcarRecebida(estado.recebidas, "conversas") };
    case "tickets":
      return { ...estado, tickets: acao.dados, recebidas: marcarRecebida(estado.recebidas, "tickets") };
    case "execucoes":
      return { ...estado, execucoes: acao.dados, recebidas: marcarRecebida(estado.recebidas, "execucoes") };
    case "cargas":
      return { ...estado, cargas: acao.dados, recebidas: marcarRecebida(estado.recebidas, "cargas") };
    case "erro":
      return { ...estado, erro: acao.mensagem };
  }
}

const TODAS_AS_FONTES: Fonte[] = ["conversas", "tickets", "execucoes", "cargas"];

export interface OpcoesMotorVertical {
  /**
   * Inclui conversas de demonstração (`origemSandbox`) na telemetria. Ligado
   * automaticamente quando um Cenário de Demonstração está carregado — sem
   * isso, carregar um cenário não mudaria número nenhum na tela, já que todo
   * lead semeado nasce marcado como Sandbox de propósito.
   */
  incluirSandbox?: boolean;
  /** Período de apuração. Padrão: mês corrente, a mesma janela inicial do `BusinessROIWidget`. */
  periodo?: RoiPeriodo;
}

/**
 * Telemetria reativa do motor vertical ativo deste tenant.
 *
 * O motor ativo é, em ordem de precedência:
 *   1. o Cenário de Demonstração carregado neste navegador, se houver;
 *   2. o motor dedicado do `Workspace.setor`, se existir um;
 *   3. nenhum (`fase: "sem-motor"`) — e a UI cai no painel genérico.
 */
export function useVerticalEngine(opcoes: OpcoesMotorVertical = {}): EstadoMotorVertical {
  const { workspaceId } = useWorkspace();
  const { data: workspace } = useWorkspaceDoc(workspaceId);
  const { cenario } = useDemoScenario();
  const [estado, despachar] = useReducer(reducerMotor, ESTADO_INICIAL);

  // Âncora temporal estável — sem ela, cada render criaria um `new Date()`
  // novo e o `useMemo` do cálculo nunca reaproveitaria nada.
  const [referencia, setReferencia] = useState(() => new Date());
  useEffect(() => {
    const intervalo = setInterval(() => setReferencia(new Date()), 60_000);
    return () => clearInterval(intervalo);
  }, []);

  const setorEfetivo: NicheKey | null = cenario?.setor ?? workspace?.setor ?? null;
  const contrato = obterContratoVertical(setorEfetivo);
  const origem: OrigemMotorVertical = cenario ? "cenario-demo" : "workspace";
  const incluirSandbox = opcoes.incluirSandbox ?? Boolean(cenario);

  // `contrato.id` (não o objeto) como dependência: os contratos são
  // constantes de módulo, mas depender do objeto deixaria o efeito refém de
  // identidade referencial se um dia vierem a ser construídos por função.
  const contratoId = contrato?.id ?? null;

  useEffect(() => {
    despachar({ tipo: "reset" });
  }, [workspaceId, contratoId, incluirSandbox]);

  useEffect(() => {
    if (!workspaceId || !contratoId) return;

    const cancelamentos = [
      subscribeConversations((lista) => despachar({ tipo: "conversas", dados: lista }), {
        workspaceId,
        limite: 500,
        incluirSandbox,
        onError: () =>
          despachar({ tipo: "erro", mensagem: "Neural Inbox indisponível no momento. Os demais números continuam atualizados." }),
      }),
      subscribeFilaTransbordo((lista) => despachar({ tipo: "tickets", dados: lista }), {
        workspaceId,
        limite: 300,
        onError: () =>
          despachar({ tipo: "erro", mensagem: "Fila de transbordo indisponível no momento. Os demais números continuam atualizados." }),
      }),
      subscribeFlowRuns(workspaceId, (lista) => despachar({ tipo: "execucoes", dados: lista })),
      subscribeShipments((lista) => despachar({ tipo: "cargas", dados: lista }), workspaceId),
    ];

    return () => cancelamentos.forEach((cancelar) => cancelar());
  }, [workspaceId, contratoId, incluirSandbox]);

  const periodo = useMemo(
    () => opcoes.periodo ?? periodoMesAtual(referencia),
    [opcoes.periodo, referencia]
  );

  const metricas = useMemo(() => {
    if (!contrato) return null;
    return calcularTelemetriaVertical({
      contrato,
      periodo,
      conversas: estado.conversas,
      tickets: estado.tickets,
      execucoes: estado.execucoes,
      cargas: estado.cargas,
      referencia,
    });
  }, [contrato, periodo, estado.conversas, estado.tickets, estado.execucoes, estado.cargas, referencia]);

  if (!workspaceId) return { fase: "sem-workspace" };
  if (!contrato) return { fase: "sem-motor", setor: setorEfetivo };
  if (estado.erro) return { fase: "erro", contrato, origem, mensagem: estado.erro };

  const todasChegaram = TODAS_AS_FONTES.every((fonte) => estado.recebidas.includes(fonte));
  if (!todasChegaram || !metricas) return { fase: "carregando", contrato, origem };

  return {
    fase: "pronto",
    contrato,
    origem,
    metricas,
    periodo,
    totalConversas: estado.conversas.length,
  };
}
