"use client";

// Link Único do Cliente — gerador do link do Portal do Cliente
// (`/portal/[slug]`) para o admin copiar/enviar por WhatsApp ao dono do
// estabelecimento. QR Code gerado 100% no navegador (`qrcode`, sem chamada
// a nenhum serviço terceiro de geração de QR) — o link nunca sai do
// dispositivo do admin antes de ele decidir compartilhá-lo.

import { useEffect, useRef, useState } from "react";
import type { Workspace } from "@/types";
import { garantirSlugWorkspace } from "@/lib/firestore";
import { Button } from "@/components/ui/Button";

export function ClientPortalLinkCard({ workspace }: { workspace: Workspace }) {
  const [slug, setSlug] = useState<string | null>(workspace.slug ?? null);
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setSlug(workspace.slug ?? null);
  }, [workspace.slug]);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const link = slug ? `${baseUrl}/portal/${slug}` : null;

  useEffect(() => {
    if (!link || !canvasRef.current) return;
    const canvas = canvasRef.current;
    // Import dinâmico: `qrcode` só entra no bundle quando este card de fato
    // precisa desenhar o código, mantendo /flows leve para quem nunca abre
    // o Link Único do Cliente.
    import("qrcode")
      .then((QRCode) => QRCode.toCanvas(canvas, link, { width: 120, margin: 1 }))
      .catch((e) => {
        console.error("[client-portal-link] falha ao desenhar QR Code:", e);
      });
  }, [link]);

  async function gerarLink() {
    setGerando(true);
    setErro(null);
    try {
      const resolvido = await garantirSlugWorkspace(workspace);
      setSlug(resolvido);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar o link do portal.");
    } finally {
      setGerando(false);
    }
  }

  async function copiarLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Clipboard pode estar indisponível — o link segue visível e selecionável manualmente.
    }
  }

  return (
    <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <h3 className="text-sm font-semibold text-ink-950">Link Único do Cliente</h3>
      <p className="mt-1 text-xs text-ink-500">
        Portal dedicado para o cliente acompanhar o ROI e os atendimentos — compartilhe por WhatsApp.
      </p>

      {erro && <p className="mt-2 text-xs text-state-error">{erro}</p>}

      {!link ? (
        <Button size="sm" className="mt-3" loading={gerando} onClick={gerarLink}>
          Gerar link do portal
        </Button>
      ) : (
        <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row">
          <canvas ref={canvasRef} className="flex-none rounded-[var(--radius-sm)] border border-ink-100" />
          <div className="min-w-0 flex-1">
            <p className="mono break-all rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 px-3 py-2 text-xs text-ink-700">
              {link}
            </p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={copiarLink}>
              {copiado ? "Copiado!" : "Copiar link para o cliente"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export default ClientPortalLinkCard;
