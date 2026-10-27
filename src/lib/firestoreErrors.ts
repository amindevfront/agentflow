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
