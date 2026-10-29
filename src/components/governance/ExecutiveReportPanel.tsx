"use client";

// Executive Board Report — botão "Baixar Relatório Executivo PDF".
//
// Reaproveita exatamente as mesmas fontes de dados do `BusinessROIWidget` e do
// `OpexTaxShieldPanel` (mesmo `calcularRoi`, mesma Neural Inbox) — o PDF nunca
// mostra um número que o resto do painel de Governança não mostraria também.
//
// Fluxo ao clicar:
//   1. sela uma entrada na trilha de auditoria (`relatorio.executivo.gerado`)
//      — essa entrada, já assinada por HMAC e encadeada por hash, É o
//      "atestado de segurança" embutido no PDF;
//   2. se o selo falhar (rede, trilha indisponível), o relatório ainda é
//      gerado — apenas sem o bloco de atestado verificável (degradação
//      graciosa, nunca um selo forjado);
//   3. gera os bytes do PDF e aciona o download no navegador.

import { useEffect, useMemo, useState } from "react";
import type { Campaign, Conversation, FlowRun, HandoffTicket, Moeda, RoiConfig } from "@/types";
import { subscribeFlowRuns } from "@/lib/firestore";
import { useWorkspace } from "@/lib/workspace";
import { subscribeFilaTransbordo } from "@/lib/humanInTheLoop";
import { subscribeConversations } from "@/lib/inbox/firestore";
import { subscribeCampaigns } from "@/lib/campaigns/firestore";
import { calcularReceitaRecuperadaMadrugada } from "@/lib/inbox/revenueRescue";
import {
  ROI_CONFIG_PADRAO,
  cambioParaMoeda,
  calcularRoi,
  formatarMoeda,
  periodoMesAtual,
  subscribeRoiConfig,
} from "@/lib/roi";
import { registrarEventoAuditoriaSilencioso } from "@/lib/auditLog";
import { Button } from "@/components/ui/Button";
import { auth } from "@/lib/firebase";

function acionarDownload(bytes: Uint8Array, nomeArquivo: string): void {
  // `pdf-lib` devolve `Uint8Array<ArrayBufferLike>` — o construtor de `Blob`
  // exige um buffer concreto (`ArrayBuffer`), daí a cópia explícita.
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ExecutiveReportPanel() {
  const { workspaceId, appUser } = useWorkspace();
  const [execucoes, setExecucoes] = useState<FlowRun[]>([]);
  const [tickets, setTickets] = useState<HandoffTicket[]>([]);
  const [conversas, setConversas] = useState<Conversation[]>([]);
  const [campanhas, setCampanhas] = useState<Campaign[]>([]);
  const [config, setConfig] = useState<RoiConfig>(ROI_CONFIG_PADRAO);
  const [moeda, setMoeda] = useState<Moeda>(ROI_CONFIG_PADRAO.moedaExibicao);
  const [gerando, setGerando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [referencia] = useState(() => new Date());

  useEffect(() => {
    if (!workspaceId) return;
    const cancelamentos = [
      subscribeFlowRuns(workspaceId, setExecucoes),
      subscribeFilaTransbordo(setTickets, { workspaceId, limite: 300 }),
      subscribeConversations(setConversas, { workspaceId, limite: 500 }),
      subscribeCampaigns(setCampanhas, { workspaceId }),
      subscribeRoiConfig((nova) => {
        setConfig(nova);
        setMoeda(nova.moedaExibicao);
      }, workspaceId),
    ];
    return () => cancelamentos.forEach((cancelar) => cancelar());
  }, [workspaceId]);

  const snapshot = useMemo(
    () =>
      calcularRoi({
        execucoes,
        tickets,
        conversas,
        campanhas,
        config,
        periodo: periodoMesAtual(referencia),
        referencia,
      }),
    [execucoes, tickets, conversas, campanhas, config, referencia]
  );

  const receitaMadrugada = useMemo(() => calcularReceitaRecuperadaMadrugada(conversas), [conversas]);
  const custoEvitadoMadrugadaBrl =
    (receitaMadrugada.totalConversas * config.minutosManuaisPorConversa * config.custoHoraOperadorBrl) / 60;

  async function handleDownload() {
    if (!workspaceId) return;
    setGerando(true);
    setAviso(null);
    try {
      const entrada = await registrarEventoAuditoriaSilencioso({
        tipo: "relatorio.executivo.gerado",
        recurso: "relatorio-executivo-mensal",
        workspaceId,
        detalhes: {
          periodo: snapshot.periodo.rotulo,
          economiaLiquidaBrl: Math.round(snapshot.economiaLiquidaBrl),
          roiPercentual: Number(snapshot.roiPercentual.toFixed(4)),
        },
      });

      if (!entrada) {
        setAviso(
          "Trilha de auditoria indisponível agora — o relatório foi gerado mesmo assim, sem o selo de segurança verificável."
        );
      }

      // `pdf-lib` só é carregado quando o download é de fato acionado — mantém
      // o bundle inicial da Governança leve (ver ADR-0005 sobre performance de
      // rota).
      const { gerarRelatorioExecutivoPdf } = await import("@/lib/reports/executiveReportPdf");

      const moedaDoValor = (valorBrl: number) => formatarMoeda(valorBrl, moeda, cambioParaMoeda(config, moeda));
      const bytes = await gerarRelatorioExecutivoPdf({
        workspaceId,
        periodoRotulo: snapshot.periodo.rotulo,
        moeda,
        snapshot,
        receitaMadrugada,
        custoEvitadoMadrugadaFormatado: moedaDoValor(custoEvitadoMadrugadaBrl),
        moedaDoValor,
        atestado: entrada
          ? {
              entryId: entrada.id,
              seq: entrada.seq,
              chainHash: entrada.chainHash,
              assinatura: entrada.assinatura,
              seladoEm: entrada.seladoEm,
            }
          : null,
        geradoEm: new Date().toISOString(),
        geradoPor: appUser?.email ?? auth?.currentUser?.email ?? "usuário autenticado",
      });

      const nomeArquivo = `agentflow-relatorio-executivo-${snapshot.periodo.inicio.slice(0, 10)}.pdf`;
      acionarDownload(bytes, nomeArquivo);
    } catch (erro) {
      setAviso(erro instanceof Error ? erro.message : "Não foi possível gerar o relatório executivo.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button size="sm" variant="secondary" loading={gerando} onClick={handleDownload} disabled={!workspaceId}>
        Baixar Relatório Executivo PDF
      </Button>
      {aviso && <p className="max-w-xs text-right text-[11px] text-state-run">{aviso}</p>}
    </div>
  );
}

export default ExecutiveReportPanel;
