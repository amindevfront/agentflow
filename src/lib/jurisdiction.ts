// Inferência de jurisdição e idioma por DDI do telefone — Expansão Global
// (EUA/Portugal).
//
// Isomórfico e puro: nenhuma chamada de rede, nenhuma dependência de
// Node/DOM. Mesmo princípio de `@/lib/roi`: dado o mesmo DDI, o resultado é
// sempre o mesmo, auditável e reproduzível.
//
// Honestidade do dado: isto classifica GEOGRAFIA (de onde vem o número), não
// aplica uma regra jurídica. GDPR e CCPA não diferem em "quanto mascarar" —
// diferem em direitos do titular (apagamento, portabilidade, opt-out de
// venda de dados), que este módulo não decide. `Jurisdicao` é uma TAG para a
// trilha de auditoria e para a escolha de idioma do Ghost Coach — nunca uma
// afirmação de conformidade legal completa.
//
// Limites honestos, documentados em vez de escondidos:
//  - `+1` (NANP) cobre EUA, Canadá e vários territórios do Caribe — não há
//    como distinguir só pelo DDI. Por isso a tag é `us-privacy` (geografia
//    aproximada), nunca `ccpa` (que é uma lei estadual da Califórnia, não
//    federal nem de todo o `+1`).
//  - Países da UE cuja língua nativa não é português/espanhol (ex.: França,
//    Alemanha) caem no fallback `en` — não é a língua nativa do titular, é o
//    melhor fallback dentre as três línguas que o produto hoje suporta
//    (ver `agentflow_business_model` / especificação do usuário).
//  - DDI desconhecido ou telefone malformado devolve `"desconhecida"`/`"en"`
//    — nunca lança, nunca assume Brasil por padrão.

export type Jurisdicao = "br-lgpd" | "eu-gdpr" | "us-privacy" | "desconhecida";

export type Idioma = "pt" | "en" | "es";

interface EntradaDdi {
  ddi: string;
  pais: string;
  jurisdicao: Jurisdicao;
  idioma: Idioma;
}

/**
 * Tabela DDI → (país, jurisdição, idioma). Ordenada do DDI mais longo para o
 * mais curto — a busca por prefixo mais longo evita que `+1` capture
 * incorretamente um DDI de 2-3 dígitos que também comece por "1" (não há
 * colisão real nesta tabela hoje, mas a ordem é a regra geral correta para
 * qualquer tabela de DDI, e barata de manter assim).
 */
const TABELA_DDI: EntradaDdi[] = [
  // Brasil — LGPD, português.
  { ddi: "55", pais: "Brasil", jurisdicao: "br-lgpd", idioma: "pt" },

  // Portugal — GDPR (UE), português. Mercado explicitamente alvo desta expansão.
  { ddi: "351", pais: "Portugal", jurisdicao: "eu-gdpr", idioma: "pt" },

  // União Europeia — GDPR. Idioma nativo mapeado quando é português/espanhol;
  // os demais caem no fallback `en` documentado acima.
  { ddi: "34", pais: "Espanha", jurisdicao: "eu-gdpr", idioma: "es" },
  { ddi: "33", pais: "França", jurisdicao: "eu-gdpr", idioma: "en" },
  { ddi: "49", pais: "Alemanha", jurisdicao: "eu-gdpr", idioma: "en" },
  { ddi: "39", pais: "Itália", jurisdicao: "eu-gdpr", idioma: "en" },
  { ddi: "31", pais: "Países Baixos", jurisdicao: "eu-gdpr", idioma: "en" },
  { ddi: "32", pais: "Bélgica", jurisdicao: "eu-gdpr", idioma: "en" },
  { ddi: "353", pais: "Irlanda", jurisdicao: "eu-gdpr", idioma: "en" },
  { ddi: "30", pais: "Grécia", jurisdicao: "eu-gdpr", idioma: "en" },
  { ddi: "48", pais: "Polônia", jurisdicao: "eu-gdpr", idioma: "en" },
  { ddi: "352", pais: "Luxemburgo", jurisdicao: "eu-gdpr", idioma: "en" },
  { ddi: "358", pais: "Finlândia", jurisdicao: "eu-gdpr", idioma: "en" },
  { ddi: "46", pais: "Suécia", jurisdicao: "eu-gdpr", idioma: "en" },
  { ddi: "45", pais: "Dinamarca", jurisdicao: "eu-gdpr", idioma: "en" },
  { ddi: "43", pais: "Áustria", jurisdicao: "eu-gdpr", idioma: "en" },

  // Espanhol fora da UE (América Latina) — idioma mapeado, jurisdição
  // específica desconhecida (nenhuma lei LGPD/GDPR/CCPA se aplica).
  { ddi: "52", pais: "México", jurisdicao: "desconhecida", idioma: "es" },
  { ddi: "54", pais: "Argentina", jurisdicao: "desconhecida", idioma: "es" },
  { ddi: "56", pais: "Chile", jurisdicao: "desconhecida", idioma: "es" },
  { ddi: "57", pais: "Colômbia", jurisdicao: "desconhecida", idioma: "es" },

  // EUA/Canadá/Caribe (NANP) — ver limite honesto no cabeçalho do arquivo.
  { ddi: "1", pais: "EUA/Canadá (NANP)", jurisdicao: "us-privacy", idioma: "en" },

  // Reino Unido — fora da UE pós-Brexit (UK GDPR é um regime próprio, não
  // coberto por esta tag); idioma inglês.
  { ddi: "44", pais: "Reino Unido", jurisdicao: "desconhecida", idioma: "en" },
];

// Ordenada por comprimento de DDI decrescente, uma única vez no load do
// módulo — garante que "351" (3 dígitos) seja tentado antes de um eventual
// prefixo de 1-2 dígitos que o colidisse.
const TABELA_DDI_ORDENADA = [...TABELA_DDI].sort((a, b) => b.ddi.length - a.ddi.length);

/**
 * Extrai o DDI de um telefone em formato E.164 (`+<ddi><número>`) e devolve
 * a entrada correspondente da tabela, pelo prefixo mais longo que casar.
 *
 * `null` para entrada vazia, sem o prefixo `+`, ou DDI não catalogado — nunca
 * lança, nunca adivinha.
 */
function resolverEntradaDdi(telefone: string | null | undefined): EntradaDdi | null {
  if (!telefone) return null;
  const limpo = telefone.trim();
  if (!limpo.startsWith("+")) return null;

  const digitos = limpo.slice(1).replace(/[^\d]/g, "");
  if (!digitos) return null;

  for (const entrada of TABELA_DDI_ORDENADA) {
    if (digitos.startsWith(entrada.ddi)) return entrada;
  }
  return null;
}

/** Jurisdição inferida a partir do DDI de um telefone em E.164. `"desconhecida"` quando não catalogado/malformado. */
export function inferirJurisdicaoPorTelefone(telefone: string | null | undefined): Jurisdicao {
  return resolverEntradaDdi(telefone)?.jurisdicao ?? "desconhecida";
}

/** Idioma provável do titular a partir do DDI de um telefone em E.164. `"en"` quando não catalogado/malformado (fallback, nunca silencioso: ver cabeçalho). */
export function inferirIdiomaPorTelefone(telefone: string | null | undefined): Idioma {
  return resolverEntradaDdi(telefone)?.idioma ?? "en";
}

/** Nome do país, quando catalogado — só para exibição/depuração, nunca usado em lógica de negócio. */
export function inferirPaisPorTelefone(telefone: string | null | undefined): string | null {
  return resolverEntradaDdi(telefone)?.pais ?? null;
}
