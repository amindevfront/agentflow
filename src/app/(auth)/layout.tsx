import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-mist-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <svg width="22" height="22" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 32 L20 20 L32 8" stroke="var(--color-signal-500)" strokeWidth="3" strokeLinecap="round" />
            <circle cx="8" cy="32" r="4.5" fill="var(--color-ink-950)" stroke="var(--color-signal-500)" strokeWidth="3" />
            <circle cx="20" cy="20" r="4.5" fill="var(--color-signal-500)" />
            <circle cx="32" cy="8" r="4.5" fill="var(--color-signal-500)" />
          </svg>
          <span className="text-[17px] font-semibold text-ink-950">AgentFlow</span>
        </div>
        <div className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-6 shadow-[var(--shadow-sm)]">
          {children}
        </div>
      </div>
    </main>
  );
}
