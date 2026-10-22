"use client";

import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helpText?: string;
  errorText?: string;
  okText?: string;
}

/** Campo de formulário com validação reativa inline, conforme design-system.html. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, helpText, errorText, okText, id, className, ...props },
  ref
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hasError = Boolean(errorText);
  const hasOk = Boolean(okText) && !hasError;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-ink-700">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        className={cn(
          "h-10 rounded-[var(--radius-sm)] border bg-white px-3 text-sm text-ink-950 outline-none transition-colors",
          "placeholder:text-ink-300 focus:border-signal-500 focus:ring-2 focus:ring-signal-100",
          hasError ? "border-state-error" : "border-ink-100",
          className
        )}
        aria-invalid={hasError}
        {...props}
      />
      {hasError && <span className="text-xs text-state-error">{errorText}</span>}
      {hasOk && <span className="text-xs text-state-done">{okText}</span>}
      {!hasError && !hasOk && helpText && <span className="text-xs text-ink-400">{helpText}</span>}
    </div>
  );
});
