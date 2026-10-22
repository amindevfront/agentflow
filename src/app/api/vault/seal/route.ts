// POST /api/vault/seal — sela uma credencial para armazenamento em repouso.
//
// Contrato Zero-Trust desta rota:
//
//  - recebe o segredo em claro (uma única vez, sobre TLS) e devolve o envelope
//    cifrado. O cliente persiste o envelope, nunca o segredo;
//  - NÃO existe rota inversa. Não há endpoint que decifre uma credencial e a
//    devolva ao browser: `unsealCredencial` em `@/lib/server/vault` é server-only
//    e usada apenas pelo motor que faz a chamada externa;
//  - o AAD vincula o envelope a `workspaceId` + `credentialId` + versão, então
//    um ciphertext copiado para outro documento não decifra;
//  - o segredo não é registrado em log, nem em caso de erro.
//
// Autorização por papel (somente administradores podem criar credenciais) é
// imposta pelas regras do Firestore no momento da escrita — ver `firestore.rules`.
// Esta rota confirma autenticação; as regras confirmam permissão. Selar um
// envelope que o chamador não consegue gravar não produz nenhum efeito.

import type { CredentialKind } from "@/types";
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
import { LIMITE_COFRE } from "@/lib/server/rateLimit";

// Web Crypto e `process.env` exigem o runtime Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIPOS_VALIDOS: CredentialKind[] = [
  "api-key",
  "bearer-token",
  "oauth-refresh-token",
  "webhook-secret",
  "basic-auth",
  "chave-privada",
];

const MAX_SEGREDO = 8192;

interface CorpoSelar {
  workspaceId?: unknown;
  credentialId?: unknown;
  versao?: unknown;
  segredo?: unknown;
  tipo?: unknown;
}

export const POST = comGuarda(
  async ({ requisicao, usuario }) => {
    const diagnostico = diagnosticoCripto();
    if (!diagnostico.pronto) {
      // Mensagem acionável para o operador, sem revelar valores de configuração.
      throw new ErroApi(
        503,
        `Cofre não configurado. Variáveis ausentes ou inválidas: ${diagnostico.faltando.join(", ")}.`,
        "cofre_nao_configurado"
      );
    }

    const corpo = await corpoJson<CorpoSelar>(requisicao);

    const workspaceId = exigirIdentificador(corpo.workspaceId, "workspaceId");
    const credentialId = exigirIdentificador(corpo.credentialId, "credentialId");
    const segredo = exigirTexto(corpo.segredo, "segredo", { max: MAX_SEGREDO, min: 8 });

    const tipo = exigirTexto(corpo.tipo, "tipo", { max: 32 }) as CredentialKind;
    if (!TIPOS_VALIDOS.includes(tipo)) {
      throw new ErroApi(400, `Tipo de credencial desconhecido: ${tipo}.`, "campo_invalido");
    }

    const versao = Number(corpo.versao ?? 1);
    if (!Number.isInteger(versao) || versao < 1 || versao > 10_000) {
      throw new ErroApi(400, "Campo \"versao\" deve ser um inteiro entre 1 e 10000.", "campo_invalido");
    }

    let envelope;
    try {
      envelope = await selarSegredo({
        plaintext: segredo,
        workspaceId,
        recursoId: credentialId,
        versao,
        proposito: "credencial",
      });
    } catch (erro) {
      // O erro original pode conter contexto do material de chave: fica no log
      // do servidor, nunca na resposta.
      console.error("[vault/seal] falha ao selar credencial:", erro);
      throw new ErroApi(500, "Não foi possível selar a credencial.", "falha_selo");
    }

    return respostaJson({
      envelope,
      metadata: {
        // Sufixo curto para conferência visual na UI, sem revelar o segredo.
        sufixo: segredo.slice(-4),
        fingerprint: envelope.fingerprint,
        versao,
        seladoPor: usuario.uid,
      },
    });
  },
  { limite: LIMITE_COFRE, escopoLimite: "vault-seal", maxBytesCorpo: 32 * 1024 }
);
