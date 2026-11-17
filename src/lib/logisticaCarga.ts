// Ingestão operacional de carga — parser de peso, cubagem e prioridade.
//
// Motor Vertical B (Logística & Supply Chain B2B). Resolve o gargalo real
// que antecede qualquer cotação automática: o cliente manda os dados da
// carga em texto corrido ("2.400 kg, 6 m³, 8 volumes de 1,20 x 0,80 x
// 1,00"), e hoje alguém redigita isso no TMS antes de qualquer coisa
// acontecer. Enquanto esse passo for humano, não existe cotação em 30
// segundos.
//
// Determinístico por desenho, como todo detector deste código: regex +
// léxico, sem IA generativa. Um dado ausente vira `null`, NUNCA um valor
// estimado (Artigo IV — No Invention) — uma cubagem inventada vira frete
// cobrado a menos, e frete cobrado a menos é margem perdida em silêncio.
//
// Puro e server-safe: sem React, sem Firestore. Consumido pelo painel de
// triagem da Neural Inbox (`@/components/niche/CargoIntakePanel`) e
// testável isoladamente (`tests/logisticaCarga.test.ts`).

/**
 * Fator de cubagem rodoviário de referência no Brasil: 300 kg por m³.
 * É o fator mais praticado em carga fracionada rodoviária — mas NÃO é
 * universal (aéreo usa 166,67; alguns contratos negociam 250 ou 333), por
 * isso é parâmetro, nunca constante embutida no cálculo.
 */
export const FATOR_CUBAGEM_RODOVIARIO_PADRAO = 300;

export interface DimensoesVolume {
  /** Em metros. */
  comprimento: number;
  largura: number;
  altura: number;
}

export interface DadosCargaExtraidos {
  pesoKg: number | null;
  cubagemM3: number | null;
  dimensoesVolume: DimensoesVolume | null;
  quantidadeVolumes: number | null;
  /** Código de rastreio/CT-e mencionado, verbatim, quando houver. */
  codigoRastreio: string | null;
}

/** Converte "2.400" / "2,4" para número — separador brasileiro, nunca `parseFloat` direto. */
function numeroBr(bruto: string): number | null {
  const normalizado = bruto.trim().replace(/\./g, "").replace(",", ".");
  const valor = Number(normalizado);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

const PADRAO_PESO_KG = /(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)\s*(?:kg|quilos?|kgs)\b/i;
const PADRAO_PESO_TON = /(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)\s*(?:t|ton|tons|toneladas?)\b/i;

/** Peso total em kg. Toneladas são convertidas; o primeiro casamento vence. */
export function extrairPesoKg(texto: string): number | null {
  if (!texto) return null;

  const emKg = texto.match(PADRAO_PESO_KG);
  if (emKg) {
    const valor = numeroBr(emKg[1]);
    if (valor !== null) return valor;
  }

  const emTon = texto.match(PADRAO_PESO_TON);
  if (emTon) {
    const valor = numeroBr(emTon[1]);
    if (valor !== null) return Math.round(valor * 1000 * 100) / 100;
  }

  return null;
}

// `(?!\w)` em vez de `\b` no fim: `³` não é um caractere de palavra, então
// `m³\b` nunca casa quando a unidade encerra a frase ("são 6 m³") — a borda
// de palavra exigiria um caractere de palavra adjacente que não existe.
const PADRAO_CUBAGEM = /(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)\s*(?:m³|m3|metros?\s+c[úu]bicos?|cbm)(?!\w)/i;

/** Cubagem declarada em m³, quando o cliente a informa diretamente. */
export function extrairCubagemM3(texto: string): number | null {
  if (!texto) return null;
  const encontrado = texto.match(PADRAO_CUBAGEM);
  if (!encontrado) return null;
  return numeroBr(encontrado[1]);
}

// "1,20 x 0,80 x 1,00" / "1.20x0.80x1.00" / "120 x 80 x 100" (cm).
const PADRAO_DIMENSOES = /(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i;

/**
 * Dimensões de UM volume, sempre devolvidas em METROS.
 *
 * Heurística de unidade, explicitada porque é a decisão que mais erra na
 * prática: qualquer das três medidas acima de 20 é lida como centímetros
 * (um volume rodoviário de 120 metros de comprimento não existe; de 120 cm,
 * é o palete PBR padrão). Abaixo disso, metros.
 */
export function extrairDimensoesVolume(texto: string): DimensoesVolume | null {
  if (!texto) return null;
  const encontrado = texto.match(PADRAO_DIMENSOES);
  if (!encontrado) return null;

  const brutos = [encontrado[1], encontrado[2], encontrado[3]].map((v) => numeroBr(v.replace(".", ",")));
  if (brutos.some((v) => v === null)) return null;

  const valores = brutos as number[];
  const emCentimetros = valores.some((v) => v > 20);
  const [comprimento, largura, altura] = valores.map((v) =>
    emCentimetros ? Math.round((v / 100) * 1000) / 1000 : v
  );

  return { comprimento, largura, altura };
}

const PADRAO_VOLUMES = /(\d{1,4})\s*(?:volumes?|vols?|paletes?|pallets?|caixas?|cx)\b/i;

/** Quantidade de volumes informada, quando houver. */
export function extrairQuantidadeVolumes(texto: string): number | null {
  if (!texto) return null;
  const encontrado = texto.match(PADRAO_VOLUMES);
  if (!encontrado) return null;
  const valor = Number(encontrado[1]);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

// Formatos comuns de rastreio/CT-e na operação: "DEMO-004521", "BRX-004521",
// "ABC123456789". Deliberadamente exige um bloco alfanumérico longo ou um
// hífen — sem isso, qualquer palavra em maiúsculas viraria "código".
const PADRAO_CODIGO = /\b([A-Z]{2,4}-?\d{4,12}|[A-Z]{3}\d{6,12})\b/;

/** Código de rastreio/CT-e mencionado, verbatim (nunca normalizado), ou `null`. */
export function extrairCodigoCarga(texto: string): string | null {
  if (!texto) return null;
  const encontrado = texto.toUpperCase().match(PADRAO_CODIGO);
  return encontrado ? encontrado[1] : null;
}

/** Extração completa a partir de uma ou mais mensagens do cliente (mais recentes primeiro ou último — a ordem não importa). */
export function extrairDadosCarga(mensagens: string | string[]): DadosCargaExtraidos {
  const lista = Array.isArray(mensagens) ? mensagens : [mensagens];
  const resultado: DadosCargaExtraidos = {
    pesoKg: null,
    cubagemM3: null,
    dimensoesVolume: null,
    quantidadeVolumes: null,
    codigoRastreio: null,
  };

  for (const texto of lista) {
    resultado.pesoKg = resultado.pesoKg ?? extrairPesoKg(texto);
    resultado.cubagemM3 = resultado.cubagemM3 ?? extrairCubagemM3(texto);
    resultado.dimensoesVolume = resultado.dimensoesVolume ?? extrairDimensoesVolume(texto);
    resultado.quantidadeVolumes = resultado.quantidadeVolumes ?? extrairQuantidadeVolumes(texto);
    resultado.codigoRastreio = resultado.codigoRastreio ?? extrairCodigoCarga(texto);
  }

  return resultado;
}

export interface CubagemCalculada {
  cubagemM3: number;
  /** De onde veio a cubagem: declarada pelo cliente ou derivada de dimensões × volumes. */
  origem: "declarada" | "calculada-por-dimensoes";
  pesoCubadoKg: number;
  /** `max(peso real, peso cubado)` — a base real de tarifação em carga fracionada. */
  pesoTaxavelKg: number | null;
  fatorCubagem: number;
}

/**
 * Consolida cubagem e peso taxável. Devolve `null` quando não há cubagem
 * nem dimensões — sem esse dado, não existe peso cubado, e devolver zero
 * faria o peso taxável cair para o peso real sem ninguém perceber a lacuna.
 */
export function calcularCubagem(
  dados: DadosCargaExtraidos,
  fatorCubagem = FATOR_CUBAGEM_RODOVIARIO_PADRAO
): CubagemCalculada | null {
  let cubagemM3: number | null = dados.cubagemM3;
  let origem: CubagemCalculada["origem"] = "declarada";

  if (cubagemM3 === null && dados.dimensoesVolume) {
    const { comprimento, largura, altura } = dados.dimensoesVolume;
    const unitario = comprimento * largura * altura;
    // Sem quantidade declarada, assume UM volume — o mínimo informado pelo
    // cliente, nunca um multiplicador inventado.
    cubagemM3 = Math.round(unitario * (dados.quantidadeVolumes ?? 1) * 1000) / 1000;
    origem = "calculada-por-dimensoes";
  }

  if (cubagemM3 === null) return null;

  const pesoCubadoKg = Math.round(cubagemM3 * fatorCubagem * 100) / 100;
  const pesoTaxavelKg = dados.pesoKg === null ? null : Math.max(dados.pesoKg, pesoCubadoKg);

  return { cubagemM3, origem, pesoCubadoKg, pesoTaxavelKg, fatorCubagem };
}

// ---------------------------------------------------------------------------
// Escalonamento de prioridade para a torre de controle
// ---------------------------------------------------------------------------

export type PrioridadeDespacho = "rotina" | "atencao" | "critica";

/**
 * Léxico de criticidade operacional. Cada entrada é um custo real e
 * conhecido do setor, não um sinônimo genérico de "urgente": parada de
 * linha para a fábrica do cliente, perecível perde a carga inteira, free
 * time estourado liga o contador de demurrage, sinistro vira processo.
 */
const LEXICO_CRITICO: Array<{ padrao: RegExp; motivo: string }> = [
  { padrao: /\bparada\s+de\s+linha\b|\blinha\s+parada\b|\bpar(?:ou|ar)\s+a\s+produ[çc][ãa]o\b/i, motivo: "Parada de linha de produção do cliente" },
  { padrao: /\bperec[íi]ve(?:l|is)\b|\bcadeia\s+do\s+frio\b|\brefrigerad[oa]\b/i, motivo: "Carga perecível / cadeia do frio" },
  { padrao: /\bfree\s*time\b|\bdemurrage\b|\bsobre-?estadia\b/i, motivo: "Free time / demurrage em curso" },
  { padrao: /\bsinistro\b|\bavaria\b|\broubo\b|\bacidente\b|\btombamento\b/i, motivo: "Sinistro, avaria ou roubo de carga" },
  { padrao: /\bjanela\s+de\s+atraca[çc][ãa]o\b|\bdeadline\s+de\s+embarque\b/i, motivo: "Janela de atracação / deadline de embarque" },
  { padrao: /\bcarga\s+perigosa\b|\bprodutos?\s+qu[íi]micos?\b|\bONU\s*\d{4}\b/i, motivo: "Carga perigosa (produto controlado)" },
];

const LEXICO_ATENCAO: Array<{ padrao: RegExp; motivo: string }> = [
  { padrao: /\burgente\b|\burg[êe]ncia\b|\bpra\s+hoje\b|\bo\s+quanto\s+antes\b|\bimediat[oa]\b/i, motivo: "Urgência declarada pelo cliente" },
  { padrao: /\batras(?:o|ad[oa])\b|\bfora\s+do\s+prazo\b|\bn[ãa]o\s+chegou\b/i, motivo: "Atraso ou entrega não realizada relatada" },
  { padrao: /\bcliente\s+final\s+(?:est[áa]\s+)?cobrando\b|\breclama[çc][ãa]o\b/i, motivo: "Pressão do cliente final" },
  { padrao: /\bredespacho\b|\bremanejamento\b|\breentrega\b/i, motivo: "Redespacho / reentrega solicitado" },
];

export interface ClassificacaoDespacho {
  prioridade: PrioridadeDespacho;
  /** Motivos detectados, em linguagem de operador — a trilha de explicabilidade da decisão. */
  motivos: string[];
  /** `true` quando a prioridade exige encaminhamento imediato à torre de controle. */
  escalonarParaTorre: boolean;
}

/**
 * Classifica a prioridade de despacho da demanda, a partir do texto do
 * cliente e dos dados já extraídos.
 *
 * Determinística e explicável: a lista de `motivos` é exatamente o conjunto
 * de gatilhos que casaram — nunca um score opaco. Um caso crítico escala
 * para a torre de controle mesmo que o cliente não tenha usado a palavra
 * "urgente", e um "urgente" solto NÃO vira crítico sozinho: urgência
 * declarada é atenção, custo operacional conhecido é crítico.
 */
export function classificarPrioridadeDespacho(
  mensagens: string | string[],
  dados?: DadosCargaExtraidos
): ClassificacaoDespacho {
  const lista = Array.isArray(mensagens) ? mensagens : [mensagens];
  const motivos: string[] = [];
  let critico = false;
  let atencao = false;

  for (const texto of lista) {
    if (!texto) continue;
    for (const { padrao, motivo } of LEXICO_CRITICO) {
      if (padrao.test(texto) && !motivos.includes(motivo)) {
        motivos.push(motivo);
        critico = true;
      }
    }
    for (const { padrao, motivo } of LEXICO_ATENCAO) {
      if (padrao.test(texto) && !motivos.includes(motivo)) {
        motivos.push(motivo);
        atencao = true;
      }
    }
  }

  // Carga pesada o bastante para exigir equipamento especial (acima de 10 t)
  // deixa de ser fracionada de rotina — não é criticidade, é planejamento:
  // atenção, para o despachante confirmar veículo e janela antes de cotar.
  if (dados?.pesoKg !== null && dados?.pesoKg !== undefined && dados.pesoKg > 10_000) {
    motivos.push("Carga acima de 10 t — exige veículo/equipamento dedicado");
    atencao = true;
  }

  const prioridade: PrioridadeDespacho = critico ? "critica" : atencao ? "atencao" : "rotina";
  return { prioridade, motivos, escalonarParaTorre: prioridade === "critica" };
}

export const ROTULO_PRIORIDADE_DESPACHO: Record<PrioridadeDespacho, string> = {
  rotina: "rotina",
  atencao: "atenção",
  critica: "crítica",
};
