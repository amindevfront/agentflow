// POST /api/audit/verify — verifica a integridade de uma cadeia de auditoria.
//
// O cliente envia as entradas lidas do Firestore; o servidor confere hashes,
// encadeamento e assinaturas HMAC. A verificação do HMAC só é possível aqui,
// porque a chave nunca sai do servidor.
//
// A verificação é pura: não grava nada e não depende de nenhum estado além da
// chave. Isso significa que um auditor pode reexecutá-la a qualquer momento
// sobre um export da coleção e obter o mesmo resultado.

import type { AuditEntry } from "@/types";
import { verificarCadeiaAuditoria } from "@/lib/crypto/auditChain";
import { chaveAuditoria, diagnosticoCripto } from "@/lib/server/env";
import { ErroApi, comGuarda, corpoJson, respostaJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Teto por requisição; cadeias maiores são verificadas em páginas. */
const MAX_ENTRADAS = 2000;

const CAMPOS_OBRIGATORIOS = [
  "id",
  "workspaceId",
  "seq",
  "corpo",
  "contentHash",
  "prevHash",
  "chainHash",
  "assinatura",
] as const;

function validarFormato(entradas: unknown): AuditEntry[] {
  if (!Array.isArray(entradas)) {
    throw new ErroApi(400, 'Campo "entradas" deve ser uma lista.', "campo_invalido");
  }
  if (entradas.length === 0) {
    throw new ErroApi(400, "Nenhuma entrada enviada para verificação.", "campo_obrigatorio");
  }
  if (entradas.length > MAX_ENTRADAS) {
    throw new ErroApi(
      413,
      `Máximo de ${MAX_ENTRADAS} entradas por requisição. Verifique a cadeia em páginas.`,
      "corpo_grande"
    );
  }

  entradas.forEach((entrada, indice) => {
    if (typeof entrada !== "object" || entrada === null) {
      throw new ErroApi(400, `Entrada ${indice} não é um objeto.`, "campo_invalido");
    }
    for (const campo of CAMPOS_OBRIGATORIOS) {
      if (!(campo in (entrada as Record<string, unknown>))) {
        throw new ErroApi(400, `Entrada ${indice} sem o campo obrigatório "${campo}".`, "campo_invalido");
      }
    }
  });

  return entradas as AuditEntry[];
}

export const POST = comGuarda(
  async ({ requisicao }) => {
    const diagnostico = diagnosticoCripto();
    const recebido = await corpoJson<{ entradas?: unknown }>(requisicao, 4 * 1024 * 1024);
    const entradas = validarFormato(recebido.entradas);

    // Sem a chave configurada, ainda vale verificar a estrutura: hashes e
    // encadeamento são checáveis sem segredo algum. A resposta deixa explícito
    // que as assinaturas não foram conferidas.
    const chave = diagnostico.pronto ? await chaveAuditoria() : undefined;
    const verificacao = await verificarCadeiaAuditoria(entradas, chave);

    return respostaJson({
      verificacao,
      aviso: diagnostico.pronto
        ? undefined
        : `Assinaturas não verificadas: ${diagnostico.faltando.join(", ")} não configurado(s).`,
    });
  },
  { escopoLimite: "audit-verify", maxBytesCorpo: 4 * 1024 * 1024 }
);
