"use client";

// Modo Copiloto Guiado (V2 do Onboarding) — concatena, numa única tela, o
// que antes ficava espalhado sem conexão visível entre si: escolher o
// nicho (Configurações), criar/salvar um Fluxo, ver isso virando
// atendimento na Neural Inbox (Sandbox → ponte de demonstração, ver
// `PayloadSimulator`) e acompanhar o resultado em Governança. Nenhuma etapa
// aqui FAZ algo novo — cada botão só aponta para uma funcionalidade que já
// existe, só que antes não havia nenhum lugar que amarrasse as quatro em
// sequência.
//
// Retrátil, não removível: diferente da v1 (que podia ser escondida pra
// sempre), este painel só COLAPSA — vira uma barra fina com o progresso,
// sempre a um clique de reabrir. Ninguém perde o guia por engano.

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAbrirQuizOnboarding } from "@/components/onboarding/DynamicNicheQuizModal";
import { cn } from "@/lib/utils";

const CHAVE_COLAPSADO = "agentflow:flows:guiaColapsado";
const CHAVE_TESTOU_SIMULADOR = "agentflow:flows:testouSimulador";
/**
 * `localStorage` não dispara o evento nativo `storage` na MESMA aba que
 * escreveu — só em outras abas/janelas. Como `PayloadSimulator` e este
 * cartão são irmãos na mesma página, o passo 3 só ficaria "✓" depois de um
 * recarregamento sem este evento customizado — o que quebraria exatamente a
 * sensação de "instantâneo" que este guia existe para dar.
 */
const EVENTO_SIMULADOR_TESTADO = "agentflow:simulador-testado";

/** Quantos passos deste guia realmente ganham um estado "concluído" — o passo 4 é contínuo (acompanhamento), não uma caixa pra marcar. */
const TOTAL_PASSOS_MENSURAVEIS = 3;

interface PrimeirosPassosCardProps {
  temNicho: boolean;
  temFluxo: boolean;
  ehAdmin: boolean;
}

interface Passo {
  numero: number;
  titulo: string;
  descricao: string;
  feito: boolean;
  acao: ReactNode;
}

export function PrimeirosPassosCard({ temNicho, temFluxo, ehAdmin }: PrimeirosPassosCardProps) {
  const abrirQuizOnboarding = useAbrirQuizOnboarding();
  const [colapsado, setColapsado] = useState(false);
  const [testouSimulador, setTestouSimulador] = useState(false);
  const [pulsando, setPulsando] = useState<Set<number>>(new Set());

  // Só pulsa numa transição de VERDADE (false → true) dentro da vida deste
  // componente — nunca no primeiro load só porque o passo já estava feito
  // há muito tempo (isso pareceria um bug de animação disparando sem motivo).
  const anteriorRef = useRef({ nicho: temNicho, fluxo: temFluxo, simulador: testouSimulador });

  useEffect(() => {
    try {
      setColapsado(localStorage.getItem(CHAVE_COLAPSADO) === "1");
      setTestouSimulador(localStorage.getItem(CHAVE_TESTOU_SIMULADOR) === "1");
    } catch {
      // localStorage indisponível (modo privado, etc.) — guia sempre expandido, nunca quebra a tela.
    }

    function marcarAoVivo() {
      setTestouSimulador(true);
    }
    window.addEventListener(EVENTO_SIMULADOR_TESTADO, marcarAoVivo);
    return () => window.removeEventListener(EVENTO_SIMULADOR_TESTADO, marcarAoVivo);
  }, []);

  useEffect(() => {
    const recemConcluidos: number[] = [];
    if (temNicho && !anteriorRef.current.nicho) recemConcluidos.push(1);
    if (temFluxo && !anteriorRef.current.fluxo) recemConcluidos.push(2);
    if (testouSimulador && !anteriorRef.current.simulador) recemConcluidos.push(3);
    anteriorRef.current = { nicho: temNicho, fluxo: temFluxo, simulador: testouSimulador };

    if (recemConcluidos.length === 0) return;
    setPulsando((atual) => new Set([...atual, ...recemConcluidos]));
    const temporizador = setTimeout(() => {
      setPulsando((atual) => {
        const copia = new Set(atual);
        recemConcluidos.forEach((numero) => copia.delete(numero));
        return copia;
      });
    }, 900);
    return () => clearTimeout(temporizador);
  }, [temNicho, temFluxo, testouSimulador]);

  function alternarColapso() {
    const novoValor = !colapsado;
    setColapsado(novoValor);
    try {
      localStorage.setItem(CHAVE_COLAPSADO, novoValor ? "1" : "0");
    } catch {
      // Preferência não persiste nesta sessão — sem efeito colateral, só não lembra na próxima visita.
    }
  }

  const passos: Passo[] = [
    {
      numero: 1,
      titulo: "Escolha o nicho do seu negócio",
      descricao: "Isso liga automaticamente os guardrails e os painéis certos para o seu tipo de empresa.",
      feito: temNicho,
      // Deliberadamente UMA ação só (não um botão + um link redundante
      // lado a lado): Configurações já mostra o mesmo "Trocar nicho" de
      // forma proeminente — duplicar a entrada aqui só adiciona risco de
      // aperto visual em telas estreitas sem ganho real de clareza.
      acao: (
        <button type="button" onClick={abrirQuizOnboarding} className="text-xs font-medium text-signal-600 hover:underline">
          {temNicho ? "trocar nicho" : "escolher agora"}
        </button>
      ),
    },
    {
      numero: 2,
      titulo: "Crie e salve o seu primeiro Fluxo",
      descricao: 'Clique em "✨ Preenchimento mágico" no formulário ao lado e depois em "Salvar configurações".',
      feito: temFluxo,
      acao: (
        <span className="text-xs text-ink-400">
          {temFluxo ? "já tem pelo menos 1 fluxo salvo" : "use o formulário ao lado →"}
        </span>
      ),
    },
    {
      numero: 3,
      titulo: "Veja isso virando atendimento de verdade",
      descricao: 'No Simulador (mais abaixo), use "✨ Simular payload de exemplo" → "Executar teste" → "Enviar como lead de teste para a Neural Inbox".',
      feito: testouSimulador,
      acao: (
        <a href="#sandbox-fluxos" className="text-xs font-medium text-signal-600 hover:underline">
          ir para o simulador ↓
        </a>
      ),
    },
    {
      numero: 4,
      titulo: "Acompanhe o resultado em Governança",
      descricao: "Horas economizadas, pipeline gerado e tudo que o Fluxo e a Inbox produziram, em um só lugar.",
      feito: false,
      acao: ehAdmin ? (
        <Link href="/governance" className="text-xs font-medium text-signal-600 hover:underline">
          abrir Governança →
        </Link>
      ) : (
        <span className="text-xs text-ink-400">disponível para administradores</span>
      ),
    },
  ];

  const concluidos = passos.filter((p) => p.feito).length;
  const progresso = Math.round((concluidos / TOTAL_PASSOS_MENSURAVEIS) * 100);

  if (colapsado) {
    return (
      <button
        type="button"
        onClick={alternarColapso}
        className="flex items-center gap-3 rounded-[var(--radius-md)] border border-signal-500/30 bg-signal-50 px-4 py-2.5 text-left transition-colors hover:bg-signal-100"
      >
        <span className="text-sm font-semibold text-ink-950">Primeiros passos</span>
        <span className="mono text-xs text-ink-500">{concluidos} de {TOTAL_PASSOS_MENSURAVEIS} concluídos</span>
        <span className="h-1.5 w-20 flex-none overflow-hidden rounded-full bg-white">
          <span
            className="block h-full rounded-full bg-state-done-ink transition-all duration-500"
            style={{ width: `${progresso}%` }}
          />
        </span>
        <span className="ml-auto text-xs font-medium text-signal-600">expandir ▾</span>
      </button>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-signal-500/30 bg-signal-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink-950">Primeiros passos</h2>
          <p className="mt-0.5 text-xs text-ink-500">Siga esta ordem — funciona do mesmo jeito para qualquer nicho.</p>
        </div>
        <button
          type="button"
          onClick={alternarColapso}
          className="flex-none whitespace-nowrap text-xs font-medium text-ink-400 hover:text-ink-700 hover:underline"
        >
          recolher guia ▴
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white">
          <span
            className="block h-full rounded-full bg-state-done-ink transition-all duration-500"
            style={{ width: `${progresso}%` }}
          />
        </span>
        <span className="mono flex-none text-xs text-ink-500">{concluidos}/{TOTAL_PASSOS_MENSURAVEIS}</span>
      </div>

      <ol className="flex flex-col gap-2.5">
        {passos.map((passo) => (
          <li key={passo.numero} className="flex items-start gap-3">
            <span
              className={cn(
                "mono flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-semibold transition-transform duration-300",
                passo.feito ? "bg-state-done-bg text-state-done" : "bg-white text-ink-500 border border-ink-100",
                pulsando.has(passo.numero) && "scale-125"
              )}
            >
              {passo.feito ? "✓" : passo.numero}
            </span>
            <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <div>
                <p className="text-sm font-medium text-ink-950">{passo.titulo}</p>
                <p className="text-xs text-ink-500">{passo.descricao}</p>
              </div>
              <div className="flex-none">{passo.acao}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Chamado pelo `PayloadSimulator` ao enviar com sucesso um lead de teste para a Neural Inbox — fecha o passo 3 deste guia, ao vivo, na mesma página. */
export function marcarSimuladorTestado(): void {
  try {
    localStorage.setItem(CHAVE_TESTOU_SIMULADOR, "1");
  } catch {
    // Preferência não persiste — sem efeito colateral real, o guia só não marca o passo como feito.
  }
  window.dispatchEvent(new Event(EVENTO_SIMULADOR_TESTADO));
}
