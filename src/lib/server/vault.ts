// Uso de credenciais seladas — exclusivamente server-side.
//
// SERVER-ONLY. Não existe e nunca deve existir rota HTTP que exponha o
// resultado destas funções: elas devolvem segredo em claro.
//
// O consumidor previsto é o motor de orquestração, que já opera com o Admin SDK
// e é a única parte do sistema autorizada a ler `credentialSecrets` (ver
// `firestore.rules`, onde a leitura dessa coleção é negada a todo cliente). Este
// módulo recebe o envelope já carregado; ele não acessa o banco, para que a
// responsabilidade de autorização fique num só lugar.

import type { SealedSecret } from "@/types";
import { abrirSegredo, montarAad } from "@/lib/crypto/envelope";
import { sha256Hex } from "@/lib/crypto/digest";
import { comparacaoSegura } from "@/lib/crypto/encoding";
import { assertServidor } from "./env";

export interface ReferenciaCredencial {
  workspaceId: string;
  credentialId: string;
  versao: number;
}

function aadDaCredencial(referencia: ReferenciaCredencial): string {
  return montarAad({
    workspaceId: referencia.workspaceId,
    recursoId: referencia.credentialId,
    versao: referencia.versao,
    proposito: "credencial",
  });
}

/**
 * Decifra uma credencial.
 *
 * Prefira `usarCredencial`: esta função devolve o segredo em claro, e um valor
 * em claro que circula entre camadas tende a acabar em um log.
 */
export async function abrirCredencial(
  envelope: SealedSecret,
  referencia: ReferenciaCredencial
): Promise<string> {
  assertServidor();
  return abrirSegredo(envelope, aadDaCredencial(referencia));
}

/**
 * Executa uma operação com a credencial decifrada em escopo controlado.
 *
 * O segredo existe apenas durante `operacao`. Qualquer exceção é re-lançada com
 * mensagem sanitizada: se o segredo tiver vazado para o texto do erro (comum em
 * clientes HTTP que ecoam a URL com token em query string), ele é removido
 * antes de propagar.
 */
export async function usarCredencial<T>(
  envelope: SealedSecret,
  referencia: ReferenciaCredencial,
  operacao: (segredo: string) => Promise<T>
): Promise<T> {
  assertServidor();
  const segredo = await abrirCredencial(envelope, referencia);

  try {
    return await operacao(segredo);
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    const sanitizada = mensagem.split(segredo).join("[CREDENCIAL_REDIGIDA]");
    const novoErro = new Error(sanitizada);
    novoErro.name = erro instanceof Error ? erro.name : "Error";
    throw novoErro;
  }
}

/**
 * Confere se um segredo candidato corresponde ao envelope, sem decifrá-lo.
 *
 * Usado na rotação para detectar que o operador colou a mesma chave de novo —
 * rotação que não troca o valor dá falsa sensação de segurança.
 */
export async function mesmoSegredo(envelope: SealedSecret, candidato: string): Promise<boolean> {
  assertServidor();
  const fingerprint = (await sha256Hex(candidato)).slice(0, 16);
  return comparacaoSegura(fingerprint, envelope.fingerprint);
}
