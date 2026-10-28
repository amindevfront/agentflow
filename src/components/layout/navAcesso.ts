// Dual-Layer Workspace View — rotas de "administração técnica avançada",
// ocultas do menu e bloqueadas por redirecionamento para quem não é `admin`.
//
// Lista única, compartilhada por `Sidebar` (o que aparece no menu) e
// `AppShell` (o que é de fato acessível por URL) — evitar duas listas evita
// que elas divirjam e um item fique escondido do menu mas ainda navegável.

export const ROTAS_ADMIN_EXCLUSIVO = ["/connectors", "/team", "/governance"] as const;

export function exigeAdmin(pathname: string | null): boolean {
  if (!pathname) return false;
  return ROTAS_ADMIN_EXCLUSIVO.some((rota) => pathname.startsWith(rota));
}
