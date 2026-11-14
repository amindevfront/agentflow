import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

// Configuração do Firebase lida das variáveis de ambiente públicas.
// Os valores devem ser preenchidos no arquivo .env.local (ver .env.local.example)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Inicialização condicional: sem as credenciais preenchidas, o app continua
// rodando normalmente (dev/build) e os exports ficam como undefined
const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId
);

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let storage: FirebaseStorage | undefined;

/**
 * Habilita persistência local (IndexedDB) do Firestore — operadores em campo
 * (galpão logístico, canteiro de obras) continuam lendo e gravando na Neural
 * Inbox e em Fluxos mesmo sem rede; o próprio SDK reenvia as escritas
 * pendentes quando a conexão volta (ver ADR-0005).
 *
 * API moderna (`initializeFirestore` + `persistentLocalCache`), não a
 * `enableIndexedDbPersistence()` — essa função está depreciada desde o
 * Firestore v9.19: a API de settings substitui-a e já resolve, de fábrica
 * via `persistentMultipleTabManager`, o erro clássico de persistência
 * (`failed-precondition`) quando o operador abre o AgentFlow em mais de uma
 * aba — na API antiga, só a primeira aba ganhava o cache.
 *
 * Fallback seguro, cobrindo os dois motivos reais de falha aqui:
 *   1. SSR/sem IndexedDB (verificado antes de tentar) — cache em memória,
 *      comportamento idêntico ao `getFirestore()` original.
 *   2. `initializeFirestore` só pode ser chamado uma vez por app — em
 *      desenvolvimento, HMR pode reexecutar este módulo; o catch cai para
 *      `getFirestore(app)`, que devolve a instância já inicializada em vez
 *      de lançar. O mesmo catch também cobre um navegador que declara
 *      `indexedDB` mas nega acesso de fato (ex.: modo privado restrito).
 */
function criarFirestore(app: FirebaseApp): Firestore {
  const suportaIndexedDb = typeof window !== "undefined" && typeof window.indexedDB !== "undefined";

  if (!suportaIndexedDb) {
    try {
      return initializeFirestore(app, { localCache: memoryLocalCache() });
    } catch {
      return getFirestore(app);
    }
  }

  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (erro) {
    console.warn("[firebase] persistência local indisponível — usando cache em memória:", erro);
    return getFirestore(app);
  }
}

// Bug real: este bloco roda em escopo de MÓDULO, importado (transitivamente,
// via `./auth`) pelo layout raiz do app — qualquer `throw` aqui nunca chega a
// nenhum try/catch de componente nem Error Boundary, porque acontece ANTES
// de qualquer render começar. O resultado é uma tela completamente branca,
// sem nenhuma mensagem — exatamente o sintoma reportado em Safari mobile na
// primeira visita (a política de particionamento de armazenamento do
// WebKit/ITP é o gatilho real mais comum para `getAuth`/`getStorage`
// lançarem durante a configuração da camada de persistência, mesmo com
// `criarFirestore` já protegido abaixo). O resto do app já foi desenhado
// para lidar bem com `auth`/`db`/`storage` undefined (`firebaseReady` em
// `@/lib/auth`, `requireDb()` lançando um erro CATCHÁVEL só quando de fato
// usado) — faltava só proteger a própria inicialização para esse
// comportamento gracioso realmente se aplicar quando o SDK falha em tempo
// de execução, não só quando as credenciais estão ausentes.
if (isFirebaseConfigured) {
  try {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = criarFirestore(app);
    storage = getStorage(app);
  } catch (erro) {
    console.error(
      "[firebase] falha ao inicializar o SDK — o app continua rodando sem Firebase (ver `firebaseReady`):",
      erro
    );
  }
}

export { app, auth, db, storage };
