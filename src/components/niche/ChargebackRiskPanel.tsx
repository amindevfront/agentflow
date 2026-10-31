"use client";

// Radar de Risco de Chargeback & Devolução (nicho E-commerce).
//
// Painel visual sobre `@/lib/chargebackRisk` — a parte que ficou pendente na
// entrega anterior (ver ADR-0007, seção "Consequências"). Mesmo padrão de
// registro manual dos demais painéis de nicho (`CargoTriagePanel`,
// `AppointmentRemindersPanel`): a integração real com um gateway de
// pagamento é trabalho futuro (conector dedicado); isto garante dados
// estruturados reais para o radar calcular sobre.

import { useEffect, useMemo, useState } from "react";
import type { PedidoEcommerce, StatusPedidoEcommerce } from "@/types";
import { useWorkspace } from "@/lib/workspace";
import { atualizarStatusPedido, criarPedido, subscribePedidos } from "@/lib/ecommercePedidos";
import { calcularExposicaoChargebackDevolucao, type NivelAlertaChargeback } from "@/lib/chargebackRisk";
import { formatarMoeda, formatarPercentual, periodoMesAtual } from "@/lib/roi";
import { MetricCard } from "@/components/ui/MetricCard";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";

const ROTULO_STATUS_PEDIDO: Record<StatusPedidoEcommerce, string> = {
  pago: "pago",
  entregue: "entregue",
  devolvido: "devolvido",
  chargeback: "chargeback",
  cancelado: "cancelado",
};

const CORES_STATUS_PEDIDO: Record<StatusPedidoEcommerce, string> = {
  pago: "bg-signal-100 text-signal-700",
  entregue: "bg-state-done-bg text-state-done",
  devolvido: "bg-state-run-bg text-state-run",
  chargeback: "bg-state-error-bg text-state-error",
  cancelado: "bg-state-idle-bg text-state-idle",
};

const TOM_ALERTA: Record<NivelAlertaChargeback, "positivo" | "atencao" | "erro"> = {
  saudavel: "positivo",
  atencao: "atencao",
  critico: "erro",
};

/** Próximo status sugerido por botão de ação — nunca "ressuscita" um pedido já encerrado (chargeback/cancelado). */
const PROXIMOS_STATUS: Record<StatusPedidoEcommerce, StatusPedidoEcommerce[]> = {
  pago: ["entregue", "devolvido", "chargeback", "cancelado"],
  entregue: ["devolvido", "chargeback"],
  devolvido: [],
  chargeback: [],
  cancelado: [],
};

export function ChargebackRiskPanel() {
  const { workspaceId } = useWorkspace();
  const [pedidos, setPedidos] = useState<PedidoEcommerce[]>([]);
  const [formAberto, setFormAberto] = useState(false);
  const [numeroPedido, setNumeroPedido] = useState("");
  const [valorBrl, setValorBrl] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);
  const [atualizandoId, setAtualizandoId] = useState<string | null>(null);
  const [referencia] = useState(() => new Date());

  useEffect(() => {
    if (!workspaceId) return;
    return subscribePedidos(setPedidos, workspaceId);
  }, [workspaceId]);

  // Mesmo recorte temporal de `periodoMesAtual` (@/lib/roi), já usado em todo
  // painel financeiro do produto — evita misturar pedidos de meses
  // diferentes num único número de exposição.
  const periodoMes = useMemo(() => periodoMesAtual(referencia), [referencia]);
  const pedidosDoMes = useMemo(
    () =>
      pedidos.filter((p) => {
        const instante = new Date(p.criadoEm).getTime();
        return instante >= new Date(periodoMes.inicio).getTime() && instante <= new Date(periodoMes.fim).getTime();
      }),
    [pedidos, periodoMes]
  );
  const resultado = useMemo(() => calcularExposicaoChargebackDevolucao(pedidosDoMes), [pedidosDoMes]);

  async function handleCriar() {
    const valor = Number(valorBrl);
    if (!numeroPedido.trim() || !Number.isFinite(valor) || valor <= 0) return;
    setProcessando(true);
    setErro(null);
    try {
      await criarPedido({ numeroPedido: numeroPedido.trim(), valorBrl: valor, workspaceId: workspaceId ?? undefined });
      setNumeroPedido("");
      setValorBrl("");
      setFormAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registrar o pedido.");
    } finally {
      setProcessando(false);
    }
  }

  async function handleAtualizarStatus(pedido: PedidoEcommerce, novoStatus: StatusPedidoEcommerce) {
    setAtualizandoId(pedido.id);
    setErro(null);
    try {
      await atualizarStatusPedido(pedido, novoStatus);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível atualizar o status do pedido.");
    } finally {
      setAtualizandoId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Radar de Risco de Chargeback &amp; Devolução</h3>
          <p className="mt-0.5 text-xs text-ink-400">
            Soma produto perdido, taxa de processamento retida e taxa fixa de disputa num único número mensal.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setFormAberto((v) => !v)}>
          {formAberto ? "Cancelar" : "Novo pedido"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          rotulo="Chargeback + devolução (mês)"
          valor={formatarPercentual(resultado.taxaChargebackEDevolucao)}
          detalhe={`${resultado.totalChargeback} chargeback · ${resultado.totalDevolvido} devolvido`}
          tom={TOM_ALERTA[resultado.nivelAlerta]}
          dica="Referência de mercado: acima de 7,5% já supera a média documentada de incidentes do e-commerce em geral."
        />
        <MetricCard
          rotulo="Produto perdido (mês)"
          valor={formatarMoeda(resultado.custoProdutoPerdidoBrl, "BRL")}
          detalhe="valor dos pedidos em chargeback"
          tom={resultado.custoProdutoPerdidoBrl > 0 ? "atencao" : "positivo"}
        />
        <MetricCard
          rotulo="Custo total exposto (mês)"
          valor={formatarMoeda(resultado.custoTotalBrl, "BRL")}
          detalhe="produto + taxas retidas + taxa fixa de disputa"
          tom={TOM_ALERTA[resultado.nivelAlerta]}
          dica="Taxa de processamento retida mesmo em reembolso (~2,9%) + taxa fixa de disputa — referência de mercado, ajustável por workspace."
        />
      </div>

      {formAberto && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-signal-500 bg-signal-50 p-3">
          <p className="text-xs text-ink-500">
            Ferramenta operacional para registrar pedidos manualmente — a integração com um gateway de pagamento real é
            trabalho futuro (conector dedicado).
          </p>
          <Field label="Número do pedido" value={numeroPedido} onChange={(e) => setNumeroPedido(e.target.value)} placeholder="Ex.: 1042" />
          <Field label="Valor (R$)" type="number" value={valorBrl} onChange={(e) => setValorBrl(e.target.value)} placeholder="Ex.: 250" />
          {erro && <p className="text-xs text-state-error">{erro}</p>}
          <Button size="sm" loading={processando} disabled={!numeroPedido.trim() || !valorBrl.trim()} onClick={handleCriar}>
            Salvar pedido
          </Button>
        </div>
      )}

      {!formAberto && erro && <p className="text-xs text-state-error">{erro}</p>}

      {pedidosDoMes.length === 0 ? (
        <EmptyState title="Nenhum pedido registrado este mês" description="Registre pedidos para o radar calcular a exposição real de chargeback e devolução." />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {pedidosDoMes.map((pedido) => (
            <li key={pedido.id} className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink-950">Pedido #{pedido.numeroPedido}</span>
                <span className={cn("mono rounded-full px-2 py-0.5 text-[11px] font-medium", CORES_STATUS_PEDIDO[pedido.status])}>
                  {ROTULO_STATUS_PEDIDO[pedido.status]}
                </span>
              </div>
              <p className="text-xs text-ink-500">{formatarMoeda(pedido.valorBrl, "BRL")}</p>
              {PROXIMOS_STATUS[pedido.status].length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {PROXIMOS_STATUS[pedido.status].map((status) => (
                    <Button
                      key={status}
                      size="sm"
                      variant={status === "chargeback" ? "danger-solid" : "secondary"}
                      loading={atualizandoId === pedido.id}
                      onClick={() => handleAtualizarStatus(pedido, status)}
                    >
                      Marcar {ROTULO_STATUS_PEDIDO[status]}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default ChargebackRiskPanel;
