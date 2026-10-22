// Tipos do Motor de Guardrails & Validação Semântica.
//
// Camada de domínio compartilhada entre o motor (`src/lib/guardrails/`), o
// transbordo humano (`src/lib/humanInTheLoop.ts`), a trilha de auditoria
// (`src/lib/auditLog.ts`) e a UI de governança. Isomórfico: nenhum tipo aqui
// depende de APIs de browser ou de Node.

/** Categorias de dado pessoal/sensível reconhecidas pelos detectores. */
export type PiiKind =
  | "cpf"
  | "cnpj"
  | "email"
  | "telefone"
  | "cep"
  | "cartao-credito"
  | "chave-pix"
  | "rg"
  | "conta-bancaria"
  | "valor-financeiro"
  | "segredo-api"
  | "ip";

/** Base legal/classificação LGPD de cada categoria — usada na trilha de auditoria. */
export type PiiClassificacao = "identificador-pessoal" | "financeiro" | "contato" | "credencial" | "tecnico";

export type GuardrailSeverity = "info" | "baixa" | "media" | "alta" | "critica";

/**
 * Veredito final de uma inspeção.
 * - `permitido`: segue sem alteração
 * - `mascarado`: segue, porém com PII substituída por placeholders
 * - `transbordo`: exige revisão humana antes de prosseguir (Human-in-the-Loop)
 * - `bloqueado`: interrompe a execução do nó
 */
export type GuardrailVerdict = "permitido" | "mascarado" | "transbordo" | "bloqueado";

/** Direção do tráfego inspecionado. */
export type GuardrailDirection = "entrada" | "saida";

export type GuardrailRuleId =
  | "pii-entrada"
  | "pii-vazamento-saida"
  | "segredo-em-payload"
  | "prompt-injection"
  | "alucinacao-sem-fundamento"
  | "numero-nao-fundamentado"
  | "inconsistencia-estocastica"
  | "loop-repeticao"
  | "loop-ciclo-no"
  | "schema-invalido"
  | "payload-excedido"
  | "orcamento-tokens"
  | "erro-interno-guardrail"
  /** Radar de sentimento da Neural Inbox: usado em `GuardrailViolation` de tickets de frustração crítica. */
  | "frustracao-critica";

export interface GuardrailViolation {
  regra: GuardrailRuleId;
  severidade: GuardrailSeverity;
  mensagem: string;
  /** Trecho de evidência — SEMPRE já mascarado. Nunca contém PII em claro. */
  evidencia?: string;
  /** Score observado (0..1) quando a regra é quantitativa. */
  score?: number;
  /** Limite configurado que foi violado. */
  limite?: number;
}

/** Ocorrência individual de PII localizada em um texto. */
export interface PiiMatch {
  kind: PiiKind;
  classificacao: PiiClassificacao;
  inicio: number;
  fim: number;
  placeholder: string;
  /** Tamanho do valor original — preservado para telemetria sem vazar o valor. */
  tamanho: number;
}

export interface ConsistencyReport {
  /** Similaridade média par-a-par entre as amostras (0..1). */
  similaridadeMedia: number;
  /** Desvio padrão da similaridade — alta variância indica resposta instável. */
  desvioPadrao: number;
  /** Índice da amostra medoide (a mais "central"), usada como consenso. */
  indiceConsenso: number;
  /** Amostra escolhida como resposta de consenso. */
  consenso: string;
  /** Conjuntos numéricos divergentes entre amostras — sinal forte de alucinação. */
  numerosDivergentes: string[];
  amostras: number;
}

export interface GroundednessReport {
  /** Proporção de afirmações verificáveis com suporte no contexto (0..1). */
  score: number;
  /** Afirmações sem suporte, já mascaradas. */
  afirmacoesSemSuporte: string[];
  afirmacoesAvaliadas: number;
}

export interface LoopReport {
  /** Maior taxa de repetição de n-gramas observada (0..1). */
  taxaRepeticao: number;
  /** Nó do fluxo que excedeu o número máximo de visitas, se houver. */
  noEmLoop?: string;
  visitasNo?: number;
  /** Ciclo detectado no trace de execução (ex.: ["validar", "corrigir", "validar"]). */
  ciclo?: string[];
}

export interface GuardrailPolicy {
  id: string;
  /** Nó do fluxo ao qual esta política se aplica. Ausente = política padrão. */
  nodeId?: string;
  /** Nós críticos usam fail-closed: erro interno do motor vira `bloqueado`. */
  critico: boolean;

  // --- PII / LGPD ---
  mascararPii: boolean;
  /** Categorias explicitamente liberadas (ex.: e-mail em fluxo de atendimento). */
  piiPermitida: PiiKind[];
  /** Acima deste valor (em reais), um valor monetário é tratado como sensível. */
  limiarValorSensivel: number;
  /** Bloqueia a resposta se PII reaparecer na saída do LLM. */
  bloquearPiiNaSaida: boolean;

  // --- Anti-alucinação ---
  exigirFundamentacao: boolean;
  /** Score mínimo de fundamentação aceitável (0..1). */
  minGroundedness: number;
  /** Similaridade mínima entre amostras em checagem estocástica (0..1). */
  minConsistencia: number;
  /** Quantas amostras coletar do LLM em nós críticos (1 = sem self-consistency). */
  amostrasConsistencia: number;

  // --- Anti-loop ---
  /** Taxa máxima de repetição de n-gramas tolerada na saída (0..1). */
  maxRepeticaoNgram: number;
  /** Número máximo de visitas ao mesmo nó dentro de uma execução. */
  maxVisitasPorNo: number;

  // --- Superfície de ataque ---
  detectarPromptInjection: boolean;
  /** Tamanho máximo do payload em caracteres. */
  maxCaracteresPayload: number;
  /** Orçamento de tokens por execução. Ausente = sem limite. */
  orcamentoTokens?: number;

  /** Mapa severidade → ação. Permite afrouxar/endurecer por nó. */
  acaoPorSeveridade: Record<GuardrailSeverity, GuardrailVerdict>;
}

export interface InboundInspection {
  traceId: string;
  direcao: "entrada";
  veredito: GuardrailVerdict;
  severidadeMaxima: GuardrailSeverity;
  violacoes: GuardrailViolation[];
  /** Payload já mascarado — este é o único texto que pode sair para APIs externas. */
  payloadSanitizado: string;
  piiDetectada: PiiKind[];
  totalOcorrenciasPii: number;
  duracaoMs: number;
  politicaId: string;
}

export interface OutboundInspection {
  traceId: string;
  direcao: "saida";
  veredito: GuardrailVerdict;
  severidadeMaxima: GuardrailSeverity;
  violacoes: GuardrailViolation[];
  /** Saída final entregue ao fluxo: re-hidratada se permitido, mascarada caso contrário. */
  saidaFinal: string;
  /** Saída com PII mascarada — segura para log, auditoria e ticket de transbordo. */
  saidaMascarada: string;
  consistencia?: ConsistencyReport;
  fundamentacao?: GroundednessReport;
  loop?: LoopReport;
  duracaoMs: number;
  politicaId: string;
}
