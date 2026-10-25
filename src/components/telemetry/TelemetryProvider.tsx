"use client";

// Captura global de falhas — render, rede e Promises não tratadas (ver
// ADR-0004 e `src/lib/telemetry/errorReporting.ts`).
//
// Três fontes cobertas, do mais para o menos grave:
//   1. Erro de renderização React → `LimiteDeRenderizacao` (error boundary de
//      classe — é o único jeito de capturar isso em React) mostra um estado
//      de recuperação em vez de uma tela branca.
//   2. `window.onerror` → exceções síncronas fora do ciclo de render (ex.:
//      script de terceiro, erro em um listener nativo).
//   3. `unhandledrejection` → a categoria que mais importava para o bug
//      original deste produto: uma chamada ao SDK do Firebase/fetch que
//      falha sem ninguém com `.catch()` olhando. Sem este listener, esse
//      erro desaparecia inteiramente do radar do operador.
//
// Nenhuma das três bloqueia a UI — a falha é logada e, no máximo, um banner
// discreto (reaproveitando `Banner`, já no design system) avisa o operador.

import { Component, useEffect, useState, type ReactNode } from "react";
import { assinarFalhas, limparFalha, reportarErro, type FalhaCapturada } from "@/lib/telemetry/errorReporting";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

interface LimiteState {
  comFalha: boolean;
}

class LimiteDeRenderizacao extends Component<{ children: ReactNode }, LimiteState> {
  state: LimiteState = { comFalha: false };

  static getDerivedStateFromError(): LimiteState {
    return { comFalha: true };
  }

  componentDidCatch(erro: unknown): void {
    reportarErro(erro, "render");
  }

  render() {
    if (this.state.comFalha) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center p-6">
          <EmptyState
            title="Algo deu errado nesta tela"
            description="O erro já foi registrado. Tente recarregar — se persistir, contate o suporte."
            action={
              <Button size="sm" onClick={() => window.location.reload()}>
                Recarregar
              </Button>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}

function BannerDeFalhasSilenciosas() {
  const [falhas, setFalhas] = useState<FalhaCapturada[]>([]);

  useEffect(() => assinarFalhas(setFalhas), []);

  const maisRecente = falhas[0];
  if (!maisRecente) return null;

  return (
    <Banner
      action={
        <Button size="sm" variant="secondary" onClick={() => limparFalha(maisRecente.id)}>
          Dispensar
        </Button>
      }
    >
      Uma operação falhou em segundo plano{maisRecente.contexto ? ` (${maisRecente.contexto})` : ""} — o sistema
      tentará de novo automaticamente quando possível.
    </Banner>
  );
}

export function TelemetryProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    function aoFalharRecurso(evento: ErrorEvent): void {
      reportarErro(evento.error ?? evento.message, "window.onerror");
    }
    function aoRejeitarPromise(evento: PromiseRejectionEvent): void {
      reportarErro(evento.reason, "unhandledrejection");
    }
    window.addEventListener("error", aoFalharRecurso);
    window.addEventListener("unhandledrejection", aoRejeitarPromise);
    return () => {
      window.removeEventListener("error", aoFalharRecurso);
      window.removeEventListener("unhandledrejection", aoRejeitarPromise);
    };
  }, []);

  return (
    <LimiteDeRenderizacao>
      <BannerDeFalhasSilenciosas />
      {children}
    </LimiteDeRenderizacao>
  );
}
