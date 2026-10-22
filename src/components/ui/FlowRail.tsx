import { cn } from "@/lib/utils";
import type { FlowRunStep } from "@/types";

const nodeClasses: Record<FlowRunStep["status"], string> = {
  concluido: "bg-state-done-ink",
  "em-execucao": "bg-state-run-ink ring-4 ring-state-run-bg",
  ociosa: "bg-ink-200",
  falhou: "bg-state-error-ink",
};

const titleClasses: Record<FlowRunStep["status"], string> = {
  concluido: "text-ink-950",
  "em-execucao": "text-ink-950",
  ociosa: "text-ink-400",
  falhou: "text-state-error",
};

/** Trilho de fluxo — visualização passo-a-passo reaproveitada em Fluxos e Execuções. */
export function FlowRail({ steps }: { steps: FlowRunStep[] }) {
  return (
    <div>
      {steps.map((step, i) => (
        <div key={step.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={cn("h-2.5 w-2.5 flex-none rounded-full", nodeClasses[step.status])} />
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "w-px flex-1",
                  step.status === "concluido" ? "bg-state-done-ink" : "bg-ink-100"
                )}
                style={{ minHeight: 24 }}
              />
            )}
          </div>
          <div className="pb-4">
            <p className={cn("text-[13px] font-medium", titleClasses[step.status])}>{step.titulo}</p>
            {step.timestamp && (
              <p className="mono text-xs text-ink-400">
                {step.timestamp}
                {step.duracaoMs ? ` · ${step.duracaoMs}ms` : ""}
              </p>
            )}
            {step.status === "em-execucao" && !step.timestamp && (
              <p className="mono text-xs text-state-run">em andamento</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
