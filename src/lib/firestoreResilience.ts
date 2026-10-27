// Degradação graciosa para consultas em tempo real que exigem índice
// composto — nenhuma view do app pode travar ou mostrar erro cru do
// Firestore só porque um índice ainda não foi criado.
//
// Estratégia, em ordem:
//   1. Assina a consulta "real" (com `where` + `orderBy`/múltiplos `where`).
//   2. Se ela falhar por índice ausente (`isMissingIndexError`), loga o link
//      de criação em dev (`logIndiceAusente`) e troca, sem round-trip
//      manual, para uma consulta de fallback equivalente mas sem a parte que
//      exige o índice — o chamador informa ambas as consultas e como
//      ordenar o resultado do fallback em memória.
//   3. Qualquer outro erro (permissão, rede, serviço indisponível) nunca
//      propaga para a UI: degrada para lista vazia, igual ao padrão já
//      usado em `inbox/firestore.ts`, `humanInTheLoop.ts`, `credentials.ts`
//      e `auditLog.ts` — este módulo só uniformiza esse padrão e adiciona o
//      caminho específico de índice ausente.

import { onSnapshot, type Query, type QueryDocumentSnapshot, type QuerySnapshot, type Unsubscribe } from "firebase/firestore";
import { codigoErroFirestore, isMissingIndexError, logIndiceAusente } from "./firestoreErrors";

interface OpcoesFallbackIndice<T> {
  /** Consulta "real", com a ordenação/filtros que podem exigir índice composto. */
  consultaPrincipal: Query;
  /** Consulta equivalente, mas simplificada a ponto de nunca exigir índice composto. */
  consultaFallback: Query;
  mapearDoc: (doc: QueryDocumentSnapshot) => T;
  /** Aplicada ao resultado do fallback, para repor a ordenação que a consulta simplificada não tem mais. */
  ordenarFallback: (lista: T[]) => T[];
  onChange: (lista: T[]) => void;
  /** Identifica a assinatura nos logs (ex.: "flows", "inbox:conversas"). */
  contexto: string;
  /**
   * Chamado só para erro IRRECUPERÁVEL (não é índice ausente — esse caso nem
   * chega aqui, é absorvido pelo fallback). Nunca inclui a mensagem crua do
   * Firestore como argumento, deliberadamente: quem consome este callback
   * deve mostrar um texto amigável fixo, nunca `erro.message` (ver
   * requisito de nunca expor erro técnico na UI).
   */
  aoFalharDeFormaIrrecuperavel?: () => void;
}

export function assinarComFallbackDeIndice<T>(opcoes: OpcoesFallbackIndice<T>): Unsubscribe {
  const { consultaPrincipal, consultaFallback, mapearDoc, ordenarFallback, onChange, contexto, aoFalharDeFormaIrrecuperavel } = opcoes;
  let cancelado = false;
  let unsubscribeAtual: Unsubscribe = () => {};

  function mapear(snap: QuerySnapshot): T[] {
    return snap.docs.map(mapearDoc);
  }

  function assinarFallback(): void {
    unsubscribeAtual = onSnapshot(
      consultaFallback,
      (snap) => {
        if (cancelado) return;
        onChange(ordenarFallback(mapear(snap)));
      },
      (erro) => {
        if (cancelado) return;
        console.error(
          `[${contexto}] falha ao assinar mesmo na consulta de fallback (sem índice composto), código ${codigoErroFirestore(erro)}:`,
          erro
        );
        onChange([]);
        aoFalharDeFormaIrrecuperavel?.();
      }
    );
  }

  unsubscribeAtual = onSnapshot(
    consultaPrincipal,
    (snap) => {
      if (cancelado) return;
      onChange(mapear(snap));
    },
    (erro) => {
      if (cancelado) return;
      if (isMissingIndexError(erro)) {
        logIndiceAusente(erro, contexto);
        unsubscribeAtual();
        assinarFallback();
        return;
      }
      console.error(`[${contexto}] falha ao assinar, código ${codigoErroFirestore(erro)}:`, erro);
      onChange([]);
      aoFalharDeFormaIrrecuperavel?.();
    }
  );

  return () => {
    cancelado = true;
    unsubscribeAtual();
  };
}
