// Ponte Sandbox → Neural Inbox (`@/components/flows/PayloadSimulator`).
//
// Extração pura, sem Firestore: dado o payload JÁ validado pelo simulador,
// decide qual nome e texto de mensagem usar para a conversa de demonstração.
// Nunca inventa um valor (Artigo IV) — procura chaves comuns (PT/EN) e, na
// ausência de qualquer uma, cai no próprio JSON como texto e num rótulo
// genérico como nome, que deixa claro que é um lead de teste.

/** Chaves de texto reconhecidas, em ordem de prioridade. */
const CHAVES_TEXTO = ["texto", "mensagem", "message", "text", "body"] as const;
/** Chaves de nome reconhecidas, em ordem de prioridade. */
const CHAVES_NOME = ["nome", "name", "cliente", "remetente"] as const;

function primeiraChaveComTextoNaoVazio(objeto: Record<string, unknown>, chaves: readonly string[]): string | null {
  for (const chave of chaves) {
    const valor = objeto[chave];
    if (typeof valor === "string" && valor.trim().length > 0) return valor.trim();
  }
  return null;
}

export interface ClienteSimulado {
  nome: string;
  texto: string;
}

/**
 * Extrai um nome e um texto de mensagem plausíveis do payload simulado.
 * `payload` já é o resultado de `JSON.parse` — nunca uma string.
 */
export function extrairClienteSimulado(payload: unknown): ClienteSimulado {
  const objeto =
    payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};

  return {
    nome: primeiraChaveComTextoNaoVazio(objeto, CHAVES_NOME) ?? "Lead simulado (Fluxos)",
    texto: primeiraChaveComTextoNaoVazio(objeto, CHAVES_TEXTO) ?? JSON.stringify(payload, null, 2),
  };
}
