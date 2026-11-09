/** Concatena classes condicionalmente, ignorando valores falsy. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Formata um timestamp em texto relativo curto (ex.: "há 2 min", "ontem").
 *
 * Reaproveitado em toda gaveta que lista algo por data (Fluxos, Auditoria,
 * Neural Inbox, Cofre, Transbordo, Agendamentos) — um campo de data ausente
 * ou malformado em QUALQUER uma delas (`new Date(undefined)` → Invalid Date)
 * nunca pode virar "há NaN dias" na tela de um cliente pagante.
 */
export function formatRelativeTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin} min`;

  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `há ${diffHours}h`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "ontem";
  return `há ${diffDays} dias`;
}

/** Gera as iniciais (até 2 letras) usadas nos avatares. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
