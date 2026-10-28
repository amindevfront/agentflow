"use client";

// Neural Inbox — central de atendimento omnichannel.
//
// Três sistemas já construídos se encontram nesta tela:
//   - Shield-Layer de PII (`@/lib/guardrails/piiVault`) — toda mensagem que
//     chega aqui já está mascarada; nada em claro passa pela UI.
//   - Radar de sentimento (`@/lib/sentiment/radar`) — o índice de frustração
//     e o Circuit Breaker, visíveis no cabeçalho da conversa.
//   - Swarm Routing (`@/lib/inbox/swarm`) — a atribuição e sua trilha de
//     explicabilidade (por que este operador, por que este agente).
//
// O harness de "simular mensagem do cliente" existe porque não há, neste
// ambiente, credenciais reais de WhatsApp/Meta para gerar tráfego de entrada
// de verdade (ver `/api/inbox/webhook`) — é rotulado explicitamente como
// simulação, no mesmo espírito do `PayloadSimulator` dos fluxos: nunca finge
// ser o canal real, só exercita o pipeline real (mascaramento, radar,
// roteamento) de ponta a ponta.

import { useEffect, useMemo, useState } from "react";
import type {
  AgentProfile,
  Canal,
  Conversation,
  ConversationMessage,
  OperatorProfile,
  RoiConfig,
} from "@/types";
import {
  atribuirConversaManual,
  atribuirConversaPorRoteamento,
  criarConversa,
  enviarMensagemOperador,
  registrarMensagemCliente,
  resolverConversa,
  subscribeAgentProfiles,
  subscribeConversations,
  subscribeMessages,
  subscribeOperatorProfiles,
} from "@/lib/inbox/firestore";
import { rotear } from "@/lib/inbox/swarm";
import { calcularReceitaRecuperadaMadrugada } from "@/lib/inbox/revenueRescue";
import { LIMIAR_FRUSTRACAO_CRITICA, gerarExecutiveBrief } from "@/lib/sentiment/radar";
import { ROI_CONFIG_PADRAO, cambioParaMoeda, formatarMoeda, formatarPercentual, subscribeRoiConfig } from "@/lib/roi";
import { auth } from "@/lib/firebase";
import { useWorkspace } from "@/lib/workspace";
import { useWorkspaceDoc } from "@/lib/queries/workspace";
import { BusinessROIWidget } from "@/components/BusinessROIWidget";
import { NicheAttachmentsPanel } from "@/components/niche/NicheAttachmentsPanel";
import { AppointmentRemindersPanel } from "@/components/niche/AppointmentRemindersPanel";
import { CargoTriagePanel } from "@/components/niche/CargoTriagePanel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricCard } from "@/components/ui/MetricCard";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { cn, formatRelativeTime, initials } from "@/lib/utils";

const ROTULO_CANAL: Record<Canal, string> = {
  whatsapp: "WhatsApp",
  webchat: "Web Chat",
  instagram: "Instagram",
  facebook: "Facebook",
  email: "E-mail",
};

const corStatus: Record<Conversation["status"], string> = {
  aberta: "bg-signal-100 text-signal-700",
  "em-atendimento": "bg-state-run-bg text-state-run",
  "aguardando-cliente": "bg-state-idle-bg text-state-idle",
  resolvida: "bg-state-done-bg text-state-done",
  escalada: "bg-state-error-bg text-state-error",
  arquivada: "bg-state-idle-bg text-state-idle",
};

const ROTULO_STATUS: Record<Conversation["status"], string> = {
  aberta: "aberta",
  "em-atendimento": "em atendimento",
  "aguardando-cliente": "aguardando cliente",
  resolvida: "resolvida",
  escalada: "escalada",
  arquivada: "arquivada",
};

function corFrustracao(indice: number): string {
  if (indice >= LIMIAR_FRUSTRACAO_CRITICA) return "text-state-error";
  if (indice >= 40) return "text-state-run";
  return "text-state-done";
}

/** Mesmas faixas de `corFrustracao`, na versão para o preenchimento do medidor. */
function corBarraFrustracao(indice: number): string {
  if (indice >= LIMIAR_FRUSTRACAO_CRITICA) return "bg-state-error-ink";
  if (indice >= 40) return "bg-state-run-ink";
  return "bg-state-done-ink";
}

/**
 * Acento de severidade na lista de conversas — silencioso (transparente) em
 * níveis normais de frustração: colorir toda a lista mesmo quando nada
 * precisa de atenção seria exatamente a "poluição visual que gera ansiedade"
 * que esta varredura pede para evitar. Só aparece quando há algo a notar.
 */
function acentoFrustracaoLista(indice: number): string {
  if (indice >= LIMIAR_FRUSTRACAO_CRITICA) return "bg-state-error-ink";
  if (indice >= 40) return "bg-state-run-ink";
  return "bg-transparent";
}

/**
 * Medidor horizontal do índice de frustração — feedback visual imediato
 * (o pedido explícito de "UX dopaminérgica"): a cor e o preenchimento
 * comunicam a gravidade antes mesmo de ler o número.
 */
function MedidorFrustracao({ indice }: { indice: number }) {
  return (
    <div
      role="meter"
      aria-valuenow={indice}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Índice de frustração"
      className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
    >
      <div
        className={cn("h-full rounded-full transition-all", corBarraFrustracao(indice))}
        style={{ width: `${Math.min(100, Math.max(0, indice))}%` }}
      />
    </div>
  );
}

type FiltroInbox = "ativas" | "circuit-breaker" | "sem-atribuicao" | "resolvidas" | "todas";

function corresponde(conversa: Conversation, filtro: FiltroInbox): boolean {
  if (filtro === "todas") return true;
  if (filtro === "circuit-breaker") return conversa.circuitBreakerAtivo;
  if (filtro === "sem-atribuicao") return conversa.atribuidoTipo === "nenhum";
  if (filtro === "resolvidas") return conversa.status === "resolvida";
  return conversa.status !== "resolvida" && conversa.status !== "arquivada";
}

export function NeuralInbox() {
  const { workspaceId } = useWorkspace();
  // Determina o nicho ativo (Quiz de onboarding) para os módulos de
  // refinamento por setor abaixo — cada um só aparece no workspace a que
  // de fato se aplica (ver Dual-Layer/Onboarding Cognitivo).
  const { data: workspace } = useWorkspaceDoc(workspaceId);
  const [conversas, setConversas] = useState<Conversation[]>([]);
  const [operadores, setOperadores] = useState<OperatorProfile[]>([]);
  const [agentes, setAgentes] = useState<AgentProfile[]>([]);
  const [mensagens, setMensagens] = useState<ConversationMessage[]>([]);
  // Dual-currency: a mesma moeda/regime configurados em Governança →
  // Parâmetros, refletidos aqui em tempo real — nenhum seletor próprio.
  const [roiConfig, setRoiConfig] = useState<RoiConfig>(ROI_CONFIG_PADRAO);

  const [filtro, setFiltro] = useState<FiltroInbox>("ativas");
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);

  const [resposta, setResposta] = useState("");
  const [simulacao, setSimulacao] = useState("");
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [novaConversaAberta, setNovaConversaAberta] = useState(false);
  const [novoNomeCliente, setNovoNomeCliente] = useState("");
  const [novoContatoCliente, setNovoContatoCliente] = useState("");
  const [novoAssunto, setNovoAssunto] = useState("");

  // Fechados por padrão: são ferramentas de explicabilidade/teste, não o
  // caminho principal — mantê-las abertas por padrão poluiria a tela de
  // atendimento real com informação que a maioria das interações não precisa.
  const [roteamentoAberto, setRoteamentoAberto] = useState(false);
  const [simuladorAberto, setSimuladorAberto] = useState(false);

  useEffect(() => {
    const cancelamentos = [
      subscribeConversations(setConversas, {
        onError: () => setErro("Não foi possível carregar as conversas agora. Tente novamente em instantes."),
      }),
      subscribeOperatorProfiles(setOperadores),
      subscribeAgentProfiles(setAgentes),
      subscribeRoiConfig(setRoiConfig),
    ];
    return () => cancelamentos.forEach((cancelar) => cancelar());
  }, []);

  useEffect(() => {
    if (!selecionadaId) {
      setMensagens([]);
      return;
    }
    return subscribeMessages(selecionadaId, setMensagens, {
      onError: () => setErro("Não foi possível carregar as mensagens desta conversa agora. Tente novamente em instantes."),
    });
  }, [selecionadaId]);

  const visiveis = useMemo(() => conversas.filter((c) => corresponde(c, filtro)), [conversas, filtro]);
  const selecionada = conversas.find((c) => c.id === selecionadaId) ?? null;

  const contagens = useMemo(() => {
    const ativas = conversas.filter((c) => corresponde(c, "ativas")).length;
    const circuitBreaker = conversas.filter((c) => c.circuitBreakerAtivo).length;
    const semAtribuicao = conversas.filter((c) => c.atribuidoTipo === "nenhum" && c.status !== "resolvida").length;
    const resolvidas = conversas.filter((c) => c.status === "resolvida").length;
    const comFrustracao = conversas.filter((c) => c.status !== "resolvida");
    const frustracaoMedia =
      comFrustracao.length > 0
        ? Math.round(comFrustracao.reduce((acc, c) => acc + c.frustrationIndex, 0) / comFrustracao.length)
        : 0;
    return { ativas, circuitBreaker, semAtribuicao, resolvidas, frustracaoMedia };
  }, [conversas]);

  // Motor de Resgate de Receita Perdida: conversas de alta intenção comercial
  // resolvidas fora do expediente — prova de ROI imediato ("a empresa estaria
  // fechada e o cliente foi atendido assim mesmo"). Ver `@/lib/inbox/revenueRescue`
  // sobre por que isto conta volume real em vez de inventar um valor em R$.
  const receitaMadrugada = useMemo(() => calcularReceitaRecuperadaMadrugada(conversas), [conversas]);

  // Custo humano evitado só nessas conversas — mesma fórmula honesta já
  // usada em `calcularRoi` (minutos manuais configurados × custo-hora),
  // nunca um valor de negócio inventado. Dual-currency: usa a mesma
  // moeda/regime configurados em Governança, recalculando automaticamente.
  const custoEvitadoMadrugadaBrl =
    (receitaMadrugada.totalConversas * roiConfig.minutosManuaisPorConversa * roiConfig.custoHoraOperadorBrl) / 60;
  const custoEvitadoMadrugadaFormatado = formatarMoeda(
    custoEvitadoMadrugadaBrl,
    roiConfig.moedaExibicao,
    cambioParaMoeda(roiConfig, roiConfig.moedaExibicao)
  );

  const opcoesFiltro = [
    { valor: "ativas" as const, label: "Ativas", contagem: contagens.ativas },
    { valor: "circuit-breaker" as const, label: "Circuit Breaker", contagem: contagens.circuitBreaker },
    { valor: "sem-atribuicao" as const, label: "Sem atribuição", contagem: contagens.semAtribuicao },
    { valor: "resolvidas" as const, label: "Resolvidas", contagem: contagens.resolvidas },
    { valor: "todas" as const, label: "Todas", contagem: conversas.length },
  ];

  const executiveBrief = useMemo(() => {
    if (!selecionada?.circuitBreakerAtivo) return null;
    return gerarExecutiveBrief({
      indice: selecionada.frustrationIndex,
      tendencia: selecionada.frustrationTendencia,
      sinais: selecionada.roteamento?.intencao.sinais ?? [],
      circuitBreakerAtivado: true,
    });
  }, [selecionada]);

  async function handleEnviarResposta() {
    if (!selecionada || resposta.trim().length === 0) return;
    const uid = auth?.currentUser?.uid;
    if (!uid) {
      setErro("Sessão expirada. Entre novamente para responder.");
      return;
    }

    setProcessando(true);
    setErro(null);
    try {
      await enviarMensagemOperador({
        conversationId: selecionada.id,
        texto: resposta,
        remetente: "operador",
        remetenteId: uid,
        canal: selecionada.canal,
        workspaceId: selecionada.workspaceId,
      });
      setResposta("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar a resposta.");
    } finally {
      setProcessando(false);
    }
  }

  async function handleSimularMensagemCliente() {
    if (!selecionada || simulacao.trim().length === 0) return;
    setProcessando(true);
    setErro(null);
    try {
      await registrarMensagemCliente({
        conversationId: selecionada.id,
        texto: simulacao,
        canal: selecionada.canal,
        workspaceId: selecionada.workspaceId,
      });
      setSimulacao("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível simular a mensagem.");
    } finally {
      setProcessando(false);
    }
  }

  async function handleAssumir() {
    if (!selecionada) return;
    const usuario = auth?.currentUser;
    if (!usuario) {
      setErro("Sessão expirada.");
      return;
    }
    setProcessando(true);
    setErro(null);
    try {
      await atribuirConversaManual(selecionada.id, usuario.uid, usuario.displayName ?? usuario.email ?? "Operador");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível assumir a conversa.");
    } finally {
      setProcessando(false);
    }
  }

  async function handleRotear() {
    if (!selecionada) return;
    setProcessando(true);
    setErro(null);
    try {
      const ultimaMensagemCliente =
        [...mensagens].reverse().find((m) => m.remetente === "cliente")?.texto ?? selecionada.assunto;

      const decisao = rotear({
        texto: ultimaMensagemCliente,
        totalMensagensAnteriores: selecionada.totalMensagens,
        operadores,
        agentes,
      });

      await atribuirConversaPorRoteamento(selecionada.id, decisao);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível rotear a conversa.");
    } finally {
      setProcessando(false);
    }
  }

  async function handleResolver() {
    if (!selecionada) return;
    setProcessando(true);
    setErro(null);
    try {
      await resolverConversa(selecionada.id, selecionada.workspaceId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível resolver a conversa.");
    } finally {
      setProcessando(false);
    }
  }

  /** Insere um texto pronto (anexo de nicho, resposta sugerida de rastreio) na caixa de resposta, sem sobrescrever o que já foi digitado. */
  function inserirNaResposta(texto: string) {
    setResposta((atual) => (atual.trim().length > 0 ? `${atual}\n${texto}` : texto));
  }

  async function handleCriarConversa() {
    if (novoNomeCliente.trim().length === 0 || novoContatoCliente.trim().length === 0) return;
    setProcessando(true);
    setErro(null);
    try {
      const conversa = await criarConversa({
        canal: "webchat",
        nomeParticipante: novoNomeCliente.trim(),
        identificadorParticipante: novoContatoCliente.trim(),
        assunto: novoAssunto.trim() || "Novo contato via Web Chat",
      });
      setSelecionadaId(conversa.id);
      setNovaConversaAberta(false);
      setNovoNomeCliente("");
      setNovoContatoCliente("");
      setNovoAssunto("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar a conversa.");
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          rotulo="Conversas ativas"
          valor={String(contagens.ativas)}
          detalhe={`${contagens.semAtribuicao} sem atribuição`}
          tom={contagens.semAtribuicao > 0 ? "atencao" : "neutro"}
        />
        <MetricCard
          rotulo="Circuit Breaker ativo"
          valor={String(contagens.circuitBreaker)}
          detalhe="frustração crítica — P1 de SLA aberto"
          tom={contagens.circuitBreaker > 0 ? "erro" : "positivo"}
        />
        <MetricCard
          rotulo="Frustração média"
          valor={`${contagens.frustracaoMedia}/100`}
          detalhe="conversas não resolvidas"
          tom={contagens.frustracaoMedia >= LIMIAR_FRUSTRACAO_CRITICA ? "erro" : contagens.frustracaoMedia >= 40 ? "atencao" : "positivo"}
        />
        <MetricCard rotulo="Resolvidas" valor={String(contagens.resolvidas)} detalhe="neste carregamento" tom="positivo" />
        <MetricCard
          rotulo="Receita recuperada de madrugada"
          valor={String(receitaMadrugada.totalConversas)}
          detalhe={`${receitaMadrugada.totalAltaIntencaoComercial} de alta intenção comercial · ${
            receitaMadrugada.totalConversas > 0 ? `${custoEvitadoMadrugadaFormatado} evitados` : "fora do expediente"
          }`}
          tom={receitaMadrugada.totalConversas > 0 ? "marca" : "neutro"}
          dica="Conversas resolvidas cujo primeiro contato ocorreu fora do horário comercial (padrão: 8h–18h, seg. a sex.) — demanda que, sem atendimento automatizado, teria esperado o próximo dia útil ou sido perdida. O valor evitado usa a mesma fórmula do painel de ROI (minutos manuais × custo-hora configurados), nunca um valor de negócio estimado."
        />
      </div>

      {/* Relatório de Economia & Resgate de Receita — mesmo widget da
          Governança, embutido aqui para a visão simplificada (`operacoes`):
          quem não acessa Governança ainda vê o essencial do ROI sem sair do
          atendimento diário (ver Dual-Layer Workspace View, `@/components/layout/navAcesso`). */}
      <BusinessROIWidget compacto />

      {/* Refinamento funcional por nicho (Onboarding Cognitivo): cada módulo
          só aparece no setor a que se aplica — nenhum workspace vê os três. */}
      {workspace?.setor === "construtora-imobiliaria" && (
        <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
          <NicheAttachmentsPanel onInsert={inserirNaResposta} />
        </section>
      )}
      {workspace?.setor === "clinica-alto-padrao" && (
        <AppointmentRemindersPanel
          conversaSelecionada={selecionada ? { id: selecionada.id, nome: selecionada.participante.nome } : null}
        />
      )}
      {workspace?.setor === "logistica-portuaria" && (
        <CargoTriagePanel
          textoParaExtrairCodigo={[...mensagens].reverse().find((m) => m.remetente === "cliente")?.texto}
          onInsertResposta={inserirNaResposta}
        />
      )}

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <SegmentedFilter rotuloGrupo="Filtro da Neural Inbox" opcoes={opcoesFiltro} selecionado={filtro} onChange={setFiltro} />
            <Button size="sm" variant="secondary" onClick={() => setNovaConversaAberta((v) => !v)}>
              Nova conversa
            </Button>
          </div>

          {novaConversaAberta && (
            <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-signal-500 bg-signal-50 p-3">
              <p className="text-xs font-medium text-ink-700">
                Simula o primeiro contato de um cliente via Web Chat — não requer credenciais de canal externo.
              </p>
              <input
                value={novoNomeCliente}
                onChange={(e) => setNovoNomeCliente(e.target.value)}
                placeholder="Nome do cliente"
                className="h-9 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
              />
              <input
                value={novoContatoCliente}
                onChange={(e) => setNovoContatoCliente(e.target.value)}
                placeholder="Telefone ou e-mail (será mascarado)"
                className="h-9 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
              />
              <input
                value={novoAssunto}
                onChange={(e) => setNovoAssunto(e.target.value)}
                placeholder="Assunto (opcional)"
                className="h-9 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
              />
              <div className="flex gap-2">
                <Button size="sm" loading={processando} onClick={handleCriarConversa}>
                  Criar conversa
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setNovaConversaAberta(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {visiveis.length === 0 ? (
            <EmptyState
              title="Nenhuma conversa nesta visão"
              description="Conversas chegam aqui em tempo real de WhatsApp, Web Chat e redes sociais, assim que o Shield-Layer processa a primeira mensagem."
            />
          ) : (
            <ul className="flex flex-col gap-1 overflow-y-auto">
              {visiveis.map((conversa) => {
                const ativa = conversa.id === selecionadaId;
                return (
                  <li key={conversa.id}>
                    <button
                      type="button"
                      onClick={() => setSelecionadaId(conversa.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-colors",
                        ativa ? "border-signal-500 bg-signal-50" : "border-transparent hover:bg-mist-50"
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn("h-9 w-1 flex-none rounded-full", acentoFrustracaoLista(conversa.frustrationIndex))}
                      />
                      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-signal-100 font-mono text-xs font-medium text-signal-700">
                        {initials(conversa.participante.nome)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold text-ink-950">{conversa.participante.nome}</span>
                          {conversa.circuitBreakerAtivo && (
                            <span className="mono flex-none rounded-full bg-state-error-bg px-1.5 py-0.5 text-[10px] font-medium text-state-error">
                              P1
                            </span>
                          )}
                          {workspace?.setor === "construtora-imobiliaria" && conversa.leadAltoPadrao && (
                            <span
                              className="mono flex-none rounded-full bg-signal-100 px-1.5 py-0.5 text-[10px] font-medium text-signal-700"
                              title="Lead Qualificado de Alto Padrão — capacidade de investimento + urgência de compra detectadas"
                            >
                              ALTO PADRÃO
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-ink-500">{conversa.ultimaMensagemPreview || conversa.assunto}</p>
                      </div>
                      <div className="flex flex-none flex-col items-end gap-1">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", corStatus[conversa.status])}>
                          {ROTULO_STATUS[conversa.status]}
                        </span>
                        <span className="mono text-[11px] text-ink-400">{formatRelativeTime(new Date(conversa.ultimaMensagemEm))}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
          {!selecionada ? (
            <EmptyState
              title="Selecione uma conversa"
              description="A trilha completa — mensagens, frustração, roteamento — aparece aqui."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-ink-100 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink-950">{selecionada.participante.nome}</h3>
                    <span className="mono rounded-full bg-mist-50 px-2 py-0.5 text-[11px] text-ink-500">
                      {ROTULO_CANAL[selecionada.canal]}
                    </span>
                  </div>
                  <p className="mono text-xs text-ink-400">{selecionada.participante.identificadorMascarado}</p>
                  {workspace?.setor === "construtora-imobiliaria" && selecionada.leadAltoPadrao && (
                    <span
                      className="mono mt-1 inline-flex items-center gap-1 rounded-full bg-signal-100 px-2 py-0.5 text-[11px] font-medium text-signal-700"
                      title={[...(selecionada.leadSinaisCapacidade ?? []), ...(selecionada.leadSinaisUrgencia ?? [])].join(", ")}
                    >
                      Lead Qualificado de Alto Padrão
                    </span>
                  )}
                </div>
                <div className="flex w-44 flex-none flex-col items-end gap-1">
                  <span className={cn("mono whitespace-nowrap text-sm font-medium", corFrustracao(selecionada.frustrationIndex))}>
                    {selecionada.frustrationIndex}/100 · {selecionada.frustrationTendencia}
                  </span>
                  <MedidorFrustracao indice={selecionada.frustrationIndex} />
                </div>
              </div>

              {selecionada.circuitBreakerAtivo && executiveBrief && (
                <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-state-error-ink/40 bg-state-error-bg p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono flex-none rounded-full bg-state-error px-2 py-0.5 text-[11px] font-semibold text-white">
                      P1 · CIRCUIT BREAKER
                    </span>
                    <p className="text-xs font-semibold text-state-error">
                      Ticket de SLA aberto{selecionada.slaTicketId ? ` (${selecionada.slaTicketId})` : ""}
                    </p>
                  </div>
                  <p className="text-xs text-ink-700">
                    <span className="font-medium">Motivo provável:</span> {executiveBrief.motivoProvavel}
                  </p>
                  {executiveBrief.sinaisDetectados.length > 0 && (
                    <p className="text-xs text-ink-500">Sinais: {executiveBrief.sinaisDetectados.join(", ")}</p>
                  )}
                  <div>
                    <p className="text-xs font-medium text-ink-700">Scripts sugeridos:</p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {executiveBrief.scriptsSugeridos.map((script, i) => (
                        <li key={i} className="text-xs text-ink-700">
                          “{script}”
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                <span>
                  Atribuído a:{" "}
                  <span className="font-medium text-ink-900">
                    {selecionada.atribuidoTipo === "nenhum" ? "ninguém" : `${selecionada.atribuidoNome} (${selecionada.atribuidoTipo})`}
                  </span>
                </span>
                {selecionada.atribuidoTipo === "nenhum" && (
                  <>
                    <Button size="sm" variant="secondary" disabled={processando} onClick={handleAssumir}>
                      Assumir
                    </Button>
                    <Button size="sm" variant="secondary" disabled={processando} onClick={handleRotear} title="Aciona o Swarm Routing para encontrar o melhor operador ou agente disponível">
                      Rotear automaticamente
                    </Button>
                  </>
                )}
                {selecionada.status !== "resolvida" && (
                  <Button size="sm" variant="secondary" disabled={processando} onClick={handleResolver}>
                    Marcar como resolvida
                  </Button>
                )}
              </div>

              {selecionada.roteamento && (
                <div className="rounded-[var(--radius-sm)] border border-ink-100 text-xs">
                  <button
                    type="button"
                    onClick={() => setRoteamentoAberto((v) => !v)}
                    aria-expanded={roteamentoAberto}
                    className="flex w-full items-center justify-between px-2 py-1.5 text-left font-medium text-ink-700 hover:bg-mist-50"
                  >
                    <span>Por que foi roteada assim? (explicabilidade do Swarm Routing)</span>
                    <span className="mono text-ink-400">{roteamentoAberto ? "ocultar" : "mostrar"}</span>
                  </button>
                  {roteamentoAberto && (
                    <div className="flex flex-col gap-2 border-t border-ink-100 p-2">
                      <p className="text-ink-500">
                        Intenção:{" "}
                        <span className="font-medium text-ink-900">{selecionada.roteamento.intencao.categoria}</span>{" "}
                        (confiança {formatarPercentual(selecionada.roteamento.intencao.confianca, 0)}) ·
                        Complexidade {formatarPercentual(selecionada.roteamento.complexidade, 0)}
                      </p>
                      {selecionada.roteamento.candidatos.map((candidato) => (
                        <div key={`${candidato.tipo}-${candidato.id}`} className="rounded-[var(--radius-sm)] bg-mist-50 p-2">
                          <p className="font-medium text-ink-900">
                            {candidato.nome} ({candidato.tipo}) — score {formatarPercentual(candidato.score, 0)}
                          </p>
                          <ul className="mt-1 list-inside list-disc text-ink-500">
                            {candidato.motivos.map((motivo, i) => (
                              <li key={i}>{motivo}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 p-3">
                {mensagens.length === 0 ? (
                  <p className="text-xs text-ink-400">Nenhuma mensagem ainda.</p>
                ) : (
                  mensagens.map((mensagem) => {
                    const doCliente = mensagem.remetente === "cliente";
                    return (
                      <div key={mensagem.id} className={cn("flex flex-col gap-0.5", doCliente ? "items-start" : "items-end")}>
                        <div
                          className={cn(
                            "max-w-[80%] rounded-[var(--radius-sm)] px-3 py-2 text-sm",
                            doCliente ? "bg-white text-ink-950" : "bg-signal-600 text-white"
                          )}
                        >
                          {mensagem.texto}
                        </div>
                        <span className="mono text-[11px] text-ink-400">
                          {mensagem.remetente} · {formatRelativeTime(new Date(mensagem.enviadaEm))}
                          {mensagem.piiDetectada.length > 0 && ` · PII mascarada: ${mensagem.piiDetectada.join(", ")}`}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-ink-700" htmlFor="inbox-resposta">
                  Responder
                </label>
                <div className="flex gap-2">
                  <input
                    id="inbox-resposta"
                    value={resposta}
                    onChange={(e) => setResposta(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleEnviarResposta()}
                    placeholder="Digite a resposta ao cliente"
                    className="h-10 flex-1 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
                  />
                  <Button size="sm" loading={processando} disabled={resposta.trim().length === 0} onClick={handleEnviarResposta}>
                    Enviar
                  </Button>
                </div>
              </div>

              {/* Ferramenta de teste, não o fluxo principal: escondida por
                  padrão para não poluir o atendimento real com um campo que a
                  maior parte das interações nunca usa. */}
              {simuladorAberto ? (
                <div className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-ink-200 p-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-ink-500" htmlFor="inbox-simulacao">
                      Simular mensagem do cliente (sem credenciais de canal real — exercita o pipeline real)
                    </label>
                    <button
                      type="button"
                      onClick={() => setSimuladorAberto(false)}
                      className="text-[11px] font-medium text-ink-400 hover:text-ink-700"
                    >
                      ocultar
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      id="inbox-simulacao"
                      value={simulacao}
                      onChange={(e) => setSimulacao(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSimularMensagemCliente()}
                      placeholder="Ex.: Isso é um absurdo, vou cancelar!"
                      className="h-9 flex-1 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-xs outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={processando}
                      disabled={simulacao.trim().length === 0}
                      onClick={handleSimularMensagemCliente}
                    >
                      Simular
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setSimuladorAberto(true)}
                  className="self-start text-[11px] font-medium text-ink-400 hover:text-signal-600"
                >
                  modo de teste: simular mensagem do cliente
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default NeuralInbox;
