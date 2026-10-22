import type { ReactNode } from "react";

interface TopbarProps {
  title: string;
  onMenuClick: () => void;
  actions?: ReactNode;
}

export function Topbar({ title, onMenuClick, actions }: TopbarProps) {
  return (
    <header className="flex h-16 flex-none items-center justify-between gap-3 border-b border-ink-100 bg-white px-4 md:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Abrir menu de navegação"
          className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-ink-500 hover:bg-mist-50 md:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-ink-950">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </header>
  );
}
