"use client";

// Onboarding Cognitivo — Quiz dinâmico de setup por nicho.
//
// Três perguntas estratégicas (nicho, maior ralo de caixa, região/idioma)
// moldam a configuração inicial do workspace — ver `@/lib/onboardingQuiz`
// para a derivação (pura) e a persistência. Este arquivo só cuida de QUANDO
// mostrar o quiz e da interação do wizard.
//
// Abre automaticamente para quem administra um workspace que ainda não
// respondeu (`workspace.quizRespondidoEm` ausente) — nunca para `operacoes`,
// que não deveria ser interrompido por uma decisão de configuração que não
// lhe pertence. `QuizModalProvider` expõe `abrirQuiz()` via contexto para que
// a tela de Configurações possa reabri-lo deliberadamente ("Refazer o quiz").

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { NicheKey, PainPointKey, RegiaoOperacao } from "@/types";
import { useWorkspace } from "@/lib/workspace";
import { useInvalidarWorkspace, useWorkspaceDoc } from "@/lib/queries/workspace";
import { NICHE_ORDER, NICHE_PRESETS } from "@/lib/niches";
import { PAIN_POINT_ORDER, PAIN_POINT_PRESETS, REGIAO_ORDER, REGIAO_PRESETS, salvarRespostaQuiz } from "@/lib/onboardingQuiz";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type Passo = "nicho" | "ralo" | "regiao" | "salvando";

const PASSOS: Passo[] = ["nicho", "ralo", "regiao"];

interface QuizModalContextValue {
  abrirQuiz: () => void;
}

const QuizModalContext = createContext<QuizModalContextValue | undefined>(undefined);

export function useAbrirQuizOnboarding(): () => void {
  const ctx = useContext(QuizModalContext);
  if (!ctx) throw new Error("useAbrirQuizOnboarding deve ser usado dentro de <QuizModalProvider>");
  return ctx.abrirQuiz;
}

/** Cartão de opção de rádio — mesmo padrão visual do Passo 2 de `/onboarding`, reaproveitado aqui. */
function CartaoOpcao({
  name,
  selecionado,
  titulo,
  descricao,
  onSelect,
}: {
  name: string;
  selecionado: boolean;
  titulo: string;
  descricao: string;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-1 rounded-[var(--radius-md)] border p-3 text-left transition-colors",
        selecionado ? "border-signal-600 bg-signal-50" : "border-ink-100 hover:bg-mist-50"
      )}
    >
      {/* `name` agrupa nativamente os rádios de cada passo — sem ele, teclado
          (setas) e leitor de tela não reconhecem "1 de N opções", mesma
          regressão que o padrão original de `/onboarding` evita com `name="setor"`. */}
      <input type="radio" name={name} checked={selecionado} onChange={onSelect} className="sr-only" />
      <span className="text-sm font-semibold text-ink-950">{titulo}</span>
      <span className="text-xs text-ink-500">{descricao}</span>
    </label>
  );
}

export function QuizModalProvider({ children }: { children: ReactNode }) {
  const { appUser, workspaceId } = useWorkspace();
  const { data: workspace, isLoading } = useWorkspaceDoc(workspaceId);
  const invalidarWorkspace = useInvalidarWorkspace();

  const [abertoManualmente, setAbertoManualmente] = useState(false);
  const [dispensadoNestaSessao, setDispensadoNestaSessao] = useState(false);
  const [passo, setPasso] = useState<Passo>("nicho");
  const [setor, setSetor] = useState<NicheKey | null>(null);
  const [ralogDeCaixa, setRalogDeCaixa] = useState<PainPointKey | null>(null);
  const [regiaoOperacao, setRegiaoOperacao] = useState<RegiaoOperacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const precisaResponder =
    appUser?.papel === "admin" && !isLoading && Boolean(workspace) && !workspace?.quizRespondidoEm;

  const aberto = abertoManualmente || (precisaResponder && !dispensadoNestaSessao);

  // Reseta o wizard para o primeiro passo a cada nova abertura — evita que
  // uma resposta de uma sessão anterior (nunca salva) aplique-se silenciosa.
  useEffect(() => {
    if (!aberto) return;
    setPasso("nicho");
    setSetor(workspace?.setor ?? null);
    setRalogDeCaixa(workspace?.ralogDeCaixa ?? null);
    setRegiaoOperacao(workspace?.regiaoOperacao ?? null);
    setErro(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const indicePasso = PASSOS.indexOf(passo === "salvando" ? "regiao" : passo) + 1;

  function fechar() {
    setAbertoManualmente(false);
    setDispensadoNestaSessao(true);
  }

  async function finalizar() {
    if (!workspaceId || !setor || !ralogDeCaixa || !regiaoOperacao) return;
    setErro(null);
    setPasso("salvando");
    try {
      await salvarRespostaQuiz({ setor, ralogDeCaixa, regiaoOperacao }, workspaceId);
      invalidarWorkspace(workspaceId);
      setAbertoManualmente(false);
      setDispensadoNestaSessao(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar as respostas do quiz.");
      setPasso("regiao");
    }
  }

  const contextValue = useMemo<QuizModalContextValue>(
    () => ({
      abrirQuiz: () => {
        setDispensadoNestaSessao(false);
        setAbertoManualmente(true);
      },
    }),
    []
  );

  return (
    <QuizModalContext.Provider value={contextValue}>
      {children}

      {aberto && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-950/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="quiz-onboarding-title"
            className="flex max-h-[90vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-[var(--radius-md)] bg-white p-6 shadow-[var(--shadow-md)]"
          >
            <div>
              <p className="mono text-xs font-semibold uppercase tracking-wide text-signal-600">
                {passo === "salvando" ? "Salvando…" : `Passo ${indicePasso} de ${PASSOS.length}`}
              </p>
              <h2 id="quiz-onboarding-title" className="mt-1 text-lg font-semibold text-ink-950">
                Onboarding Cognitivo
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                Três perguntas rápidas para calibrar os guardrails, a moeda e o SLA do seu workspace.
              </p>
            </div>

            {passo === "nicho" && (
              <>
                <div role="radiogroup" aria-label="Nicho e setor" className="grid gap-2 sm:grid-cols-2">
                  {NICHE_ORDER.filter((k) => k !== "outros").map((key) => (
                    <CartaoOpcao
                      key={key}
                      name="quiz-nicho"
                      selecionado={setor === key}
                      titulo={NICHE_PRESETS[key].label}
                      descricao={NICHE_PRESETS[key].descricao}
                      onSelect={() => setSetor(key)}
                    />
                  ))}
                  <CartaoOpcao
                    name="quiz-nicho"
                    selecionado={setor === "outros"}
                    titulo={NICHE_PRESETS.outros.label}
                    descricao={NICHE_PRESETS.outros.descricao}
                    onSelect={() => setSetor("outros")}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Button variant="secondary" size="sm" onClick={fechar}>
                    Responder depois
                  </Button>
                  <Button size="sm" disabled={!setor} onClick={() => setPasso("ralo")}>
                    Continuar
                  </Button>
                </div>
              </>
            )}

            {passo === "ralo" && (
              <>
                <div role="radiogroup" aria-label="Maior ralo de caixa" className="flex flex-col gap-2">
                  {PAIN_POINT_ORDER.map((key) => (
                    <CartaoOpcao
                      key={key}
                      name="quiz-ralo"
                      selecionado={ralogDeCaixa === key}
                      titulo={PAIN_POINT_PRESETS[key].label}
                      descricao={PAIN_POINT_PRESETS[key].descricao}
                      onSelect={() => setRalogDeCaixa(key)}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setPasso("nicho")}>
                    Voltar
                  </Button>
                  <Button size="sm" disabled={!ralogDeCaixa} onClick={() => setPasso("regiao")}>
                    Continuar
                  </Button>
                </div>
              </>
            )}

            {(passo === "regiao" || passo === "salvando") && (
              <>
                <div role="radiogroup" aria-label="Idioma/região da operação" className="grid gap-2 sm:grid-cols-2">
                  {REGIAO_ORDER.map((key) => (
                    <CartaoOpcao
                      key={key}
                      name="quiz-regiao"
                      selecionado={regiaoOperacao === key}
                      titulo={REGIAO_PRESETS[key].label}
                      descricao={REGIAO_PRESETS[key].descricao}
                      onSelect={() => setRegiaoOperacao(key)}
                    />
                  ))}
                </div>

                {erro && <p className="text-xs text-state-error">{erro}</p>}

                <div className="flex items-center justify-between gap-2">
                  <Button variant="secondary" size="sm" disabled={passo === "salvando"} onClick={() => setPasso("ralo")}>
                    Voltar
                  </Button>
                  <Button
                    size="sm"
                    loading={passo === "salvando"}
                    disabled={!regiaoOperacao}
                    onClick={finalizar}
                  >
                    Concluir configuração
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </QuizModalContext.Provider>
  );
}

export default QuizModalProvider;
