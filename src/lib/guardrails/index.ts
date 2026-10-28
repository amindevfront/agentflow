// Motor de Guardrails & Validação Semântica — fachada pública.
//
// Ponto único de entrada do módulo. Importe sempre `@/lib/guardrails`, nunca os
// submódulos diretamente, para que a superfície pública possa evoluir sem
// quebrar os consumidores.
//
// Fluxo de uma chamada protegida:
//
//   payload bruto
//     → inspecionarEntrada  (mascara PII, barra injeção, valida tamanho)
//     → executor do LLM     (recebe APENAS o payload mascarado)
//     → inspecionarSaida    (consistência, fundamentação, loop, vazamento)
//     → re-hidratação       (placeholders voltam a ser valores reais)
//
// Garantia central: o executor nunca recebe PII em claro, e o cofre que sabe
// traduzir placeholder → valor real nunca sai do processo.

import type {
  GuardrailPolicy,
  GuardrailSeverity,
  GuardrailVerdict,
  GuardrailViolation,
  InboundInspection,
  OutboundInspection,
  PiiKind,
} from "@/types";
import {
  avaliarConsistencia,
  avaliarFundamentacao,
  detectarCicloNo,
  detectarPromptInjection,
  detectarRepeticao,
} from "./consistency";
import { PiiVault, maskPayload, maskText } from "./pii";
import { acaoPara, maiorSeveridade, resolverPolitica, vereditoMaisRestritivo } from "./policy";

export {
  PiiVault,
  evidenciaSegura,
  maskDeep,
  maskPayload,
  maskText,
  parseValorMonetario,
  validarCnpj,
  validarCpf,
  validarLuhn,
  ROTULO_POR_KIND,
  CLASSIFICACAO_POR_KIND,
} from "./pii";
export {
  avaliarConsistencia,
  avaliarFundamentacao,
  detectarCicloNo,
  detectarPromptInjection,
  detectarRepeticao,
  similaridade,
  tokenizar,
} from "./consistency";
export {
  POLITICA_NO_CRITICO,
  POLITICA_PADRAO,
  POLITICA_SANDBOX,
  POLITICAS_PREDEFINIDAS,
  maiorSeveridade,
  resolverPolitica,
} from "./policy";
export { detectarCompliancePreventivo } from "./compliancePreventivo";
export type { CompliancePreventivoResultado } from "./compliancePreventivo";

/** Gera um identificador de correlação. Usa UUID nativo quando disponível. */
export function novoTraceId(): string {
  const aleatorio =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `gr_${aleatorio}`;
}

function agora(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Deriva o veredito final a partir das violações e da política. */
function derivarVeredito(
  violacoes: GuardrailViolation[],
  politica: GuardrailPolicy,
  pisoVeredito: GuardrailVerdict
): { veredito: GuardrailVerdict; severidade: GuardrailSeverity } {
  if (violacoes.length === 0) {
    return { veredito: pisoVeredito, severidade: "info" };
  }

  const severidade = maiorSeveridade(violacoes.map((v) => v.severidade));
  let veredito = pisoVeredito;
  // Cada violação contribui com sua ação; a mais restritiva prevalece.
  for (const violacao of violacoes) {
    veredito = vereditoMaisRestritivo(veredito, acaoPara(politica, violacao.severidade));
  }

  return { veredito, severidade };
}

// ---------------------------------------------------------------------------
// Inspeção de entrada
// ---------------------------------------------------------------------------

export interface InspecaoEntradaInput {
  payload: string;
  /** Política base: objeto, id predefinido, ou ausente para a padrão. */
  politica?: GuardrailPolicy | string;
  sobrescritas?: Partial<GuardrailPolicy>;
  /** Cofre a reutilizar. Um novo é criado quando omitido. */
  vault?: PiiVault;
  traceId?: string;
}

export interface InspecaoEntradaResultado {
  inspecao: InboundInspection;
  /**
   * Cofre com os valores originais. NUNCA persista, serialize ou envie a
   * terceiros — use apenas para re-hidratar a saída do LLM.
   */
  vault: PiiVault;
}

/**
 * Inspeciona e sanitiza um payload antes de ele sair para uma API externa.
 *
 * Fail-closed por construção: se o mascaramento lançar, a função devolve
 * veredito `bloqueado` e payload vazio. É inaceitável deixar passar um payload
 * cujo mascaramento não pôde ser comprovado.
 */
export function inspecionarEntrada(entrada: InspecaoEntradaInput): InspecaoEntradaResultado {
  const inicio = agora();
  const traceId = entrada.traceId ?? novoTraceId();
  const politica = resolverPolitica(entrada.politica, entrada.sobrescritas);
  const vault = entrada.vault ?? new PiiVault();
  const violacoes: GuardrailViolation[] = [];
  const base = { traceId, direcao: "entrada" as const, politicaId: politica.id };

  try {
    const payload = typeof entrada.payload === "string" ? entrada.payload : "";

    if (payload.length > politica.maxCaracteresPayload) {
      violacoes.push({
        regra: "payload-excedido",
        severidade: "alta",
        mensagem: `Payload com ${payload.length} caracteres excede o limite de ${politica.maxCaracteresPayload}.`,
        score: payload.length,
        limite: politica.maxCaracteresPayload,
      });
    }

    // Recorta antes de processar: um payload gigante não deve consumir CPU
    // ilimitada só para ser rejeitado em seguida.
    const recortado = payload.slice(0, politica.maxCaracteresPayload);

    if (politica.detectarPromptInjection) {
      for (const descricao of detectarPromptInjection(recortado).descricoes) {
        violacoes.push({
          regra: "prompt-injection",
          severidade: "alta",
          mensagem: `Possível prompt injection: ${descricao}.`,
        });
      }
    }

    const mascaramento = politica.mascararPii
      ? maskPayload(recortado, vault, {
          piiPermitida: politica.piiPermitida,
          limiarValorSensivel: politica.limiarValorSensivel,
        })
      : {
          texto: recortado,
          matches: [],
          kindsDetectados: [] as PiiKind[],
          kindsMascarados: [] as PiiKind[],
        };

    if (mascaramento.kindsMascarados.includes("segredo-api")) {
      violacoes.push({
        regra: "segredo-em-payload",
        severidade: "critica",
        mensagem:
          "Credencial detectada no payload de entrada. Credenciais devem vir do cofre Zero-Trust, nunca embutidas no dado do fluxo.",
      });
    }

    const outrasPii = mascaramento.kindsMascarados.filter((k) => k !== "segredo-api");
    if (outrasPii.length > 0) {
      violacoes.push({
        regra: "pii-entrada",
        severidade: politica.critico ? "media" : "baixa",
        mensagem: `Dados pessoais mascarados antes do envio externo: ${outrasPii.join(", ")}.`,
        score: mascaramento.matches.length,
      });
    }

    // O piso é `mascarado` quando houve substituição: ainda que nenhuma regra
    // escale, o payload foi alterado e o registro precisa dizer isso.
    const piso: GuardrailVerdict = mascaramento.matches.length > 0 ? "mascarado" : "permitido";
    const { veredito, severidade } = derivarVeredito(violacoes, politica, piso);

    return {
      inspecao: {
        ...base,
        veredito,
        severidadeMaxima: severidade,
        violacoes,
        payloadSanitizado: veredito === "bloqueado" ? "" : mascaramento.texto,
        piiDetectada: mascaramento.kindsDetectados,
        totalOcorrenciasPii: mascaramento.matches.length,
        duracaoMs: Math.round(agora() - inicio),
      },
      vault,
    };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return {
      inspecao: {
        ...base,
        veredito: "bloqueado",
        severidadeMaxima: "critica",
        violacoes: [
          {
            regra: "erro-interno-guardrail",
            severidade: "critica",
            mensagem: `Falha ao sanitizar a entrada — execução bloqueada por precaução: ${mensagem}`,
          },
        ],
        payloadSanitizado: "",
        piiDetectada: [],
        totalOcorrenciasPii: 0,
        duracaoMs: Math.round(agora() - inicio),
      },
      vault,
    };
  }
}

// ---------------------------------------------------------------------------
// Inspeção de saída
// ---------------------------------------------------------------------------

export interface InspecaoSaidaInput {
  /**
   * Amostras retornadas pelo LLM. Uma única amostra desativa a checagem
   * estocástica; `politica.amostrasConsistencia` define quantas são esperadas.
   */
  amostras: string[];
  /** Trechos de contexto que sustentam a resposta (RAG, dados do fluxo). */
  contextos?: string[];
  /** Nós visitados nesta execução, em ordem — base da detecção de ciclo. */
  trace?: string[];
  /** Cofre devolvido por `inspecionarEntrada`, usado na re-hidratação. */
  vault: PiiVault;
  politica?: GuardrailPolicy | string;
  sobrescritas?: Partial<GuardrailPolicy>;
  traceId?: string;
  /** Tokens consumidos acumulados, para checagem de orçamento. */
  tokensUsados?: number;
}

/**
 * Inspeciona a saída do LLM antes de ela voltar ao fluxo.
 *
 * Três famílias de verificação:
 *  1. **Estocástica** — amostras divergentes indicam resposta não determinada
 *     pelos dados (alucinação).
 *  2. **Determinística** — fundamentação contra o contexto, repetição
 *     degenerada, ciclo no grafo, orçamento de tokens.
 *  3. **Vazamento** — PII que reapareceu na saída e placeholders forjados.
 */
export function inspecionarSaida(entrada: InspecaoSaidaInput): OutboundInspection {
  const inicio = agora();
  const traceId = entrada.traceId ?? novoTraceId();
  const politica = resolverPolitica(entrada.politica, entrada.sobrescritas);
  const violacoes: GuardrailViolation[] = [];
  const base = { traceId, direcao: "saida" as const, politicaId: politica.id };

  try {
    const amostras = (entrada.amostras ?? []).filter((a) => typeof a === "string");
    if (amostras.length === 0) {
      return {
        ...base,
        veredito: "bloqueado",
        severidadeMaxima: "alta",
        violacoes: [
          {
            regra: "erro-interno-guardrail",
            severidade: "alta",
            mensagem: "Nenhuma saída foi produzida pelo modelo — nada a validar.",
          },
        ],
        saidaFinal: "",
        saidaMascarada: "",
        duracaoMs: Math.round(agora() - inicio),
      };
    }

    // 1. Consistência estocástica.
    const consistencia = avaliarConsistencia(amostras);
    const escolhida = consistencia.consenso;

    if (amostras.length > 1 && consistencia.similaridadeMedia < politica.minConsistencia) {
      violacoes.push({
        regra: "inconsistencia-estocastica",
        severidade: politica.critico ? "critica" : "alta",
        mensagem: `Respostas divergentes entre ${consistencia.amostras} amostras (similaridade ${consistencia.similaridadeMedia.toFixed(2)}).`,
        score: consistencia.similaridadeMedia,
        limite: politica.minConsistencia,
      });
    }

    if (consistencia.numerosDivergentes.length > 0) {
      violacoes.push({
        regra: "numero-nao-fundamentado",
        severidade: politica.critico ? "alta" : "media",
        mensagem: `Valores numéricos presentes em algumas amostras e ausentes em outras: ${consistencia.numerosDivergentes.join(", ")}.`,
        score: consistencia.numerosDivergentes.length,
      });
    }

    // 2. Fundamentação contra o contexto fornecido.
    const contextos = entrada.contextos ?? [];
    let fundamentacao;
    if (politica.exigirFundamentacao) {
      if (contextos.length === 0) {
        violacoes.push({
          regra: "alucinacao-sem-fundamento",
          severidade: "alta",
          mensagem:
            "Política exige fundamentação, mas nenhum contexto foi fornecido — não há como verificar a resposta.",
        });
      } else {
        fundamentacao = avaliarFundamentacao(escolhida, contextos);
        if (fundamentacao.score < politica.minGroundedness) {
          violacoes.push({
            regra: "alucinacao-sem-fundamento",
            severidade: politica.critico ? "critica" : "alta",
            mensagem: `Fundamentação de ${(fundamentacao.score * 100).toFixed(0)}% abaixo do mínimo exigido. Sem suporte no contexto: ${fundamentacao.afirmacoesSemSuporte.join("; ")}.`,
            score: fundamentacao.score,
            limite: politica.minGroundedness,
          });
        }
      }
    }

    // 3. Loop: repetição textual e ciclo no grafo de execução.
    const taxaRepeticao = detectarRepeticao(escolhida);
    const loopNo = detectarCicloNo(entrada.trace ?? [], politica.maxVisitasPorNo);
    const loop = { ...loopNo, taxaRepeticao };

    if (taxaRepeticao > politica.maxRepeticaoNgram) {
      violacoes.push({
        regra: "loop-repeticao",
        severidade: "alta",
        mensagem: `Saída com repetição degenerada (${(taxaRepeticao * 100).toFixed(0)}% de n-gramas repetidos) — indício de loop de geração.`,
        score: taxaRepeticao,
        limite: politica.maxRepeticaoNgram,
      });
    }

    if (loop.noEmLoop) {
      violacoes.push({
        regra: "loop-ciclo-no",
        severidade: "critica",
        mensagem: `O nó "${loop.noEmLoop}" foi visitado ${loop.visitasNo} vezes, acima do limite de ${politica.maxVisitasPorNo}.`,
        score: loop.visitasNo,
        limite: politica.maxVisitasPorNo,
      });
    } else if (loop.ciclo && loop.ciclo.length > 0) {
      violacoes.push({
        regra: "loop-ciclo-no",
        severidade: "alta",
        mensagem: `Ciclo repetido no fluxo: ${loop.ciclo.join(" → ")}.`,
      });
    }

    // 4. Orçamento de tokens.
    if (politica.orcamentoTokens !== undefined && (entrada.tokensUsados ?? 0) > politica.orcamentoTokens) {
      violacoes.push({
        regra: "orcamento-tokens",
        severidade: "alta",
        mensagem: `Consumo de ${entrada.tokensUsados} tokens excede o orçamento de ${politica.orcamentoTokens} desta execução.`,
        score: entrada.tokensUsados,
        limite: politica.orcamentoTokens,
      });
    }

    // 5. Vazamento de PII na saída.
    //
    // Reaparecimento de PII na resposta significa que o modelo a reconstruiu a
    // partir de outra fonte, ou que o mascaramento da entrada foi incompleto.
    // Em ambos os casos é um achado de severidade alta.
    const cofreSaida = new PiiVault();
    let saidaMascarada: string;
    try {
      const resultado = maskText(escolhida, cofreSaida, {
        piiPermitida: politica.piiPermitida,
        limiarValorSensivel: politica.limiarValorSensivel,
      });
      saidaMascarada = resultado.texto;

      if (resultado.kindsMascarados.length > 0) {
        violacoes.push({
          regra: "pii-vazamento-saida",
          severidade: politica.bloquearPiiNaSaida ? "critica" : "media",
          mensagem: `Dados pessoais presentes na saída do modelo: ${resultado.kindsMascarados.join(", ")}.`,
          score: resultado.matches.length,
        });
      }
    } finally {
      cofreSaida.clear();
    }

    // Placeholder que o cofre não reconhece = o modelo inventou um token de
    // mascaramento. Re-hidratá-lo seria impossível e confiar nele, perigoso.
    const forjados = entrada.vault.placeholdersDesconhecidos(escolhida);
    if (forjados.length > 0) {
      violacoes.push({
        regra: "schema-invalido",
        severidade: "alta",
        mensagem: `A saída contém placeholders de mascaramento desconhecidos: ${forjados.join(", ")}.`,
      });
    }

    const { veredito, severidade } = derivarVeredito(violacoes, politica, "permitido");

    // Re-hidratação só acontece se a saída foi liberada. Em transbordo ou
    // bloqueio, o fluxo recebe a versão mascarada — o operador humano decide.
    const liberada = veredito === "permitido" || veredito === "mascarado";
    const saidaFinal = liberada ? entrada.vault.restore(escolhida) : saidaMascarada;

    return {
      ...base,
      veredito,
      severidadeMaxima: severidade,
      violacoes,
      saidaFinal,
      saidaMascarada,
      consistencia,
      fundamentacao,
      loop,
      duracaoMs: Math.round(agora() - inicio),
    };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    // Fail-closed em nó crítico, transbordo nos demais: uma falha do próprio
    // motor não pode resultar em entrega silenciosa de conteúdo não validado.
    return {
      ...base,
      veredito: politica.critico ? "bloqueado" : "transbordo",
      severidadeMaxima: "critica",
      violacoes: [
        {
          regra: "erro-interno-guardrail",
          severidade: "critica",
          mensagem: `Falha ao validar a saída: ${mensagem}`,
        },
      ],
      saidaFinal: "",
      saidaMascarada: "",
      duracaoMs: Math.round(agora() - inicio),
    };
  }
}

// ---------------------------------------------------------------------------
// Middleware de interceptação
// ---------------------------------------------------------------------------

/**
 * Pedido de revisão humana emitido pelo motor.
 *
 * Deliberadamente não traz o cofre nem o payload bruto: tudo que chega ao
 * operador já está mascarado. Consumido por `@/lib/humanInTheLoop`.
 */
export interface SolicitacaoTransbordo {
  traceId: string;
  politicaId: string;
  nodeId?: string;
  severidade: GuardrailSeverity;
  veredito: GuardrailVerdict;
  violacoes: GuardrailViolation[];
  payloadMascarado: string;
  saidaMascarada?: string;
}

/** Função que efetivamente chama o provedor de LLM. */
export type ExecutorLlm = (payloadSanitizado: string, tentativa: number) => Promise<string>;

export interface ChamadaProtegidaInput {
  payload: string;
  executor: ExecutorLlm;
  contextos?: string[];
  trace?: string[];
  nodeId?: string;
  politica?: GuardrailPolicy | string;
  sobrescritas?: Partial<GuardrailPolicy>;
  tokensUsados?: number;
  traceId?: string;
  /** Invocado quando o veredito exige revisão humana ou bloqueio. */
  aoTransbordar?: (solicitacao: SolicitacaoTransbordo) => Promise<void> | void;
}

export interface ChamadaProtegidaResultado {
  traceId: string;
  entrada: InboundInspection;
  saida: OutboundInspection | null;
  /** Resultado liberado para o fluxo, ou `null` se bloqueado/em transbordo. */
  resultado: string | null;
  bloqueado: boolean;
  transbordo: boolean;
}

/**
 * Executa uma chamada de LLM sob guardrails de entrada e de saída.
 *
 * Em nós com `amostrasConsistencia > 1`, o executor é chamado k vezes para
 * medir convergência. Amostras que falham individualmente são descartadas sem
 * derrubar a chamada — só a ausência total de amostras é fatal.
 *
 * O cofre de PII é sempre limpo em `finally`, inclusive no caminho de exceção.
 */
export async function guardarChamadaLlm(
  entrada: ChamadaProtegidaInput
): Promise<ChamadaProtegidaResultado> {
  const traceId = entrada.traceId ?? novoTraceId();
  const politica = resolverPolitica(entrada.politica, entrada.sobrescritas);

  const { inspecao: entradaInspecionada, vault } = inspecionarEntrada({
    payload: entrada.payload,
    politica,
    traceId,
  });

  try {
    if (entradaInspecionada.veredito === "bloqueado" || entradaInspecionada.veredito === "transbordo") {
      await notificarTransbordo(entrada.aoTransbordar, {
        traceId,
        politicaId: politica.id,
        nodeId: entrada.nodeId,
        severidade: entradaInspecionada.severidadeMaxima,
        veredito: entradaInspecionada.veredito,
        violacoes: entradaInspecionada.violacoes,
        payloadMascarado: entradaInspecionada.payloadSanitizado,
      });

      return {
        traceId,
        entrada: entradaInspecionada,
        saida: null,
        resultado: null,
        bloqueado: entradaInspecionada.veredito === "bloqueado",
        transbordo: entradaInspecionada.veredito === "transbordo",
      };
    }

    const totalAmostras = Math.max(1, politica.amostrasConsistencia);
    const amostras: string[] = [];
    const falhas: string[] = [];

    for (let tentativa = 1; tentativa <= totalAmostras; tentativa += 1) {
      try {
        const bruta = await entrada.executor(entradaInspecionada.payloadSanitizado, tentativa);
        if (typeof bruta === "string" && bruta.trim().length > 0) amostras.push(bruta);
      } catch (erro) {
        falhas.push(erro instanceof Error ? erro.message : String(erro));
      }
    }

    const saidaInspecionada = inspecionarSaida({
      amostras,
      contextos: entrada.contextos,
      trace: entrada.trace,
      vault,
      politica,
      traceId,
      tokensUsados: entrada.tokensUsados,
    });

    // Falhas parciais do provedor entram no registro: elas explicam uma
    // amostragem menor do que a configurada, o que afeta a confiança do veredito.
    if (falhas.length > 0) {
      saidaInspecionada.violacoes.push({
        regra: "erro-interno-guardrail",
        severidade: amostras.length === 0 ? "critica" : "baixa",
        mensagem: `${falhas.length} de ${totalAmostras} chamadas ao provedor falharam: ${falhas.join("; ")}`,
      });
    }

    const bloqueado = saidaInspecionada.veredito === "bloqueado";
    const transbordo = saidaInspecionada.veredito === "transbordo";

    if (bloqueado || transbordo) {
      await notificarTransbordo(entrada.aoTransbordar, {
        traceId,
        politicaId: politica.id,
        nodeId: entrada.nodeId,
        severidade: saidaInspecionada.severidadeMaxima,
        veredito: saidaInspecionada.veredito,
        violacoes: saidaInspecionada.violacoes,
        payloadMascarado: entradaInspecionada.payloadSanitizado,
        saidaMascarada: saidaInspecionada.saidaMascarada,
      });
    }

    return {
      traceId,
      entrada: entradaInspecionada,
      saida: saidaInspecionada,
      resultado: bloqueado || transbordo ? null : saidaInspecionada.saidaFinal,
      bloqueado,
      transbordo,
    };
  } finally {
    // O cofre contém PII em claro: seu tempo de vida termina aqui, sempre.
    vault.clear();
  }
}

/**
 * Entrega a solicitação de transbordo sem permitir que uma falha no canal de
 * notificação propague. O veredito do guardrail já está decidido; perder a
 * notificação é um incidente de observabilidade, não motivo para reverter a
 * proteção e deixar o conteúdo passar.
 */
async function notificarTransbordo(
  handler: ChamadaProtegidaInput["aoTransbordar"],
  solicitacao: SolicitacaoTransbordo
): Promise<void> {
  if (!handler) return;
  try {
    await handler(solicitacao);
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    console.error(`[guardrails] falha ao acionar transbordo (trace ${solicitacao.traceId}):`, mensagem);
  }
}
