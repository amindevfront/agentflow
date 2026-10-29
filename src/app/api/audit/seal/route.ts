// POST /api/audit/seal — sela E PERSISTE uma entrada da trilha de auditoria.
//
// O cliente envia apenas o corpo do evento. O servidor lê o ponteiro da
// cadeia, calcula hashes, assina com HMAC e grava a nova entrada — tudo
// dentro de uma única transação do Admin SDK (`auditChainStore.ts`). O
// cliente não escreve mais em `auditLogs` diretamente.
//
// Por que a escrita migrou para o servidor (correção de concorrência):
//  - a versão anterior deixava o cliente ler a última entrada e escrever a
//    sua por conta própria, com um laço de "releia e tente de novo" em caso
//    de colisão — apenas otimista, não atômico. Duas escritas concorrentes
//    para a mesma posição eram possíveis em teoria, resolvidas apenas pela
//    regra `update: false` rejeitando a segunda, que então tentava de novo;
//  - a transação do Firestore elimina essa janela por completo: ler o
//    ponteiro, selar e escrever acontecem atomicamente, e o próprio banco
//    serializa disputas — nenhum retry do lado do cliente é necessário.
//
// Isso custa privilégio mínimo? Não na direção que importa: o Admin SDK agora
// usado aqui é escopado a esta transação específica (ler/escrever duas
// coleções de auditoria), nunca à verificação de identidade — `auth.ts`
// continua validando o ID token via JWKS público, sem conta de serviço.
//
// O campo `ator` é sempre sobrescrito com o uid autenticado: um cliente não
// pode registrar um evento em nome de outra pessoa.

import type { AuditEventBody, AuditEventType, AuditOutcome } from "@/types";
import { selarEPersistirEntrada } from "@/lib/server/auditChainStore";
import { selarDetalhesAuditoria } from "@/lib/crypto/envelope";
import { chaveAuditoria, diagnosticoCripto } from "@/lib/server/env";
import { diagnosticoAdmin } from "@/lib/server/firebaseAdmin";
import {
  ErroApi,
  comGuarda,
  corpoJson,
  exigirIdentificador,
  exigirTexto,
  respostaJson,
} from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIPOS_EVENTO = new Set<AuditEventType>([
  "guardrail.entrada.mascarada",
  "guardrail.entrada.bloqueada",
  "guardrail.saida.bloqueada",
  "guardrail.transbordo.acionado",
  "hitl.ticket.aberto",
  "hitl.ticket.assumido",
  "hitl.ticket.resolvido",
  "hitl.ticket.expirado",
  "credencial.criada",
  "credencial.rotacionada",
  "credencial.revogada",
  "credencial.acessada",
  "config.alterada",
  "auth.sessao.iniciada",
  "auth.sessao.encerrada",
  "relatorio.executivo.gerado",
]);

const RESULTADOS = new Set<AuditOutcome>(["sucesso", "falha", "negado"]);

/** Teto de campos em `detalhes`, para que a entrada não se torne um depósito. */
const MAX_DETALHES = 24;

interface CorpoSelarAuditoria {
  corpo?: Record<string, unknown>;
  /** Detalhes sensíveis a cifrar em repouso, em vez de gravar em claro. */
  detalhesSensiveis?: unknown;
}

/**
 * Normaliza `detalhes`: aceita apenas escalares.
 * Estruturas aninhadas iriam para o campo cifrado — misturar texto livre em um
 * campo legível é a via mais comum de PII vazar para dentro de um log.
 */
function normalizarDetalhes(bruto: unknown): Record<string, string | number | boolean | null> {
  if (bruto === undefined || bruto === null) return {};
  if (typeof bruto !== "object" || Array.isArray(bruto)) {
    throw new ErroApi(400, 'Campo "corpo.detalhes" deve ser um objeto.', "campo_invalido");
  }

  const entradas = Object.entries(bruto as Record<string, unknown>);
  if (entradas.length > MAX_DETALHES) {
    throw new ErroApi(400, `"corpo.detalhes" excede ${MAX_DETALHES} campos.`, "campo_invalido");
  }

  const saida: Record<string, string | number | boolean | null> = {};
  for (const [chave, valor] of entradas) {
    if (!/^[A-Za-z0-9_.-]{1,48}$/.test(chave)) {
      throw new ErroApi(400, `Chave inválida em detalhes: ${chave}`, "campo_invalido");
    }
    if (valor === null || typeof valor === "boolean") {
      saida[chave] = valor;
    } else if (typeof valor === "number") {
      saida[chave] = Number.isFinite(valor) ? valor : null;
    } else if (typeof valor === "string") {
      saida[chave] = valor.slice(0, 512);
    } else {
      throw new ErroApi(
        400,
        `Detalhe "${chave}" deve ser escalar. Use "detalhesSensiveis" para estruturas.`,
        "campo_invalido"
      );
    }
  }
  return saida;
}


export const POST = comGuarda(
  async ({ requisicao, usuario }) => {
    const diagnosticoKek = diagnosticoCripto();
    if (!diagnosticoKek.pronto) {
      throw new ErroApi(
        503,
        `Trilha de auditoria não configurada. Variáveis ausentes ou inválidas: ${diagnosticoKek.faltando.join(", ")}.`,
        "auditoria_nao_configurada"
      );
    }

    // A transação atômica exige o Admin SDK — sem ele, não há como gravar com
    // a garantia de concorrência que substitui o antigo retry otimista do
    // cliente. Falha controlada (503), nunca uma exceção não tratada.
    const diagnosticoFirestore = diagnosticoAdmin();
    if (!diagnosticoFirestore.pronto) {
      throw new ErroApi(
        503,
        `Trilha de auditoria indisponível — Admin SDK não configurado: ${diagnosticoFirestore.motivo}.`,
        "auditoria_admin_indisponivel"
      );
    }

    const recebido = await corpoJson<CorpoSelarAuditoria>(requisicao);
    const bruto = recebido.corpo;
    if (!bruto || typeof bruto !== "object") {
      throw new ErroApi(400, 'Campo "corpo" é obrigatório.', "campo_obrigatorio");
    }

    const tipo = exigirTexto(bruto.tipo, "corpo.tipo", { max: 64 }) as AuditEventType;
    if (!TIPOS_EVENTO.has(tipo)) {
      throw new ErroApi(400, `Tipo de evento desconhecido: ${tipo}.`, "campo_invalido");
    }

    const resultado = exigirTexto(bruto.resultado, "corpo.resultado", { max: 16 }) as AuditOutcome;
    if (!RESULTADOS.has(resultado)) {
      throw new ErroApi(400, `Resultado inválido: ${resultado}.`, "campo_invalido");
    }

    const workspaceId = exigirIdentificador(bruto.workspaceId, "corpo.workspaceId");
    const recurso = exigirTexto(bruto.recurso, "corpo.recurso", { max: 256 });

    const traceId =
      bruto.traceId === undefined || bruto.traceId === null
        ? undefined
        : exigirTexto(bruto.traceId, "corpo.traceId", { max: 128 });

    // Detalhes estruturados vão cifrados; os escalares ficam legíveis para que
    // a UI de auditoria seja útil sem exigir decifragem.
    let detalhesCifrados = null;
    if (recebido.detalhesSensiveis !== undefined && recebido.detalhesSensiveis !== null) {
      try {
        detalhesCifrados = await selarDetalhesAuditoria(
          recebido.detalhesSensiveis,
          workspaceId,
          traceId ?? recurso
        );
      } catch (erro) {
        console.error("[audit/seal] falha ao cifrar detalhes sensíveis:", erro);
        throw new ErroApi(500, "Não foi possível cifrar os detalhes do evento.", "falha_cifra");
      }
    }

    const corpo: AuditEventBody = {
      tipo,
      resultado,
      workspaceId,
      // Sobrescrito com a identidade autenticada: o cliente não escolhe o ator.
      ator: usuario.uid,
      atorEmail: usuario.email ?? undefined,
      recurso,
      traceId,
      severidade: typeof bruto.severidade === "string" ? (bruto.severidade as AuditEventBody["severidade"]) : undefined,
      detalhes: normalizarDetalhes(bruto.detalhes),
      detalhesCifrados,
      // Horário do servidor: um relógio adiantado no cliente não pode reordenar
      // a trilha nem antedatar um evento.
      ocorridoEm: new Date().toISOString(),
    };

    try {
      const entrada = await selarEPersistirEntrada(workspaceId, corpo, await chaveAuditoria());
      return respostaJson({ entrada });
    } catch (erro) {
      console.error("[audit/seal] falha ao selar/persistir entrada:", erro);
      throw new ErroApi(500, "Não foi possível selar a entrada de auditoria.", "falha_selo");
    }
  },
  { escopoLimite: "audit-seal", maxBytesCorpo: 64 * 1024 }
);
