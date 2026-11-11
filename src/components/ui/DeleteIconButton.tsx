import type { MouseEvent } from "react";

interface DeleteIconButtonProps {
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

/** Botão de lixeira reutilizado em Fluxos, Conectores e Equipe — sempre abre uma confirmação, nunca apaga direto. */
export function DeleteIconButton({ label, onClick }: DeleteIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex-none rounded-[var(--radius-sm)] p-1.5 text-ink-400 transition-colors hover:bg-state-error-bg hover:text-state-error"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2.5 4.5h11M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5 4.5l.5 8a1 1 0 0 0 1 .95h3a1 1 0 0 0 1-.95l.5-8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
