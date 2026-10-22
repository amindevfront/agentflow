"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth, translateAuthError } from "@/lib/auth";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-lg font-semibold text-ink-950">Verifique seu e-mail</h1>
        <p className="text-sm text-ink-500">
          Se houver uma conta associada a <strong>{email}</strong>, enviamos um link para redefinir a senha.
        </p>
        <Link href="/login" className="text-sm text-signal-600 hover:underline">
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-950">Esqueci minha senha</h1>
        <p className="mt-1 text-sm text-ink-500">Informe seu e-mail para receber o link de redefinição.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field
          label="E-mail"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p className="text-xs text-state-error">{error}</p>}
        <Button type="submit" loading={loading} className="w-full">
          Enviar link de redefinição
        </Button>
      </form>

      <Link href="/login" className="text-center text-xs text-signal-600 hover:underline">
        Voltar para o login
      </Link>
    </div>
  );
}
