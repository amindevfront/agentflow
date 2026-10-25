"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, translateAuthError } from "@/lib/auth";
import { validatePassword } from "@/lib/passwordPolicy";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function SignupPage() {
  const router = useRouter();
  const { signUpWithEmail, signInWithGoogle, firebaseReady } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"email" | "google" | null>(null);

  const passwordError = password.length > 0 ? validatePassword(password) : null;
  const confirmError =
    confirmPassword.length > 0 && confirmPassword !== password ? "As senhas não coincidem." : null;

  async function handleEmailSignup(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const senhaInvalida = validatePassword(password);
    if (senhaInvalida) {
      setError(senhaInvalida);
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    setLoading("email");
    try {
      await signUpWithEmail(email, password);
      router.push("/onboarding");
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleGoogleSignup() {
    setError(null);
    setLoading("google");
    try {
      await signInWithGoogle();
      router.push("/onboarding");
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-950">Criar conta</h1>
        <p className="mt-1 text-sm text-ink-500">Comece seu workspace no AgentFlow em menos de 2 minutos.</p>
      </div>

      {!firebaseReady && (
        <p className="rounded-[var(--radius-sm)] bg-state-error-bg px-3 py-2 text-xs text-state-error">
          Firebase não configurado. Preencha <code className="mono">.env.local</code> com as credenciais do projeto.
        </p>
      )}

      <form onSubmit={handleEmailSignup} className="flex flex-col gap-4">
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
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          errorText={passwordError ?? undefined}
          helpText={passwordError ? undefined : "Mínimo de 8 caracteres, com letras, números e símbolos."}
        />
        <Field
          label="Confirmar senha"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          errorText={confirmError ?? undefined}
        />

        {error && <p className="text-xs text-state-error">{error}</p>}

        <Button
          type="submit"
          loading={loading === "email"}
          disabled={!email || !password || !confirmPassword || Boolean(passwordError) || Boolean(confirmError)}
          className="w-full"
        >
          Criar conta
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
        onClick={handleGoogleSignup}
        className="w-full"
      >
        Continuar com Google
      </Button>

      <p className="text-center text-xs text-ink-400">
        Já tem conta?{" "}
        <Link href="/login" className="text-signal-600 hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}
