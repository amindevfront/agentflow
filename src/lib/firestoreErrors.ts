// Classificação explícita de erros do Firestore (ver ADR-0006) — núcleo puro,
// sem dependência do SDK, só para dar nome aos códigos que importam ao
// decidir o que fazer com uma leitura de workspace que falhou.
//
// `permission-denied`: regra de segurança negou a leitura (ex.: doc de outro
// tenant, token expirado no meio da sessão).
// `unavailable`: Firestore fora do ar/inacessível (rede, outage do serviço).
// `deadline-exceeded`: o próprio SDK expirou a chamada antes do nosso
// `withTimeout` de 3s conseguir fazê-lo.
// `unauthenticated`: token do Firebase Auth inválido/expirado no momento da
// leitura.
// Qualquer outro código (ou nenhum) cai em `desconhecido` — ainda tratado,
// só sem um rótulo mais específico para o log.

export type FirestoreErrorCode =
  | "permission-denied"
  | "unavailable"
  | "deadline-exceeded"
  | "unauthenticated"
  | "desconhecido";

const CODIGOS_CONHECIDOS: ReadonlySet<string> = new Set([
  "permission-denied",
  "unavailable",
  "deadline-exceeded",
  "unauthenticated",
]);

export function codigoErroFirestore(erro: unknown): FirestoreErrorCode {
  const code = (erro as { code?: unknown } | null)?.code;
  if (typeof code === "string" && CODIGOS_CONHECIDOS.has(code)) {
    return code as FirestoreErrorCode;
  }
  return "desconhecido";
}

// ---------------------------------------------------------------------------
// Índice composto ausente
// ---------------------------------------------------------------------------
//
// Uma consulta com `where` + `orderBy` em campos diferentes (ou múltiplos
// `where`) exige um índice composto já criado no Firestore. Sem ele, o SDK
// rejeita com `code: "failed-precondition"` e uma mensagem que inclui, em
// texto livre, um link de console que cria o índice automaticamente —
// `https://console.firebase.google.com/.../firestore/indexes?create_composite=...`.
// Nenhum desses dois sinais (código + texto do link) é estruturado o
// suficiente para confiar isoladamente: o código `failed-precondition` tem
// outros usos no Firestore, e a mensagem é texto livre do backend. Exigimos
// os dois juntos para classificar como "índice ausente" com segurança.

function mensagemDoErro(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  if (typeof erro === "string") return erro;
  // `FirestoreError` real é uma instância de `Error`, mas nem todo erro que
  // chega aqui necessariamente é — ex.: um objeto simples `{code, message}`
  // reconstruído a partir de uma resposta serializada. Aceitar qualquer
  // objeto com `message` string evita perder a classificação por um detalhe
  // de forma, não de conteúdo.
  const mensagem = (erro as { message?: unknown } | null)?.message;
  return typeof mensagem === "string" ? mensagem : "";
}

export function isMissingIndexError(erro: unknown): boolean {
  const code = (erro as { code?: unknown } | null)?.code;
  if (code !== "failed-precondition") return false;
  return /requires an index|requer um índice/i.test(mensagemDoErro(erro));
}

/** Extrai o link de criação automática de índice da mensagem do Firestore, se presente. */
export function extrairLinkIndice(erro: unknown): string | null {
  const match = mensagemDoErro(erro).match(/https:\/\/console\.firebase\.google\.com\S+/);
  return match ? match[0] : null;
}

/**
 * Loga o link de criação do índice ausente — estritamente em desenvolvimento
 * (nunca em produção, para não poluir o console do usuário final nem expor
 * detalhes de schema interno). Não lança e não retorna nada: é só um canal de
 * diagnóstico para quem está desenvolvendo, nunca parte do fluxo de decisão.
 */
export function logIndiceAusente(erro: unknown, contexto: string): void {
  if (process.env.NODE_ENV === "production") return;
  if (!isMissingIndexError(erro)) return;
  const link = extrairLinkIndice(erro);
  console.warn(
    `[firestore] índice composto ausente em "${contexto}".` +
      (link ? ` Crie o índice aqui: ${link}` : " Verifique a mensagem de erro completa para o link de criação.")
  );
}
