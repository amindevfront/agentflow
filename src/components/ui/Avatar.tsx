import { cn } from "@/lib/utils";
import { initials } from "@/lib/utils";

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <div
      className={cn(
        "flex flex-none items-center justify-center rounded-full bg-signal-100 font-mono font-medium text-signal-700",
        size === "sm" ? "h-7 w-7 text-[11px]" : "h-9 w-9 text-xs"
      )}
    >
      {initials(name)}
    </div>
  );
}
