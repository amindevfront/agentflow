"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "danger-solid";
type Size = "md" | "sm";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-signal-600 text-white hover:bg-signal-700 active:bg-signal-700 disabled:bg-ink-200 disabled:text-ink-400",
  secondary:
    "bg-white text-ink-900 border border-ink-100 hover:bg-mist-50 active:bg-ink-100 disabled:text-ink-300",
  "danger-solid":
    "bg-state-error text-white hover:opacity-90 active:opacity-80 disabled:bg-ink-200 disabled:text-ink-400",
};

const sizeClasses: Record<Size, string> = {
  md: "h-10 px-4 text-sm",
  sm: "h-9 px-3.5 text-[13px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-btn)] font-medium transition-colors duration-150 disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      <span className="btn-label">{children}</span>
    </button>
  );
});
