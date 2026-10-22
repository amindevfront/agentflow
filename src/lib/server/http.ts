// Utilitários de Route Handler: autenticação, limite de taxa, erros e cabeçalhos.
//
// SERVER-ONLY.
//
// Centraliza o contrato de todas as rotas de API para que nenhuma delas esqueça
// de autenticar, limitar taxa ou impedir cache de resposta sensível.

import { ErroAutenticacao, autenticarRequisicao, type UsuarioAutenticado } from "./auth";
import { consumirLimiteDistribuido } from "./distributedRateLimit";
import { LIMITE_PADRAO, type ConfiguracaoLimite } from "./rateLimit";

/** Erro de domínio com status HTTP — lançado por handlers e traduzido aqui. */
export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly codigo = "erro_requisicao"
  ) {
    super(mensagem);
    this.name = "ErroApi";
  }
}

/**
 * Respostas de API nunca podem ser cacheadas: carregam material criptográfico e
 * dados escopados a um usuário específico.
 */
const CABECALHOS_SEGUROS: Record<string, string> = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export function respostaJson(dados: unknown, status = 200, extras: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { ...CABECALHOS_SEGUROS, ...extras },
  });
}

export function respostaErro(
  status: number,
  mensagem: string,
  codigo = "erro_requisicao",
  extras: Record<string, string> = {}
): Response {
  return respostaJson({ erro: { codigo, mensagem } }, status, extras);
}

export interface ContextoRota {
  usuario: UsuarioAutenticado;
  requisicao: Request;
}

export interface OpcoesGuarda {
  limite?: ConfiguracaoLimite;
  /** Sufixo da chave de limite, para separar orçamentos por rota. */
  escopoLimite?: string;
  /** Tamanho máximo do corpo em bytes. */
  maxBytesCorpo?: number;
}

const MAX_BYTES_PADRAO = 256 * 1024;

/**
 * Envolve um handler com autenticação, limite de taxa e tradução de erros.
 *
 * Mensagens de erro inesperado nunca chegam ao cliente: a mensagem original vai
 * para o log do servidor e o chamador recebe um texto genérico. Vazar o texto
 * de uma exceção interna entrega detalhes de implementação a quem sonda a API.
 */
export function comGuarda(
  handler: (contexto: ContextoRota) => Promise<Response>,
  opcoes: OpcoesGuarda = {}
): (requisicao: Request) => Promise<Response> {
  return async function rota(requisicao: Request): Promise<Response> {
    let usuario: UsuarioAutenticado;
    try {
      usuario = await autenticarRequisicao(requisicao);
    } catch (erro) {
      if (erro instanceof ErroAutenticacao) {
        return respostaErro(401, erro.message, "nao_autenticado");
      }
      console.error("[api] falha inesperada na autenticação:", erro);
      return respostaErro(503, "Serviço de autenticação indisponível.", "auth_indisponivel");
    }

    const chave = `${opcoes.escopoLimite ?? "api"}:${usuario.uid}`;
    const limite = await consumirLimiteDistribuido(chave, opcoes.limite ?? LIMITE_PADRAO);
    if (!limite.permitido) {
      return respostaErro(
        429,
        `Limite de requisições excedido. Tente novamente em ${limite.tentarEmSegundos}s.`,
        "limite_excedido",
        { "retry-after": String(limite.tentarEmSegundos) }
      );
    }

    const declarado = requisicao.headers.get("content-length");
    const maxBytes = opcoes.maxBytesCorpo ?? MAX_BYTES_PADRAO;
    if (declarado && Number(declarado) > maxBytes) {
      return respostaErro(413, `Corpo da requisição excede ${maxBytes} bytes.`, "corpo_grande");
    }

    try {
      return await handler({ usuario, requisicao });
    } catch (erro) {
      if (erro instanceof ErroApi) {
        return respostaErro(erro.status, erro.message, erro.codigo);
      }
      console.error("[api] erro não tratado:", erro);
      return respostaErro(500, "Erro interno ao processar a requisição.", "erro_interno");
    }
  };
}

/** Lê e valida o corpo JSON da requisição. */
export async function corpoJson<T = unknown>(requisicao: Request, maxBytes = MAX_BYTES_PADRAO): Promise<T> {
  const texto = await requisicao.text();
  if (texto.length === 0) {
    throw new ErroApi(400, "Corpo da requisição vazio.", "corpo_vazio");
  }
  if (texto.length > maxBytes) {
    throw new ErroApi(413, `Corpo da requisição excede ${maxBytes} bytes.`, "corpo_grande");
  }
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new ErroApi(400, "Corpo da requisição não é JSON válido.", "json_invalido");
  }
}

/** Valida que um campo é uma string não vazia dentro do tamanho permitido. */
export function exigirTexto(
  valor: unknown,
  campo: string,
  opcoes: { max?: number; min?: number } = {}
): string {
  const { max = 2048, min = 1 } = opcoes;
  if (typeof valor !== "string") {
    throw new ErroApi(400, `Campo "${campo}" deve ser texto.`, "campo_invalido");
  }
  const limpo = valor.trim();
  if (limpo.length < min) {
    throw new ErroApi(400, `Campo "${campo}" é obrigatório.`, "campo_obrigatorio");
  }
  if (limpo.length > max) {
    throw new ErroApi(400, `Campo "${campo}" excede ${max} caracteres.`, "campo_invalido");
  }
  return limpo;
}

/**
 * Valida um identificador usado em AAD ou em id de documento.
 * O conjunto restrito de caracteres impede injeção no separador do AAD e
 * caminhos inválidos no Firestore.
 */
export function exigirIdentificador(valor: unknown, campo: string): string {
  const texto = exigirTexto(valor, campo, { max: 128 });
  if (!/^[A-Za-z0-9_-]+$/.test(texto)) {
    throw new ErroApi(
      400,
      `Campo "${campo}" aceita apenas letras, números, hífen e sublinhado.`,
      "campo_invalido"
    );
  }
  return texto;
}
