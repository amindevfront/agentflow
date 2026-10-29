// Página pública (sem login, sem Firestore) — ferramenta de pré-venda para
// o time comercial apresentar a um prospect antes de ele ter workspace.
// Fora do grupo `(app)` deliberadamente: não deve exigir autenticação nem
// herdar o AppShell (sidebar/topbar do produto).

import { RoiSandbox } from "@/components/sales/RoiSandbox";

export default function SandboxPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-mist-50 p-4 md:p-8">
      <div className="w-full max-w-3xl">
        <RoiSandbox />
      </div>
    </main>
  );
}
