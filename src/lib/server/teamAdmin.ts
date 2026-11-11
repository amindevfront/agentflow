// Ações administrativas de Equipe — remover membro e revogar convite
// pendente (Configurações → Equipe).
//
// SERVER-ONLY.
//
// Por que isto precisa do Admin SDK: `firestore.rules` nega de propósito
// `delete` em `users/{uid}` (linha "Nada no produto apaga este documento
// hoje") e em `invites/{id}`, e a própria regra de `update` de `users/{uid}`
// só permite a MESMA pessoa editar o PRÓPRIO documento (nunca um admin
// editando o de outro membro). Ou seja: hoje não existe NENHUM caminho de
// cliente para remover alguém da equipe ou cancelar um convite — este módulo
// é o primeiro a existir, então a autorização real (quem pode remover quem)
// vive inteiramente aqui, nunca em `firestore.rules`.
//
// Isolamento multi-tenant: toda operação confirma que o alvo
// (`users/{uid}` ou `invites/{id}`) pertence ao MESMO `workspaceId` de quem
// está pedindo — nunca um id solto vindo do cliente sem essa checagem.

import type { AuditEntry, AuditEventBody } from "@/types";
import { executarTransacaoDeSelo } from "./auditChainStore";
import { chaveAuditoria } from "./env";
import { firestoreAdmin } from "./firebaseAdmin";

export interface AutorizacaoAcaoEquipe {
  autorizado: boolean;
  workspaceId: string | null;
  motivo?: string;
}

/** Mesmo contrato de `autorizarResetAmbienteTeste`: admin do PRÓPRIO workspace, nunca de um id vindo do cliente. */
export function autorizarAcaoDeEquipe(
  dadosUsuario: { workspaceId?: unknown; papel?: unknown } | null
): AutorizacaoAcaoEquipe {
  const workspaceId = typeof dadosUsuario?.workspaceId === "string" ? dadosUsuario.workspaceId : null;
  if (!workspaceId) {
    return { autorizado: false, workspaceId: null, motivo: "Usuário sem workspace associado." };
  }
  if (dadosUsuario?.papel !== "admin") {
    return { autorizado: false, workspaceId, motivo: "Apenas administradores do workspace podem gerenciar a equipe." };
  }
  return { autorizado: true, workspaceId };
}

async function selarAuditoria(workspaceId: string, corpo: AuditEventBody): Promise<AuditEntry> {
  const db = firestoreAdmin();
  const chaveHmac = await chaveAuditoria();
  return db.runTransaction((tx) => executarTransacaoDeSelo(tx, db, workspaceId, corpo, chaveHmac));
}

export class ErroAcaoEquipe extends Error {
  constructor(
    message: string,
    public readonly codigo: string
  ) {
    super(message);
  }
}

export interface ResultadoRemoverMembro {
  uidRemovido: string;
  entradaAuditoria: AuditEntry;
}

/**
 * Remove um membro do workspace (apaga `users/{uid}`, liberando o uid como
 * se fosse uma conta nova — a próxima vez que essa pessoa logar, passa pelo
 * onboarding normal de novo, sem acesso ao workspace anterior).
 *
 * Duas proteções deliberadas:
 *   - não remove a SI MESMO por esta ação (evita autoexclusão acidental
 *     levando um admin a perder acesso sem querer — "Sair" em Configurações
 *     já cobre "eu quero parar de usar minha conta");
 *   - não remove o ÚLTIMO admin do workspace (sem isso, o workspace ficaria
 *     sem ninguém com permissão de gerenciar a própria equipe, um beco sem
 *     saída que só o Admin SDK resolveria depois).
 */
export async function removerMembro(
  workspaceId: string,
  targetUid: string,
  solicitante: { uid: string; email?: string | null }
): Promise<ResultadoRemoverMembro> {
  if (targetUid === solicitante.uid) {
    throw new ErroAcaoEquipe("Você não pode remover a si mesmo. Use \"Sair\" em Configurações.", "autoremocao_negada");
  }

  const db = firestoreAdmin();
  const targetRef = db.collection("users").doc(targetUid);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new ErroAcaoEquipe("Este membro já não existe.", "membro_nao_encontrado");
  }
  const target = targetSnap.data() as { workspaceId?: string; papel?: string; email?: string };
  if (target.workspaceId !== workspaceId) {
    throw new ErroAcaoEquipe("Este membro não pertence ao seu workspace.", "membro_de_outro_workspace");
  }

  if (target.papel === "admin") {
    const admins = await db.collection("users").where("workspaceId", "==", workspaceId).where("papel", "==", "admin").get();
    if (admins.size <= 1) {
      throw new ErroAcaoEquipe("Não é possível remover o único administrador do workspace.", "ultimo_admin");
    }
  }

  await targetRef.delete();

  const corpo: AuditEventBody = {
    tipo: "equipe.membro.removido",
    resultado: "sucesso",
    workspaceId,
    ator: solicitante.uid,
    atorEmail: solicitante.email ?? undefined,
    recurso: `users/${targetUid}`,
    detalhes: { uidRemovido: targetUid, emailRemovido: target.email ?? null },
    ocorridoEm: new Date().toISOString(),
  };
  const entradaAuditoria = await selarAuditoria(workspaceId, corpo);

  return { uidRemovido: targetUid, entradaAuditoria };
}

export interface ResultadoRevogarConvite {
  inviteIdRevogado: string;
  entradaAuditoria: AuditEntry;
}

/** Cancela um convite ainda pendente — convites aceitos/expirados não são afetados (nada a revogar). */
export async function revogarConvite(
  workspaceId: string,
  inviteId: string,
  solicitante: { uid: string; email?: string | null }
): Promise<ResultadoRevogarConvite> {
  const db = firestoreAdmin();
  const inviteRef = db.collection("invites").doc(inviteId);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) {
    throw new ErroAcaoEquipe("Este convite já não existe.", "convite_nao_encontrado");
  }
  const invite = inviteSnap.data() as { workspaceId?: string; status?: string; email?: string };
  if (invite.workspaceId !== workspaceId) {
    throw new ErroAcaoEquipe("Este convite não pertence ao seu workspace.", "convite_de_outro_workspace");
  }
  if (invite.status !== "pendente") {
    throw new ErroAcaoEquipe("Este convite não está mais pendente.", "convite_nao_pendente");
  }

  await inviteRef.delete();

  const corpo: AuditEventBody = {
    tipo: "equipe.convite.revogado",
    resultado: "sucesso",
    workspaceId,
    ator: solicitante.uid,
    atorEmail: solicitante.email ?? undefined,
    recurso: `invites/${inviteId}`,
    detalhes: { inviteIdRevogado: inviteId, emailConvidado: invite.email ?? null },
    ocorridoEm: new Date().toISOString(),
  };
  const entradaAuditoria = await selarAuditoria(workspaceId, corpo);

  return { inviteIdRevogado: inviteId, entradaAuditoria };
}
