// Logging estruturado — base da telemetria de falhas (ver ADR-0004).
//
// Sem provedor externo configurado (Sentry/Datadog), o destino é `console.*`
// — mas em formato JSON de uma linha, não texto livre. Isso é o que faz a
// diferença entre "log que humano lê" e "log que uma ferramenta de
// observabilidade (Vercel Logs, Cloud Logging, qualquer agregador que
// faça parsing de JSON por linha) consegue indexar, filtrar e alertar" —
// trocar o destino no futuro (um `fetch` para um endpoint de telemetria) é
// uma mudança local a este arquivo, não uma reescrita de todo call site.

export type NivelLog = "debug" | "info" | "warn" | "error";

export interface RegistroLog {
  nivel: NivelLog;
  mensagem: string;
  timestamp: string;
  /** Módulo/fluxo de origem — ex.: "auth", "onboarding", "neural-inbox". */
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
    mensagem,
    timestamp: new Date().toISOString(),
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

function registrar(
  nivel: NivelLog,
  mensagem: string,
  opcoes?: { contexto?: string; dados?: Record<string, unknown> }
): RegistroLog {
  const registro = formatarRegistro(nivel, mensagem, opcoes);
  CONSOLE_POR_NIVEL[nivel](JSON.stringify(registro));
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
