// Cofre Zero-Trust de credenciais — cliente.
//
// Modelo de armazenamento em duas coleções, porque o Firestore não tem
// segurança por campo:
//
//   credentials/{id}                   → metadados. Legível pelo workspace.
//   credentialSecrets/{id}__v{n}       → envelope cifrado. `read: false` para
//                                        TODO cliente; só o motor com Admin SDK
//                                        pode ler. Create-only: rotação cria uma
//                                        nova versão, nunca sobrescreve.
//
// Consequência prática: um operador logado consegue listar quais credenciais
// existem, mas não consegue nem ler o ciphertext — e, se conseguisse, ele é
// inerte sem a chave-mestra, que vive apenas no servidor.
//
// Não existe função de leitura do segredo neste arquivo. Por desenho.

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import type { CredentialKind, CredentialMetadata, SealedSecret } from "@/types";
import { auth, db } from "./firebase";
import { DEFAULT_WORKSPACE_ID, requireDb } from "./firestore";
import { registrarEventoAuditoriaSilencioso } from "./auditLog";

const COLECAO_META = "credentials";
const COLECAO_SEGREDOS = "credentialSecrets";

export const ROTULO_TIPO_CREDENCIAL: Record<CredentialKind, string> = {
  "api-key": "Chave de API",
  "bearer-token": "Token Bearer",
  "oauth-refresh-token": "Refresh token OAuth",
  "webhook-secret": "Segredo de webhook",
  "basic-auth": "Autenticação básica",
  "chave-privada": "Chave privada",
};

/** Id do documento de segredo de uma versão específica. */
function idSegredo(credentialId: string, versao: number): string {
  return `${credentialId}__v${versao}`;
}

async function idToken(): Promise<string> {
  const usuario = auth?.currentUser;
  if (!usuario) throw new Error("Nenhuma sessão autenticada — operação de cofre indisponível.");
  return usuario.getIdToken();
}

interface RespostaSelo {
  envelope?: SealedSecret;
  metadata?: { sufixo: string; fingerprint: string; versao: number };
  erro?: { codigo: string; mensagem: string };
}

/** Sela o segredo no servidor. O plaintext trafega uma única vez, sobre TLS. */
async function selarSegredo(
  workspaceId: string,
  credentialId: string,
  versao: number,
  segredo: string,
  tipo: CredentialKind
): Promise<{ envelope: SealedSecret; sufixo: string; fingerprint: string }> {
  const resposta = await fetch("/api/vault/seal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await idToken()}`,
    },
    body: JSON.stringify({ workspaceId, credentialId, versao, segredo, tipo }),
  });

  const dados = (await resposta.json().catch(() => ({}))) as RespostaSelo;
  if (!resposta.ok || !dados.envelope || !dados.metadata) {
    throw new Error(dados.erro?.mensagem ?? `Falha ao selar a credencial (HTTP ${resposta.status}).`);
  }

  return {
    envelope: dados.envelope,
    sufixo: dados.metadata.sufixo,
    fingerprint: dados.metadata.fingerprint,
  };
}

/** Gera um id de credencial opaco, sem relação com o nome dado pelo usuário. */
function novoIdCredencial(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `cred_${aleatorio.slice(0, 24)}`;
}

export interface NovaCredencialInput {
  nome: string;
  tipo: CredentialKind;
  segredo: string;
  conectorId?: string | null;
  expiraEm?: string | null;
  workspaceId?: string;
}

/**
 * Armazena uma nova credencial.
 *
 * Ordem das escritas importa: o envelope vai primeiro. Se a gravação dos
 * metadados falhar, sobra um documento de segredo órfão — inerte e sem
 * referência. A ordem inversa deixaria uma credencial listada na UI apontando
 * para um segredo que não existe, e o fluxo falharia só na hora de usar.
 */
export async function armazenarCredencial(entrada: NovaCredencialInput): Promise<CredentialMetadata> {
  const database = requireDb();
  const workspaceId = entrada.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const uid = auth?.currentUser?.uid ?? "desconhecido";

  const nome = entrada.nome.trim();
  if (nome.length === 0) throw new Error("Informe um nome para a credencial.");
  if (entrada.segredo.trim().length < 8) {
    throw new Error("O segredo deve ter pelo menos 8 caracteres.");
  }

  const credentialId = novoIdCredencial();
  const versao = 1;
  const { envelope, sufixo, fingerprint } = await selarSegredo(
    workspaceId,
    credentialId,
    versao,
    entrada.segredo,
    entrada.tipo
  );

  const agora = new Date().toISOString();
  const metadados: CredentialMetadata = {
    id: credentialId,
    workspaceId,
    nome,
    tipo: entrada.tipo,
    conectorId: entrada.conectorId ?? null,
    status: "ativa",
    versao,
    sufixo,
    fingerprint,
    criadoEm: agora,
    criadoPor: uid,
    atualizadoEm: agora,
    expiraEm: entrada.expiraEm ?? null,
    revogadoEm: null,
    revogadoPor: null,
    ultimoUsoEm: null,
  };

  await setDoc(doc(database, COLECAO_SEGREDOS, idSegredo(credentialId, versao)), {
    credentialId,
    workspaceId,
    versao,
    envelope,
    criadoEm: agora,
    criadoPor: uid,
  });

  await setDoc(doc(database, COLECAO_META, credentialId), metadados);

  await registrarEventoAuditoriaSilencioso({
    tipo: "credencial.criada",
    recurso: `${COLECAO_META}/${credentialId}`,
    workspaceId,
    detalhes: { nome, tipo: entrada.tipo, versao, fingerprint },
  });

  return metadados;
}

/**
 * Rotaciona o segredo de uma credencial.
 *
 * Cria uma nova versão em vez de sobrescrever: as versões antigas permanecem
 * para que uma execução em andamento, que já resolveu a versão anterior, não
 * quebre no meio — e para que a auditoria possa reconstruir qual segredo estava
 * em uso em determinado momento.
 */
export async function rotacionarCredencial(
  credentialId: string,
  novoSegredo: string,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<CredentialMetadata> {
  const database = requireDb();
  const uid = auth?.currentUser?.uid ?? "desconhecido";

  const referencia = doc(database, COLECAO_META, credentialId);
  const snapshot = await getDoc(referencia);
  if (!snapshot.exists()) {
    throw new Error("Credencial não encontrada.");
  }

  const atual = snapshot.data() as CredentialMetadata;
  if (atual.status === "revogada") {
    throw new Error("Credencial revogada não pode ser rotacionada — crie uma nova.");
  }
  if (novoSegredo.trim().length < 8) {
    throw new Error("O novo segredo deve ter pelo menos 8 caracteres.");
  }

  const novaVersao = atual.versao + 1;
  const { envelope, sufixo, fingerprint } = await selarSegredo(
    workspaceId,
    credentialId,
    novaVersao,
    novoSegredo,
    atual.tipo
  );

  if (fingerprint === atual.fingerprint) {
    // Rotação que não troca o valor dá falsa sensação de segurança: a credencial
    // potencialmente comprometida continua válida.
    throw new Error("O novo segredo é idêntico ao atual — a rotação não teria efeito.");
  }

  const agora = new Date().toISOString();

  await setDoc(doc(database, COLECAO_SEGREDOS, idSegredo(credentialId, novaVersao)), {
    credentialId,
    workspaceId,
    versao: novaVersao,
    envelope,
    criadoEm: agora,
    criadoPor: uid,
  });

  await updateDoc(referencia, {
    versao: novaVersao,
    sufixo,
    fingerprint,
    status: "ativa",
    atualizadoEm: agora,
  });

  await registrarEventoAuditoriaSilencioso({
    tipo: "credencial.rotacionada",
    recurso: `${COLECAO_META}/${credentialId}`,
    workspaceId,
    detalhes: { versaoAnterior: atual.versao, versaoNova: novaVersao, fingerprint },
  });

  return { ...atual, versao: novaVersao, sufixo, fingerprint, status: "ativa", atualizadoEm: agora };
}

/**
 * Revoga uma credencial.
 *
 * Marcação lógica, não exclusão: o documento de segredo é imutável por regra, e
 * apagar o metadado destruiria a trilha de "esta credencial existiu e foi
 * revogada em tal data" — exatamente o que uma auditoria precisa consultar.
 */
export async function revogarCredencial(
  credentialId: string,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
  const database = requireDb();
  const uid = auth?.currentUser?.uid ?? "desconhecido";
  const agora = new Date().toISOString();

  await updateDoc(doc(database, COLECAO_META, credentialId), {
    status: "revogada",
    revogadoEm: agora,
    revogadoPor: uid,
    atualizadoEm: agora,
  });

  await registrarEventoAuditoriaSilencioso({
    tipo: "credencial.revogada",
    recurso: `${COLECAO_META}/${credentialId}`,
    workspaceId,
    severidade: "media",
    detalhes: { revogadoPor: uid },
  });
}

/** Assina a lista de credenciais do workspace em tempo real (apenas metadados). */
export function subscribeCredenciais(
  onChange: (credenciais: CredentialMetadata[]) => void,
  // `onError` nunca recebe o erro — quem consome mostra um texto amigável fixo.
  opcoes: { workspaceId?: string; onError?: () => void } = {}
): Unsubscribe {
  if (!db) {
    onChange([]);
    return () => {};
  }

  const consulta = query(
    collection(db, COLECAO_META),
    where("workspaceId", "==", opcoes.workspaceId ?? DEFAULT_WORKSPACE_ID)
  );

  return onSnapshot(
    consulta,
    (snapshot) => {
      const lista = snapshot.docs.map((d) => ({ ...(d.data() as CredentialMetadata), id: d.id }));
      // Ativas primeiro, depois por data de criação decrescente.
      lista.sort((a, b) => {
        if (a.status !== b.status) return a.status === "ativa" ? -1 : 1;
        return b.criadoEm.localeCompare(a.criadoEm);
      });
      onChange(lista);
    },
    (erro) => {
      console.error("[cofre] falha ao assinar credenciais:", erro);
      opcoes.onError?.();
      onChange([]);
    }
  );
}

/** `true` quando a credencial passou da data de expiração configurada. */
export function credencialExpirada(credencial: CredentialMetadata, referencia = new Date()): boolean {
  if (!credencial.expiraEm) return false;
  const limite = new Date(credencial.expiraEm).getTime();
  return Number.isFinite(limite) && limite < referencia.getTime();
}

/** Status efetivo, considerando expiração por data além do campo persistido. */
export function statusEfetivo(credencial: CredentialMetadata): CredentialMetadata["status"] {
  if (credencial.status === "revogada") return "revogada";
  return credencialExpirada(credencial) ? "expirada" : credencial.status;
}

/**
 * Lê os metadados de uma única credencial (sem o segredo — este continua
 * inacessível a qualquer cliente). Usada por telas que vinculam um recurso a
 * uma credencial específica (ex.: o token de API de um fluxo) e precisam
 * exibir seu status sem assinar a listagem inteira do workspace.
 */
export async function obterCredencial(credentialId: string): Promise<CredentialMetadata | null> {
  const database = requireDb();
  const snapshot = await getDoc(doc(database, COLECAO_META, credentialId));
  return snapshot.exists() ? ({ ...(snapshot.data() as CredentialMetadata), id: snapshot.id }) : null;
}
