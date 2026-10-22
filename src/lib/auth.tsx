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
      await signInWithEmailAndPassword(auth, email, password);
    },
    async signUpWithEmail(email, password) {
      if (!auth) throw new Error(NOT_CONFIGURED_MESSAGE);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      return cred.user;
    },
    async signInWithGoogle() {
      if (!auth) throw new Error(NOT_CONFIGURED_MESSAGE);
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      return cred.user;
    },
    async sendPasswordReset(email) {
      if (!auth) throw new Error(NOT_CONFIGURED_MESSAGE);
      await sendPasswordResetEmail(auth, email);
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

/** Traduz os códigos de erro mais comuns do Firebase Auth para mensagens em pt-BR. */
export function translateAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "E-mail ou senha incorretos.";
    case "auth/invalid-email":
      return "Formato de e-mail inválido.";
    case "auth/email-already-in-use":
      return "Já existe uma conta com este e-mail. Faça login normalmente.";
    case "auth/weak-password":
      return "Senha muito curta — use pelo menos 6 caracteres.";
    case "auth/too-many-requests":
      return "Muitas tentativas. Aguarde um momento e tente novamente.";
    case "auth/popup-closed-by-user":
      return "Janela de login fechada antes de concluir.";
    default:
      return error instanceof Error ? error.message : "Não foi possível concluir. Tente novamente.";
  }
}
