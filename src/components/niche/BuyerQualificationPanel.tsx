"use client";

// Buyer Qualification Panel — US Luxury Real Estate (Miami/Orlando).
//
// Deliberadamente SEM assinatura própria do Firestore: diferente dos demais
// painéis de nicho, este é um painel PURO — deriva tudo de
// `InboxModuleContext` (já entregue pela Neural Inbox) e dos extratores
// determinísticos de `@/lib/server/usRealEstateLuxury`, sem nenhuma coleção
// própria. Mesma filosofia de "No Invention" dos demais: um sinal ausente
// aparece como "Not mentioned yet", nunca inventado.
//
// A integração real com portais de listagem (MLS/Zillow/Realtor.com) é
// trabalho futuro via Connect Hub — ver cabeçalho de
// `@/lib/server/usRealEstateLuxury`.

import { useMemo } from "react";
import type { InboxModuleContext } from "@/modules/types";
import {
  detectShowingRequest,
  extractBudgetRange,
  extractMappedObjection,
  extractProofOfFundsSignal,
  extractPropertyInterest,
} from "@/lib/server/usRealEstateLuxury";
import { Button } from "@/components/ui/Button";

function Signal({ label, value, strong }: { label: string; value: string | null; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2">
      <span className="text-xs text-ink-500">{label}</span>
      <span className={strong && value ? "text-sm font-semibold text-state-done" : "text-sm text-ink-950"}>
        {value ?? "Not mentioned yet"}
      </span>
    </div>
  );
}

export function BuyerQualificationPanel({
  conversaSelecionada,
  mensagensClienteRecentes,
  inserirNaResposta,
}: InboxModuleContext) {
  const mensagens = useMemo(() => mensagensClienteRecentes ?? [], [mensagensClienteRecentes]);

  const proofOfFunds = useMemo(() => extractProofOfFundsSignal(mensagens), [mensagens]);
  const budgetRange = useMemo(() => extractBudgetRange(mensagens), [mensagens]);
  const propertyInterest = useMemo(() => extractPropertyInterest(mensagens), [mensagens]);
  const objection = useMemo(() => extractMappedObjection(mensagens), [mensagens]);
  const showingRequested = useMemo(() => mensagens.some((texto) => detectShowingRequest(texto)), [mensagens]);

  const qualified = Boolean(proofOfFunds);

  function handleInsertQualificationNote() {
    const partes = [
      "Thanks for sharing that!",
      proofOfFunds ? `I have you down as a qualified buyer (${proofOfFunds.toLowerCase()}).` : null,
      showingRequested ? "I'll get a showing scheduled and follow up shortly with available times." : null,
    ].filter(Boolean);
    inserirNaResposta(partes.join(" "));
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Buyer qualification</h3>
          <p className="mt-0.5 text-xs text-ink-400">
            {conversaSelecionada ? conversaSelecionada.nome : "No conversation selected"} · financial-capacity
            screening (US luxury market)
          </p>
        </div>
        <span
          className={
            qualified
              ? "rounded-full bg-state-done-bg px-2.5 py-1 text-[11px] font-medium text-state-done"
              : "rounded-full bg-state-idle-bg px-2.5 py-1 text-[11px] font-medium text-state-idle"
          }
        >
          {qualified ? "Financially qualified" : "Not yet qualified"}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <Signal label="Proof of funds / pre-approval" value={proofOfFunds} strong />
        <Signal label="Budget range mentioned" value={budgetRange} />
        <Signal label="Property/neighborhood interest" value={propertyInterest} />
        <Signal label="Objection detected" value={objection} />
      </div>

      {showingRequested && (
        <p className="rounded-[var(--radius-sm)] border border-signal-500/30 bg-signal-50 px-3 py-2 text-xs text-signal-700">
          Showing requested — scheduling a visit is the recommended next step.
        </p>
      )}

      <Button size="sm" variant="secondary" onClick={handleInsertQualificationNote}>
        Insert qualification note
      </Button>
    </section>
  );
}

export default BuyerQualificationPanel;
