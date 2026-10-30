"use client";

// Radar de Risco de Distrato — exposição financeira real (nicho
// Construtora/Incorporadora). Mostra, por contrato, quanto a empresa
// deveria reembolsar HOJE se o comprador pedisse distrato, e se o atraso de
// entrega já configurou culpa da construtora (o que troca a retenção
// parcial de 25-50% por reembolso de 100%).
//
// Deliberadamente sem botão de "inserir resposta" ao comprador: diferente
// dos outros painéis de nicho, afirmar a um comprador que a empresa está em
// culpa é uma declaração jurídica — este painel é uma ferramenta interna
// para o operador/jurídico decidirem o que fazer, não um gerador de
// mensagem automática.

import { useMemo, useState } from "react";
import { useEffect } from "react";
import type { ContratoImobiliario } from "@/types";
import { useWorkspace } from "@/lib/workspace";
import { auth } from "@/lib/firebase";
import {
  avancarStatusDistrato,
  criarContratoImobiliario,
  registrarEntregaUnidade,
  subscribeContratosImobiliarios,
  TOLERANCIA_ATRASO_SUGERIDA_DIAS,
} from "@/lib/contratosImobiliarios";
import { calcularExposicaoFinanceiraDistrato, PROXIMO_STATUS_DISTRATO, type NivelAlertaDistrato } from "@/lib/distrato";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";

const ROTULO_STATUS: Record<ContratoImobiliario["status"], string> = {
  ativo: "ativo",
  "distrato-solicitado": "distrato solicitado",
  "distrato-formalizado": "distrato formalizado",
};

const CORES_ALERTA: Record<NivelAlertaDistrato, string> = {
  "dentro-do-prazo": "bg-state-done-bg text-state-done",
  "tolerancia-proxima-do-limite": "bg-state-run-bg text-state-run",
  "culpa-construtora-configurada": "bg-state-error-bg text-state-error",
  "distrato-em-andamento": "bg-state-error-bg text-state-error",
};

const ROTULO_ALERTA: Record<NivelAlertaDistrato, string> = {
  "dentro-do-prazo": "dentro do prazo",
  "tolerancia-proxima-do-limite": "tolerância próxima do limite",
  "culpa-construtora-configurada": "culpa da construtora configurada",
  "distrato-em-andamento": "distrato em andamento",
};

/** Prioridade de exibição — risco mais grave primeiro, para que o operador veja o que importa sem precisar rolar a lista. */
const PRIORIDADE_ALERTA: Record<NivelAlertaDistrato, number> = {
  "culpa-construtora-configurada": 0,
  "distrato-em-andamento": 1,
  "tolerancia-proxima-do-limite": 2,
  "dentro-do-prazo": 3,
};

function formatarBrl(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number.isFinite(valor) ? valor : 0
  );
}

export function DistratoRiskPanel() {
  const { workspaceId } = useWorkspace();
  const [contratos, setContratos] = useState<ContratoImobiliario[]>([]);
  const [referencia, setReferencia] = useState(() => new Date());
  const [formAberto, setFormAberto] = useState(false);
  const [compradorNome, setCompradorNome] = useState("");
  const [unidade, setUnidade] = useState("");
  const [valorContratoBrl, setValorContratoBrl] = useState("");
  const [valorPagoBrl, setValorPagoBrl] = useState("");
  const [dataPrevistaEntrega, setDataPrevistaEntrega] = useState("");
  const [toleranciaAtrasoDias, setToleranciaAtrasoDias] = useState(String(TOLERANCIA_ATRASO_SUGERIDA_DIAS));
  const [patrimonioDeAfetacao, setPatrimonioDeAfetacao] = useState(false);
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeContratosImobiliarios(setContratos, workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    const intervalo = setInterval(() => setReferencia(new Date()), 60_000);
    return () => clearInterval(intervalo);
  }, []);

  const linhas = useMemo(
    () =>
      contratos
        .map((contrato) => ({ contrato, exposicao: calcularExposicaoFinanceiraDistrato(contrato, referencia) }))
        .sort((a, b) => PRIORIDADE_ALERTA[a.exposicao.nivelAlerta] - PRIORIDADE_ALERTA[b.exposicao.nivelAlerta]),
    [contratos, referencia]
  );

  const totalEmRisco = linhas.filter(
    (l) => l.exposicao.nivelAlerta === "culpa-construtora-configurada" || l.exposicao.nivelAlerta === "tolerancia-proxima-do-limite"
  ).length;

  async function handleCriar() {
    const uid = auth?.currentUser?.uid;
    const valorContrato = Number(valorContratoBrl);
    const valorPago = Number(valorPagoBrl);
    const tolerancia = Number(toleranciaAtrasoDias);
    if (
      !uid ||
      !compradorNome.trim() ||
      !unidade.trim() ||
      !dataPrevistaEntrega ||
      !Number.isFinite(valorContrato) ||
      !Number.isFinite(valorPago) ||
      !Number.isFinite(tolerancia)
    ) {
      return;
    }
    setErro(null);
    try {
      await criarContratoImobiliario({
        compradorNome: compradorNome.trim(),
        unidade: unidade.trim(),
        valorContratoBrl: valorContrato,
        valorPagoBrl: valorPago,
        dataPrevistaEntrega: new Date(dataPrevistaEntrega).toISOString(),
        toleranciaAtrasoDias: tolerancia,
        patrimonioDeAfetacao,
        workspaceId: workspaceId ?? undefined,
        criadoPor: uid,
      });
      setCompradorNome("");
      setUnidade("");
      setValorContratoBrl("");
      setValorPagoBrl("");
      setDataPrevistaEntrega("");
      setToleranciaAtrasoDias(String(TOLERANCIA_ATRASO_SUGERIDA_DIAS));
      setPatrimonioDeAfetacao(false);
      setFormAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registrar o contrato.");
    }
  }

  async function handleAvancarStatus(contrato: ContratoImobiliario) {
    setProcessandoId(contrato.id);
    setErro(null);
    try {
      await avancarStatusDistrato(contrato);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível avançar o status do distrato.");
    } finally {
      setProcessandoId(null);
    }
  }

  async function handleRegistrarEntrega(contrato: ContratoImobiliario) {
    setProcessandoId(contrato.id);
    setErro(null);
    try {
      await registrarEntregaUnidade(contrato);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registrar a entrega.");
    } finally {
      setProcessandoId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Radar de risco de distrato</h3>
          <p className="mt-0.5 text-xs text-ink-400">
            {totalEmRisco > 0
              ? `${totalEmRisco} contrato(s) exigem atenção agora`
              : "Exposição financeira por contrato, sob a Lei do Distrato (13.786/2018)"}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setFormAberto((v) => !v)}>
          {formAberto ? "Cancelar" : "Registrar contrato"}
        </Button>
      </div>

      {formAberto && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-signal-500 bg-signal-50 p-3">
          <Field label="Comprador" value={compradorNome} onChange={(e) => setCompradorNome(e.target.value)} />
          <Field label="Unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)} placeholder="Ex.: Apto 302 - Torre B" />
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Valor do contrato (R$)"
              type="number"
              value={valorContratoBrl}
              onChange={(e) => setValorContratoBrl(e.target.value)}
            />
            <Field
              label="Valor já pago (R$)"
              type="number"
              value={valorPagoBrl}
              onChange={(e) => setValorPagoBrl(e.target.value)}
            />
          </div>
          <Field
            label="Previsão de entrega"
            type="datetime-local"
            value={dataPrevistaEntrega}
            onChange={(e) => setDataPrevistaEntrega(e.target.value)}
          />
          <Field
            label="Tolerância contratual de atraso (dias)"
            type="number"
            value={toleranciaAtrasoDias}
            onChange={(e) => setToleranciaAtrasoDias(e.target.value)}
            helpText="Confira no contrato real — 180 dias é apenas a prática mais comum de mercado, não um valor universal."
          />
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={patrimonioDeAfetacao} onChange={(e) => setPatrimonioDeAfetacao(e.target.checked)} />
            Incorporação sob patrimônio de afetação (eleva o teto de retenção para 50%)
          </label>
          {erro && <p className="text-xs text-state-error">{erro}</p>}
          <Button
            size="sm"
            disabled={!compradorNome.trim() || !unidade.trim() || !dataPrevistaEntrega || !valorContratoBrl || !valorPagoBrl}
            onClick={handleCriar}
          >
            Salvar contrato
          </Button>
        </div>
      )}

      {!formAberto && erro && <p className="text-xs text-state-error">{erro}</p>}

      {linhas.length === 0 ? (
        <EmptyState
          title="Nenhum contrato registrado"
          description="Registre os contratos de compra de unidade para acompanhar a exposição financeira a distrato."
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {linhas.map(({ contrato, exposicao }) => (
            <li key={contrato.id} className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink-950">
                  {contrato.compradorNome} · {contrato.unidade}
                </span>
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", CORES_ALERTA[exposicao.nivelAlerta])}>
                  {ROTULO_ALERTA[exposicao.nivelAlerta]}
                </span>
              </div>
              <p className="text-xs text-ink-500">
                status {ROTULO_STATUS[contrato.status]} · previsão {new Date(contrato.dataPrevistaEntrega).toLocaleDateString("pt-BR")}
                {contrato.dataEntregaRealizadaEm
                  ? ` · entregue em ${new Date(contrato.dataEntregaRealizadaEm).toLocaleDateString("pt-BR")}`
                  : exposicao.diasRestantesTolerancia > 0
                    ? ` · ${exposicao.diasRestantesTolerancia} dia(s) restante(s) de tolerância`
                    : exposicao.culpaConstrutora
                      ? ` · ${exposicao.diasAtrasoAlemTolerancia} dia(s) além da tolerância`
                      : ""}
              </p>
              <p className="mono text-xs text-ink-700">
                {exposicao.culpaConstrutora
                  ? `Reembolso devido: ${formatarBrl(exposicao.valorAReembolsarBrl)} (100% — culpa da construtora, sem retenção)`
                  : `Se distrato hoje: reter ${formatarBrl(exposicao.valorRetidoBrl)} (${Math.round(exposicao.percentualRetencao * 100)}%) · devolver ${formatarBrl(exposicao.valorAReembolsarBrl)}`}
              </p>
              <div className="flex flex-wrap gap-2">
                {PROXIMO_STATUS_DISTRATO[contrato.status] && (
                  <Button size="sm" variant="secondary" loading={processandoId === contrato.id} onClick={() => handleAvancarStatus(contrato)}>
                    Avançar para &ldquo;{ROTULO_STATUS[PROXIMO_STATUS_DISTRATO[contrato.status]!]}&rdquo;
                  </Button>
                )}
                {!contrato.dataEntregaRealizadaEm && (
                  <Button size="sm" variant="secondary" loading={processandoId === contrato.id} onClick={() => handleRegistrarEntrega(contrato)}>
                    Registrar entrega da unidade
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default DistratoRiskPanel;
