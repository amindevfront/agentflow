"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, translateAuthError } from "@/lib/auth";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();
  const { signInWithEmail, signInWithGoogle, firebaseReady } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"email" | "google" | null>(null);

  async function handleEmailLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading("email");
    try {
      await signInWithEmail(email, password);
      router.push("/flows");
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleGoogleLogin() {
    setError(null);
    setLoading("google");
    try {
      await signInWithGoogle();
      router.push("/flows");
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-950">Entrar</h1>
        <p className="mt-1 text-sm text-ink-500">Acesse o console de fluxos do seu workspace.</p>
      </div>

      {!firebaseReady && (
        <p className="rounded-[var(--radius-sm)] bg-state-error-bg px-3 py-2 text-xs text-state-error">
          Firebase não configurado. Preencha <code className="mono">.env.local</code> com as credenciais do projeto.
        </p>
      )}

      <form onSubmit={handleEmailLogin} className="flex flex-col gap-4">
        <Field
          label="E-mail"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="text-xs text-state-error">{error}</p>}

        <div className="flex items-center justify-between">
          <Link href="/forgot-password" className="text-xs text-signal-600 hover:underline">
            Esqueci minha senha
          </Link>
        </div>

        <Button type="submit" loading={loading === "email"} className="w-full">
          Entrar
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-ink-300">
        <span className="h-px flex-1 bg-ink-100" />
        ou
        <span className="h-px flex-1 bg-ink-100" />
      </div>

      <Button
        type="button"
        variant="secondary"
        loading={loading === "google"}
        onClick={handleGoogleLogin}
        className="w-full"
      >
        Continuar com Google
      </Button>

      <p className="text-center text-xs text-ink-400">
        Cadastro apenas por convite. Recebeu um convite? Acesse pelo link enviado ao seu e-mail.
      </p>
    </div>
  );
}
