// Material criptográfico do servidor — Zero-Trust.
//
// ESTE MÓDULO NUNCA PODE SER IMPORTADO POR CÓDIGO DE CLIENTE.
//
// Toda variável lida aqui é intencionalmente SEM o prefixo `NEXT_PUBLIC_`:
// qualquer coisa com esse prefixo é embutida no bundle JavaScript e, portanto,
// pública. A chave-mestra existe apenas no processo do servidor; o browser
// recebe metadados e ciphertext, nunca a chave que os abre.
//
// `assertServidor()` é chamado em toda leitura: se este módulo for arrastado
// para um bundle de cliente por um import acidental, a falha é imediata e
// explícita, em vez de silenciosamente embutir um segredo no HTML.

import { base64UrlParaBytes } from "@/lib/crypto/encoding";
import { derivarSubchave } from "@/lib/crypto/digest";

/** Tamanho mínimo da chave-mestra: 32 bytes = 256 bits. */
const TAMANHO_MINIMO_CHAVE = 32;

export function assertServidor(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "Módulo server-only carregado no cliente. Isso indica um import indevido — " +
        "nenhum segredo do servidor pode alcançar o bundle do browser."
    );
  }
}

function lerVariavel(nome: string): string {
  assertServidor();
  const valor = process.env[nome];
  if (!valor || valor.trim().length === 0) {
    throw new Error(
      `Variável de ambiente ${nome} não configurada. ` +
        "Consulte .env.local.example — sem ela o cofre de credenciais e a trilha " +
        "de auditoria não podem operar."
    );
  }
  return valor.trim();
}

/** Versão corrente da chave-mestra, registrada em cada envelope. */
export function versaoChaveMestra(): string {
  assertServidor();
  return process.env.AGENTFLOW_VAULT_KEK_VERSION?.trim() || "v1";
}

let chaveMestraCache: Uint8Array | null = null;

/**
 * Chave-mestra (KEK) decodificada.
 *
 * Em produção, a origem recomendada é um gerenciador de segredos (Google Secret
 * Manager, AWS Secrets Manager) injetando a variável em tempo de deploy — não um
 * arquivo `.env` versionado.
 */
function chaveMestra(): Uint8Array {
  if (chaveMestraCache) return chaveMestraCache;

  const bruto = lerVariavel("AGENTFLOW_VAULT_KEK");
  let bytes: Uint8Array;
  try {
    bytes = base64UrlParaBytes(bruto);
  } catch {
    throw new Error("AGENTFLOW_VAULT_KEK não está em base64 válido.");
  }

  if (bytes.length < TAMANHO_MINIMO_CHAVE) {
    throw new Error(
      `AGENTFLOW_VAULT_KEK tem ${bytes.length} bytes; o mínimo é ${TAMANHO_MINIMO_CHAVE} (256 bits). ` +
        'Gere uma chave com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"'
    );
  }

  chaveMestraCache = bytes;
  return bytes;
}

// Subchaves derivadas por propósito via HKDF. Separar o material por contexto
// garante que comprometer a assinatura da auditoria não entregue a chave que
// decifra credenciais, e vice-versa.
const CONTEXTO_ENVELOPE = "vault/credential-kek/v1";
const CONTEXTO_AUDITORIA = "audit/hmac/v1";
const CONTEXTO_DETALHES = "audit/payload-kek/v1";

const cacheSubchaves = new Map<string, Uint8Array>();

async function subchave(contexto: string): Promise<Uint8Array> {
  assertServidor();
  const existente = cacheSubchaves.get(contexto);
  if (existente) return existente;

  const derivada = await derivarSubchave(chaveMestra(), contexto, 32);
  cacheSubchaves.set(contexto, derivada);
  return derivada;
}

/** KEK que envelopa as DEKs das credenciais. */
export function chaveEnvelope(): Promise<Uint8Array> {
  return subchave(CONTEXTO_ENVELOPE);
}

/** Chave de assinatura (HMAC) da trilha de auditoria. */
export function chaveAuditoria(): Promise<Uint8Array> {
  return subchave(CONTEXTO_AUDITORIA);
}

/** KEK que cifra os detalhes sensíveis das entradas de auditoria. */
export function chaveDetalhesAuditoria(): Promise<Uint8Array> {
  return subchave(CONTEXTO_DETALHES);
}

/** ID do projeto Firebase, usado na validação de `iss`/`aud` do ID token. */
export function projetoFirebase(): string {
  assertServidor();
  const valor =
    process.env.FIREBASE_PROJECT_ID?.trim() || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (!valor) {
    throw new Error(
      "FIREBASE_PROJECT_ID (ou NEXT_PUBLIC_FIREBASE_PROJECT_ID) não configurado — " +
        "sem ele não é possível validar o público do ID token."
    );
  }
  return valor;
}

/**
 * Diagnóstico de configuração, sem revelar valores.
 * Usado pela rota de verificação para dar uma mensagem acionável ao operador.
 */
export function diagnosticoCripto(): { pronto: boolean; faltando: string[] } {
  assertServidor();
  const faltando: string[] = [];

  if (!process.env.AGENTFLOW_VAULT_KEK?.trim()) {
    faltando.push("AGENTFLOW_VAULT_KEK");
  } else {
    try {
      if (base64UrlParaBytes(process.env.AGENTFLOW_VAULT_KEK.trim()).length < TAMANHO_MINIMO_CHAVE) {
        faltando.push("AGENTFLOW_VAULT_KEK (curta demais: mínimo 32 bytes)");
      }
    } catch {
      faltando.push("AGENTFLOW_VAULT_KEK (base64 inválido)");
    }
  }

  if (!process.env.FIREBASE_PROJECT_ID?.trim() && !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()) {
    faltando.push("FIREBASE_PROJECT_ID");
  }

  return { pronto: faltando.length === 0, faltando };
}

/** Modelo padrão do motor de orquestração — mesmo tier usado como referência em `@/lib/roi`. */
const MODELO_ORQUESTRADOR_PADRAO = "claude-sonnet-5";

/** Chave de API da Anthropic, usada pelo motor de orquestração real. */
export function chaveAnthropic(): string {
  return lerVariavel("ANTHROPIC_API_KEY");
}

/** Modelo configurado para o motor de orquestração, com padrão sensato. */
export function modeloOrquestrador(): string {
  assertServidor();
  return process.env.AGENTFLOW_ORCHESTRATOR_MODEL?.trim() || MODELO_ORQUESTRADOR_PADRAO;
}

/**
 * Diagnóstico do motor de orquestração — mesma filosofia de
 * \`diagnosticoCripto()\`: nunca lança, só relata o que falta, para que a rota
 * de execução responda 503 com uma mensagem acionável em vez de um erro 500
 * genérico no meio de uma chamada já iniciada ao provedor de LLM.
 */
export function diagnosticoOrquestrador(): { pronto: boolean; faltando: string[] } {
  assertServidor();
  const faltando: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    faltando.push("ANTHROPIC_API_KEY");
  }
  return { pronto: faltando.length === 0, faltando };
}
