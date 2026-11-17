"use client";

// Handover de Alto Ticket — Motor Vertical A (Imobiliário, Itajaí/BC).
//
// Dois guardrails autônomos, lado a lado, sobre a MESMA conversa:
//
//  1. **Proteção de Caixa (preço/desconto).** Sempre ativa na saída do
//     agente, via a política `imobiliario-alto-padrao`
//     (`@/lib/guardrails/policy`) — este painel só TORNA VISÍVEL que ela
//     está ligada e o que exatamente ela barra. A interceptação em si
//     acontece no motor, não aqui: um painel de UI nunca é a barreira.
//  2. **Handover obrigatório por intenção explícita de compra.** Detectado
//     deterministicamente por `detectarIntencaoCompraExplicita`
//     (`@/lib/server/imobiliarioAltoPadrao`) sobre as mensagens já
//     mascaradas do cliente. Quando dispara, a conversa deixa de ser
//     elegível a resposta autônoma e o painel oferece a escalada de um
//     clique — com o Resumo Executivo Mastigado já montado.
//
// O ticket aberto aqui usa o motivo `agendamento-visita-presencial`, o
// mesmo que alimenta "Visitas agendadas" e "VGV em pipeline ativo" no motor
// vertical: um handover de alto ticket é, por definição, a passagem do lead
// a um corretor humano para conduzir a visita/negociação.

import { useMemo, useState } from "react";
import type { InboxModuleContext } from "@/modules/types";
import {
  construirResumoExecutivoHandoff,
  detectarGatilhoAgendamentoVisita,
  detectarIntencaoCompraExplicita,
} from "@/lib/server/imobiliarioAltoPadrao";
import { abrirTransbordo } from "@/lib/humanInTheLoop";
import { useWorkspace } from "@/lib/workspace";
import { reportarErro } from "@/lib/telemetry/errorReporting";
import { POLITICA_IMOBILIARIO_ALTO_PADRAO } from "@/lib/guardrails/policy";
import { Button } from "@/components/ui/Button";

function Sinal({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-ink-100 px-3 py-2">
      <span className="text-xs text-ink-500">{rotulo}</span>
      <span className={valor ? "text-sm font-medium text-ink-950" : "text-sm text-ink-400"}>
        {valor ?? "ainda não informado"}
      </span>
    </div>
  );
}

export function HighTicketHandoverPanel({
  conversaSelecionada,
  mensagensClienteRecentes,
  inserirNaResposta,
}: InboxModuleContext) {
  const { workspaceId } = useWorkspace();
  const mensagens = useMemo(() => mensagensClienteRecentes ?? [], [mensagensClienteRecentes]);

  const [escalando, setEscalando] = useState(false);
  const [ticketAberto, setTicketAberto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const intencaoCompra = useMemo(() => detectarIntencaoCompraExplicita(mensagens), [mensagens]);
  const pediuVisita = useMemo(() => mensagens.some((t) => detectarGatilhoAgendamentoVisita(t)), [mensagens]);
  const resumo = useMemo(
    () =>
      construirResumoExecutivoHandoff({
        nomeCliente: conversaSelecionada?.nome ?? "",
        mensagensClienteRecentes: mensagens,
      }),
    [conversaSelecionada?.nome, mensagens]
  );

  const exigeHumano = intencaoCompra !== null;

  async function escalarParaCorretor() {
    if (!conversaSelecionada) return;
    setEscalando(true);
    setErro(null);
    try {
      const ticket = await abrirTransbordo({
        solicitacao: {
          traceId: `imob_${Date.now().toString(36)}`,
          politicaId: POLITICA_IMOBILIARIO_ALTO_PADRAO.id,
          severidade: "alta",
          veredito: "transbordo",
          violacoes: [
            {
              regra: "preco-comercial-nao-autorizado",
              severidade: "alta",
              mensagem: intencaoCompra
                ? `${intencaoCompra.rotulo}: "${intencaoCompra.trechoDetectado}"`
                : "Handover de alto ticket solicitado pelo operador.",
            },
          ],
          // Conteúdo JÁ mascarado pelo Shield-Layer antes de chegar a este
          // componente (ver `InboxModuleContext`) — o ticket nunca carrega o
          // original, só o que o operador já podia ver na tela.
          payloadMascarado: mensagens.slice(0, 3).join(" | ").slice(0, 2000),
        },
        // Handover nascido da Neural Inbox, não de um fluxo — mesmo padrão
        // dos demais tickets de conversa (`conversationId` presente,
        // `flowId` identificando a origem).
        flowId: "neural-inbox",
        flowNome: "Neural Inbox — Handover de Alto Ticket",
        conversationId: conversaSelecionada.id,
        workspaceId: workspaceId ?? undefined,
        motivoForcado: "agendamento-visita-presencial",
        resumoExecutivo: resumo,
        noCritico: true,
      });
      setTicketAberto(ticket.id);
    } catch (e) {
      reportarErro(e, "imobiliario:handover-alto-ticket");
      setErro("Não foi possível abrir o transbordo agora. Tente novamente em alguns instantes.");
    } finally {
      setEscalando(false);
    }
  }

  function inserirNotaDeTransicao() {
    const partes = [
      "Perfeito! Já registrei tudo o que conversamos.",
      exigeHumano
        ? "Um corretor da nossa equipe assume a partir daqui para tratar proposta e condições — ele retoma com você em instantes, sem precisar repetir nada."
        : "Um corretor da equipe retoma com você em instantes com os próximos passos.",
    ];
    inserirNaResposta(partes.join(" "));
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Handover de alto ticket</h3>
          <p className="mt-0.5 text-xs text-ink-400">
            {conversaSelecionada ? conversaSelecionada.nome : "Nenhuma conversa selecionada"} · guardrails do motor
            vertical imobiliário
          </p>
        </div>
        <span
          className={
            exigeHumano
              ? "flex-none rounded-full bg-state-error-bg px-2.5 py-1 text-[11px] font-medium text-state-error"
              : "flex-none rounded-full bg-state-done-bg px-2.5 py-1 text-[11px] font-medium text-state-done"
          }
        >
          {exigeHumano ? "humano obrigatório" : "autonomia liberada"}
        </span>
      </div>

      {/* Guardrail 1 — sempre ativo, declarado em voz alta. */}
      <div className="rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 px-3 py-2">
        <p className="text-xs font-medium text-ink-700">Proteção de Caixa ativa</p>
        <p className="mt-0.5 text-[11px] text-ink-500">
          Política <span className="mono">{POLITICA_IMOBILIARIO_ALTO_PADRAO.id}</span> — valor de tabela exato,
          percentual de desconto e condição de parcelamento são interceptados na saída do agente e bloqueados
          antes de chegar ao lead, sem exceção de horário ou canal.
        </p>
      </div>

      {/* Guardrail 2 — gatilho de handover. */}
      {exigeHumano && intencaoCompra && (
        <div className="rounded-[var(--radius-sm)] border border-state-error/40 bg-state-error-bg px-3 py-2">
          <p className="text-xs font-semibold text-state-error">
            Intenção explícita de compra detectada — {intencaoCompra.rotulo}
          </p>
          <p className="mono mt-1 text-[11px] text-ink-700">&ldquo;{intencaoCompra.trechoDetectado}&rdquo;</p>
          <p className="mt-1 text-[11px] text-ink-600">
            A partir daqui, nenhuma resposta autônoma deve tratar proposta, reserva ou estrutura de pagamento — a
            negociação é de alçada humana.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {/* `?? null`: os campos de `ResumoExecutivoHandoff` são opcionais no
            tipo (um resumo persistido por uma versão anterior pode não
            trazê-los) — tratar ausente e vazio da mesma forma é o
            comportamento certo aqui, os dois significam "não informado". */}
        <Sinal rotulo="Faixa de orçamento" valor={resumo.faixaOrcamento ?? null} />
        <Sinal rotulo="Imóvel de interesse" valor={resumo.imovelInteresse ?? null} />
        <Sinal rotulo="Objeção mapeada" valor={resumo.objecaoMapeada ?? null} />
        <Sinal rotulo="Visita presencial pedida" valor={pediuVisita ? "sim" : null} />
      </div>

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      {ticketAberto ? (
        <p className="rounded-[var(--radius-sm)] border border-state-done-ink/30 bg-state-done-bg px-3 py-2 text-xs text-state-done">
          ✓ Transbordo aberto (<span className="mono">{ticketAberto.slice(0, 10)}</span>) com o Resumo Executivo
          anexado. Acompanhe em Governança → Transbordo.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={exigeHumano ? "primary" : "secondary"}
            loading={escalando}
            disabled={!conversaSelecionada}
            onClick={escalarParaCorretor}
          >
            Passar ao corretor com resumo executivo
          </Button>
          <Button size="sm" variant="secondary" disabled={!conversaSelecionada} onClick={inserirNotaDeTransicao}>
            Inserir nota de transição
          </Button>
        </div>
      )}
    </section>
  );
}

export default HighTicketHandoverPanel;
