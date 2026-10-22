import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type TomMetrica = "neutro" | "positivo" | "atencao" | "erro" | "marca";

/**
 * Cartão de métrica — superfície plana, borda de 1px, sem gradiente ou glass,
 * conforme a regra de elevação do design system. Nenhum token novo é
 * introduzido: cores, raios e sombras vêm de `globals.css`.
 */
const tomValor: Record<TomMetrica, string> = {
  neutro: "text-ink-950",
  positivo: "text-state-done",
  atencao: "text-state-run",
  erro: "text-state-error",
  marca: "text-signal-700",
};

interface MetricCardProps {
  rotulo: string;
  valor: string;
  /** Linha de contexto sob o valor: base de cálculo, comparação ou ressalva. */
  detalhe?: string;
  tom?: TomMetrica;
  /** Texto longo exibido no `title` nativo — explica como o número é obtido. */
  dica?: string;
  acao?: ReactNode;
}

export function MetricCard({ rotulo, valor, detalhe, tom = "neutro", dica, acao }: MetricCardProps) {
  return (
    <div
      title={dica}
      className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4 shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-ink-500">{rotulo}</span>
        {acao}
      </div>
      {/* Mono é reservada a valores reais — um número de métrica é um deles. */}
      <strong className={cn("mono text-2xl font-medium leading-tight", tomValor[tom])}>{valor}</strong>
      {detalhe && <span className="text-xs text-ink-400">{detalhe}</span>}
    </div>
  );
}
