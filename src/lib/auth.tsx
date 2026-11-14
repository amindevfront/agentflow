"use client";

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { auth } from "./firebase";
import { PASSWORD_MIN_LENGTH, validatePassword } from "./passwordPolicy";
import { medirDuracao } from "./telemetry/performance";

/**
 * Bug real: login com Google usava SEMPRE `signInWithPopup`, que não
 * funciona de forma confiável fora de um navegador de desktop —
 *  - PWA instalada (modo standalone, ver `next.config.ts`/`manifest.json`)
 *    não tem o conceito de "abrir uma janela" — o Firebase lança
 *    `auth/operation-not-supported-in-this-environment`.
 *  - Navegadores mobile (Safari iOS em particular) frequentemente bloqueiam
 *    o popup, ou têm a comunicação entre a janela principal e o popup
 *    quebrada pela proteção de armazenamento de terceiros (ITP) — às vezes
 *    isso nem rejeita a Promise de forma limpa, só trava.
 * `signInWithRedirect` funciona universalmente (sai da página e volta),
 * então detecta esses dois ambientes ANTES de tentar o popup, em vez de
 * reagir a um erro que pode não chegar a ser lançado de forma confiável.
 */
export function deveUsarRedirectParaGoogle(): boolean {
  if (typeof window === "undefined") return false;
  // Bug corrigido aqui mesmo antes de ir pro ar: `window.matchMedia?.(...)`
  // só protege a CHAMADA — se `matchMedia` não existisse, o `?.()` devolve
  // `undefined`, e acessar `.matches` em seguida, fora da cadeia opcional,
  // lançaria TypeError. Encadear o `?.` também no `.matches` fecha isso.
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (window.navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return true;
  return /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent);
}

interface AuthContextValue {
  user: FirebaseUser | null;
  loading: boolean;
  firebaseReady: boolean;
  /** Erro do fluxo de redirect do Google (ver `deveUsarRedirectParaGoogle`) — a página que chamou `signInWithGoogle` foi recarregada do zero, então só este campo sabe se o retorno falhou. */
  redirectError: string | null;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<FirebaseUser>;
  /**
   * `opcoes.forcarPopup`: usado pela tela de convite (`/invite/[token]`),
   * que depende do retorno SÍNCRONO (checagem de segurança: o e-mail da
   * conta Google tem de bater com o do convite, na mesma página, antes de
   * provisionar) — redirect reinicia a página do zero e exigiria refazer
   * essa checagem depois de voltar do Google, o que esta versão ainda não
   * trata. Login/Signup não têm essa restrição, então usam o redirect
   * automático em mobile/PWA por padrão.
   */
  signInWithGoogle: (opcoes?: { forcarPopup?: boolean }) => Promise<FirebaseUser>;
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
  const [redirectError, setRedirectError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    const instancia = auth;
    // Processa o retorno do fluxo de redirect do Google (ver
    // `deveUsarRedirectParaGoogle`/`signInWithGoogle`) — se ele falhou, a
    // página que chamou `signInWithGoogle` já foi recarregada do zero e
    // perdeu qualquer `catch` em voo; este é o único lugar que ainda sabe
    // o motivo. `onAuthStateChanged` abaixo já cobre o caminho de SUCESSO
    // (dispara com o usuário assim que o Firebase processa o redirect).
    getRedirectResult(instancia).catch((erro) => {
      setRedirectError(translateAuthError(erro));
    });
    const unsubscribe = onAuthStateChanged(instancia, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    firebaseReady: Boolean(auth),
    redirectError,
    async signInWithEmail(email, password) {
      if (!auth) throw new Error(NOT_CONFIGURED_MESSAGE);
      const instancia = auth;
      await medirDuracao("auth.signInWithEmail", () =>
        signInWithEmailAndPassword(instancia, sanitizeEmail(email), password)
      );
    },
    async signUpWithEmail(email, password) {
      if (!auth) throw new Error(NOT_CONFIGURED_MESSAGE);
      const instancia = auth;
      // Reforço no cliente: mesmo que uma tela esqueça de validar antes de
      // chamar o provider, nenhuma conta é criada com senha fora da política
      // (ver src/lib/passwordPolicy.ts).
      const erroSenha = validatePassword(password);
      if (erroSenha) throw new Error(erroSenha);
      const cred = await medirDuracao("auth.signUpWithEmail", () =>
        createUserWithEmailAndPassword(instancia, sanitizeEmail(email), password)
      );
      return cred.user;
    },
    async signInWithGoogle(opcoes) {
      if (!auth) throw new Error(NOT_CONFIGURED_MESSAGE);
      const instancia = auth;
      const provider = new GoogleAuthProvider();
      if (!opcoes?.forcarPopup && deveUsarRedirectParaGoogle()) {
        await signInWithRedirect(instancia, provider);
        // `signInWithRedirect` navega para fora desta página — esta
        // chamada nunca resolve de verdade aqui. Quem volta do Google é
        // tratado pelo efeito de `getRedirectResult`/`onAuthStateChanged`
        // acima, nunca pelo retorno desta função (ver `redirectError` e o
        // `useEffect` que observa `user` em `LoginPage`/`SignupPage`).
        return new Promise<FirebaseUser>(() => {});
      }
      const cred = await medirDuracao("auth.signInWithGoogle", () =>
        signInWithPopup(instancia, provider)
      );
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
