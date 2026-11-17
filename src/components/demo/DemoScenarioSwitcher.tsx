"use client";

// "Carregar Cenário de Demonstração" — seletor de vitrine no topo do app.
//
// Duas ações distintas, deliberadamente separadas (confundi-las é o que
// transforma uma vitrine em contaminação de dados):
//
//  - **Ativar** um cenário: só troca o CONTEXTO local desta máquina — qual
//    motor vertical a Governança exibe e se conversas de Sandbox entram na
//    conta. Zero escrita, reversível com um clique, nunca sai deste
//    navegador (ver `salvarCenarioAtivo` em `@/lib/demoScenarios`).
//  - **Semear** os dados do cenário: escreve conversas e cargas de verdade
//    no workspace, pelo pipeline real. Exige confirmação explícita em modal,
//    porque é a única parte que o cliente veria depois na base dele.
//
// Restrito a admin: semear cria dados no workspace inteiro, mesma régua de
// `Zona de risco` em Configurações.

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useWorkspace } from "@/lib/workspace";
import { useDemoScenario } from "@/lib/verticalEngine";
import { semearCenario, type ResultadoSemeadura } from "@/lib/demoScenarioSeed";
import { CENARIOS_DEMO, ORDEM_CENARIOS, type DemoScenario, type DemoScenarioId } from "@/lib/demoScenarios";
import { cn } from "@/lib/utils";

export function DemoScenarioSwitcher() {
  const { workspaceId, appUser } = useWorkspace();
  const { cenario, definirCenario, hidratado } = useDemoScenario();
  const [aberto, setAberto] = useState(false);
  const [paraSemear, setParaSemear] = useState<DemoScenario | null>(null);
  const [semeando, setSemeando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoSemeadura | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (appUser?.papel !== "admin") return null;

  // `hidratado` evita o flash de "Vitrine" no primeiro paint quando já
  // existe um cenário salvo neste navegador (ver `DemoScenarioProvider`).
  const rotuloBotao = !hidratado ? "Vitrine" : cenario ? cenario.rotulo.split(" — ")[0] : "Carregar cenário";

  async function confirmarSemeadura() {
    if (!paraSemear || !workspaceId) return;
    setSemeando(true);
    setErro(null);
    try {
      const saida = await semearCenario(paraSemear, workspaceId);
      setResultado(saida);
      definirCenario(paraSemear.id);
      setParaSemear(null);
    } catch {
      // `semearCenario` já agrega as falhas item a item e reporta cada uma
      // ao diagnóstico; só um erro realmente inesperado chega aqui.
      setErro("Não foi possível carregar o cenário agora. Tente novamente em alguns instantes.");
    } finally {
      setSemeando(false);
    }
  }

  function selecionar(id: DemoScenarioId) {
    definirCenario(id);
    setResultado(null);
    setErro(null);
  }

  return (
    <div className="relative">
      <Button variant="secondary" size="sm" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        {cenario && hidratado && (
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-state-run-ink align-middle" />
        )}
        {rotuloBotao}
      </Button>

      {aberto && (
        <>
          {/* Captura de clique fora — um menu que só fecha pelo próprio
              botão é o tipo de detalhe que trava uma demonstração ao vivo. */}
          <button
            type="button"
            aria-label="Fechar seletor de cenário"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setAberto(false)}
          />
          <div className="absolute right-0 z-40 mt-2 w-80 rounded-[var(--radius-md)] border border-ink-100 bg-white p-3 shadow-[var(--shadow-md)]">
            <p className="text-xs font-semibold text-ink-950">Cenário de demonstração</p>
            <p className="mt-0.5 text-[11px] text-ink-400">
              Ativar troca só o contexto desta máquina. Carregar os dados escreve conversas e cargas de
              demonstração neste workspace.
            </p>

            <div className="mt-3 flex flex-col gap-2">
              {ORDEM_CENARIOS.map((id) => {
                const item = CENARIOS_DEMO[id];
                const ativo = cenario?.id === id;
                return (
                  <div
                    key={id}
                    className={cn(
                      "flex flex-col gap-1.5 rounded-[var(--radius-sm)] border p-2.5",
                      ativo ? "border-signal-500 bg-signal-50" : "border-ink-100 bg-white"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selecionar(id)}
                      className="text-left"
                    >
                      <span className="block text-xs font-semibold text-ink-950">{item.rotulo}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-500">{item.descricao}</span>
                    </button>
                    <div className="flex items-center gap-2">
                      {ativo ? (
                        <span className="rounded-full bg-state-done-bg px-2 py-0.5 text-[10px] font-medium text-state-done">
                          contexto ativo
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => selecionar(id)}
                          className="text-[11px] font-medium text-signal-600 hover:underline"
                        >
                          ativar contexto
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setParaSemear(item);
                          setAberto(false);
                        }}
                        className="ml-auto text-[11px] font-medium text-signal-600 hover:underline"
                      >
                        carregar dados
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {cenario && (
              <button
                type="button"
                onClick={() => {
                  definirCenario(null);
                  setResultado(null);
                }}
                className="mt-3 text-[11px] font-medium text-ink-500 hover:underline"
              >
                voltar ao nicho real do workspace
              </button>
            )}

            {resultado && (
              <p className="mt-2 text-[11px] text-state-done">
                {resultado.conversasCriadas} conversa(s), {resultado.mensagensCriadas} mensagem(ns) e{" "}
                {resultado.cargasCriadas} carga(s) criadas.
                {resultado.falhas.length > 0 && ` ${resultado.falhas.length} item(ns) falharam.`}
              </p>
            )}
            {erro && <p className="mt-2 text-[11px] text-state-error">{erro}</p>}
          </div>
        </>
      )}

      <Modal
        open={paraSemear !== null}
        onClose={() => {
          if (semeando) return;
          setParaSemear(null);
        }}
        titleId="carregar-cenario-title"
        title={`Carregar dados de "${paraSemear?.rotulo ?? ""}"?`}
        body={
          paraSemear
            ? `Isto cria ${paraSemear.leads.length} conversa(s) de demonstração na Neural Inbox` +
              (paraSemear.cargas.length > 0 ? ` e ${paraSemear.cargas.length} carga(s) no rastreio operacional` : "") +
              ". As conversas nascem marcadas como Sandbox (pill \"Teste\") e ficam fora de todo agregado financeiro real; as cargas usam o prefixo DEMO- no código de rastreio. Carregar o mesmo cenário duas vezes cria conversas novas a cada vez — use Configurações → Zona de risco para zerar tudo antes de operar com clientes reais."
            : ""
        }
        actions={
          <>
            <Button variant="secondary" size="sm" disabled={semeando} onClick={() => setParaSemear(null)}>
              Cancelar
            </Button>
            <Button size="sm" loading={semeando} onClick={confirmarSemeadura}>
              Sim, carregar cenário
            </Button>
          </>
        }
      />
    </div>
  );
}

export default DemoScenarioSwitcher;
