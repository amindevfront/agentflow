"use client";

// Motor Vertical — painel de telemetria do nicho ativo (C-Level).
//
// Complementa `RoiOpportunityPanel` em vez de substituí-lo: aquele painel
// fala a língua GENÉRICA do produto (atendimentos, agendamentos, pipeline
// estimado), e este fala a língua da DIRETORIA DA VERTICAL (VGV em
// negociação, visitas na Praia Brava, cotações sub-30s, demurrage exposta).
// Os dois leem as mesmas coleções — a diferença é só a tradução.
//
// Sem dados próprios: todo número vem de `useVerticalEngine`
// (`@/lib/verticalEngine`), que por sua vez delega o cálculo ao motor puro
// `calcularTelemetriaVertical` (`@/lib/verticalTelemetry`). Este arquivo é
// apresentação, nada mais — mesmo desenho de `BusinessROIWidget`.

import Link from "next/link";
import { MetricCard } from "@/components/ui/MetricCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { useVerticalEngine } from "@/lib/verticalEngine";
import { ROTULO_MOTOR, formatarMoedaBrl, formatarValorMetrica } from "@/lib/verticalTelemetry";
import { NICHE_PRESETS } from "@/lib/niches";

function Cabecalho({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  return (
    <header>
      <h2 className="text-sm font-semibold text-ink-950">{titulo}</h2>
      <p className="mt-0.5 text-xs text-ink-400">{subtitulo}</p>
    </header>
  );
}

export function VerticalTelemetryPanel() {
  const motor = useVerticalEngine();

  if (motor.fase === "sem-workspace") {
    return (
      <section
        aria-label="Motor vertical"
        className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4"
      >
        <Cabecalho titulo="Motor vertical" subtitulo="Aguardando a sincronização do workspace…" />
      </section>
    );
  }

  if (motor.fase === "sem-motor") {
    const label = motor.setor ? NICHE_PRESETS[motor.setor]?.label ?? null : null;
    return (
      <section
        aria-label="Motor vertical"
        className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4"
      >
        <Cabecalho
          titulo="Motor vertical"
          subtitulo="Telemetria preditiva na linguagem financeira do seu setor."
        />
        <EmptyState
          title={label ? `${label} ainda não tem motor vertical dedicado` : "Nicho ainda não configurado"}
          description={
            label
              ? "Os motores preditivos desta versão cobrem Imobiliário de Alto Padrão (VGV, visitas, comissão) e Logística B2B (cotações sub-30s, ocorrências autônomas, Risk Shield). As métricas genéricas deste workspace continuam em Oportunidade & Pipeline."
              : "Defina o setor do workspace em Configurações para ativar o motor vertical correspondente."
          }
          action={
            <Link href="/settings" className="text-xs font-medium text-signal-600 hover:underline">
              ir para Configurações
            </Link>
          }
        />
      </section>
    );
  }

  const nomeMotor = ROTULO_MOTOR[motor.contrato.id];
  const ehDemo = motor.origem === "cenario-demo";

  return (
    <section
      aria-label="Motor vertical"
      className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Cabecalho
          titulo={`Motor vertical — ${nomeMotor}`}
          subtitulo={
            motor.fase === "pronto"
              ? `${motor.periodo.rotulo} · ${motor.totalConversas} atendimento(s) na base de cálculo`
              : "Carregando as fontes reativas do workspace…"
          }
        />
        {ehDemo && (
          <span className="rounded-full bg-state-run-bg px-2.5 py-1 text-[11px] font-medium text-state-run">
            cenário de demonstração ativo
          </span>
        )}
      </div>

      {/* Contrato de dados sempre visível: um número de VGV sem o parâmetro
          que o produziu é exatamente o tipo de métrica que não sobrevive a
          uma auditoria de diretoria. */}
      <div className="rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Contrato de dados da vertical</p>
        {motor.contrato.id === "imobiliario-alto-padrao" ? (
          <p className="mt-1 text-xs text-ink-600">
            VGV médio por unidade <span className="mono">{formatarMoedaBrl(motor.contrato.vgvMedioUnidadeBrl)}</span> ·
            comissão média <span className="mono">{formatarMoedaBrl(motor.contrato.comissaoMediaBrl)}</span> · praças{" "}
            {motor.contrato.pracasAlvo.join(", ")}. Valores de referência declarados — recalibre ao ticket real do
            empreendimento.
          </p>
        ) : (
          <p className="mt-1 text-xs text-ink-600">
            SLA de cotação instantânea <span className="mono">{motor.contrato.slaCotacaoSegundos}s</span> ·{" "}
            {motor.contrato.contratosRecorrentesMes > 0
              ? `${motor.contrato.contratosRecorrentesMes} contrato(s) de frete recorrente/mês declarados`
              : "contratos de frete recorrente/mês ainda não informados pelo cliente"}
            . Telemetria de demurrage só considera cargas com free time e custo diário contratados.
          </p>
        )}
      </div>

      {motor.fase === "erro" ? (
        <p className="text-xs text-state-error">{motor.mensagem}</p>
      ) : motor.fase === "carregando" ? (
        <p className="text-xs text-ink-400">Carregando telemetria da vertical…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {motor.metricas.map((metrica) => (
              <MetricCard
                key={metrica.id}
                rotulo={metrica.rotulo}
                valor={formatarValorMetrica(metrica)}
                detalhe={metrica.detalhe}
                tom={metrica.tom}
                dica={metrica.dica}
              />
            ))}
          </div>
          {motor.totalConversas === 0 && (
            <p className="rounded-[var(--radius-sm)] border border-state-run-ink/30 bg-state-run-bg px-3 py-2 text-xs text-state-run">
              Nenhum atendimento no período — os números acima são zeros reais, não dados ausentes. Carregue um
              cenário de demonstração no topo da tela para ver o motor em operação.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default VerticalTelemetryPanel;
