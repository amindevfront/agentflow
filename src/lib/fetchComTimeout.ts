// `fetch` com timeout — lado cliente.
//
// Converte tanto a rejeição de rede crua (`TypeError: Failed to fetch`)
// quanto o estouro do prazo (`AbortError`) na mesma mensagem amigável fixa
// que o chamador escolhe — nunca um erro técnico bruto chega à tela do dono
// do negócio, e nenhuma chamada fica pendurada para sempre numa rede
// instável ou um servidor que nunca responde.

export async function fetchComTimeout(
  url: string,
  init: RequestInit,
  mensagemFalha: string,
  timeoutMs: number
): Promise<Response> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controlador.signal });
  } catch {
    throw new Error(mensagemFalha);
  } finally {
    clearTimeout(temporizador);
  }
}
