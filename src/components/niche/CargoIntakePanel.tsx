"use client";

// Ingestão de carga & despacho prioritário — Motor Vertical B (Logística B2B).
//
// Complementa `CargoTriagePanel` (que responde "onde está a carga X?")
// respondendo a pergunta anterior: "o que exatamente esse cliente acabou de
// pedir, e isso pode esperar?". Lê peso, cubagem, dimensões e volumes
// direto da mensagem (`@/lib/logisticaCarga`) e classifica a prioridade de
// despacho com motivos explicáveis — nunca um score opaco.
//
// Nada aqui estima o que não foi dito: um campo ausente aparece como
// ausente, e a cotação segue para a torre de controle em vez de sair com um
// peso taxável chutado (Artigo IV — No Invention).

import { useMemo, useState } from "react";
import type { InboxModuleContext } from "@/modules/types";
import {
  FATOR_CUBAGEM_RODOVIARIO_PADRAO,
  ROTULO_PRIORIDADE_DESPACHO,
  calcularCubagem,
  classificarPrioridadeDespacho,
  extrairDadosCarga,
  type PrioridadeDespacho,
} from "@/lib/logisticaCarga";
import { abrirTransbordo } from "@/lib/humanInTheLoop";
import { useWorkspace } from "@/lib/workspace";
import { reportarErro } from "@/lib/telemetry/errorReporting";
import { POLITICA_NO_CRITICO } from "@/lib/guardrails/policy";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const CORES_PRIORIDADE: Record<PrioridadeDespacho, string> = {
  rotina: "bg-state-done-bg text-state-done",
  atencao: "bg-state-run-bg text-state-run",
  critica: "bg-state-error-bg text-state-error",
};

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2">
      <span className="text-xs text-ink-500">{rotulo}</span>
      <span className={valor ? "mono text-sm text-ink-950" : "text-sm text-ink-400"}>
        {valor ?? "não informado"}
      </span>
    </div>
  );
}

export function CargoIntakePanel({
  conversaSelecionada,
  ultimaMensagemCliente,
  mensagensClienteRecentes,
  inserirNaResposta,
}: InboxModuleContext) {
  const { workspaceId } = useWorkspace();

  // Prioriza o histórico recente sobre a última mensagem isolada: peso e
  // rota costumam vir em mensagens diferentes numa mesma conversa de
  // cotação ("são 2.400 kg" / "de Itajaí para Campinas").
  const mensagens = useMemo(() => {
    const lista = mensagensClienteRecentes ?? [];
    if (lista.length > 0) return lista;
    return ultimaMensagemCliente ? [ultimaMensagemCliente] : [];
  }, [mensagensClienteRecentes, ultimaMensagemCliente]);

  const [escalando, setEscalando] = useState(false);
  const [ticketAberto, setTicketAberto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const dados = useMemo(() => extrairDadosCarga(mensagens), [mensagens]);
  const cubagem = useMemo(() => calcularCubagem(dados), [dados]);
  const classificacao = useMemo(() => classificarPrioridadeDespacho(mensagens, dados), [mensagens, dados]);

  const temAlgumDado =
    dados.pesoKg !== null ||
    dados.cubagemM3 !== null ||
    dados.dimensoesVolume !== null ||
    dados.codigoRastreio !== null;

  async function escalarParaTorre() {
    if (!conversaSelecionada) return;
    setEscalando(true);
    setErro(null);
    try {
      const ticket = await abrirTransbordo({
        solicitacao: {
          traceId: `log_${Date.now().toString(36)}`,
          politicaId: POLITICA_NO_CRITICO.id,
          severidade: classificacao.prioridade === "critica" ? "critica" : "alta",
          veredito: "transbordo",
          violacoes: [
            {
              regra: "erro-interno-guardrail",
              severidade: classificacao.prioridade === "critica" ? "critica" : "alta",
              mensagem:
                classificacao.motivos.length > 0
                  ? `Escalonamento operacional: ${classificacao.motivos.join("; ")}`
                  : "Escalonamento operacional solicitado pelo operador.",
            },
          ],
          payloadMascarado: mensagens.slice(0, 3).join(" | ").slice(0, 2000),
        },
        flowId: "neural-inbox",
        flowNome: "Neural Inbox — Torre de Controle",
        conversationId: conversaSelecionada.id,
        workspaceId: workspaceId ?? undefined,
        motivoForcado: "solicitacao-manual",
        noCritico: true,
      });
      setTicketAberto(ticket.id);
    } catch (e) {
      reportarErro(e, "logistica:escalonamento-torre");
      setErro("Não foi possível escalar para a torre de controle agora. Tente novamente em alguns instantes.");
    } finally {
      setEscalando(false);
    }
  }

  function inserirConfirmacaoDeDados() {
    const partes: string[] = ["Recebi os dados da sua carga:"];
    if (dados.pesoKg !== null) partes.push(`peso ${dados.pesoKg.toLocaleString("pt-BR")} kg`);
    if (cubagem) partes.push(`cubagem ${cubagem.cubagemM3.toLocaleString("pt-BR")} m³`);
    if (dados.quantidadeVolumes !== null) partes.push(`${dados.quantidadeVolumes} volume(s)`);
    if (dados.codigoRastreio) partes.push(`referência ${dados.codigoRastreio}`);
    const corpo = partes.length > 1 ? `${partes[0]} ${partes.slice(1).join(", ")}.` : "Recebi sua solicitação.";
    inserirNaResposta(
      `${corpo} Já encaminhei para a torre de controle confirmar veículo e janela — o valor final do frete sai com essa confirmação.`
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Ingestão de carga &amp; despacho</h3>
          <p className="mt-0.5 text-xs text-ink-400">
            Peso, cubagem e criticidade lidos direto da mensagem do cliente — sem redigitação no TMS.
          </p>
        </div>
        <span
          className={cn(
            "flex-none rounded-full px-2.5 py-1 text-[11px] font-medium",
            CORES_PRIORIDADE[classificacao.prioridade]
          )}
        >
          {ROTULO_PRIORIDADE_DESPACHO[classificacao.prioridade]}
        </span>
      </div>

      {!temAlgumDado ? (
        <p className="text-xs text-ink-400">
          Nenhum dado de carga reconhecido nas mensagens desta conversa ainda. O parser procura peso (kg/t),
          cubagem (m³), dimensões (C x L x A), quantidade de volumes e código de rastreio/CT-e.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Campo
            rotulo="Peso informado"
            valor={dados.pesoKg !== null ? `${dados.pesoKg.toLocaleString("pt-BR")} kg` : null}
          />
          <Campo
            rotulo="Cubagem"
            valor={
              cubagem
                ? `${cubagem.cubagemM3.toLocaleString("pt-BR")} m³ (${cubagem.origem === "declarada" ? "declarada" : "calculada por dimensões"})`
                : null
            }
          />
          <Campo
            rotulo="Dimensões por volume"
            valor={
              dados.dimensoesVolume
                ? `${dados.dimensoesVolume.comprimento} × ${dados.dimensoesVolume.largura} × ${dados.dimensoesVolume.altura} m`
                : null
            }
          />
          <Campo
            rotulo="Volumes"
            valor={dados.quantidadeVolumes !== null ? String(dados.quantidadeVolumes) : null}
          />
          <Campo rotulo="Código de rastreio / CT-e" valor={dados.codigoRastreio} />
          <Campo
            rotulo={`Peso taxável (fator ${FATOR_CUBAGEM_RODOVIARIO_PADRAO} kg/m³)`}
            valor={
              cubagem?.pesoTaxavelKg != null
                ? `${cubagem.pesoTaxavelKg.toLocaleString("pt-BR")} kg`
                : null
            }
          />
        </div>
      )}

      {classificacao.motivos.length > 0 && (
        <div
          className={cn(
            "rounded-[var(--radius-sm)] px-3 py-2",
            classificacao.prioridade === "critica"
              ? "border border-state-error/40 bg-state-error-bg"
              : "border border-state-run-ink/40 bg-state-run-bg"
          )}
        >
          <p className="text-xs font-semibold text-ink-900">
            {classificacao.escalonarParaTorre
              ? "Escalonamento imediato à torre de controle"
              : "Sinais que exigem confirmação do despachante"}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 pl-4 text-[11px] text-ink-700">
            {classificacao.motivos.map((motivo) => (
              <li key={motivo} className="list-disc">
                {motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      {ticketAberto ? (
        <p className="rounded-[var(--radius-sm)] border border-state-done-ink/30 bg-state-done-bg px-3 py-2 text-xs text-state-done">
          ✓ Escalonado à torre de controle (<span className="mono">{ticketAberto.slice(0, 10)}</span>). Acompanhe em
          Governança → Transbordo.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={classificacao.escalonarParaTorre ? "primary" : "secondary"}
            loading={escalando}
            disabled={!conversaSelecionada}
            onClick={escalarParaTorre}
          >
            Escalar à torre de controle
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!temAlgumDado}
            onClick={inserirConfirmacaoDeDados}
          >
            Inserir confirmação dos dados
          </Button>
        </div>
      )}
    </section>
  );
}

export default CargoIntakePanel;
