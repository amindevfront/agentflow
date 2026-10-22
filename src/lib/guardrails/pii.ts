// Detecção e mascaramento de PII / dados sensíveis (LGPD).
//
// Isomórfico: roda no browser (inspetor da UI) e no servidor (fonte de verdade
// em `/api/guardrails/inspect`). Nenhuma dependência de Node ou de DOM.
//
// Princípio: o valor original NUNCA sai deste módulo. O `PiiVault` mantém o mapa
// placeholder → valor original em memória, vive apenas pelo tempo de uma
// requisição e jamais é serializado, persistido ou enviado a terceiros.

import type { PiiClassificacao, PiiKind, PiiMatch } from "@/types";

export const CLASSIFICACAO_POR_KIND: Record<PiiKind, PiiClassificacao> = {
  cpf: "identificador-pessoal",
  cnpj: "identificador-pessoal",
  rg: "identificador-pessoal",
  email: "contato",
  telefone: "contato",
  cep: "contato",
  "cartao-credito": "financeiro",
  "chave-pix": "financeiro",
  "conta-bancaria": "financeiro",
  "valor-financeiro": "financeiro",
  "segredo-api": "credencial",
  ip: "tecnico",
};

export const ROTULO_POR_KIND: Record<PiiKind, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  rg: "RG",
  email: "E-mail",
  telefone: "Telefone",
  cep: "CEP",
  "cartao-credito": "Cartão de crédito",
  "chave-pix": "Chave PIX",
  "conta-bancaria": "Conta bancária",
  "valor-financeiro": "Valor financeiro",
  "segredo-api": "Credencial",
  ip: "Endereço IP",
};

const PREFIXO_PLACEHOLDER = "[[PII:";
const SUFIXO_PLACEHOLDER = "]]";

function tokenPlaceholder(kind: PiiKind, indice: number): string {
  return `${PREFIXO_PLACEHOLDER}${kind.toUpperCase()}:${indice}${SUFIXO_PLACEHOLDER}`;
}

/** Captura qualquer placeholder emitido por este módulo. */
export const REGEX_PLACEHOLDER = /\[\[PII:[A-Z-]+:\d+\]\]/g;

/**
 * Cofre efêmero de valores mascarados.
 *
 * Responsabilidade única: traduzir valor real ↔ placeholder dentro do ciclo de
 * vida de uma única chamada. Deliberadamente não serializável — `toJSON` lança,
 * para que um `JSON.stringify` acidental em um log ou em um documento do
 * Firestore falhe de forma ruidosa em vez de vazar dados pessoais.
 */
export class PiiVault {
  private readonly porValor = new Map<string, string>();
  private readonly porPlaceholder = new Map<string, string>();
  private readonly contadores = new Map<PiiKind, number>();

  /**
   * Registra um valor e devolve seu placeholder. Idempotente: o mesmo valor
   * recebe sempre o mesmo placeholder, preservando correferência no prompt
   * (o LLM continua entendendo que duas menções são a mesma entidade).
   */
  register(kind: PiiKind, valor: string): string {
    const chave = `${kind}::${valor}`;
    const existente = this.porValor.get(chave);
    if (existente) return existente;

    const proximo = (this.contadores.get(kind) ?? 0) + 1;
    this.contadores.set(kind, proximo);
    const placeholder = tokenPlaceholder(kind, proximo);

    this.porValor.set(chave, placeholder);
    this.porPlaceholder.set(placeholder, valor);
    return placeholder;
  }

  /** Re-hidrata placeholders conhecidos. Placeholders desconhecidos permanecem. */
  restore(texto: string): string {
    if (this.porPlaceholder.size === 0) return texto;
    return texto.replace(REGEX_PLACEHOLDER, (encontrado) =>
      this.porPlaceholder.has(encontrado) ? (this.porPlaceholder.get(encontrado) as string) : encontrado
    );
  }

  /** Placeholders presentes no texto que este cofre não conhece (possível forja). */
  placeholdersDesconhecidos(texto: string): string[] {
    const achados = texto.match(REGEX_PLACEHOLDER) ?? [];
    return [...new Set(achados.filter((p) => !this.porPlaceholder.has(p)))];
  }

  get size(): number {
    return this.porPlaceholder.size;
  }

  kinds(): PiiKind[] {
    return [...this.contadores.keys()];
  }

  /** Descarta todo o conteúdo. Chamado em `finally` nos caminhos críticos. */
  clear(): void {
    this.porValor.clear();
    this.porPlaceholder.clear();
    this.contadores.clear();
  }

  /** Falha explícita: um cofre de PII nunca pode ser serializado. */
  toJSON(): never {
    throw new Error(
      "PiiVault não é serializável por design — ele contém dados pessoais em claro. " +
        "Persista apenas o texto mascarado."
    );
  }
}

// ---------------------------------------------------------------------------
// Validadores determinísticos
// ---------------------------------------------------------------------------

function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/** Valida CPF pelos dois dígitos verificadores (módulo 11). */
export function validarCpf(entrada: string): boolean {
  const d = apenasDigitos(entrada);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  for (const posicao of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < posicao; i += 1) {
      soma += Number(d[i]) * (posicao + 1 - i);
    }
    const resto = (soma * 10) % 11;
    const esperado = resto === 10 ? 0 : resto;
    if (esperado !== Number(d[posicao])) return false;
  }
  return true;
}

/** Valida CNPJ pelos dois dígitos verificadores (módulo 11, pesos 2..9). */
export function validarCnpj(entrada: string): boolean {
  const d = apenasDigitos(entrada);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const calcula = (tamanho: number): number => {
    let soma = 0;
    let peso = tamanho - 7;
    for (let i = 0; i < tamanho; i += 1) {
      soma += Number(d[i]) * peso;
      peso -= 1;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return calcula(12) === Number(d[12]) && calcula(13) === Number(d[13]);
}

/** Algoritmo de Luhn — usado para confirmar números de cartão. */
export function validarLuhn(entrada: string): boolean {
  const d = apenasDigitos(entrada);
  if (d.length < 13 || d.length > 19) return false;

  let soma = 0;
  let dobra = false;
  for (let i = d.length - 1; i >= 0; i -= 1) {
    let digito = Number(d[i]);
    if (dobra) {
      digito *= 2;
      if (digito > 9) digito -= 9;
    }
    soma += digito;
    dobra = !dobra;
  }
  return soma % 10 === 0;
}

function validarIpv4(entrada: string): boolean {
  const partes = entrada.split(".");
  if (partes.length !== 4) return false;
  return partes.every((parte) => {
    if (!/^\d{1,3}$/.test(parte)) return false;
    const n = Number(parte);
    return n >= 0 && n <= 255;
  });
}

/**
 * Converte um valor monetário textual em número.
 * Trata as duas convenções: `1.234,56` (pt-BR) e `1,234.56` (en-US).
 */
export function parseValorMonetario(bruto: string): number | null {
  const limpo = bruto.replace(/[^\d.,]/g, "");
  if (!limpo) return null;

  const ultimaVirgula = limpo.lastIndexOf(",");
  const ultimoPonto = limpo.lastIndexOf(".");
  let normalizado: string;

  if (ultimaVirgula > ultimoPonto) {
    // pt-BR: ponto é separador de milhar, vírgula é decimal.
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else if (ultimoPonto > ultimaVirgula) {
    normalizado = limpo.replace(/,/g, "");
  } else {
    normalizado = limpo.replace(/[.,]/g, "");
  }

  const valor = Number(normalizado);
  return Number.isFinite(valor) ? valor : null;
}

// ---------------------------------------------------------------------------
// Detectores
// ---------------------------------------------------------------------------

export interface MaskingOptions {
  /** Categorias liberadas: detectadas e reportadas, mas não mascaradas. */
  piiPermitida?: PiiKind[];
  /** Valores monetários abaixo deste limiar não são considerados sensíveis. */
  limiarValorSensivel?: number;
}

interface CandidatoBruto {
  kind: PiiKind;
  prioridade: number;
  inicio: number;
  fim: number;
  valor: string;
}

interface Detector {
  kind: PiiKind;
  /** Em conflito de sobreposição, a maior prioridade vence. */
  prioridade: number;
  regex: RegExp;
  /** Índice do grupo de captura a mascarar. 0 = casamento inteiro. */
  grupo?: number;
  /** Exige que o caractere adjacente não seja dígito/pontuação numérica. */
  bordaNumerica?: boolean;
  aceita?: (valor: string, opcoes: MaskingOptions) => boolean;
}

/**
 * Decide se o trecho casado é um valor completo, e não parte de um número maior.
 *
 * Um dígito imediatamente antes ou depois invalida o casamento. Um separador
 * (`.` `,` `-` `/`) só invalida quando ele próprio é seguido/precedido de
 * dígito — isto é, quando o número de fato continua. Sem essa distinção, um CPF
 * no fim de uma frase ("...247-25.") escaparia do mascaramento por causa do
 * ponto final.
 */
function ehDigito(caractere: string): boolean {
  return caractere >= "0" && caractere <= "9";
}

function ehSeparadorNumerico(caractere: string): boolean {
  return caractere === "." || caractere === "," || caractere === "-" || caractere === "/";
}

function temBordaValida(texto: string, inicio: number, fim: number): boolean {
  const anterior = inicio > 0 ? texto[inicio - 1] : "";
  const anteriorDuplo = inicio > 1 ? texto[inicio - 2] : "";
  const posterior = fim < texto.length ? texto[fim] : "";
  const posteriorDuplo = fim + 1 < texto.length ? texto[fim + 1] : "";

  if (ehDigito(anterior) || ehDigito(posterior)) return false;
  if (ehSeparadorNumerico(anterior) && ehDigito(anteriorDuplo)) return false;
  if (ehSeparadorNumerico(posterior) && ehDigito(posteriorDuplo)) return false;
  return true;
}

/**
 * Ordem de prioridade importa: um CPF e um telefone celular têm ambos 11
 * dígitos, então identificadores validados por dígito verificador precisam ser
 * avaliados antes de heurísticas mais frouxas.
 */
const DETECTORES: Detector[] = [
  // Credenciais primeiro: um vazamento de chave é sempre o pior caso.
  {
    kind: "segredo-api",
    prioridade: 100,
    regex: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g,
  },
  { kind: "segredo-api", prioridade: 99, regex: /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g },
  { kind: "segredo-api", prioridade: 99, regex: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { kind: "segredo-api", prioridade: 99, regex: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { kind: "segredo-api", prioridade: 99, regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "segredo-api", prioridade: 99, regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  {
    kind: "segredo-api",
    prioridade: 98,
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    kind: "segredo-api",
    prioridade: 97,
    regex: /\bBearer\s+([A-Za-z0-9._~+/-]{20,}=*)/g,
    grupo: 1,
  },

  // Identificadores com dígito verificador.
  {
    kind: "cnpj",
    prioridade: 90,
    regex: /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14}/g,
    bordaNumerica: true,
    aceita: (valor) => validarCnpj(valor),
  },
  {
    kind: "cpf",
    prioridade: 89,
    regex: /\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11}/g,
    bordaNumerica: true,
    aceita: (valor) => validarCpf(valor),
  },
  {
    kind: "cartao-credito",
    prioridade: 88,
    regex: /\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{1,7}|\d{13,19}/g,
    bordaNumerica: true,
    aceita: (valor) => validarLuhn(valor),
  },

  // Chave PIX aleatória (UUID).
  {
    kind: "chave-pix",
    prioridade: 80,
    regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  },

  { kind: "email", prioridade: 70, regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },

  // Dados que só são identificáveis com contexto textual explícito.
  { kind: "rg", prioridade: 65, regex: /\bRG\s*(?:n[ºo°.]*)?\s*:?\s*([\d.-]{7,14})/gi, grupo: 1 },
  {
    kind: "conta-bancaria",
    prioridade: 64,
    regex: /\bag(?:ê|e)ncia\s*:?\s*(\d{3,6}-?\d?)/gi,
    grupo: 1,
  },
  {
    kind: "conta-bancaria",
    prioridade: 64,
    regex: /\bconta\s*(?:corrente|poupan(?:ç|c)a)?\s*:?\s*(\d{4,12}-?\d?)/gi,
    grupo: 1,
  },

  {
    kind: "telefone",
    prioridade: 60,
    regex: /(?:\+55[\s-]?)?(?:\(\d{2}\)|\b\d{2})[\s-]?9?\d{4}[\s-]?\d{4}\b/g,
    bordaNumerica: true,
  },
  { kind: "cep", prioridade: 55, regex: /\b\d{5}-\d{3}\b/g, bordaNumerica: true },

  {
    kind: "valor-financeiro",
    prioridade: 40,
    regex: /(?:R\$|US\$|USD|BRL|EUR|\$)\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?/gi,
    aceita: (valor, opcoes) => {
      const numero = parseValorMonetario(valor);
      if (numero === null) return false;
      return numero >= (opcoes.limiarValorSensivel ?? 0);
    },
  },

  {
    kind: "ip",
    prioridade: 20,
    regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    aceita: (valor) => validarIpv4(valor),
  },
];

function coletarCandidatos(texto: string, opcoes: MaskingOptions): CandidatoBruto[] {
  const candidatos: CandidatoBruto[] = [];

  for (const detector of DETECTORES) {
    // Clona o regex para não compartilhar `lastIndex` entre chamadas concorrentes.
    const regex = new RegExp(detector.regex.source, detector.regex.flags);
    let m: RegExpExecArray | null;
    let guarda = 0;

    while ((m = regex.exec(texto)) !== null) {
      // Proteção contra regex que casa vazio e trava o laço.
      if (m[0] === "") {
        regex.lastIndex += 1;
        continue;
      }
      guarda += 1;
      if (guarda > 10000) break;

      const indiceGrupo = detector.grupo ?? 0;
      const valor = m[indiceGrupo];
      if (!valor) continue;

      const deslocamento = indiceGrupo === 0 ? 0 : m[0].indexOf(valor);
      if (deslocamento < 0) continue;

      const inicio = m.index + deslocamento;
      const fim = inicio + valor.length;

      if (detector.bordaNumerica && !temBordaValida(texto, inicio, fim)) continue;
      if (detector.aceita && !detector.aceita(valor, opcoes)) continue;

      candidatos.push({ kind: detector.kind, prioridade: detector.prioridade, inicio, fim, valor });
    }
  }

  return candidatos;
}

/**
 * Resolve sobreposições: mantém o candidato de maior prioridade e, em empate, o
 * mais longo. Evita que um CPF seja parcialmente mascarado como telefone.
 */
function resolverSobreposicoes(candidatos: CandidatoBruto[]): CandidatoBruto[] {
  const ordenados = [...candidatos].sort((a, b) => {
    if (b.prioridade !== a.prioridade) return b.prioridade - a.prioridade;
    const tamanhoA = a.fim - a.inicio;
    const tamanhoB = b.fim - b.inicio;
    if (tamanhoB !== tamanhoA) return tamanhoB - tamanhoA;
    return a.inicio - b.inicio;
  });

  const aceitos: CandidatoBruto[] = [];
  for (const candidato of ordenados) {
    const colide = aceitos.some((a) => candidato.inicio < a.fim && a.inicio < candidato.fim);
    if (!colide) aceitos.push(candidato);
  }

  return aceitos.sort((a, b) => a.inicio - b.inicio);
}

export interface MaskingResult {
  texto: string;
  matches: PiiMatch[];
  /** Categorias detectadas, inclusive as liberadas por política. */
  kindsDetectados: PiiKind[];
  /** Categorias efetivamente substituídas por placeholder. */
  kindsMascarados: PiiKind[];
}

/**
 * Mascara PII em um texto, registrando os valores no cofre fornecido.
 *
 * As substituições são aplicadas da direita para a esquerda para que os índices
 * calculados na varredura permaneçam válidos durante a reescrita.
 */
export function maskText(
  texto: string,
  vault: PiiVault,
  opcoes: MaskingOptions = {}
): MaskingResult {
  if (!texto) {
    return { texto, matches: [], kindsDetectados: [], kindsMascarados: [] };
  }

  const permitidas = new Set(opcoes.piiPermitida ?? []);
  const candidatos = resolverSobreposicoes(coletarCandidatos(texto, opcoes));

  const matches: PiiMatch[] = [];
  const detectados = new Set<PiiKind>();
  const mascarados = new Set<PiiKind>();
  let resultado = texto;

  for (let i = candidatos.length - 1; i >= 0; i -= 1) {
    const candidato = candidatos[i];
    detectados.add(candidato.kind);
    if (permitidas.has(candidato.kind)) continue;

    const placeholder = vault.register(candidato.kind, candidato.valor);
    resultado = resultado.slice(0, candidato.inicio) + placeholder + resultado.slice(candidato.fim);
    mascarados.add(candidato.kind);

    matches.push({
      kind: candidato.kind,
      classificacao: CLASSIFICACAO_POR_KIND[candidato.kind],
      inicio: candidato.inicio,
      fim: candidato.fim,
      placeholder,
      tamanho: candidato.valor.length,
    });
  }

  return {
    texto: resultado,
    matches: matches.reverse(),
    kindsDetectados: [...detectados],
    kindsMascarados: [...mascarados],
  };
}

/**
 * Nomes de campo tratados como sensíveis independentemente do conteúdo.
 * Cobre o caso em que o valor não tem formato reconhecível (ex.: uma senha
 * arbitrária em um campo `password`), que nenhum regex pegaria.
 */
const CHAVES_SENSIVEIS: Array<{ padrao: RegExp; kind: PiiKind }> = [
  { padrao: /^(senha|password|passwd|pwd|secret|segredo|client_?secret)$/i, kind: "segredo-api" },
  {
    padrao: /^(token|api_?key|apikey|access_?token|refresh_?token|authorization|auth)$/i,
    kind: "segredo-api",
  },
  { padrao: /^(private_?key|chave_?privada)$/i, kind: "segredo-api" },
  { padrao: /^(cpf|cpf_cnpj|documento|doc)$/i, kind: "cpf" },
  { padrao: /^(cnpj)$/i, kind: "cnpj" },
  { padrao: /^(rg|identidade)$/i, kind: "rg" },
  { padrao: /^(e?_?mail)$/i, kind: "email" },
  { padrao: /^(telefone|celular|phone|whatsapp|fone)$/i, kind: "telefone" },
  { padrao: /^(cep|zip|zipcode)$/i, kind: "cep" },
  {
    padrao: /^(cartao|cartao_credito|card|card_?number|numero_cartao|cvv|cvc)$/i,
    kind: "cartao-credito",
  },
  { padrao: /^(pix|chave_?pix)$/i, kind: "chave-pix" },
  { padrao: /^(conta|conta_?corrente|agencia|iban)$/i, kind: "conta-bancaria" },
  { padrao: /^(salario|renda|saldo|valor_?total|faturamento)$/i, kind: "valor-financeiro" },
];

function kindPorNomeDeChave(chave: string): PiiKind | null {
  const normalizada = chave.trim();
  for (const { padrao, kind } of CHAVES_SENSIVEIS) {
    if (padrao.test(normalizada)) return kind;
  }
  return null;
}

export interface DeepMaskingResult {
  valor: unknown;
  matches: PiiMatch[];
  kindsDetectados: PiiKind[];
  kindsMascarados: PiiKind[];
}

const PROFUNDIDADE_MAXIMA = 12;

/**
 * Mascara PII recursivamente em uma estrutura JSON.
 *
 * Duas estratégias combinadas:
 *  1. por nome de campo (pega segredos sem formato reconhecível);
 *  2. por conteúdo, via `maskText` (pega PII embutida em texto livre).
 *
 * Ciclos e profundidade excessiva são tratados: um grafo com referência
 * circular devolve um marcador naquele ponto em vez de estourar a pilha.
 */
export function maskDeep(
  valor: unknown,
  vault: PiiVault,
  opcoes: MaskingOptions = {}
): DeepMaskingResult {
  const matches: PiiMatch[] = [];
  const detectados = new Set<PiiKind>();
  const mascarados = new Set<PiiKind>();
  const visitados = new WeakSet<object>();
  const permitidas = new Set(opcoes.piiPermitida ?? []);

  function registrarForcado(kind: PiiKind, bruto: string): string | null {
    detectados.add(kind);
    if (permitidas.has(kind)) return null;

    const placeholder = vault.register(kind, bruto);
    mascarados.add(kind);
    matches.push({
      kind,
      classificacao: CLASSIFICACAO_POR_KIND[kind],
      inicio: 0,
      fim: bruto.length,
      placeholder,
      tamanho: bruto.length,
    });
    return placeholder;
  }

  function visitar(entrada: unknown, kindForcado: PiiKind | null, profundidade: number): unknown {
    if (profundidade > PROFUNDIDADE_MAXIMA) return "[[PII:PROFUNDIDADE_EXCEDIDA]]";
    if (entrada === null || entrada === undefined) return entrada;

    if (typeof entrada === "string") {
      if (kindForcado && entrada.length > 0) {
        return registrarForcado(kindForcado, entrada) ?? entrada;
      }
      const resultado = maskText(entrada, vault, opcoes);
      resultado.kindsDetectados.forEach((k) => detectados.add(k));
      resultado.kindsMascarados.forEach((k) => mascarados.add(k));
      matches.push(...resultado.matches);
      return resultado.texto;
    }

    if (typeof entrada === "number" || typeof entrada === "boolean") {
      // Campo sensível com valor numérico (ex.: um CPF enviado como number).
      if (kindForcado) {
        return registrarForcado(kindForcado, String(entrada)) ?? entrada;
      }
      return entrada;
    }

    if (Array.isArray(entrada)) {
      if (visitados.has(entrada)) return "[[PII:CICLO]]";
      visitados.add(entrada);
      return entrada.map((item) => visitar(item, kindForcado, profundidade + 1));
    }

    if (typeof entrada === "object") {
      if (visitados.has(entrada as object)) return "[[PII:CICLO]]";
      visitados.add(entrada as object);

      const saida: Record<string, unknown> = {};
      for (const [chave, item] of Object.entries(entrada as Record<string, unknown>)) {
        saida[chave] = visitar(item, kindPorNomeDeChave(chave), profundidade + 1);
      }
      return saida;
    }

    // Funções, símbolos e BigInt não têm representação segura em um payload.
    return "[[PII:TIPO_NAO_SUPORTADO]]";
  }

  return {
    valor: visitar(valor, null, 0),
    matches,
    kindsDetectados: [...detectados],
    kindsMascarados: [...mascarados],
  };
}

/**
 * Mascara um payload de qualquer formato, preservando JSON quando possível.
 * Entrada que não é JSON válido cai no mascaramento textual.
 */
export function maskPayload(
  payload: string,
  vault: PiiVault,
  opcoes: MaskingOptions = {}
): MaskingResult {
  const aparentaJson = /^\s*[{[]/.test(payload);
  if (aparentaJson) {
    try {
      const estrutura = JSON.parse(payload) as unknown;
      const resultado = maskDeep(estrutura, vault, opcoes);
      return {
        texto: JSON.stringify(resultado.valor, null, 2),
        matches: resultado.matches,
        kindsDetectados: resultado.kindsDetectados,
        kindsMascarados: resultado.kindsMascarados,
      };
    } catch {
      // JSON malformado: segue para o caminho textual, que é sempre seguro.
    }
  }
  return maskText(payload, vault, opcoes);
}

/**
 * Trunca e mascara um trecho para uso como evidência em logs e tickets.
 * Garantia: a saída nunca contém PII em claro.
 */
export function evidenciaSegura(trecho: string, limite = 160): string {
  const cofreDescartavel = new PiiVault();
  try {
    const { texto } = maskText(trecho, cofreDescartavel, { limiarValorSensivel: 0 });
    const colapsado = texto.replace(/\s+/g, " ").trim();
    return colapsado.length > limite ? `${colapsado.slice(0, limite)}…` : colapsado;
  } finally {
    cofreDescartavel.clear();
  }
}
