"use client";

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { auth } from "./firebase";
import { PASSWORD_MIN_LENGTH, validatePassword } from "./passwordPolicy";

interface AuthContextValue {
  user: FirebaseUser | null;
  loading: boolean;
  firebaseReady: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<FirebaseUser>;
  signInWithGoogle: () => Promise<FirebaseUser>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Mensagem exibida quando as credenciais do Firebase ainda não foram preenchidas
// em .env.local (ver .env.local.example) — o app continua renderizando normalmente.
const NOT_CONFIGURED_MESSAGE =
  "Firebase não configurado. Preencha .env.local com as credenciais do projeto (ver .env.local.example).";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    firebaseReady: Boolean(auth),
    async signInWithEmail(email, password) {
      if (!auth) throw new Error(NOT_CONFIGURED_MESSAGE);
      await signInWithEmailAndPassword(auth, sanitizeEmail(email), password);
    },
    async signUpWithEmail(email, password) {
      if (!auth) throw new Error(NOT_CONFIGURED_MESSAGE);
      // Reforço no cliente: mesmo que uma tela esqueça de validar antes de
      // chamar o provider, nenhuma conta é criada com senha fora da política
      // (ver src/lib/passwordPolicy.ts).
      const erroSenha = validatePassword(password);
      if (erroSenha) throw new Error(erroSenha);
      const cred = await createUserWithEmailAndPassword(auth, sanitizeEmail(email), password);
      return cred.user;
    },
    async signInWithGoogle() {
      if (!auth) throw new Error(NOT_CONFIGURED_MESSAGE);
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      return cred.user;
    },
    async sendPasswordReset(email) {
      if (!auth) throw new Error(NOT_CONFIGURED_MESSAGE);
      await sendPasswordResetEmail(auth, sanitizeEmail(email));
    },
    async signOut() {
      if (!auth) return;
      await firebaseSignOut(auth);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}

function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Qualquer código que revelaria se uma conta existe para um e-mail específico
// (senha errada vs. e-mail inexistente vs. credencial inválida) cai na MESMA
// mensagem genérica — ver OWASP "Authentication Cheat Sheet" / EC-1 em
// docs/stories/shell-auth/spec/requirements.json. Nunca adicionar aqui um
// `case` que diferencie esses três cenários.
const CREDENCIAIS_INVALIDAS = new Set([
  "auth/invalid-credential",
  "auth/wrong-password",
  "auth/user-not-found",
  "auth/invalid-email",
]);

/**
 * Traduz erros do Firebase Auth para mensagens em pt-BR seguras contra user
 * enumeration. Nenhum `case` de código `auth/*` repassa `error.message` ao
 * usuário — esse texto vem direto do SDK/backend e pode conter detalhes
 * técnicos (nomes de projeto, códigos internos). Detalhe completo deve ir
 * para `console.error`/observabilidade, nunca para a tela.
 *
 * Exceção deliberada: um `Error` sem `code` (ex.: validação de senha em
 * `signUpWithEmail`, ou "As senhas não coincidem." nas telas) foi gerado
 * pelo nosso próprio código, não pelo backend — não há risco de enumeração
 * e a mensagem específica é o que ajuda o usuário a corrigir o formulário.
 */
export function translateAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code;

  if (!code) {
    return error instanceof Error ? error.message : "Não foi possível concluir a autenticação. Tente novamente.";
  }

  if (CREDENCIAIS_INVALIDAS.has(code)) {
    return "E-mail ou senha incorretos.";
  }

  switch (code) {
    case "auth/email-already-in-use":
      return "Já existe uma conta com este e-mail. Faça login normalmente.";
    case "auth/weak-password":
      return `Senha muito curta — use pelo menos ${PASSWORD_MIN_LENGTH} caracteres, com letras, números e símbolos.`;
    case "auth/too-many-requests":
      return "Muitas tentativas. Aguarde um momento e tente novamente.";
    case "auth/popup-closed-by-user":
      return "Janela de login fechada antes de concluir.";
    case "auth/network-request-failed":
      return "Falha de conexão. Verifique sua internet e tente novamente.";
    case "auth/operation-not-allowed":
      return "Este método de login não está habilitado no momento.";
    case "auth/user-disabled":
      return "Esta conta foi desativada. Contate um administrador.";
    default:
      return "Não foi possível concluir a autenticação. Tente novamente.";
  }
}
