// Selo "Zero-Trust Active · AES-256-GCM" — barra superior da Governança e do Workspace.
//
// Decorativo com base em fato, não em promessa vazia: o envelope encryption
// AES-256-GCM é real (`@/lib/crypto/envelope.ts`, usado por `/api/vault/seal`
// e `/api/audit/seal`) e o mascaramento de PII roda em 100% das chamadas de
// LLM (`@/lib/guardrails`). Nenhuma cor, raio ou sombra nova — só os tokens já
// definidos em `globals.css`.

export function ZeroTrustBadge() {
  return (
    <span
      title="Mascaramento de PII em toda chamada de IA + envelope encryption AES-256-GCM em repouso."
      className="hidden items-center gap-1.5 rounded-full border border-ink-100 bg-white px-2.5 py-1 sm:inline-flex"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-state-done-ink" />
      <span className="text-[11px] font-medium text-ink-700">Zero-Trust Active</span>
      <span className="mono text-[11px] text-ink-400">AES-256-GCM</span>
    </span>
  );
}

export default ZeroTrustBadge;
