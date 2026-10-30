// Trilha de auditoria imutável — cliente.
//
// Divisão de responsabilidade (correção de concorrência — ver
// `src/lib/server/auditChainStore.ts`): este arquivo NÃO escreve mais em
// `auditLogs`. O servidor lê o ponteiro da cadeia, sela e persiste a entrada
// dentro de uma única transação do Admin SDK — atômica, sem a janela de
// corrida que a versão anterior tinha ao deixar o cliente ler a última
// entrada e escrever a própria, com retry otimista em caso de colisão.
//
//   cliente (este arquivo)              servidor (/api/audit/seal)
//   ──────────────────────              ──────────────────────────
//   envia o corpo do evento             lê o ponteiro da cadeia
//   assina a leitura em tempo real      calcula hashes e assina (HMAC)
//   (via onSnapshot)                    cifra detalhes sensíveis
//                                       grava entrada + ponteiro (transação)
//
// O cliente nunca produz o selo nem toca na coleção diretamente, então não
// há como forjar uma entrada nem como competir por uma posição na cadeia.
//
// Perda de log é tratada como incidente: uma falha de rede não deve apagar o
// registro de um evento de segurança. Eventos que não puderam ser enviados ao
// servidor vão para uma fila local e são reenviados na próxima oportunidade.

import { collection, limit, orderBy, query, where, type QueryDocumentSnapshot, type Unsubscribe } from "firebase/firestore";
import type { AuditChainVerification, AuditEntry, AuditEventBody, AuditEventType, AuditOutcome, GuardrailSeverity } from "@/types";
import { auth, db } from "./firebase";
import { DEFAULT_WORKSPACE_ID } from "./firestore";
import { assinarComFallbackDeIndice } from "./firestoreResilience";

const COLECAO = "auditLogs";
const CHAVE_FILA = "agentflow.auditoria.fila";
const MAX_FILA = 50;

export interface EventoAuditoriaInput {
  tipo: AuditEventType;
  resultado?: AuditOutcome;
  recurso: string;
  traceId?: string;
  severidade?: GuardrailSeverity;
  /** Campos escalares, legíveis na UI. Nunca inclua PII aqui. */
  detalhes?: Record<string, string | number | boolean | null>;
  /** Estrutura cifrada em repouso pelo servidor. */
  detalhesSensiveis?: unknown;
  workspaceId?: string;
}

/** Obtém o ID token do usuário corrente, exigido por toda rota de API. */
async function idToken(): Promise<string> {
  const usuario = auth?.currentUser;
  if (!usuario) {
    throw new Error("Nenhuma sessão autenticada — não é possível registrar auditoria.");
  }
  return usuario.getIdToken();
}

interface RespostaSelo {
  entrada?: AuditEntry;
  erro?: { codigo: string; mensagem: string };
}

async function selarNoServidor(
  corpo: Partial<AuditEventBody>,
  detalhesSensiveis: unknown
): Promise<AuditEntry> {
  const resposta = await fetch("/api/audit/seal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await idToken()}`,
    },
    body: JSON.stringify({ corpo, detalhesSensiveis }),
  });

  const dados = (await resposta.json().catch(() => ({}))) as RespostaSelo;
  if (!resposta.ok || !dados.entrada) {
    throw new Error(dados.erro?.mensagem ?? `Falha ao selar auditoria (HTTP ${resposta.status}).`);
  }
  return dados.entrada;
}

/**
 * Registra um evento na trilha de auditoria.
 *
 * Um único POST a `/api/audit/seal`: o servidor lê o ponteiro da cadeia, sela
 * e persiste a entrada dentro de uma transação atômica (ver
 * `src/lib/server/auditChainStore.ts`). Não há mais posição a disputar nem
 * retry de colisão do lado do cliente — qualquer concorrência é resolvida
 * pelo próprio Firestore, dentro da transação do servidor.
 *
 * A única falha tratada aqui é de transporte (rede, sessão expirada, servidor
 * fora do ar): nesse caso o evento vai para a fila local e é reenviado depois.
 */
export async function registrarEventoAuditoria(entrada: EventoAuditoriaInput): Promise<AuditEntry> {
  const workspaceId = entrada.workspaceId ?? DEFAULT_WORKSPACE_ID;

  const corpoParcial: Partial<AuditEventBody> = {
    tipo: entrada.tipo,
    resultado: entrada.resultado ?? "sucesso",
    workspaceId,
    recurso: entrada.recurso,
    traceId: entrada.traceId,
    severidade: entrada.severidade,
    detalhes: entrada.detalhes ?? {},
  };

  try {
    return await selarNoServidor(corpoParcial, entrada.detalhesSensiveis);
  } catch (erro) {
    // Último recurso: preserva o evento localmente para reenvio.
    enfileirarLocalmente(entrada);
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    throw new Error(`Não foi possível registrar a auditoria (evento preservado para reenvio): ${detalhe}`);
  }
}

/**
 * Registra um evento sem propagar falha.
 *
 * Usado em caminhos onde a ação principal já se consumou: perder o log é grave,
 * mas desfazer a ação por causa do log seria pior. O evento vai para a fila
 * local e a falha fica visível no console.
 */
export async function registrarEventoAuditoriaSilencioso(
  entrada: EventoAuditoriaInput
): Promise<AuditEntry | null> {
  try {
    return await registrarEventoAuditoria(entrada);
  } catch (erro) {
    console.error("[auditoria] evento não registrado:", erro);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fila local de reenvio
// ---------------------------------------------------------------------------

function lerFila(): EventoAuditoriaInput[] {
  if (typeof window === "undefined") return [];
  try {
    const bruto = window.localStorage.getItem(CHAVE_FILA);
    const lista = bruto ? (JSON.parse(bruto) as unknown) : [];
    return Array.isArray(lista) ? (lista as EventoAuditoriaInput[]) : [];
  } catch {
    // localStorage pode estar indisponível (modo privado, cota cheia).
    return [];
  }
}

function gravarFila(fila: EventoAuditoriaInput[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAVE_FILA, JSON.stringify(fila.slice(-MAX_FILA)));
  } catch {
    // Sem fila local o evento é perdido; o erro já foi logado pelo chamador.
  }
}

function enfileirarLocalmente(entrada: EventoAuditoriaInput): void {
  const fila = lerFila();
  fila.push(entrada);
  gravarFila(fila);
}

export function tamanhoFilaAuditoria(): number {
  return lerFila().length;
}

/**
 * Reenvia os eventos pendentes. Chamada no carregamento do painel de
 * governança, quando há sessão autenticada e rede disponível.
 */
export async function drenarFilaAuditoria(): Promise<{ enviados: number; pendentes: number }> {
  const fila = lerFila();
  if (fila.length === 0) return { enviados: 0, pendentes: 0 };

  const restantes: EventoAuditoriaInput[] = [];
  let enviados = 0;

  for (const evento of fila) {
    try {
      const workspaceId = evento.workspaceId ?? DEFAULT_WORKSPACE_ID;
      await selarNoServidor(
        {
          tipo: evento.tipo,
          resultado: evento.resultado ?? "sucesso",
          workspaceId,
          recurso: evento.recurso,
          traceId: evento.traceId,
          severidade: evento.severidade,
          detalhes: evento.detalhes ?? {},
        },
        evento.detalhesSensiveis
      );
      enviados += 1;
    } catch {
      restantes.push(evento);
    }
  }

  gravarFila(restantes);
  return { enviados, pendentes: restantes.length };
}

// ---------------------------------------------------------------------------
// Leitura e verificação
// ---------------------------------------------------------------------------

/**
 * Assina a trilha em tempo real, da entrada mais recente para a mais antiga.
 *
 * Segue o padrão de `subscribeFlowRuns`: sem Firestore configurado, entrega uma
 * lista vazia e um cancelamento inócuo, para que a UI renderize normalmente em
 * ambiente de desenvolvimento sem credenciais.
 */
export function subscribeTrilhaAuditoria(
  onChange: (entradas: AuditEntry[]) => void,
  // `onError` nunca recebe o erro — por design: quem consome deve mostrar um
  // texto amigável fixo, nunca a mensagem técnica do Firestore (índice
  // ausente já é absorvido de forma transparente, nem chega a chamar isto).
  opcoes: { limite?: number; workspaceId?: string; onError?: () => void } = {}
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }

  const workspaceId = opcoes.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const limite = opcoes.limite ?? 100;
  const mapearEntrada = (d: QueryDocumentSnapshot) => ({ ...(d.data() as AuditEntry), id: d.id });

  return assinarComFallbackDeIndice({
    consultaPrincipal: query(
      collection(db, COLECAO),
      where("workspaceId", "==", workspaceId),
      orderBy("seq", "desc"),
      limit(limite)
    ),
    // Sem índice composto disponível: busca só pelo workspace (sem orderBy
    // nem limit na própria query — um `limit` sem `orderBy` devolveria N
    // entradas arbitrárias, não as mais recentes) e reordena/corta em
    // memória, preservando a mesma semântica "mais recentes primeiro".
    consultaFallback: query(collection(db, COLECAO), where("workspaceId", "==", workspaceId)),
    mapearDoc: mapearEntrada,
    ordenarFallback: (lista) => [...lista].sort((a, b) => b.seq - a.seq).slice(0, limite),
    onChange,
    aoFalharDeFormaIrrecuperavel: opcoes.onError,
    contexto: "auditoria",
  });
}

interface RespostaVerificacao {
  verificacao?: AuditChainVerification;
  aviso?: string;
  erro?: { codigo: string; mensagem: string };
}

/**
 * Verifica a integridade de um conjunto de entradas no servidor.
 *
 * A verificação precisa do servidor porque a conferência do HMAC exige a chave
 * de assinatura. O encadeamento em si seria verificável no cliente, mas sem o
 * HMAC um atacante que escrevesse diretamente no banco poderia reconstruir uma
 * cadeia internamente consistente.
 */
export async function verificarTrilhaAuditoria(
  entradas: AuditEntry[]
): Promise<{ verificacao: AuditChainVerification; aviso?: string }> {
  if (entradas.length === 0) {
    return {
      verificacao: {
        integra: true,
        entradasVerificadas: 0,
        assinaturasVerificadas: false,
        problemas: [],
        verificadoEm: new Date().toISOString(),
      },
    };
  }

  const resposta = await fetch("/api/audit/verify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await idToken()}`,
    },
    body: JSON.stringify({ entradas }),
  });

  const dados = (await resposta.json().catch(() => ({}))) as RespostaVerificacao;
  if (!resposta.ok || !dados.verificacao) {
    throw new Error(dados.erro?.mensagem ?? `Falha ao verificar a trilha (HTTP ${resposta.status}).`);
  }

  return { verificacao: dados.verificacao, aviso: dados.aviso };
}

/** Rótulos legíveis dos tipos de evento, para a UI. */
export const ROTULO_EVENTO: Record<AuditEventType, string> = {
  "guardrail.entrada.mascarada": "Entrada mascarada",
  "guardrail.entrada.bloqueada": "Entrada bloqueada",
  "guardrail.saida.bloqueada": "Saída bloqueada",
  "guardrail.transbordo.acionado": "Transbordo acionado",
  "hitl.ticket.aberto": "Transbordo aberto",
  "hitl.ticket.assumido": "Transbordo assumido",
  "hitl.ticket.resolvido": "Transbordo resolvido",
  "hitl.ticket.expirado": "Transbordo expirado",
  "credencial.criada": "Credencial criada",
  "credencial.rotacionada": "Credencial rotacionada",
  "credencial.revogada": "Credencial revogada",
  "credencial.acessada": "Credencial acessada",
  "config.alterada": "Configuração alterada",
  "auth.sessao.iniciada": "Sessão iniciada",
  "auth.sessao.encerrada": "Sessão encerrada",
  "relatorio.executivo.gerado": "Relatório executivo gerado",
  "procedimento.consentimento.registrado": "Consentimento de procedimento registrado",
  "procedimento.posatendimento.registrado": "Checagem pós-atendimento registrada",
};
