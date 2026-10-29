// "Dopamina Financeira" — indicador vivo de valor recuperado em tempo real.
//
// Usado no `acao` de um `MetricCard` quando o robô acaba de concluir algo com
// valor financeiro real por trás (ex.: conversa de alta intenção comercial
// resolvida fora do expediente). O pulso só aparece quando há valor > 0 — ele
// nunca pisca "zero", o que destruiria o próprio efeito de recompensa.

import { cn } from "@/lib/utils";

interface PulseBadgeProps {
  label: string;
  className?: string;
}

export function PulseBadge({ label, className }: PulseBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-state-done-ink/30 bg-state-done-bg px-2 py-0.5",
        className
      )}
    >
      <span aria-hidden className="dopamina-pulse h-1.5 w-1.5 rounded-full bg-state-done-ink" />
      <span className="mono text-[11px] font-medium text-state-done">{label}</span>
    </span>
  );
}

export default PulseBadge;
