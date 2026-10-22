// POST /api/inbox/seal-message — sela o texto ORIGINAL de uma mensagem de
// chat no cofre efêmero da Neural Inbox.
//
// Contrato Zero-Trust, espelhando `/api/vault/seal`:
//
//  - recebe o texto em claro (uma única vez, sobre TLS) e devolve o envelope
//    cifrado (AES-256-GCM). O cliente persiste o envelope em
//    `messageVaults/{messageId}` — nunca o texto original;
//  - NÃO existe rota inversa. Nenhum endpoint devolve o texto em claro ao
//    browser; a decifragem é uma operação server-only, reservada a uma
//    extração formal de compliance (fora do escopo desta v1, documentado
//    como trabalho futuro em `firestore.rules`);
//  - o AAD vincula o envelope a `workspaceId` + `messageId` — um ciphertext
//    copiado para outra mensagem ou outro workspace não decifra;
//  - o texto nunca é registrado em log, nem em caso de erro.
//
// Autorização: as regras do Firestore (`messageVaults`) são o portão real —
// esta rota só cifra; a escrita subsequente do cliente é quem precisa
// pertencer ao workspace da conversa (mesmo raciocínio já aplicado em
// `/api/vault/seal`).

import { selarSegredo } from "@/lib/crypto/envelope";
import { diagnosticoCripto } from "@/lib/server/env";
import {
  ErroApi,
  comGuarda,
  corpoJson,
  exigirIdentificador,
  exigirTexto,
  respostaJson,
} from "@/lib/server/http";

// Web Crypto e `process.env` exigem o runtime Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXTO = 8192;

interface CorpoSelarMensagem {
  texto?: unknown;
  conversationId?: unknown;
  messageId?: unknown;
  workspaceId?: unknown;
}

export const POST = comGuarda(
  async ({ requisicao }) => {
    const diagnostico = diagnosticoCripto();
    if (!diagnostico.pronto) {
      throw new ErroApi(
        503,
        `Cofre da Neural Inbox não configurado. Variáveis ausentes ou inválidas: ${diagnostico.faltando.join(", ")}.`,
        "cofre_nao_configurado"
      );
    }

    const corpo = await corpoJson<CorpoSelarMensagem>(requisicao);

    const workspaceId = exigirIdentificador(corpo.workspaceId, "workspaceId");
    const conversationId = exigirIdentificador(corpo.conversationId, "conversationId");
    const messageId = exigirIdentificador(corpo.messageId, "messageId");
    const texto = exigirTexto(corpo.texto, "texto", { max: MAX_TEXTO, min: 1 });

    let envelope;
    try {
      envelope = await selarSegredo({
        plaintext: texto,
        workspaceId,
        // O recurso selado é a MENSAGEM, não a conversa — cada mensagem tem
        // seu próprio envelope, amarrado também à conversa que a contém via
        // o prefixo do id, para que mover um envelope entre conversas também
        // quebre a verificação de AAD.
        recursoId: `${conversationId}__${messageId}`,
        versao: 1,
        proposito: "mensagem-chat",
      });
    } catch (erro) {
      console.error("[inbox/seal-message] falha ao selar mensagem:", erro);
      throw new ErroApi(500, "Não foi possível selar a mensagem original.", "falha_selo");
    }

    return respostaJson({ envelope });
  },
  { escopoLimite: "inbox-seal-message", maxBytesCorpo: 16 * 1024 }
);
