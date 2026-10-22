"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth, translateAuthError } from "@/lib/auth";
import { getInviteById, markInviteAccepted, upsertAppUser, DEFAULT_WORKSPACE_ID } from "@/lib/firestore";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import type { Invite } from "@/types";

type LoadState = "loading" | "valid" | "invalid" | "expired";

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { signUpWithEmail, signInWithGoogle } = useAuth();

  const [state, setState] = useState<LoadState>("loading");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"password" | "google" | null>(null);

  useEffect(() => {
    getInviteById(params.token)
      .then((found) => {
        if (!found) return setState("invalid");
        if (found.status === "expirado") return setState("expired");
        if (found.status === "aceito") return setState("invalid");
        setInvite(found);
        setState("valid");
      })
      .catch(() => setState("invalid"));
  }, [params.token]);

  async function completeSetup(uid: string, nome: string) {
    if (!invite) return;
    await upsertAppUser({
      uid,
      nome,
      email: invite.email,
      papel: invite.papel,
      workspaceId: DEFAULT_WORKSPACE_ID,
    });
    await markInviteAccepted(invite.id);
    router.push("/flows");
  }

  async function handlePasswordSetup(e: FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setError(null);
    setLoading("password");
    try {
      const user = await signUpWithEmail(invite.email, password);
      await completeSetup(user.uid, invite.email.split("@")[0]);
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleGoogleSetup() {
    setError(null);
    setLoading("google");
    try {
      const user = await signInWithGoogle();
      await completeSetup(user.uid, user.displayName ?? user.email ?? "Usuário");
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(null);
    }
  }

  if (state === "loading") {
    return <p className="text-center text-sm text-ink-400">Verificando convite…</p>;
  }

  if (state === "invalid" || state === "expired") {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-lg font-semibold text-ink-950">
          {state === "expired" ? "Convite expirado" : "Convite inválido"}
        </h1>
        <p className="text-sm text-ink-500">
          Peça a um administrador do workspace para enviar um novo convite.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-950">Você foi convidado</h1>
        <p className="mt-1 text-sm text-ink-500">
          Defina uma senha para <strong>{invite?.email}</strong> e entre no workspace.
        </p>
      </div>

      <form onSubmit={handlePasswordSetup} className="flex flex-col gap-4">
        <Field
          label="Criar senha"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          helpText="Mínimo de 6 caracteres."
        />
        {error && <p className="text-xs text-state-error">{error}</p>}
        <Button type="submit" loading={loading === "password"} className="w-full">
          Criar conta e entrar
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-ink-300">
        <span className="h-px flex-1 bg-ink-100" />
        ou
        <span className="h-px flex-1 bg-ink-100" />
      </div>

      <Button variant="secondary" loading={loading === "google"} onClick={handleGoogleSetup} className="w-full">
        Continuar com Google
      </Button>
    </div>
  );
}
