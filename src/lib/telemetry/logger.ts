// Logging estruturado — base da telemetria de falhas (ver ADR-0004/ADR-0005).
//
// Sem provedor externo configurado (Sentry/Datadog/New Relic), o destino é
// `console.*` — mas em formato JSON de uma linha, não texto livre. Isso é o
// que faz a diferença entre "log que humano lê" e "log que uma ferramenta de
// observabilidade (Vercel Logs, Cloud Logging, qualquer agregador que faça
// parsing de JSON por linha) consegue indexar, filtrar e alertar".
//
// Dois campos existem especificamente para ingestão corporativa:
//   - `level`: alias em inglês de `nivel` — a maioria dos agentes (Datadog,
//     New Relic, Sentry) procura por padrão uma chave `level`/`severity`
//     em minúsculas; `nivel` continua existindo por fidelidade ao resto do
//     código em pt-BR, não é redundância descartável.
//   - `service`/`ambiente`: toda stack de observabilidade multi-serviço
//     filtra por origem — sem isso, os logs do AgentFlow se perderiam no
//     meio de outros serviços do mesmo projeto Datadog/New Relic.
//
// `definirSink` é o ponto de extensão: conectar um APM real (enviar via
// `fetch` para o endpoint do Sentry/Datadog, por exemplo) é uma mudança
// LOCAL a este arquivo — nenhum call site de `logger.*` muda.

export type NivelLog = "debug" | "info" | "warn" | "error";

const SERVICO = "agentflow";

function ambiente(): string {
  return process.env.NODE_ENV ?? "development";
}

export interface RegistroLog {
  nivel: NivelLog;
  /** Alias em inglês do mesmo valor de `nivel` — ver nota de topo do arquivo. */
  level: NivelLog;
  mensagem: string;
  timestamp: string;
  service: string;
  ambiente: string;
  /** Módulo/fluxo de origem — ex.: "auth", "onboarding", "neural-inbox", "performance". */
  contexto?: string;
  dados?: Record<string, unknown>;
}

/** Monta o registro estruturado — pura, sem I/O, para ser testável sem depender de `console`. */
export function formatarRegistro(
  nivel: NivelLog,
  mensagem: string,
  opcoes: { contexto?: string; dados?: Record<string, unknown> } = {}
): RegistroLog {
  return {
    nivel,
    level: nivel,
    mensagem,
    timestamp: new Date().toISOString(),
    service: SERVICO,
    ambiente: ambiente(),
    ...(opcoes.contexto ? { contexto: opcoes.contexto } : {}),
    ...(opcoes.dados ? { dados: serializavel(opcoes.dados) } : {}),
  };
}

/**
 * Garante que `dados` sempre sobrevive a um `JSON.stringify` — um valor
 * circular ou um `Error` bruto no meio do payload não pode derrubar o
 * próprio log que deveria estar reportando o problema.
 */
function serializavel(dados: Record<string, unknown>): Record<string, unknown> {
  const resultado: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(dados)) {
    if (valor instanceof Error) {
      resultado[chave] = { nome: valor.name, mensagem: valor.message, stack: valor.stack };
    } else {
      resultado[chave] = valor;
    }
  }
  try {
    JSON.stringify(resultado);
    return resultado;
  } catch {
    return { aviso: "dados não serializáveis omitidos" };
  }
}

const CONSOLE_POR_NIVEL: Record<NivelLog, (mensagem: string) => void> = {
  debug: (m) => console.debug(m),
  info: (m) => console.info(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

export type Sink = (registro: RegistroLog) => void;

const sinkConsole: Sink = (registro) => {
  CONSOLE_POR_NIVEL[registro.nivel](JSON.stringify(registro));
};

let sinkAtivo: Sink = sinkConsole;

/**
 * Troca o destino dos logs. Usado para conectar um APM real no futuro (ex.:
 * `definirSink((r) => fetch("https://http-intake.logs.datadoghq.com/...", {
 * method: "POST", body: JSON.stringify(r) }))`) sem alterar nenhum call site
 * de `logger.*`. Nunca lançar dentro de um sink customizado — uma falha ao
 * reportar não pode, em si, se tornar outro erro não tratado; o chamador do
 * sink é responsável por capturar os próprios erros de rede.
 */
export function definirSink(sink: Sink): void {
  sinkAtivo = sink;
}

/** Restaura o sink padrão (console estruturado) — usado em teste. */
export function restaurarSinkPadrao(): void {
  sinkAtivo = sinkConsole;
}

function registrar(
  nivel: NivelLog,
  mensagem: string,
  opcoes?: { contexto?: string; dados?: Record<string, unknown> }
): RegistroLog {
  const registro = formatarRegistro(nivel, mensagem, opcoes);
  sinkAtivo(registro);
  return registro;
}

export const logger = {
  debug: (mensagem: string, opcoes?: { contexto?: string; dados?: Record<string, unknown> }) =>
    registrar("debug", mensagem, opcoes),
  info: (mensagem: string, opcoes?: { contexto?: string; dados?: Record<string, unknown> }) =>
    registrar("info", mensagem, opcoes),
  warn: (mensagem: string, opcoes?: { contexto?: string; dados?: Record<string, unknown> }) =>
    registrar("warn", mensagem, opcoes),
  error: (mensagem: string, opcoes?: { contexto?: string; dados?: Record<string, unknown> }) =>
    registrar("error", mensagem, opcoes),
};
