"use client";

// Compliance Preventivo — blindagem trabalhista & LGPD.
//
// Não é um motor novo: é a composição de três peças já existentes, lida em
// conjunto porque numa auditoria elas são consultadas juntas.
//
//   1. Detecção de risco de assédio/promessa indevida em mensagens de
//      operadores e IA (`@/lib/guardrails/compliancePreventivo`), que abre
//      um ticket de transbordo com motivo "compliance-preventivo" — a fila
//      abaixo reaproveita o `HandoffQueuePanel` já construído, apenas
//      filtrado a este motivo.
//   2. Mascaramento de PII (CPF, senha, dados bancários) com placeholder
//      WORM-safe: o valor original nunca é persistido em claro — ver
//      `@/lib/guardrails/pii` e `@/lib/guardrails/piiVault`.
//   3. Trilha de auditoria imutável (hash encadeado + assinatura HMAC no
//      servidor) — `firestore.rules` nega update/delete em `auditLogs`,
//      que é a garantia WORM real, não uma convenção de UI.

import { HandoffQueuePanel } from "@/components/governance/HandoffQueuePanel";

export function CompliancePreventivoPanel() {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
        <h2 className="text-sm font-semibold text-ink-950">Compliance Preventivo</h2>
        <p className="text-xs text-ink-500">
          Toda mensagem enviada por operador ou IA na Neural Inbox é varrida por risco de assédio/conduta
          inadequada e promessa comercial ou financeira indevida antes de compor a trilha. Nenhuma mensagem é
          bloqueada por esta checagem — um alerta preventivo abre aqui para revisão humana, evitando que a
          conversa se torne evidência de um passivo trabalhista ou de propaganda enganosa (CDC art. 37).
        </p>
        <p className="text-xs text-ink-500">
          Dados pessoais (CPF, e-mail, senha, dados bancários) são sempre mascarados pelo Shield-Layer antes de
          qualquer persistência, e cada evento relevante é selado na trilha de auditoria imutável (aba{" "}
          <span className="font-medium text-ink-700">Auditoria</span>) — hash encadeado e assinatura HMAC
          calculados no servidor, com <code className="mono text-[11px]">firestore.rules</code> negando
          update/delete na coleção.
        </p>
      </section>

      <HandoffQueuePanel motivoFiltro={["compliance-preventivo"]} />
    </div>
  );
}

export default CompliancePreventivoPanel;
