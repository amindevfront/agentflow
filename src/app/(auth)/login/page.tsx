"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, translateAuthError } from "@/lib/auth";
import { loginSchema, primeiraMensagemZod } from "@/lib/validation/schemas";
import { registrarFalhaAuth, registrarSucessoAuth, verificarBloqueioAuth } from "@/lib/authThrottle";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();
  const { signInWithEmail, signInWithGoogle, firebaseReady } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"email" | "google" | null>(null);
  const [bloqueadoPorSegundos, setBloqueadoPorSegundos] = useState(0);

  // Contagem regressiva visível do bloqueio por força bruta — libera o botão
  // sozinha quando o tempo expira, sem exigir que o usuário tente de novo às
  // escuras.
  useEffect(() => {
    const id = setInterval(() => {
      setBloqueadoPorSegundos((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  async function handleEmailLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Fricção client-side contra tentativas repetidas — nunca a defesa real
    // (ver `src/lib/authThrottle.ts`); a defesa real é o próprio Firebase
    // Auth, cujo `auth/too-many-requests` já é tratado abaixo.
    const chaveThrottle = email.trim().toLowerCase() || "sem-email";
    const bloqueio = verificarBloqueioAuth(chaveThrottle);
    if (bloqueio.bloqueado) {
      setBloqueadoPorSegundos(bloqueio.restanteSegundos);
      setError(`Muitas tentativas. Aguarde ${bloqueio.restanteSegundos}s antes de tentar novamente.`);
      return;
    }

    const validado = loginSchema.safeParse({ email, password });
    if (!validado.success) {
      setError(primeiraMensagemZod(validado.error));
      return;
    }

    setLoading("email");
    try {
      await signInWithEmail(validado.data.email, validado.data.password);
      registrarSucessoAuth(chaveThrottle);
      router.push("/flows");
    } catch (err) {
      const status = registrarFalhaAuth(chaveThrottle);
      setBloqueadoPorSegundos(status.restanteSegundos);
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

        <Button
          type="submit"
          loading={loading === "email"}
          disabled={bloqueadoPorSegundos > 0}
          className="w-full"
        >
          {bloqueadoPorSegundos > 0 ? `Aguarde ${bloqueadoPorSegundos}s` : "Entrar"}
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
        Novo por aqui?{" "}
        <Link href="/signup" className="text-signal-600 hover:underline">
          Criar workspace
        </Link>
      </p>
      <p className="text-center text-xs text-ink-400">
        Recebeu um convite de equipe? Acesse pelo link enviado ao seu e-mail.
      </p>
    </div>
  );
}
