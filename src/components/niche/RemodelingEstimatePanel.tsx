"use client";

// Remodeling Estimate Panel — US Construction & Remodeling Contractors
// (EUA/Flórida).
//
// Painel PURO, mesmo desenho de `BuyerQualificationPanel`: deriva tudo de
// `InboxModuleContext` + dos extratores de
// `@/lib/server/usConstructionRemodeling`, sem coleção própria no Firestore.
//
// A faixa de estimativa é SEMPRE rotulada "preliminary" — nunca um
// orçamento fechado: a IA continua proibida de comunicar preço final na
// própria conversa pelo guardrail de Proteção de Caixa
// (`bloquearPromessaComercialNaoAutorizada`, reusado de
// `POLITICA_IMOBILIARIO_ALTO_PADRAO`). Este painel só instrumenta a decisão
// do operador humano — ele decide se e como repassar o número ao cliente.

import { useMemo } from "react";
import type { InboxModuleContext } from "@/modules/types";
import {
  detectEstimateVisitRequest,
  detectUrgency,
  estimatePreliminaryRange,
  extractMappedObjection,
  extractProjectType,
  extractSquareFootageFromMessages,
  extractStatedBudget,
} from "@/lib/server/usConstructionRemodeling";
import { Button } from "@/components/ui/Button";

function formatUsd(valor: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    valor
  );
}

export function RemodelingEstimatePanel({
  mensagensClienteRecentes,
  ultimaMensagemCliente,
  inserirNaResposta,
}: InboxModuleContext) {
  const mensagens = useMemo(
    () => mensagensClienteRecentes ?? (ultimaMensagemCliente ? [ultimaMensagemCliente] : []),
    [mensagensClienteRecentes, ultimaMensagemCliente]
  );

  const projeto = useMemo(() => extractProjectType(mensagens), [mensagens]);
  const squareFootage = useMemo(() => extractSquareFootageFromMessages(mensagens), [mensagens]);
  const statedBudget = useMemo(() => extractStatedBudget(mensagens), [mensagens]);
  const objection = useMemo(() => extractMappedObjection(mensagens), [mensagens]);
  const urgent = useMemo(() => mensagens.some((texto) => detectUrgency(texto)), [mensagens]);
  const visitRequested = useMemo(() => mensagens.some((texto) => detectEstimateVisitRequest(texto)), [mensagens]);

  const range = useMemo(
    () => estimatePreliminaryRange(projeto?.type ?? null, squareFootage),
    [projeto, squareFootage]
  );

  function handleInsertEstimateMessage() {
    if (!range || !projeto) return;
    inserirNaResposta(
      `Based on what you've shared, a preliminary ballpark for a ${projeto.label.toLowerCase()} ` +
        `around ${squareFootage} sq ft is typically between ${formatUsd(range.minUsd)} and ${formatUsd(range.maxUsd)}. ` +
        "This is a preliminary estimate only, not a final quote — our estimator will confirm exact pricing after an on-site visit."
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Preliminary estimate</h3>
          <p className="mt-0.5 text-xs text-ink-400">Project qualification &amp; ballpark pricing (US market)</p>
        </div>
        {urgent && (
          <span className="rounded-full bg-state-run-bg px-2.5 py-1 text-[11px] font-medium text-state-run">
            Urgent — prioritize follow-up
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2">
          <span className="text-xs text-ink-500">Project type</span>
          <span className="text-sm text-ink-950">{projeto?.label ?? "Not identified yet"}</span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2">
          <span className="text-xs text-ink-500">Square footage mentioned</span>
          <span className="mono text-sm text-ink-950">{squareFootage ? `${squareFootage} sq ft` : "Not mentioned yet"}</span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2">
          <span className="text-xs text-ink-500">Budget stated by client</span>
          <span className="text-sm text-ink-950">{statedBudget ?? "Not mentioned yet"}</span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2">
          <span className="text-xs text-ink-500">Objection detected</span>
          <span className="text-sm text-ink-950">{objection ?? "None"}</span>
        </div>
      </div>

      {range ? (
        <p className="mono rounded-[var(--radius-sm)] border border-signal-500/30 bg-signal-50 px-3 py-2 text-sm text-signal-700">
          Preliminary range: {formatUsd(range.minUsd)} – {formatUsd(range.maxUsd)} (not a final quote)
        </p>
      ) : (
        <p className="text-xs text-ink-400">
          Need both the project type and the square footage mentioned in the chat to compute a preliminary range.
        </p>
      )}

      {visitRequested && (
        <p className="rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 px-3 py-2 text-xs text-ink-500">
          On-site estimate visit requested — scheduling is the recommended next step.
        </p>
      )}

      <Button size="sm" variant="secondary" disabled={!range} onClick={handleInsertEstimateMessage}>
        Insert preliminary estimate message
      </Button>
    </section>
  );
}

export default RemodelingEstimatePanel;
