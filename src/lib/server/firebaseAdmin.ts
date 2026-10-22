// Firebase Admin SDK — inicialização única, isolada e com diagnóstico.
//
// SERVER-ONLY.
//
// Três subsistemas compartilham esta instância, e nenhum deles pode operar
// sem ela de forma correta e segura:
//
//   1. Limitador de taxa distribuído (`distributedRateLimit.ts`) — precisa de
//      um balde compartilhado entre instâncias, não um Map local por processo.
//   2. Selo da trilha de auditoria (`/api/audit/seal`) — precisa de uma
//      transação atômica (ler o ponteiro da cadeia, selar, escrever) para
//      eliminar a corrida de `seq` que existia na versão anterior (cliente lia
//      a última entrada e tentava escrever, com retry otimista em colisão).
//   3. Motor de orquestração (`orchestrator.ts`) — precisa escrever
//      `flowRuns` com privilégio que as regras do Firestore negam a qualquer
//      cliente ("allow write: if false; // criadas apenas pelo motor de
//      orquestração (Admin SDK)").
//
// Princípio de privilégio mínimo preservado: a verificação do ID token
// (`auth.ts`) continua deliberadamente SEM Admin SDK, via JWKS público —
// nenhuma dessas três necessidades exige validar um token, então não há
// motivo para estender o uso da conta de serviço a essa operação.
//
// Graceful degradation: a ausência ou invalidade das credenciais do Admin SDK
// nunca derruba o processo. `app()`/`firestoreAdmin()` lançam um erro
// controlado (capturado pelos chamadores) só quando efetivamente invocados; a
// falta de configuração é detectável antecipadamente via `diagnosticoAdmin()`,
// seguindo o mesmo padrão de `diagnosticoCripto()` em `env.ts`.

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { assertServidor } from "./env";

const NOME_APP = "agentflow-admin";

let appCache: App | null = null;
let appErro: Error | null = null;
let firestoreCache: Firestore | null = null;

/**
 * Resolve as credenciais do Admin SDK a partir do ambiente, em ordem de
 * preferência:
 *
 *   1. `FIREBASE_SERVICE_ACCOUNT_JSON` — o JSON da conta de serviço em uma
 *      única variável de ambiente. É a forma recomendada em serverless
 *      (Cloud Run, Vercel) onde não há um sistema de arquivos persistente
 *      para montar um `.json`.
 *   2. `GOOGLE_APPLICATION_CREDENTIALS` — caminho para o arquivo `.json`,
 *      resolvido automaticamente pelas Application Default Credentials do
 *      Google quando presente. Útil em desenvolvimento local e em ambientes
 *      que montam o segredo como arquivo (Cloud Run também suporta isso).
 *
 * Nenhum valor embutido no código-fonte: ambas as variáveis apontam para
 * material fora do repositório.
 */
function credencialDoAmbiente(): ReturnType<typeof cert> | undefined {
  const jsonInline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonInline) {
    let estrutura: unknown;
    try {
      estrutura = JSON.parse(jsonInline);
    } catch {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT_JSON não é um JSON válido — verifique se o valor não foi " +
          "truncado ao configurar a variável de ambiente."
      );
    }
    const registro = estrutura as Record<string, unknown>;
    if (
      typeof registro.project_id !== "string" ||
      typeof registro.client_email !== "string" ||
      typeof registro.private_key !== "string"
    ) {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT_JSON está incompleto — faltam project_id, client_email ou private_key."
      );
    }
    return cert(estrutura as Parameters<typeof cert>[0]);
  }

  // Sem `FIREBASE_SERVICE_ACCOUNT_JSON`: `initializeApp()` sem argumento de
  // credencial recorre às Application Default Credentials, que leem
  // `GOOGLE_APPLICATION_CREDENTIALS` automaticamente. Retornar `undefined`
  // aqui é intencional — deixa o SDK fazer essa resolução.
  return undefined;
}

function construirApp(): App {
  const existente = getApps().find((candidato) => candidato.name === NOME_APP);
  if (existente) return existente;

  const credencial = credencialDoAmbiente();
  return initializeApp(credencial ? { credential: credencial } : {}, NOME_APP);
}

/**
 * App do Admin SDK, com inicialização e erro memorizados.
 *
 * O erro é cacheado (não apenas re-lançado a cada chamada) para que uma
 * configuração ausente não implique reconstruir e falhar repetidamente a
 * cada requisição — o diagnóstico já é conhecido após a primeira tentativa.
 */
function app(): App {
  assertServidor();
  if (appCache) return appCache;
  if (appErro) throw appErro;

  try {
    appCache = construirApp();
    return appCache;
  } catch (erro) {
    appErro = erro instanceof Error ? erro : new Error(String(erro));
    throw appErro;
  }
}

/** Cliente Firestore do Admin SDK. Lança o mesmo erro controlado de `app()`. */
export function firestoreAdmin(): Firestore {
  assertServidor();
  if (firestoreCache) return firestoreCache;
  firestoreCache = getFirestore(app());
  return firestoreCache;
}

export interface DiagnosticoAdmin {
  pronto: boolean;
  motivo?: string;
}

/**
 * Diagnóstico sem efeitos colaterais: tenta construir o app (uma vez, com
 * cache) e reporta sucesso/falha sem propagar a exceção. Usado pelas rotas
 * para decidir, antes de qualquer trabalho, se devem responder 503 com uma
 * mensagem acionável — em vez de deixar a falha aparecer como um erro 500
 * genérico no meio de uma operação já iniciada.
 */
export function diagnosticoAdmin(): DiagnosticoAdmin {
  assertServidor();
  try {
    app();
    return { pronto: true };
  } catch (erro) {
    return { pronto: false, motivo: erro instanceof Error ? erro.message : String(erro) };
  }
}

/** Usado apenas em teste, para reexecutar a resolução de credenciais. */
export function resetarAdminParaTeste(): void {
  appCache = null;
  appErro = null;
  firestoreCache = null;
}
