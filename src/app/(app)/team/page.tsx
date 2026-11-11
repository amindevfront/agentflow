"use client";

import { useEffect, useState, type FormEvent } from "react";
import { subscribeTeamMembers, subscribePendingInvites, createInvite } from "@/lib/firestore";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { inviteSchema, primeiraMensagemZod } from "@/lib/validation/schemas";
import { fetchComTimeout } from "@/lib/fetchComTimeout";
import { auth } from "@/lib/firebase";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { DeleteIconButton } from "@/components/ui/DeleteIconButton";
import type { Invite, TeamMember, UserRole } from "@/types";

const TIMEOUT_EQUIPE_MS = 15_000;

type AlvoExclusao = { tipo: "membro"; item: TeamMember } | { tipo: "convite"; item: Invite };

const ROLE_LABEL: Record<UserRole, string> = {
  operacoes: "operações",
  admin: "admin",
};

export default function TeamPage() {
  const { user } = useAuth();
  const { workspaceId, appUser } = useWorkspace();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<UserRole>("operacoes");
  const [saving, setSaving] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [alvoExclusao, setAlvoExclusao] = useState<AlvoExclusao | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [exclusaoErro, setExclusaoErro] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeTeamMembers(workspaceId, setMembers);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribePendingInvites(workspaceId, setInvites);
  }, [workspaceId]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!user || !workspaceId) return;

    const validado = inviteSchema.safeParse({ email, papel });
    if (!validado.success) {
      setInviteError(primeiraMensagemZod(validado.error));
      return;
    }

    setInviteError(null);
    setSaving(true);
    setInviteLink(null);
    try {
      const id = await createInvite(validado.data.email, validado.data.papel, workspaceId, user.uid);
      setInviteLink(`${window.location.origin}/invite/${id}`);
      setEmail("");
    } finally {
      setSaving(false);
    }
  }

  async function confirmarExclusao() {
    if (!alvoExclusao) return;
    setExclusaoErro(null);
    setExcluindo(true);
    try {
      const usuarioAtual = auth?.currentUser;
      if (!usuarioAtual) throw new Error("Sessão expirada. Entre novamente para continuar.");

      const rota = alvoExclusao.tipo === "membro" ? "/api/team/remove-member" : "/api/team/revoke-invite";
      const corpo =
        alvoExclusao.tipo === "membro" ? { uid: alvoExclusao.item.id } : { inviteId: alvoExclusao.item.id };

      const resposta = await fetchComTimeout(
        rota,
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${await usuarioAtual.getIdToken()}` },
          body: JSON.stringify(corpo),
        },
        "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.",
        TIMEOUT_EQUIPE_MS
      );

      const dados = (await resposta.json().catch(() => ({}))) as { erro?: { mensagem: string } };
      if (!resposta.ok) {
        throw new Error(dados.erro?.mensagem ?? "Não foi possível concluir esta ação agora.");
      }

      setAlvoExclusao(null);
    } catch (erro) {
      setExclusaoErro(erro instanceof Error ? erro.message : "Não foi possível concluir esta ação agora.");
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="mono text-xs text-ink-400">
          {members.length} membro{members.length === 1 ? "" : "s"} · {invites.length} convite{invites.length === 1 ? "" : "s"} pendente{invites.length === 1 ? "" : "s"}
        </p>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          Convidar membro
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleInvite} className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field
              label="E-mail do convidado"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              errorText={inviteError ?? undefined}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-ink-700" htmlFor="papel">
              Papel
            </label>
            <select
              id="papel"
              value={papel}
              onChange={(e) => setPapel(e.target.value as UserRole)}
              className="h-10 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
            >
              <option value="operacoes">operações</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <Button type="submit" loading={saving} size="sm">
            Enviar convite
          </Button>
        </form>
      )}

      {inviteLink && (
        <p className="mono rounded-[var(--radius-sm)] bg-signal-50 px-3 py-2 text-xs text-signal-700">
          Convite criado. Link: {inviteLink}
          <br />
          <span className="text-ink-400">Envio automático de e-mail ainda não configurado — compartilhe este link manualmente por enquanto.</span>
        </p>
      )}

      {members.length === 0 && invites.length === 0 ? (
        <EmptyState
          title="Nenhum membro ainda"
          description="Convide colegas para colaborar neste workspace."
          action={
            <Button size="sm" onClick={() => setShowForm(true)}>
              Convidar membro
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-1">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5">
              <Avatar name={m.nome} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-950">{m.nome}</p>
                <p className="truncate text-xs text-ink-500">{m.email}</p>
              </div>
              <span className="mono text-xs text-ink-400">{ROLE_LABEL[m.papel]}</span>
              {appUser?.papel === "admin" && m.id !== user?.uid && (
                <DeleteIconButton
                  label={`Remover ${m.nome} da equipe`}
                  onClick={() => setAlvoExclusao({ tipo: "membro", item: m })}
                />
              )}
            </div>
          ))}
          {invites.map((i) => (
            <div key={i.id} className="flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 opacity-70">
              <Avatar name={i.email} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-950">{i.email}</p>
                <p className="truncate text-xs text-ink-500">convite pendente</p>
              </div>
              <span className="mono text-xs text-ink-400">{ROLE_LABEL[i.papel]}</span>
              {appUser?.papel === "admin" && (
                <DeleteIconButton
                  label={`Revogar convite de ${i.email}`}
                  onClick={() => setAlvoExclusao({ tipo: "convite", item: i })}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={alvoExclusao !== null}
        onClose={() => {
          setAlvoExclusao(null);
          setExclusaoErro(null);
        }}
        titleId="excluir-membro-equipe-title"
        title={
          alvoExclusao?.tipo === "membro"
            ? `Remover "${alvoExclusao.item.nome}" da equipe?`
            : `Revogar convite de "${alvoExclusao?.item.email ?? ""}"?`
        }
        body={
          alvoExclusao?.tipo === "membro"
            ? "A pessoa perde acesso a este workspace imediatamente. Se ela logar de novo, começa um workspace próprio do zero — não existe acesso parcial nem recuperação automática."
            : "O link do convite deixa de funcionar. A pessoa pode ser convidada de novo a qualquer momento."
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAlvoExclusao(null)}>
              Cancelar
            </Button>
            <Button variant="danger-solid" size="sm" loading={excluindo} onClick={confirmarExclusao}>
              {alvoExclusao?.tipo === "membro" ? "Sim, remover" : "Sim, revogar"}
            </Button>
          </>
        }
      >
        {exclusaoErro && <p className="text-xs text-state-error">{exclusaoErro}</p>}
      </Modal>
    </div>
  );
}
