// AgentFlow Connect Hub — leitura do segredo do webhook via cofre Zero-Trust.
//
// SERVER-ONLY.
//
// O segredo de assinatura HMAC do Connect Hub é uma credencial como
// qualquer outra (`CredentialKind: "webhook-secret"`, ver `@/lib/credentials`)
// — nunca um campo em claro em `Workspace.connectHub`. Este módulo é o lado
// Admin SDK que falta naquele cofre: o cliente (`@/lib/credentials`) sabe
// criar/rotacionar/revogar credenciais, mas nunca lê o segredo de volta, por
// desenho. Aqui, do lado do servidor, lemos os metadados para achar a versão
// vigente e então o envelope daquela versão — exatamente as duas coleções
// que `@/lib/credentials` já usa (`credentials`/`credentialSecrets`), nunca
// uma terceira forma de guardar segredo inventada para o Connect Hub.

import type { CredentialMetadata, SealedSecret } from "@/types";
import { abrirCredencial } from "./../vault";
import { firestoreAdmin } from "./../firebaseAdmin";

const COLECAO_META = "credentials";
const COLECAO_SEGREDOS = "credentialSecrets";

function idSegredo(credentialId: string, versao: number): string {
  return `${credentialId}__v${versao}`;
}

interface DocumentoSegredo {
  credentialId: string;
  workspaceId: string;
  versao: number;
  envelope: SealedSecret;
}

/**
 * Decifra o segredo vigente de uma credencial do cofre Zero-Trust.
 *
 * `null` quando a credencial não existe, está revogada, ou pertence a outro
 * workspace (checagem explícita — nunca confiar apenas no id vir de dentro
 * de `Workspace.connectHub`, que por sua vez já pertence ao workspace
 * correto, mas a defesa em profundidade aqui é barata e protege contra um
 * `secretCredentialId` copiado incorretamente entre workspaces). Nunca
 * lança — falha de leitura do cofre é tratada como "não configurado" por
 * quem chama, nunca como um erro que derruba o despacho do evento.
 */
export async function lerSegredoCredencialAdmin(
  workspaceId: string,
  credentialId: string
): Promise<string | null> {
  try {
    const db = firestoreAdmin();
    const metaSnap = await db.collection(COLECAO_META).doc(credentialId).get();
    if (!metaSnap.exists) return null;

    const metadados = metaSnap.data() as CredentialMetadata;
    if (metadados.workspaceId !== workspaceId) return null;
    if (metadados.status === "revogada") return null;

    const segredoSnap = await db
      .collection(COLECAO_SEGREDOS)
      .doc(idSegredo(credentialId, metadados.versao))
      .get();
    if (!segredoSnap.exists) return null;

    const documento = segredoSnap.data() as DocumentoSegredo;
    return await abrirCredencial(documento.envelope, {
      workspaceId,
      credentialId,
      versao: metadados.versao,
    });
  } catch (erro) {
    console.error(`[connect-hub] falha ao ler o segredo da credencial ${credentialId}:`, erro);
    return null;
  }
}
