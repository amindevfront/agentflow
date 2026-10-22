import type { ReactNode } from "react";

export function Banner({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-state-run-ink/30 bg-state-run-bg px-6 py-2.5 text-sm text-state-run">
      <span>{children}</span>
      {action}
    </div>
  );
}
