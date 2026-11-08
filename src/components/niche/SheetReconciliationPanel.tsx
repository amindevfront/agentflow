"use client";

// Sheet Reconciliation — Conciliação de Planilhas via IA.
//
// Widget integrado à Neural Inbox: lê as mensagens recentes do cliente,
// detecta uma atualização candidata (`extrairAtualizacaoRegistro`) e
// mostra o DIFF contra o registro já salvo — a aplicação em si é sempre um
// clique do operador (ver cabeçalho de `@/lib/sheetReconciliation`).
//
// `TABELA_PADRAO`: esta versão reconcilia uma única tabela operacional
// genérica ("registros-atendimento") por workspace — seleção de múltiplas
// tabelas/planilhas nomeadas é trabalho futuro (UI de configuração
// dedicada), mesma honestidade de escopo já aplicada a outras gavetas desta
// expansão.

import { useEffect, useMemo, useState } from "react";
import type { InboxModuleContext } from "@/modules/types";
import type { RegistroOperacional } from "@/types";
import { useWorkspace } from "@/lib/workspace";
import { auth } from "@/lib/firebase";
import {
  buscarRegistroPorChave,
  calcularDiffReconciliacao,
  extrairAtualizacaoRegistro,
  subscribeRegistrosOperacionais,
  upsertRegistroOperacional,
} from "@/lib/sheetReconciliation";
import { Button } from "@/components/ui/Button";

const TABELA_PADRAO = "registros-atendimento";

export function SheetReconciliationPanel({ mensagensClienteRecentes, ultimaMensagemCliente }: InboxModuleContext) {
  const { workspaceId } = useWorkspace();
  const [registros, setRegistros] = useState<RegistroOperacional[]>([]);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeRegistrosOperacionais(TABELA_PADRAO, setRegistros, workspaceId);
  }, [workspaceId]);

  const mensagens = useMemo(
    () => mensagensClienteRecentes ?? (ultimaMensagemCliente ? [ultimaMensagemCliente] : []),
    [mensagensClienteRecentes, ultimaMensagemCliente]
  );

  const atualizacaoDetectada = useMemo(() => {
    for (const texto of mensagens) {
      const detectada = extrairAtualizacaoRegistro(TABELA_PADRAO, texto);
      if (detectada) return detectada;
    }
    return null;
  }, [mensagens]);

  const registroAtual = atualizacaoDetectada ? buscarRegistroPorChave(registros, atualizacaoDetectada.chave) : null;
  const diffs = atualizacaoDetectada ? calcularDiffReconciliacao(registroAtual, atualizacaoDetectada) : [];

  async function handleAplicar() {
    if (!atualizacaoDetectada) return;
    setAplicando(true);
    setErro(null);
    try {
      await upsertRegistroOperacional({
        tabela: TABELA_PADRAO,
        chave: atualizacaoDetectada.chave,
        camposAtualizados: atualizacaoDetectada.camposAtualizados,
        registroAtual,
        workspaceId: workspaceId ?? undefined,
      });
      const usuario = auth?.currentUser;
      if (usuario) {
        await fetch("/api/back-office/ganho-operacional", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${await usuario.getIdToken()}` },
          body: JSON.stringify({ origem: "sheet-reconciliation", descricao: `Registro ${atualizacaoDetectada.chave} reconciliado` }),
        }).catch(() => undefined);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível aplicar a reconciliação.");
    } finally {
      setAplicando(false);
    }
  }

  if (!atualizacaoDetectada) return null;

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Conciliação de registro detectada</h3>
          <p className="mt-0.5 text-xs text-ink-400">
            Registro <span className="mono">{atualizacaoDetectada.chave}</span>
            {registroAtual ? " — atualização" : " — novo registro"}
          </p>
        </div>
      </div>

      {diffs.length === 0 ? (
        <p className="text-xs text-ink-400">Nenhuma diferença contra o registro já salvo.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {diffs.map((diff) => (
            <li key={diff.campo} className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-1.5 text-xs">
              <span className="font-medium text-ink-700">{diff.campo}</span>
              <span className="mono text-ink-400">
                {diff.valorAntigo ?? "—"} → <span className="text-ink-950">{diff.valorNovo}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      <Button size="sm" variant="secondary" disabled={diffs.length === 0} loading={aplicando} onClick={handleAplicar}>
        Aplicar atualização
      </Button>
    </section>
  );
}

export default SheetReconciliationPanel;
