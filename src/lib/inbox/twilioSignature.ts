// Validação de assinatura Twilio (`X-Twilio-Signature`) — SERVER-ONLY.
//
// Depende de `node:crypto`, por isso vive separada de
// `./channelAdapters` (que `gerarWidgetEmbedSnippet` expõe a um componente
// de cliente em Conectores — importar `node:crypto` ali quebraria o bundle
// do navegador). Esta validação só é chamada pela rota de API do webhook da
// Twilio (`src/app/api/inbox/webhook/twilio/route.ts`), que já roda em
// `runtime = "nodejs"`.

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Valida a assinatura `X-Twilio-Signature` de um webhook.
 *
 * Algoritmo publicamente documentado pela Twilio: HMAC-SHA1 do Auth Token
 * sobre a URL completa seguida dos parâmetros POST, ORDENADOS alfabeticamente
 * por chave (nome+valor concatenados, sem separador entre pares), em Base64.
 * Comparação em tempo constante — mesma defesa de `validarAssinaturaMeta`
 * no webhook do Meta.
 *
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validarAssinaturaTwilio(
  urlCompleta: string,
  parametros: Record<string, string>,
  authToken: string,
  assinaturaRecebida: string
): boolean {
  const chavesOrdenadas = Object.keys(parametros).sort();
  const dadosParaAssinar = urlCompleta + chavesOrdenadas.map((chave) => `${chave}${parametros[chave]}`).join("");
  const esperada = createHmac("sha1", authToken).update(dadosParaAssinar, "utf8").digest("base64");

  const bufferRecebido = Buffer.from(assinaturaRecebida);
  const bufferEsperado = Buffer.from(esperada);
  if (bufferRecebido.length !== bufferEsperado.length) return false;
  return timingSafeEqual(bufferRecebido, bufferEsperado);
}
