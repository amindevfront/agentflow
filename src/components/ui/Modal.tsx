"use client";

import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  titleId: string;
  title: string;
  body: string;
  actions: ReactNode;
}

/** Modal de confirmação destrutiva, conforme design-system.html (ex.: "Parar tudo"). */
export function Modal({ open, onClose, titleId, title, body, actions }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-950/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-[var(--radius-md)] bg-white p-6 shadow-[var(--shadow-md)]"
      >
        <h3 id={titleId} className="text-base font-semibold text-ink-950">
          {title}
        </h3>
        <p className="mt-2 text-sm text-ink-500">{body}</p>
        <div className="mt-6 flex justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}
