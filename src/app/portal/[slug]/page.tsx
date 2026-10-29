"use client";

// Portal do Cliente — visão mobile-first, dopaminérgica, de UM workspace
// específico, para o PRÓPRIO cliente final (dono do salão/clínica/
// imobiliária) acompanhar sem precisar navegar pelo painel administrativo
// completo.
//
// Segurança: o `slug` na URL é só uma forma bonita de link — a leitura real
// (`useWorkspace()`) sempre resolve o workspace do USUÁRIO AUTENTICADO, e
// toda assinatura de dados (conversas, execuções) é a mesma já usada em
// `/inbox`/`/flows`, protegida pelas mesmas regras do Firestore
// (`belongsToWorkspace`). Não existe aqui nenhum caminho que leia o
// workspace de outra pessoa a partir do slug — ver `getWorkspaceBySlug` em
// `@/lib/firestore`, que a própria regra do Firestore já restringe ao
// chamador autenticado.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Campaign, Conversation, FlowRun, HandoffTicket, RoiConfig, Workspace } from "@/types";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { useInvalidarWorkspace, useWorkspaceDoc } from "@/lib/queries/workspace";
import { patchWorkspace, subscribeFlowRuns } from "@/lib/firestore";
import { subscribeFilaTransbordo } from "@/lib/humanInTheLoop";
import { subscribeConversations } from "@/lib/inbox/firestore";
import { subscribeCampaigns } from "@/lib/campaigns/firestore";
import { EXPEDIENTE_PADRAO, calcularReceitaRecuperadaMadrugada } from "@/lib/inbox/revenueRescue";
import {
  ROI_CONFIG_PADRAO,
  cambioParaMoeda,
  calcularRoi,
  formatarMoeda,
  periodoMesAtual,
  subscribeRoiConfig,
} from "@/lib/roi";
import { NICHE_PRESETS } from "@/lib/niches";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { MetricCard } from "@/components/ui/MetricCard";
import { EmptyState } from "@/components/ui/EmptyState";

const DIAS_UTEIS_PADRAO = [1, 2, 3, 4, 5];

export default function PortalClientePage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { appUser, workspaceId, loading: workspaceLoading } = useWorkspace();
  const { data: workspace } = useWorkspaceDoc(workspaceId);
  const invalidarWorkspace = useInvalidarWorkspace();

  const [execucoes, setExecucoes] = useState<FlowRun[]>([]);
  const [tickets, setTickets] = useState<HandoffTicket[]>([]);
  const [conversas, setConversas] = useState<Conversation[]>([]);
  const [campanhas, setCampanhas] = useState<Campaign[]>([]);
  const [config, setConfig] = useState<RoiConfig>(ROI_CONFIG_PADRAO);
  const [referencia] = useState(() => new Date());

  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [configSalva, setConfigSalva] = useState(false);
  const [inicioHora, setInicioHora] = useState(EXPEDIENTE_PADRAO.inicioHora);
  const [fimHora, setFimHora] = useState(EXPEDIENTE_PADRAO.fimHora);
  const [linkConversao, setLinkConversao] = useState("");
  const [servicos, setServicos] = useState<Array<{ nome: string; precoBrl: number }>>([]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!workspace) return;
    setInicioHora(workspace.horarioFuncionamento?.inicioHora ?? EXPEDIENTE_PADRAO.inicioHora);
    setFimHora(workspace.horarioFuncionamento?.fimHora ?? EXPEDIENTE_PADRAO.fimHora);
    setLinkConversao(workspace.linkPrincipalConversao ?? "");
    setServicos(workspace.servicosDestaque ?? []);
  }, [workspace]);

  useEffect(() => {
    if (!workspaceId) return;
    const cancelamentos = [
      subscribeFlowRuns(workspaceId, setExecucoes),
      subscribeFilaTransbordo(setTickets, { workspaceId, limite: 300 }),
      subscribeConversations(setConversas, { workspaceId, limite: 100 }),
      subscribeCampaigns(setCampanhas, { workspaceId }),
      subscribeRoiConfig(setConfig, workspaceId),
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

  const janelaExpediente = useMemo(
    () => ({
      inicioHora: workspace?.horarioFuncionamento?.inicioHora ?? EXPEDIENTE_PADRAO.inicioHora,
      fimHora: workspace?.horarioFuncionamento?.fimHora ?? EXPEDIENTE_PADRAO.fimHora,
      diasUteis: workspace?.horarioFuncionamento?.diasUteis ?? DIAS_UTEIS_PADRAO,
    }),
    [workspace?.horarioFuncionamento]
  );

  const receitaMadrugada = useMemo(
    () => calcularReceitaRecuperadaMadrugada(conversas, janelaExpediente),
    [conversas, janelaExpediente]
  );
  const custoEvitadoMadrugadaBrl =
    (receitaMadrugada.totalConversas * config.minutosManuaisPorConversa * config.custoHoraOperadorBrl) / 60;

  const moedaDoValor = (valorBrl: number) =>
    formatarMoeda(valorBrl, config.moedaExibicao, cambioParaMoeda(config, config.moedaExibicao));

  const conversasRecentes = useMemo(
    () => [...conversas].sort((a, b) => b.ultimaMensagemEm.localeCompare(a.ultimaMensagemEm)).slice(0, 8),
    [conversas]
  );

  const ehAdmin = appUser?.papel === "admin";

  async function salvarConfiguracao() {
    if (!workspaceId) return;
    setSalvandoConfig(true);
    setConfigSalva(false);
    try {
      const patch: Partial<Workspace> = {
        horarioFuncionamento: {
          inicioHora: Math.min(23, Math.max(0, inicioHora)),
          fimHora: Math.min(24, Math.max(1, fimHora)),
          diasUteis: DIAS_UTEIS_PADRAO,
        },
        linkPrincipalConversao: linkConversao.trim() || null,
        servicosDestaque: servicos.filter((s) => s.nome.trim().length > 0),
      };
      await patchWorkspace(workspaceId, patch);
      invalidarWorkspace(workspaceId);
      setConfigSalva(true);
    } finally {
      setSalvandoConfig(false);
    }
  }

  if (authLoading || workspaceLoading || !workspace) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mist-50 text-sm text-ink-400">
        Carregando portal…
      </main>
    );
  }

  const nicheLabel = workspace.setor ? NICHE_PRESETS[workspace.setor].label : null;

  return (
    <main className="min-h-screen bg-mist-50 pb-12">
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-4 md:p-6">
        <header className="rounded-[var(--radius-lg)] border border-ink-100 bg-white p-5 shadow-[var(--shadow-sm)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-ink-950">{workspace.nome}</h1>
              {nicheLabel && <p className="text-xs text-ink-500">{nicheLabel}</p>}
            </div>
            <span className="mono flex-none text-[10px] text-ink-400">/{params.slug}</span>
          </div>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-state-done-bg px-2.5 py-1">
            <span aria-hidden className="dopamina-pulse h-1.5 w-1.5 rounded-full bg-state-done-ink" />
            <span className="text-xs font-medium text-state-done">Proteção de Receita Ativa 24/7</span>
          </div>
        </header>

        <section
          aria-label="Impacto financeiro do mês"
          className="rounded-[var(--radius-lg)] border border-ink-100 bg-white p-5 shadow-[var(--shadow-sm)]"
        >
          <p className="text-xs text-ink-500">Impacto financeiro protegido — {snapshot.periodo.rotulo}</p>
          <p className="mono mt-1 text-3xl font-medium text-signal-700">{moedaDoValor(snapshot.economiaLiquidaBrl)}</p>
          <p className="mt-1 text-xs text-ink-400">
            dinheiro líquido retido no caixa, após custo de IA, revisão humana e plataforma
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <MetricCard
              rotulo="Atendimentos fora do expediente"
              valor={String(receitaMadrugada.totalConversas)}
              detalhe={`${moedaDoValor(custoEvitadoMadrugadaBrl)} evitados`}
              tom={receitaMadrugada.totalConversas > 0 ? "positivo" : "neutro"}
            />
            <MetricCard
              rotulo="Autonomia dos agentes"
              valor={`${Math.round(snapshot.taxaZeroTouch * 100)}%`}
              detalhe="sem toque humano"
              tom={snapshot.taxaZeroTouch >= 0.85 ? "positivo" : "atencao"}
            />
          </div>
        </section>

        <section
          aria-label="Neural Inbox filtrada"
          className="rounded-[var(--radius-lg)] border border-ink-100 bg-white p-5 shadow-[var(--shadow-sm)]"
        >
          <h2 className="text-sm font-semibold text-ink-950">Atendimentos recentes</h2>
          {conversasRecentes.length === 0 ? (
            <EmptyState title="Nenhum atendimento ainda" description="As conversas aparecem aqui em tempo real." />
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {conversasRecentes.map((conversa) => (
                <li
                  key={conversa.id}
                  className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-ink-100 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink-950">{conversa.participante.nome}</span>
                    <span
                      className={
                        conversa.status === "resolvida"
                          ? "rounded-full bg-state-done-bg px-2 py-0.5 text-[11px] font-medium text-state-done"
                          : "rounded-full bg-mist-50 px-2 py-0.5 text-[11px] font-medium text-ink-500"
                      }
                    >
                      {conversa.status === "resolvida" ? "resolvida" : "em andamento"}
                    </span>
                  </div>
                  <p className="truncate text-xs text-ink-500">{conversa.ultimaMensagemPreview || conversa.assunto}</p>
                  {conversa.circuitBreakerAtivo && (
                    <span className="mono inline-flex w-fit items-center rounded-full bg-state-error-bg px-1.5 py-0.5 text-[10px] font-medium text-state-error">
                      Requer atenção humana
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-label="Centro de configuração rápida"
          className="rounded-[var(--radius-lg)] border border-ink-100 bg-white p-5 shadow-[var(--shadow-sm)]"
        >
          <h2 className="text-sm font-semibold text-ink-950">Centro de Configuração Rápida</h2>
          <p className="mt-1 text-xs text-ink-500">
            {ehAdmin
              ? "Esses ajustes entram em vigor imediatamente no atendimento automático."
              : "Somente administradores do workspace podem editar — fale com o responsável."}
          </p>

          <div className="mt-3 flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">Horário de funcionamento</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={23}
                  disabled={!ehAdmin}
                  value={inicioHora}
                  onChange={(e) => setInicioHora(Number(e.target.value))}
                  className="h-9 w-20 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-2 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100 disabled:bg-mist-50"
                />
                <span className="text-xs text-ink-400">às</span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  disabled={!ehAdmin}
                  value={fimHora}
                  onChange={(e) => setFimHora(Number(e.target.value))}
                  className="h-9 w-20 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-2 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100 disabled:bg-mist-50"
                />
                <span className="text-xs text-ink-400">h, seg. a sex.</span>
              </div>
            </div>

            <Field
              label="Link principal de agendamento/conversão"
              value={linkConversao}
              onChange={(e) => setLinkConversao(e.target.value)}
              disabled={!ehAdmin}
              placeholder="https://agendeonline.exemplo.com.br/agendar"
            />

            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">Serviços em destaque</label>
              <div className="flex flex-col gap-2">
                {servicos.map((servico, indice) => (
                  <div key={indice} className="flex gap-2">
                    <input
                      value={servico.nome}
                      disabled={!ehAdmin}
                      onChange={(e) =>
                        setServicos((atual) =>
                          atual.map((s, i) => (i === indice ? { ...s, nome: e.target.value } : s))
                        )
                      }
                      placeholder="Nome do serviço"
                      className="h-9 flex-1 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100 disabled:bg-mist-50"
                    />
                    <input
                      type="number"
                      min={0}
                      disabled={!ehAdmin}
                      value={servico.precoBrl}
                      onChange={(e) =>
                        setServicos((atual) =>
                          atual.map((s, i) => (i === indice ? { ...s, precoBrl: Number(e.target.value) } : s))
                        )
                      }
                      placeholder="R$"
                      className="h-9 w-24 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-2 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100 disabled:bg-mist-50"
                    />
                    {ehAdmin && (
                      <button
                        type="button"
                        onClick={() => setServicos((atual) => atual.filter((_, i) => i !== indice))}
                        className="text-xs font-medium text-ink-400 hover:text-state-error"
                      >
                        remover
                      </button>
                    )}
                  </div>
                ))}
                {ehAdmin && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setServicos((atual) => [...atual, { nome: "", precoBrl: 0 }])}
                  >
                    Adicionar serviço
                  </Button>
                )}
              </div>
            </div>

            {ehAdmin && (
              <Button size="sm" loading={salvandoConfig} onClick={salvarConfiguracao} className="self-start">
                Salvar configuração
              </Button>
            )}
            {configSalva && <p className="text-xs text-state-done">Salvo.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
