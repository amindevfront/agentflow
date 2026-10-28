// Agendamentos — anti-no-show e preparo pré-procedimento (nicho Clínicas).
//
// Mesma honestidade arquitetural do resto do app: não há worker server-side
// nesta versão (ver `expirarTicketsVencidos` em `@/lib/humanInTheLoop`), então
// as janelas de confirmação (24h/2h antes) são verificadas sob demanda —
// quando o painel é aberto, ou quando um operador aciona manualmente — nunca
// por um cron real. `calcularJanelasPendentes` é pura e testável; o envio de
// fato (`enviarConfirmacaoAgendamento`) reaproveita o pipeline já existente
// da Neural Inbox (`enviarMensagemOperador`), então a confirmação enviada
// passa pelo mesmo Shield-Layer e mesma trilha de qualquer resposta humana.

import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { Appointment, AppointmentStatus, Canal } from "@/types";
import { db } from "./firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "./firestore";
import { enviarMensagemOperador } from "./inbox/firestore";
import { enfileirarEscrita } from "./offlineQueue";

const COLECAO = "appointments";

/** Tolerância da janela: dispara entre 0h e este limite antes do horário-alvo. */
const JANELA_24H_MS = 24 * 60 * 60 * 1000;
const JANELA_2H_MS = 2 * 60 * 60 * 1000;

const STATUS_ELEGIVEIS_PARA_LEMBRETE: AppointmentStatus[] = ["agendado", "confirmado"];

function novoId(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `appt_${aleatorio}`;
}

function dentroDaJanela(dataHoraIso: string, referencia: Date, janelaMs: number): boolean {
  const alvo = new Date(dataHoraIso).getTime();
  if (!Number.isFinite(alvo)) return false;
  const restante = alvo - referencia.getTime();
  // Já passou do horário (restante < 0): não é mais "janela de antecedência",
  // é atraso — tratado como no-show em outro lugar, não aqui.
  return restante >= 0 && restante <= janelaMs;
}

export interface JanelasPendentes {
  precisamConfirmacao24h: Appointment[];
  precisamConfirmacao2h: Appointment[];
}

/**
 * Seleciona, dentro do conjunto de agendamentos do workspace, os que
 * precisam do lembrete de 24h e os que precisam do lembrete de 2h AGORA —
 * ou seja, dentro da janela E ainda não enviados. Pura e determinística.
 */
export function calcularJanelasPendentes(agendamentos: Appointment[], referencia = new Date()): JanelasPendentes {
  const elegiveis = agendamentos.filter((a) => STATUS_ELEGIVEIS_PARA_LEMBRETE.includes(a.status));

  return {
    precisamConfirmacao24h: elegiveis.filter(
      (a) => !a.confirmacao24hEnviadaEm && dentroDaJanela(a.dataHora, referencia, JANELA_24H_MS)
    ),
    precisamConfirmacao2h: elegiveis.filter(
      (a) => !a.confirmacao2hEnviadaEm && dentroDaJanela(a.dataHora, referencia, JANELA_2H_MS)
    ),
  };
}

/** Compõe o texto do lembrete — 24h inclui as diretrizes de preparo; 2h é só a confirmação final. */
export function textoConfirmacao(agendamento: Appointment, janela: "24h" | "2h"): string {
  const dataFormatada = new Date(agendamento.dataHora).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });

  if (janela === "24h") {
    const preparo = agendamento.diretrizesPreparo?.trim();
    return (
      `Olá, ${agendamento.pacienteNome}! Confirmando seu procedimento "${agendamento.procedimento}" ` +
      `em ${dataFormatada}.` +
      (preparo ? ` Preparo necessário: ${preparo}` : "") +
      ` Por favor, responda para confirmar sua presença.`
    );
  }

  return (
    `Olá, ${agendamento.pacienteNome}! Seu procedimento "${agendamento.procedimento}" é hoje, ${dataFormatada}. ` +
    `Estamos te aguardando — qualquer imprevisto, nos avise o quanto antes.`
  );
}

export interface CriarAgendamentoInput {
  pacienteNome: string;
  procedimento: string;
  dataHora: string;
  diretrizesPreparo?: string;
  conversationId?: string | null;
  workspaceId?: string;
  criadoPor: string;
}

export async function criarAgendamento(entrada: CriarAgendamentoInput): Promise<Appointment> {
  return enfileirarEscrita("Criar agendamento", async () => {
    const database = requireDb();
    const agendamento: Appointment = {
      id: novoId(),
      workspaceId: entrada.workspaceId ?? DEFAULT_WORKSPACE_ID,
      conversationId: entrada.conversationId ?? null,
      pacienteNome: entrada.pacienteNome,
      procedimento: entrada.procedimento,
      dataHora: entrada.dataHora,
      status: "agendado",
      diretrizesPreparo: entrada.diretrizesPreparo,
      confirmacao24hEnviadaEm: null,
      confirmacao2hEnviadaEm: null,
      criadoEm: new Date().toISOString(),
      criadoPor: entrada.criadoPor,
    };
    await setDoc(doc(database, COLECAO, agendamento.id), agendamento);
    return agendamento;
  });
}

export function subscribeAgendamentos(
  onChange: (agendamentos: Appointment[]) => void,
  workspaceId = DEFAULT_WORKSPACE_ID
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }
  const consulta = query(
    collection(db, COLECAO),
    where("workspaceId", "==", workspaceId),
    orderBy("dataHora", "asc")
  );
  return onSnapshot(
    consulta,
    (snapshot) => onChange(snapshot.docs.map((d: QueryDocumentSnapshot) => ({ ...(d.data() as Appointment), id: d.id }))),
    (erro) => {
      console.error("[appointments] falha ao assinar agendamentos:", erro);
      onChange([]);
    }
  );
}

export async function atualizarStatusAgendamento(id: string, status: AppointmentStatus): Promise<void> {
  return enfileirarEscrita("Atualizar status do agendamento", async () => {
    const database = requireDb();
    await updateDoc(doc(database, COLECAO, id), { status });
  });
}

/**
 * Envia o lembrete pelo canal de atendimento (quando a conversa está
 * vinculada) e marca a janela como enviada. Reaproveita
 * `enviarMensagemOperador` — a confirmação passa pelo mesmo Shield-Layer e
 * mesma trilha de qualquer resposta de operador/IA.
 */
export async function enviarConfirmacaoAgendamento(
  agendamento: Appointment,
  janela: "24h" | "2h",
  entrada: { remetenteId: string; canal?: Canal }
): Promise<void> {
  const database = requireDb();
  const texto = textoConfirmacao(agendamento, janela);

  if (agendamento.conversationId) {
    await enviarMensagemOperador({
      conversationId: agendamento.conversationId,
      texto,
      remetente: "operador",
      remetenteId: entrada.remetenteId,
      canal: entrada.canal ?? "whatsapp",
      workspaceId: agendamento.workspaceId,
    });
  }

  const campo = janela === "24h" ? "confirmacao24hEnviadaEm" : "confirmacao2hEnviadaEm";
  await updateDoc(doc(database, COLECAO, agendamento.id), { [campo]: new Date().toISOString() });
}
