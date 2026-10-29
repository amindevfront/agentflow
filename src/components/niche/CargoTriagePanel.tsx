"use client";

// Rastreio operacional inteligente — triagem de status de carga e desvio de
// SLA (nicho Logística). Cruza o código de rastreio contra os dados
// estruturados do Firestore; nunca inventa status para um código ausente —
// a UI diz explicitamente "carga não encontrada".

import { useEffect, useMemo, useState } from "react";
import type { Shipment, ShipmentStatus } from "@/types";
import { useWorkspace } from "@/lib/workspace";
import {
  buscarCargaPorCodigo,
  calcularDesvioSla,
  criarCarga,
  extrairCodigoRastreio,
  subscribeShipments,
} from "@/lib/shipments";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { cn } from "@/lib/utils";

const ROTULO_STATUS: Record<ShipmentStatus, string> = {
  coletado: "coletado",
  "em-transito": "em trânsito",
  aduana: "na aduana",
  atrasado: "atrasado",
  entregue: "entregue",
};

const CORES_SEVERIDADE: Record<string, string> = {
  nenhum: "bg-state-done-bg text-state-done",
  baixa: "bg-signal-100 text-signal-700",
  media: "bg-state-run-bg text-state-run",
  alta: "bg-state-error-bg text-state-error",
};

interface CargoTriagePanelProps {
  /** Texto da última mensagem do cliente na conversa aberta — usado para pré-preencher o código. */
  textoParaExtrairCodigo?: string;
  onInsertResposta?: (texto: string) => void;
}

export function CargoTriagePanel({ textoParaExtrairCodigo, onInsertResposta }: CargoTriagePanelProps) {
  const { workspaceId } = useWorkspace();
  const [cargas, setCargas] = useState<Shipment[]>([]);
  const [codigo, setCodigo] = useState("");
  const [formAberto, setFormAberto] = useState(false);
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [previsaoEntrega, setPrevisaoEntrega] = useState("");
  const [novoCodigo, setNovoCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeShipments(setCargas, workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    if (!textoParaExtrairCodigo) return;
    const extraido = extrairCodigoRastreio(textoParaExtrairCodigo);
    if (extraido) setCodigo(extraido);
  }, [textoParaExtrairCodigo]);

  const carga = useMemo(() => buscarCargaPorCodigo(cargas, codigo), [cargas, codigo]);
  const desvio = useMemo(() => (carga ? calcularDesvioSla(carga) : null), [carga]);
  // `criarCarga` grava com um id derivado do código — registrar o mesmo
  // código de novo SOBRESCREVE o histórico anterior em silêncio. Avisa antes
  // de deixar isso acontecer, já que não há UI de "atualizar status" ainda.
  const novoCodigoJaExiste = useMemo(
    () => (novoCodigo.trim() ? Boolean(buscarCargaPorCodigo(cargas, novoCodigo)) : false),
    [cargas, novoCodigo]
  );

  function respostaSugerida(): string {
    if (!carga || !desvio) return "";
    const previsao = new Date(carga.previsaoEntrega).toLocaleDateString("pt-BR");
    if (desvio.emAtraso) {
      return `Sua carga ${carga.codigoRastreio} está ${ROTULO_STATUS[carga.status]}, com ${desvio.horasDesvio}h de desvio em relação ao prazo combinado (${previsao}). Estamos acompanhando de perto.`;
    }
    return `Sua carga ${carga.codigoRastreio} está ${ROTULO_STATUS[carga.status]}, dentro do prazo combinado (previsão: ${previsao}).`;
  }

  async function handleCriarCarga() {
    if (!novoCodigo.trim() || !origem.trim() || !destino.trim() || !previsaoEntrega) return;
    setProcessando(true);
    setErro(null);
    try {
      await criarCarga({
        codigoRastreio: novoCodigo.trim(),
        origem: origem.trim(),
        destino: destino.trim(),
        previsaoEntrega: new Date(previsaoEntrega).toISOString(),
        workspaceId: workspaceId ?? undefined,
      });
      setNovoCodigo("");
      setOrigem("");
      setDestino("");
      setPrevisaoEntrega("");
      setFormAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registrar a carga.");
    } finally {
      setProcessando(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Triagem de carga &amp; SLA</h3>
          <p className="mt-0.5 text-xs text-ink-400">Cruza o código informado pelo cliente com os dados estruturados do Firestore.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setFormAberto((v) => !v)}>
          {formAberto ? "Cancelar" : "Registrar carga"}
        </Button>
      </div>

      <Field
        label="Código de rastreio"
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
        placeholder="Ex.: BRX-004521"
      />

      {formAberto && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-signal-500 bg-signal-50 p-3">
          <p className="text-xs text-ink-500">
            Ferramenta operacional para registrar cargas manualmente — a integração com um TMS/transportadora real é
            trabalho futuro (conector dedicado).
          </p>
          <Field
            label="Código de rastreio"
            value={novoCodigo}
            onChange={(e) => setNovoCodigo(e.target.value)}
            errorText={novoCodigoJaExiste ? "Já existe uma carga com este código — salvar substituirá o histórico atual." : undefined}
          />
          <Field label="Origem" value={origem} onChange={(e) => setOrigem(e.target.value)} />
          <Field label="Destino" value={destino} onChange={(e) => setDestino(e.target.value)} />
          <Field label="Previsão de entrega" type="datetime-local" value={previsaoEntrega} onChange={(e) => setPrevisaoEntrega(e.target.value)} />
          <Button
            size="sm"
            loading={processando}
            variant={novoCodigoJaExiste ? "danger-solid" : "primary"}
            disabled={!novoCodigo.trim() || !origem.trim() || !destino.trim() || !previsaoEntrega}
            onClick={handleCriarCarga}
          >
            {novoCodigoJaExiste ? "Substituir carga existente" : "Salvar carga"}
          </Button>
        </div>
      )}

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      {codigo.trim().length === 0 ? null : !carga ? (
        <p className="text-xs text-ink-400">Nenhuma carga encontrada com o código &ldquo;{codigo}&rdquo;.</p>
      ) : (
        desvio && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-ink-100 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink-950">{carga.codigoRastreio}</span>
              <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", CORES_SEVERIDADE[desvio.severidade])}>
                {desvio.emAtraso ? `${desvio.horasDesvio}h de desvio` : "dentro do SLA"}
              </span>
            </div>
            <p className="text-xs text-ink-500">
              {carga.origem} → {carga.destino} · status {ROTULO_STATUS[carga.status]} · previsão{" "}
              {new Date(carga.previsaoEntrega).toLocaleString("pt-BR")}
            </p>
            {carga.historico.length > 0 && (
              <ul className="flex flex-col gap-1">
                {carga.historico.map((evento, i) => (
                  <li key={i} className="mono text-[11px] text-ink-400">
                    {new Date(evento.ocorridoEm).toLocaleString("pt-BR")} — {ROTULO_STATUS[evento.status]}
                    {evento.local ? ` · ${evento.local}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {onInsertResposta && (
              <Button size="sm" variant="secondary" onClick={() => onInsertResposta(respostaSugerida())}>
                Inserir resposta sugerida
              </Button>
            )}
          </div>
        )
      )}
    </section>
  );
}

export default CargoTriagePanel;
