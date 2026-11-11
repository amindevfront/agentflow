import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { DeleteIconButton } from "./DeleteIconButton";
import { Pill } from "./Pill";
import type { ConnectorStatus, RunStatus } from "@/types";

function ProgressDots({ total, done, current }: { total: number; done: number; current: boolean }) {
  return (
    <div className="flex flex-none gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            i < done ? "bg-signal-600" : i === done && current ? "bg-state-run-ink" : "bg-ink-100"
          )}
        />
      ))}
    </div>
  );
}

interface ListRowProps {
  title: string;
  subtitle: string;
  status: RunStatus | ConnectorStatus;
  time?: string;
  active?: boolean;
  totalSteps?: number;
  doneSteps?: number;
  onClick?: () => void;
  /** Quando presente, mostra um botão de lixeira ao fim da linha (ex.: excluir um fluxo de teste). */
  onDelete?: () => void;
  /** Texto de acessibilidade do botão de lixeira — padrão "Excluir {title}". */
  deleteLabel?: string;
}

/** Linha de lista densa, reaproveitada em Fluxos, Execuções, Conectores e Equipe. */
export function ListRow({
  title,
  subtitle,
  status,
  time,
  active,
  totalSteps,
  doneSteps,
  onClick,
  onDelete,
  deleteLabel,
}: ListRowProps) {
  // Quando há um botão de lixeira aninhado (`onDelete`), a linha não pode ser
  // um <button> nativo — <button> dentro de <button> é HTML inválido e o
  // navegador reordena/fecha a árvore sozinho, quebrando o clique de ambos.
  // `div[role="button"]` com teclado equivalente mantém a mesma acessibilidade
  // sem esse problema, então ele passa a ser o padrão sempre que há onClick.
  const interativo = Boolean(onClick);
  return (
    <div
      role={interativo ? "button" : undefined}
      tabIndex={interativo ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interativo
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        "flex w-full items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-colors",
        interativo && "cursor-pointer",
        active ? "border-signal-500 bg-signal-50" : "border-transparent hover:bg-mist-50"
      )}
    >
      <Avatar name={title} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink-950">{title}</p>
        <p className="truncate text-xs text-ink-500">{subtitle}</p>
      </div>
      {typeof totalSteps === "number" && (
        <ProgressDots total={totalSteps} done={doneSteps ?? 0} current={status === "em-execucao"} />
      )}
      {time && <span className="mono flex-none text-xs text-ink-400">{time}</span>}
      <Pill status={status} />
      {onDelete && (
        <DeleteIconButton
          label={deleteLabel ?? `Excluir ${title}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        />
      )}
    </div>
  );
}
