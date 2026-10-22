// Checagens determinísticas e estocásticas contra alucinação e loops.
//
// Todo o módulo é puro e determinístico: a mesma entrada produz sempre a mesma
// saída. Isso é requisito de auditoria — um veredito de guardrail precisa ser
// reproduzível meses depois, a partir apenas dos dados registrados.
//
// Isomórfico: sem dependências de Node ou de DOM.

import type { ConsistencyReport, GroundednessReport, LoopReport } from "@/types";
import { evidenciaSegura } from "./pii";

/** Limite de caracteres considerado nas comparações O(n·m). */
const LIMITE_COMPARACAO = 4000;

/** Normaliza texto para comparação semântica aproximada. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    // Remove diacríticos para que "execução" e "execucao" comparem como iguais.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s.,%-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Palavras muito frequentes que inflariam artificialmente a similaridade. */
const STOPWORDS = new Set([
  "a","o","e","de","do","da","dos","das","em","no","na","nos","nas","um","uma",
  "para","por","com","sem","que","se","ao","aos","as","os","ou","como","mais",
  "the","of","and","to","in","is","are","for","on","with","as","at","by","an",
]);

export function tokenizar(texto: string, removerStopwords = true): string[] {
  const brutos = normalizar(texto).split(" ").filter(Boolean);
  return removerStopwords ? brutos.filter((t) => !STOPWORDS.has(t)) : brutos;
}

/** Gera n-gramas de palavras. */
export function ngramas(tokens: string[], n: number): string[] {
  if (n <= 1) return [...tokens];
  if (tokens.length < n) return tokens.length > 0 ? [tokens.join(" ")] : [];

  const saida: string[] = [];
  for (let i = 0; i <= tokens.length - n; i += 1) {
    saida.push(tokens.slice(i, i + n).join(" "));
  }
  return saida;
}

/** Índice de Jaccard entre dois conjuntos de termos (0..1). */
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersecao = 0;
  for (const item of setA) {
    if (setB.has(item)) intersecao += 1;
  }
  return intersecao / (setA.size + setB.size - intersecao);
}

/**
 * Distância de Levenshtein com duas linhas de buffer (O(min(n,m)) de memória).
 * Entradas são truncadas em `LIMITE_COMPARACAO` para manter o custo previsível
 * mesmo com respostas muito longas de LLM.
 */
export function levenshtein(a: string, b: string): number {
  const s = a.slice(0, LIMITE_COMPARACAO);
  const t = b.slice(0, LIMITE_COMPARACAO);
  if (s === t) return 0;
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;

  let anterior = new Array<number>(t.length + 1);
  let atual = new Array<number>(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) anterior[j] = j;

  for (let i = 1; i <= s.length; i += 1) {
    atual[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const custo = s[i - 1] === t[j - 1] ? 0 : 1;
      atual[j] = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo);
    }
    const troca = anterior;
    anterior = atual;
    atual = troca;
  }

  return anterior[t.length];
}

/** Razão de similaridade por edição (0..1). */
export function levenshteinRatio(a: string, b: string): number {
  const s = normalizar(a).slice(0, LIMITE_COMPARACAO);
  const t = normalizar(b).slice(0, LIMITE_COMPARACAO);
  const maior = Math.max(s.length, t.length);
  if (maior === 0) return 1;
  return 1 - levenshtein(s, t) / maior;
}

/**
 * Similaridade combinada entre duas respostas (0..1).
 *
 * Mistura três sinais porque cada um falha sozinho:
 *  - Jaccard de unigramas: pega vocabulário, ignora ordem;
 *  - Jaccard de trigramas: pega estrutura de frase;
 *  - Levenshtein: pega reescritas superficiais.
 */
export function similaridade(a: string, b: string): number {
  const tokensA = tokenizar(a);
  const tokensB = tokenizar(b);

  const unigrama = jaccard(tokensA, tokensB);
  const trigrama = jaccard(ngramas(tokensA, 3), ngramas(tokensB, 3));
  const edicao = levenshteinRatio(a, b);

  return 0.45 * unigrama + 0.35 * trigrama + 0.2 * edicao;
}

/**
 * Extrai valores numéricos relevantes de um texto.
 *
 * Números são o vetor mais comum de alucinação confiante: um LLM que divergiu
 * em um valor entre duas amostras provavelmente inventou os dois.
 */
export function extrairNumeros(texto: string): string[] {
  // A primeira alternativa exige ao menos um grupo de milhar: com `*` ela
  // casaria apenas os três primeiros dígitos de "4500", truncando o valor.
  const achados = texto.match(/-?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?%?|-?\d+(?:[.,]\d+)?%?/g) ?? [];
  return achados
    .map((bruto) => {
      const percentual = bruto.endsWith("%");
      const limpo = bruto.replace("%", "");
      const ultimaVirgula = limpo.lastIndexOf(",");
      const ultimoPonto = limpo.lastIndexOf(".");
      let normalizado = limpo;
      if (ultimaVirgula > ultimoPonto) {
        normalizado = limpo.replace(/\./g, "").replace(",", ".");
      } else if (ultimoPonto > ultimaVirgula) {
        normalizado = limpo.replace(/,/g, "");
      }
      const valor = Number(normalizado);
      if (!Number.isFinite(valor)) return null;
      // Ignora inteiros pequenos: quase sempre são numeração de lista, não fato.
      if (!percentual && Number.isInteger(valor) && Math.abs(valor) < 10) return null;
      return `${valor}${percentual ? "%" : ""}`;
    })
    .filter((v): v is string => v !== null);
}

/**
 * Checagem de consistência estocástica (self-consistency).
 *
 * Executa o mesmo nó k vezes e mede se o modelo converge. Baixa similaridade
 * média indica resposta não determinada pelos dados — o padrão da alucinação.
 * O medoide (amostra mais próxima de todas as outras) é escolhido como
 * consenso, o que é mais robusto a um outlier do que pegar a primeira amostra.
 */
export function avaliarConsistencia(amostras: string[]): ConsistencyReport {
  const validas = amostras.filter((a) => typeof a === "string" && a.trim().length > 0);

  if (validas.length === 0) {
    return {
      similaridadeMedia: 0,
      desvioPadrao: 0,
      indiceConsenso: 0,
      consenso: "",
      numerosDivergentes: [],
      amostras: 0,
    };
  }

  if (validas.length === 1) {
    // Uma única amostra não permite medir convergência; é tratada como neutra.
    return {
      similaridadeMedia: 1,
      desvioPadrao: 0,
      indiceConsenso: 0,
      consenso: validas[0],
      numerosDivergentes: [],
      amostras: 1,
    };
  }

  const n = validas.length;
  const somaPorAmostra = new Array<number>(n).fill(0);
  const pares: number[] = [];

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const score = similaridade(validas[i], validas[j]);
      pares.push(score);
      somaPorAmostra[i] += score;
      somaPorAmostra[j] += score;
    }
  }

  const media = pares.reduce((acc, v) => acc + v, 0) / pares.length;
  const variancia = pares.reduce((acc, v) => acc + (v - media) ** 2, 0) / pares.length;

  let indiceConsenso = 0;
  for (let i = 1; i < n; i += 1) {
    if (somaPorAmostra[i] > somaPorAmostra[indiceConsenso]) indiceConsenso = i;
  }

  // Números presentes em algumas amostras mas ausentes em outras.
  const conjuntos = validas.map((a) => new Set(extrairNumeros(a)));
  const todos = new Set<string>();
  conjuntos.forEach((c) => c.forEach((v) => todos.add(v)));
  const divergentes = [...todos].filter((valor) => conjuntos.some((c) => !c.has(valor)));

  return {
    similaridadeMedia: Number(media.toFixed(4)),
    desvioPadrao: Number(Math.sqrt(variancia).toFixed(4)),
    indiceConsenso,
    consenso: validas[indiceConsenso],
    numerosDivergentes: divergentes.slice(0, 12),
    amostras: n,
  };
}


/**
 * Avalia fundamentação (groundedness) da saída contra o contexto fornecido.
 *
 * Verificação determinística e conservadora: considera apenas afirmações
 * objetivamente checáveis — números, percentuais, datas e nomes próprios. Texto
 * opinativo não é penalizado, porque não é falsificável a partir do contexto.
 */
export function avaliarFundamentacao(saida: string, contextos: string[]): GroundednessReport {
  const contextoUnico = contextos.join("\n");
  const contextoNormalizado = normalizar(contextoUnico);
  const numerosContexto = new Set(extrairNumeros(contextoUnico));
  const tokensContexto = new Set(tokenizar(contextoUnico, false));

  const afirmacoes: Array<{ texto: string; suportada: boolean }> = [];

  // 1. Valores numéricos: devem existir no contexto.
  for (const numero of new Set(extrairNumeros(saida))) {
    afirmacoes.push({ texto: numero, suportada: numerosContexto.has(numero) });
  }

  // 2. Nomes próprios e entidades compostas.
  //
  // O regex evita deliberadamente lookbehind: um literal com `(?<!...)` lança
  // SyntaxError no carregamento do módulo em runtimes mais antigos, derrubando
  // a página inteira. O descarte de início de período é feito em código.
  const entidades = new Set<string>();
  const regexEntidade = /[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][\p{L}\p{N}]{2,}(?:\s+[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][\p{L}\p{N}]{2,})*/gu;
  let m: RegExpExecArray | null;
  while ((m = regexEntidade.exec(saida)) !== null) {
    const bruta = m[0].trim();
    if (bruta.length < 4) continue;
    if (entidades.size >= 40) break;

    // A capitalização no início de um período é gramatical, não sinal de entidade.
    const anterior = saida.slice(Math.max(0, m.index - 2), m.index);
    if (m.index === 0 || /[.!?]\s$/.test(anterior) || /^\s*$/.test(anterior)) continue;

    entidades.add(bruta);
  }

  for (const entidade of entidades) {
    const normalizada = normalizar(entidade);
    const suportada =
      contextoNormalizado.includes(normalizada) ||
      // Entidade composta é aceita se todos os seus termos aparecem no contexto.
      normalizada.split(" ").every((parte) => tokensContexto.has(parte));
    afirmacoes.push({ texto: entidade, suportada });
  }

  // 3. Datas explícitas.
  const datas = saida.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  for (const data of new Set(datas)) {
    afirmacoes.push({ texto: data, suportada: contextoUnico.includes(data) });
  }

  if (afirmacoes.length === 0) {
    // Nada verificável: não há evidência de alucinação nem de fundamentação.
    return { score: 1, afirmacoesSemSuporte: [], afirmacoesAvaliadas: 0 };
  }

  const semSuporte = afirmacoes.filter((a) => !a.suportada);
  return {
    score: Number(((afirmacoes.length - semSuporte.length) / afirmacoes.length).toFixed(4)),
    afirmacoesSemSuporte: semSuporte.slice(0, 10).map((a) => evidenciaSegura(a.texto, 60)),
    afirmacoesAvaliadas: afirmacoes.length,
  };
}

/**
 * Detecta repetição degenerada na saída — o sintoma textual de um loop.
 *
 * A métrica é a fração de n-gramas DUPLICADOS (`1 − únicos/total`), não a
 * frequência do n-grama mais comum: essa segunda forma é limitada por
 * `1/tamanho_da_frase`, de modo que um texto repetindo a mesma sentença doze
 * vezes pontuaria apenas ~0,13 e passaria por qualquer limite razoável.
 *
 * Dois sinais são combinados, porque falham em casos diferentes:
 *  - n-gramas duplicados: pega o modelo preso reescrevendo a mesma frase;
 *  - linhas idênticas: pega listas e JSON gerados em laço.
 */
export function detectarRepeticao(texto: string, tamanhoNgrama = 6): number {
  const tokens = tokenizar(texto, false);
  if (tokens.length < tamanhoNgrama * 3) return 0;

  const grupos = ngramas(tokens, tamanhoNgrama);
  if (grupos.length === 0) return 0;

  const taxaNgrama = 1 - new Set(grupos).size / grupos.length;

  // Linhas não vazias repetidas.
  const linhas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 12);
  let taxaLinha = 0;
  if (linhas.length >= 4) {
    taxaLinha = 1 - new Set(linhas).size / linhas.length;
  }

  return Number(Math.max(taxaNgrama, taxaLinha).toFixed(4));
}

/**
 * Detecta loop no grafo de execução a partir do trace de nós visitados.
 *
 * Captura dois padrões:
 *  - um nó visitado mais vezes que o permitido (contador simples);
 *  - um ciclo repetido (ex.: validar → corrigir → validar → corrigir), que
 *    pode respeitar o limite por nó e ainda assim nunca terminar.
 */
export function detectarCicloNo(trace: string[], maxVisitasPorNo: number): LoopReport {
  const relatorio: LoopReport = { taxaRepeticao: 0 };
  if (trace.length === 0) return relatorio;

  const visitas = new Map<string, number>();
  for (const no of trace) {
    visitas.set(no, (visitas.get(no) ?? 0) + 1);
  }

  for (const [no, contagem] of visitas) {
    if (contagem > maxVisitasPorNo) {
      relatorio.noEmLoop = no;
      relatorio.visitasNo = contagem;
      break;
    }
  }

  // Busca o menor padrão que se repete ao menos duas vezes no fim do trace.
  const maiorPadrao = Math.floor(trace.length / 2);
  for (let tamanho = 1; tamanho <= Math.min(maiorPadrao, 6); tamanho += 1) {
    const fim = trace.slice(trace.length - tamanho);
    const anterior = trace.slice(trace.length - 2 * tamanho, trace.length - tamanho);
    if (fim.length === tamanho && fim.every((no, i) => no === anterior[i])) {
      relatorio.ciclo = fim;
      break;
    }
  }

  return relatorio;
}

/**
 * Padrões de tentativa de sequestro de instrução (prompt injection).
 *
 * Cobre a superfície mais explorada: sobrescrita de instrução, exfiltração do
 * prompt de sistema, falsos delimitadores de papel e ofuscação por base64.
 */
const PADROES_INJECAO: Array<{ padrao: RegExp; descricao: string }> = [
  {
    padrao: /\b(?:ignor[ae]|desconsidere|esque[çc]a|disregard|forget)\b[^.\n]{0,40}\b(?:instru[çc][õo]es|regras|anteriores|acima|previous|prior|rules)\b/i,
    descricao: "tentativa de sobrescrever instruções anteriores",
  },
  {
    padrao: /\b(?:revele|mostre|imprima|repita|reveal|show|print|repeat)\b[^.\n]{0,40}\b(?:system prompt|prompt de sistema|suas instru[çc][õo]es|your instructions)\b/i,
    descricao: "tentativa de exfiltrar o prompt de sistema",
  },
  {
    padrao: /\b(?:you are now|a partir de agora voc[êe] [ée]|act as|atue como)\b[^.\n]{0,40}\b(?:dan|sem restri[çc][õo]es|unrestricted|jailbreak|developer mode|modo desenvolvedor)\b/i,
    descricao: "tentativa de troca de persona sem restrições",
  },
  {
    padrao: /(?:^|\n)\s*(?:system|assistant|usuario|user)\s*[:>]\s*/i,
    descricao: "delimitador de papel falsificado no conteúdo",
  },
  {
    padrao: /<\/?(?:system|instructions|im_start|im_end)>/i,
    descricao: "tag de controle de conversa injetada",
  },
  {
    padrao: /\b[A-Za-z0-9+/]{200,}={0,2}\b/,
    descricao: "bloco base64 extenso — possível payload ofuscado",
  },
];

export interface DeteccaoInjecao {
  suspeito: boolean;
  descricoes: string[];
}

export function detectarPromptInjection(texto: string): DeteccaoInjecao {
  const descricoes: string[] = [];
  for (const { padrao, descricao } of PADROES_INJECAO) {
    if (padrao.test(texto)) descricoes.push(descricao);
  }
  return { suspeito: descricoes.length > 0, descricoes };
}
