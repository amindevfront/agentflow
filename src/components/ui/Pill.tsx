import { cn } from "@/lib/utils";
import type { ConnectorStatus, RunStatus } from "@/types";

type PillTone = "run" | "done" | "error" | "idle";

const TONE_BY_RUN_STATUS: Record<RunStatus, PillTone> = {
  "em-execucao": "run",
  concluido: "done",
  falhou: "error",
  ocioso: "idle",
};

const TONE_BY_CONNECTOR_STATUS: Record<ConnectorStatus, PillTone> = {
  conectado: "done",
  erro: "error",
  "nao-configurado": "idle",
};

const LABEL: Record<RunStatus | ConnectorStatus, string> = {
  "em-execucao": "em execução",
  concluido: "concluído",
  falhou: "falhou",
  ocioso: "ocioso",
  conectado: "conectado",
  erro: "erro",
  "nao-configurado": "não configurado",
};

const toneClasses: Record<PillTone, string> = {
  run: "bg-state-run-bg text-state-run",
  done: "bg-state-done-bg text-state-done",
  error: "bg-state-error-bg text-state-error",
  idle: "bg-state-idle-bg text-state-idle",
};

const dotClasses: Record<PillTone, string> = {
  run: "bg-state-run-ink",
  done: "bg-state-done-ink",
  error: "bg-state-error-ink",
  idle: "bg-state-idle",
};

export function Pill({ status }: { status: RunStatus | ConnectorStatus }) {
  const tone =
    status in TONE_BY_RUN_STATUS
      ? TONE_BY_RUN_STATUS[status as RunStatus]
      : TONE_BY_CONNECTOR_STATUS[status as ConnectorStatus];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        toneClasses[tone]
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClasses[tone])} />
      {LABEL[status]}
    </span>
  );
}
