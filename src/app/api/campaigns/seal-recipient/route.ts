// POST /api/campaigns/seal-recipient — sela o destino ORIGINAL (telefone/
// e-mail) de um destinatário de campanha no cofre efêmero.
//
// Mesmo contrato Zero-Trust de `/api/inbox/seal-message` e `/api/vault/seal`:
// o valor em claro trafega uma única vez, sobre TLS; o cliente persiste o
// envelope em `recipientVaults/{campaignId__recipientId}`, nunca o valor.
// A decifragem (quando um canal real de mensageria estiver configurado) é
// server-only, em `src/lib/server/campaignsAdmin.ts`, no momento do envio.

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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DESTINO = 256;

interface CorpoSelarDestinatario {
  destino?: unknown;
  campaignId?: unknown;
  recipientId?: unknown;
  workspaceId?: unknown;
}

export const POST = comGuarda(
  async ({ requisicao }) => {
    const diagnostico = diagnosticoCripto();
    if (!diagnostico.pronto) {
      throw new ErroApi(
        503,
        `Cofre de campanhas não configurado. Variáveis ausentes ou inválidas: ${diagnostico.faltando.join(", ")}.`,
        "cofre_nao_configurado"
      );
    }

    const corpo = await corpoJson<CorpoSelarDestinatario>(requisicao);
    const workspaceId = exigirIdentificador(corpo.workspaceId, "workspaceId");
    const campaignId = exigirIdentificador(corpo.campaignId, "campaignId");
    const recipientId = exigirIdentificador(corpo.recipientId, "recipientId");
    const destino = exigirTexto(corpo.destino, "destino", { max: MAX_DESTINO, min: 3 });

    let envelope;
    try {
      envelope = await selarSegredo({
        plaintext: destino,
        workspaceId,
        recursoId: `${campaignId}__${recipientId}`,
        versao: 1,
        proposito: "destinatario-campanha",
      });
    } catch (erro) {
      console.error("[campaigns/seal-recipient] falha ao selar destinatário:", erro);
      throw new ErroApi(500, "Não foi possível selar o destinatário.", "falha_selo");
    }

    return respostaJson({ envelope });
  },
  { escopoLimite: "campaigns-seal-recipient", maxBytesCorpo: 8 * 1024 }
);
