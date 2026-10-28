"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { ROTAS_ADMIN_EXCLUSIVO } from "./navAcesso";
import type { UserRole } from "@/types";

const NAV_ITEMS = [
  { href: "/inbox", label: "Neural Inbox" },
  { href: "/flows", label: "Fluxos" },
  { href: "/runs", label: "Execuções" },
  { href: "/connectors", label: "Conectores" },
  { href: "/team", label: "Equipe" },
  { href: "/governance", label: "Governança" },
  { href: "/settings", label: "Configurações" },
];

/**
 * Dual-Layer Workspace View: `operacoes` (uso diário — cliente/operador) vê
 * só Inbox, Fluxos, Execuções e Configurações. Conectores/Equipe/Governança
 * são "administração técnica avançada", exclusivos de `admin` — ver
 * `./navAcesso` para a mesma lista usada no guard de rota do `AppShell`.
 */
function itensVisiveis(papel: UserRole) {
  if (papel === "admin") return NAV_ITEMS;
  return NAV_ITEMS.filter((item) => !ROTAS_ADMIN_EXCLUSIVO.some((rota) => item.href.startsWith(rota)));
}

const ROLE_LABEL: Record<UserRole, string> = {
  operacoes: "operações",
  admin: "admin",
};

function Brand() {
  return (
    <div className="flex items-center gap-2 px-5 py-5">
      <svg width="20" height="20" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 32 L20 20 L32 8" stroke="var(--color-signal-500)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="8" cy="32" r="4.5" fill="var(--color-ink-950)" stroke="var(--color-signal-500)" strokeWidth="3" />
        <circle cx="20" cy="20" r="4.5" fill="var(--color-signal-500)" />
        <circle cx="32" cy="8" r="4.5" fill="var(--color-signal-500)" />
      </svg>
      <span className="text-[15px] font-semibold text-ink-950">AgentFlow</span>
    </div>
  );
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
  userRole: UserRole;
}

export function Sidebar({ isOpen, onClose, userName, userRole }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          "fixed inset-0 z-40 bg-ink-950/30 transition-opacity md:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <nav
        aria-label="Navegação principal"
        className={cn(
          "fixed left-0 top-0 z-50 flex h-full w-[var(--sidebar-w)] flex-col border-r border-ink-100 bg-white transition-transform duration-200 md:sticky md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Brand />
        <div className="flex flex-1 flex-col gap-0.5 px-2">
          {itensVisiveis(userRole).map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex h-10 items-center rounded-[var(--radius-sm)] border-l-2 px-3 text-sm transition-colors",
                  active
                    ? "border-signal-600 bg-signal-50 font-semibold text-ink-950"
                    : "border-transparent text-ink-500 hover:bg-mist-50 hover:text-ink-900"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="mt-auto flex items-center gap-2.5 border-t border-ink-100 px-5 py-3.5">
          <Avatar name={userName} size="sm" />
          <div className="min-w-0">
            <strong className="block truncate text-[13px] text-ink-950">{userName}</strong>
            <span className="mono text-[11px] text-ink-500">{ROLE_LABEL[userRole]}</span>
          </div>
        </div>
      </nav>
    </>
  );
}
