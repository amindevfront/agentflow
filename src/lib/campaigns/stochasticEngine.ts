// Motor de campanhas com anti-ban estocástico.
//
// Dois problemas resolvidos juntos:
//
//   1. **Anti-ban**: APIs de mensageria (WhatsApp Business, etc.) suspendem
//      números que enviam em cadência robótica — intervalos idênticos, lotes
//      de tamanho fixo, zero variação. `planejarLotes` nunca envia dois
//      destinatários no mesmo instante e nunca com o mesmo intervalo exato;
//      `taxaMaximaPorMinuto` é uma defesa redundante e DETERMINÍSTICA — o
//      jitter é aleatório, mas o teto de taxa nunca é violado mesmo no pior
//      caso de sorteio (ver `calcularAtrasoComTeto`).
//   2. **Conformidade**: nenhum envio sai sem passar por `verificarConformidade`
//      — opt-out registrado bloqueia incondicionalmente, antes de qualquer
//      tentativa de rede.
//
// Arquitetura deliberada: `planejarLotes` é instantâneo e puro — calcula o
// cronograma inteiro (todos os `agendadoPara`) sem nenhum `await` real de
// tempo. O disparo de verdade acontece em `processarEnviosDevidos`, chamada
// repetidamente (por um scheduler/cron, ou por um polling leve no cliente) —
// nunca por uma requisição HTTP que fica bloqueada esperando o jitter de uma
// campanha inteira. O mesmo padrão de injeção de dependências do motor de
// orquestração (`@/lib/server/orchestrator`): o executor de envio real entra
// por parâmetro, nunca por import direto, então todo o módulo é testável sem
// rede e sem relógio de parede.

import type { Campaign, CampaignRecipient, ComplianceCheckResult, JitterConfig, OptOutEntry } from "@/types";
import { sha256Hex } from "@/lib/crypto/digest";

// ---------------------------------------------------------------------------
// Jitter e planejamento de lotes
// ---------------------------------------------------------------------------

/**
 * Sorteia um atraso dentro de `[minMs, maxMs]`, mas nunca abaixo do intervalo
 * mínimo imposto por `taxaMaximaPorMinuto` — a aleatoriedade nunca é deixada
 * livre para, por acaso, produzir uma rajada que violaria o teto de taxa.
 */
export function calcularAtrasoComTeto(config: JitterConfig, rng: () => number = Math.random): number {
  const intervaloMinimoPorTaxa = config.taxaMaximaPorMinuto > 0 ? 60_000 / config.taxaMaximaPorMinuto : 0;
  const minEfetivo = Math.max(config.minMs, intervaloMinimoPorTaxa);
  const maxEfetivo = Math.max(minEfetivo, config.maxMs);

  const amplitude = maxEfetivo - minEfetivo;
  return Math.round(minEfetivo + rng() * amplitude);
}

export interface EnvioAgendado {
  recipientId: string;
  agendadoPara: string;
  jitterMsAplicado: number;
  loteIndice: number;
}

export interface PlanejarLotesInput {
  recipientIds: string[];
  config: JitterConfig;
  /** Instante de referência — o primeiro envio planejado parte daqui. */
  inicioEm?: Date;
  /** Gerador de aleatoriedade injetável — determinístico em teste. */
  rng?: () => number;
}

/**
 * Planeja o cronograma completo de uma campanha: um horário por destinatário,
 * com jitter individual e pausas entre lotes. Puro e instantâneo — nenhum
 * `setTimeout`, nenhuma espera real. O disparo de fato acontece depois, em
 * `processarEnviosDevidos`, quando o relógio real alcança cada horário.
 */
export function planejarLotes(entrada: PlanejarLotesInput): EnvioAgendado[] {
  const { recipientIds, config, rng = Math.random } = entrada;
  const inicio = entrada.inicioEm ?? new Date();

  const plano: EnvioAgendado[] = [];
  const tamanhoLote = Math.max(1, config.loteSize);
  let instanteAcumuladoMs = inicio.getTime();

  for (let i = 0; i < recipientIds.length; i += 1) {
    const loteIndice = Math.floor(i / tamanhoLote);
    const inicioDeNovoLote = i > 0 && i % tamanhoLote === 0;

    // O atraso aplicado a ESTE envio: pausa entre lotes ao cruzar a fronteira
    // de um lote, jitter individual nos demais, e zero no primeiro envio da
    // campanha (ele parte exatamente de `inicioEm`).
    const atrasoAplicado = i === 0 ? 0 : inicioDeNovoLote ? config.pausaEntreLotesMs : calcularAtrasoComTeto(config, rng);
    instanteAcumuladoMs += atrasoAplicado;

    plano.push({
      recipientId: recipientIds[i],
      agendadoPara: new Date(instanteAcumuladoMs).toISOString(),
      jitterMsAplicado: atrasoAplicado,
      loteIndice,
    });
  }

  return plano;
}

// ---------------------------------------------------------------------------
// Conformidade regulatória e opt-out
// ---------------------------------------------------------------------------

/** Hash determinístico do destino — usado para checar opt-out sem jamais guardar o valor em claro. */
export async function hashDestino(destino: string, workspaceId: string): Promise<string> {
  // `workspaceId` entra no material do hash para que o mesmo telefone em dois
  // workspaces diferentes produza hashes distintos — sem isso, um opt-out em
  // um workspace vazaria (por coincidência de hash) para outro.
  return sha256Hex(`${workspaceId}::${destino.trim().toLowerCase()}`);
}

/**
 * Verifica se um envio pode acontecer: bloqueia incondicionalmente contra
 * opt-out registrado, antes de qualquer tentativa de envio real.
 */
export function verificarConformidade(destinoHash: string, optOuts: Pick<OptOutEntry, "destinoHash">[]): ComplianceCheckResult {
  if (!destinoHash || destinoHash.trim().length === 0) {
    return { permitido: false, motivo: "destino inválido", destinoHash };
  }

  const optouBloqueado = optOuts.some((entrada) => entrada.destinoHash === destinoHash);
  if (optouBloqueado) {
    return { permitido: false, motivo: "destinatário em opt-out", destinoHash };
  }

  return { permitido: true, destinoHash };
}

// ---------------------------------------------------------------------------
// Execução — processa apenas o que já venceu, nunca a campanha inteira de uma vez
// ---------------------------------------------------------------------------

export type EnviarMensagem = (recipient: CampaignRecipient, mensagem: string) => Promise<boolean>;

export interface ProcessarEnviosInput {
  campanha: Pick<Campaign, "mensagemTemplate" | "workspaceId">;
  destinatarios: CampaignRecipient[];
  optOuts: Pick<OptOutEntry, "destinoHash">[];
  enviar: EnviarMensagem;
  agora?: Date;
}

export interface ProcessarEnviosResultado {
  destinatariosAtualizados: CampaignRecipient[];
  processadosNestaExecucao: number;
  enviadosNestaExecucao: number;
  bloqueadosNestaExecucao: number;
  falhasNestaExecucao: number;
}

/**
 * Processa, nesta chamada, apenas os destinatários pendentes cujo horário
 * agendado já chegou. Chamada repetidamente (scheduler/polling) — nunca
 * bloqueia esperando o restante da campanha.
 */
export async function processarEnviosDevidos(entrada: ProcessarEnviosInput): Promise<ProcessarEnviosResultado> {
  const agora = (entrada.agora ?? new Date()).getTime();
  const atualizados = [...entrada.destinatarios];

  let processados = 0;
  let enviados = 0;
  let bloqueados = 0;
  let falhas = 0;

  for (let i = 0; i < atualizados.length; i += 1) {
    const destinatario = atualizados[i];
    if (destinatario.status !== "pendente") continue;
    if (!destinatario.agendadoPara) continue;
    if (new Date(destinatario.agendadoPara).getTime() > agora) continue;

    processados += 1;

    const conformidade = verificarConformidade(destinatario.destinoHash, entrada.optOuts);
    if (!conformidade.permitido) {
      bloqueados += 1;
      atualizados[i] = {
        ...destinatario,
        status: "bloqueado-conformidade",
        motivoBloqueio: conformidade.motivo,
      };
      continue;
    }

    try {
      const sucesso = await entrada.enviar(destinatario, entrada.campanha.mensagemTemplate);
      if (sucesso) {
        enviados += 1;
        atualizados[i] = { ...destinatario, status: "enviado", enviadoEm: new Date(agora).toISOString() };
      } else {
        falhas += 1;
        atualizados[i] = { ...destinatario, status: "falhou", motivoBloqueio: "envio recusado pelo provedor" };
      }
    } catch (erro) {
      falhas += 1;
      atualizados[i] = {
        ...destinatario,
        status: "falhou",
        motivoBloqueio: erro instanceof Error ? erro.message : String(erro),
      };
    }
  }

  return {
    destinatariosAtualizados: atualizados,
    processadosNestaExecucao: processados,
    enviadosNestaExecucao: enviados,
    bloqueadosNestaExecucao: bloqueados,
    falhasNestaExecucao: falhas,
  };
}
