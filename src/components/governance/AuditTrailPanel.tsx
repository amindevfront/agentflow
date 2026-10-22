"use client";

// Trilha de auditoria imutável.
//
// Além de listar os eventos, o painel permite VERIFICAR a cadeia: hashes,
// encadeamento e assinaturas HMAC. Uma trilha que ninguém consegue verificar
// não é uma trilha de auditoria — é apenas uma lista de registros.
//
// A verificação roda no servidor porque a conferência do HMAC exige a chave de
// assinatura, que nunca sai de lá.

import { useEffect, useMemo, useState } from "react";
import type { AuditChainVerification, AuditEntry } from "@/types";
import {
  ROTULO_EVENTO,
  drenarFilaAuditoria,
  subscribeTrilhaAuditoria,
  tamanhoFilaAuditoria,
  verificarTrilhaAuditoria,
} from "@/lib/auditLog";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricCard } from "@/components/ui/MetricCard";
import { cn } from "@/lib/utils";

const corResultado: Record<AuditEntry["corpo"]["resultado"], string> = {
  sucesso: "bg-state-done-bg text-state-done",
  falha: "bg-state-error-bg text-state-error",
  negado: "bg-state-run-bg text-state-run",
};

export function AuditTrailPanel() {
  const [entradas, setEntradas] = useState<AuditEntry[]>([]);
  const [verificacao, setVerificacao] = useState<AuditChainVerification | null>(null);
  const [avisoVerificacao, setAvisoVerificacao] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendentes, setPendentes] = useState(0);
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeTrilhaAuditoria(setEntradas, {
      limite: 200,
      onError: (e) => setErro(e.message),
    });
  }, []);

  useEffect(() => {
    setPendentes(tamanhoFilaAuditoria());
  }, [entradas]);

  const selecionada = entradas.find((e) => e.id === selecionadaId) ?? null;

  const resumo = useMemo(() => {
    let falhas = 0;
    let negados = 0;
    for (const entrada of entradas) {
      if (entrada.corpo.resultado === "falha") falhas += 1;
      if (entrada.corpo.resultado === "negado") negados += 1;
    }
    return { falhas, negados, ultimaSeq: entradas[0]?.seq ?? 0 };
  }, [entradas]);

  async function verificar() {
    setErro(null);
    setVerificando(true);
    setVerificacao(null);
    setAvisoVerificacao(null);
    try {
      const { verificacao: resultado, aviso } = await verificarTrilhaAuditoria(entradas);
      setVerificacao(resultado);
      setAvisoVerificacao(aviso ?? null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível verificar a trilha.");
    } finally {
      setVerificando(false);
    }
  }

  async function reenviarPendentes() {
    setErro(null);
    try {
      const { enviados, pendentes: restantes } = await drenarFilaAuditoria();
      setPendentes(restantes);
      if (enviados === 0 && restantes > 0) {
        setErro("Nenhum evento pendente pôde ser reenviado. Verifique a conexão.");
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao reenviar eventos pendentes.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          rotulo="Eventos na cadeia"
          valor={String(resumo.ultimaSeq)}
          detalhe={`${entradas.length} carregado(s) nesta visão`}
        />
        <MetricCard
          rotulo="Integridade"
          valor={
            verificacao === null ? "—" : verificacao.integra ? "íntegra" : String(verificacao.problemas.length)
          }
          detalhe={
            verificacao === null
              ? "execute a verificação"
              : verificacao.integra
                ? verificacao.assinaturasVerificadas
                  ? "hashes e assinaturas conferem"
                  : "hashes conferem (sem assinatura)"
                : "problema(s) detectado(s)"
          }
          tom={verificacao === null ? "neutro" : verificacao.integra ? "positivo" : "erro"}
        />
        <MetricCard
          rotulo="Ações negadas"
          valor={String(resumo.negados)}
          detalhe={`${resumo.falhas} falha(s) registrada(s)`}
          tom={resumo.negados > 0 ? "atencao" : "neutro"}
        />
        <MetricCard
          rotulo="Pendentes de envio"
          valor={String(pendentes)}
          detalhe={pendentes > 0 ? "preservados localmente" : "nenhum evento em fila"}
          tom={pendentes > 0 ? "atencao" : "positivo"}
          acao={
            pendentes > 0 ? (
              <button
                type="button"
                onClick={reenviarPendentes}
                className="text-[11px] font-medium text-signal-700 underline"
              >
                reenviar
              </button>
            ) : undefined
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" loading={verificando} onClick={verificar} disabled={entradas.length === 0}>
          Verificar integridade
        </Button>
        <span className="text-xs text-ink-400">
          Confere o encadeamento por hash e as assinaturas HMAC das{" "}
          <span className="mono">{entradas.length}</span> entradas carregadas.
        </span>
      </div>

      {erro && <p className="text-xs text-state-error">{erro}</p>}
      {avisoVerificacao && <p className="text-xs text-state-run">{avisoVerificacao}</p>}

      {verificacao && !verificacao.integra && (
        <div className="rounded-[var(--radius-md)] border border-state-error-ink/30 bg-state-error-bg p-3">
          <p className="text-xs font-semibold text-state-error">
            A trilha apresenta sinais de adulteração ou remoção de registros.
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {verificacao.problemas.slice(0, 10).map((problema, indice) => (
              <li key={`${problema.entryId}-${indice}`} className="text-xs text-state-error">
                <span className="mono">#{problema.seq}</span> · {problema.problema} — {problema.detalhe}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
          <h3 className="text-sm font-semibold text-ink-950">Eventos</h3>

          {entradas.length === 0 ? (
            <EmptyState
              title="Nenhum evento registrado"
              description="Mascaramentos, bloqueios, transbordos e operações de cofre são registrados aqui de forma imutável."
            />
          ) : (
            <ul className="flex flex-col gap-1">
              {entradas.map((entrada) => (
                <li key={entrada.id}>
                  <button
                    type="button"
                    onClick={() => setSelecionadaId(entrada.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors",
                      entrada.id === selecionadaId
                        ? "border-signal-500 bg-signal-50"
                        : "border-transparent hover:bg-mist-50"
                    )}
                  >
                    <span className="mono flex-none text-[11px] text-ink-400">#{entrada.seq}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink-950">
                        {ROTULO_EVENTO[entrada.corpo.tipo] ?? entrada.corpo.tipo}
                      </span>
                      <span className="mono block truncate text-[11px] text-ink-500">
                        {entrada.corpo.recurso}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "flex-none rounded-full px-2 py-0.5 text-[11px] font-medium",
                        corResultado[entrada.corpo.resultado]
                      )}
                    >
                      {entrada.corpo.resultado}
                    </span>
                    <span className="mono flex-none text-[11px] text-ink-400">
                      {new Date(entrada.corpo.ocorridoEm).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
          {!selecionada ? (
            <EmptyState
              title="Selecione um evento"
              description="O selo criptográfico e os detalhes do registro aparecem aqui."
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink-950">
                  {ROTULO_EVENTO[selecionada.corpo.tipo] ?? selecionada.corpo.tipo}
                </h3>
                <p className="mono mt-0.5 text-[11px] text-ink-400">
                  posição #{selecionada.seq} · selo v{selecionada.versaoSelo}
                </p>
              </div>

              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt className="text-ink-500">Ator</dt>
                <dd className="mono truncate text-ink-900">
                  {selecionada.corpo.atorEmail ?? selecionada.corpo.ator}
                </dd>
                <dt className="text-ink-500">Recurso</dt>
                <dd className="mono truncate text-ink-900">{selecionada.corpo.recurso}</dd>
                <dt className="text-ink-500">Ocorrido em</dt>
                <dd className="mono text-ink-900">
                  {new Date(selecionada.corpo.ocorridoEm).toLocaleString("pt-BR")}
                </dd>
                {selecionada.corpo.traceId && (
                  <>
                    <dt className="text-ink-500">Trace</dt>
                    <dd className="mono truncate text-ink-900">{selecionada.corpo.traceId}</dd>
                  </>
                )}
                {selecionada.corpo.severidade && (
                  <>
                    <dt className="text-ink-500">Severidade</dt>
                    <dd className="mono text-ink-900">{selecionada.corpo.severidade}</dd>
                  </>
                )}
              </dl>

              {Object.keys(selecionada.corpo.detalhes).length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
                    Detalhes
                  </h4>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                    {Object.entries(selecionada.corpo.detalhes).map(([chave, valor]) => (
                      <div key={chave} className="col-span-2 grid grid-cols-subgrid">
                        <dt className="text-ink-500">{chave}</dt>
                        <dd className="mono truncate text-ink-900">{String(valor)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {selecionada.corpo.detalhesCifrados && (
                <p className="rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 px-3 py-2 text-xs text-ink-500">
                  Este evento tem detalhes cifrados em repouso (AES-256-GCM). A decifragem é uma
                  operação server-side restrita a investigação autorizada.
                </p>
              )}

              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Selo criptográfico
                </h4>
                <dl className="flex flex-col gap-1 text-[11px]">
                  <div>
                    <dt className="text-ink-500">hash do conteúdo</dt>
                    <dd className="mono break-all text-ink-900">{selecionada.contentHash}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">hash anterior</dt>
                    <dd className="mono break-all text-ink-900">
                      {selecionada.prevHash || "(genesis)"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">hash da cadeia</dt>
                    <dd className="mono break-all text-ink-900">{selecionada.chainHash}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-500">assinatura HMAC</dt>
                    <dd className="mono break-all text-ink-900">{selecionada.assinatura}</dd>
                  </div>
                </dl>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
