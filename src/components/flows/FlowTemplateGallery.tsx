"use client";

// Galeria de Templates de Fluxo — implantação em 1 clique.
//
// O template é persistido pelo MESMO `createFlow` de um fluxo criado à mão
// (nenhum caminho de escrita paralelo), então um fluxo implantado daqui é
// indistinguível de um configurado manualmente, exceto por carregar o
// `grafo` e o `templateId` que o originaram.
//
// A pré-visualização do grafo é delegada a `FlowGraphView` — o mesmo
// componente que a tela de Fluxos usa para o fluxo já implantado, para o
// que se vê antes e depois de implantar nunca divergir.

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { createFlow } from "@/lib/firestore";
import { registrarEventoAuditoriaSilencioso } from "@/lib/auditLog";
import { reportarErro } from "@/lib/telemetry/errorReporting";
import { useWorkspace } from "@/lib/workspace";
import { useWorkspaceDoc } from "@/lib/queries/workspace";
import { novoFluxoDoTemplate, templatesParaSetor, type FlowTemplate } from "@/lib/flowTemplates";
import { FlowGraphView } from "@/components/flows/FlowGraphView";
import { cn } from "@/lib/utils";

interface FlowTemplateGalleryProps {
  /** Chamado com o id do fluxo recém-criado, para a página selecioná-lo imediatamente. */
  onImplantado: (flowId: string) => void;
}

export function FlowTemplateGallery({ onImplantado }: FlowTemplateGalleryProps) {
  const { workspaceId } = useWorkspace();
  const { data: workspace } = useWorkspaceDoc(workspaceId);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [implantando, setImplantando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [implantado, setImplantado] = useState<string | null>(null);

  const templates = templatesParaSetor(workspace?.setor);

  async function implantar(template: FlowTemplate) {
    if (!workspaceId) return;
    setImplantando(template.id);
    setErro(null);
    try {
      const flowId = await createFlow(workspaceId, novoFluxoDoTemplate(template));
      registrarEventoAuditoriaSilencioso({
        tipo: "fluxo.template.implantado",
        recurso: `flows/${flowId}`,
        workspaceId,
        detalhes: {
          templateId: template.id,
          nome: template.nome,
          nos: template.grafo.nos.length,
          arestas: template.grafo.arestas.length,
          // Rastreabilidade do que realmente importa numa auditoria: quais
          // políticas de guardrail este fluxo passou a aplicar.
          politicas: template.grafo.nos
            .map((no) => no.politicaGuardrailId)
            .filter((id): id is string => Boolean(id))
            .join(", "),
        },
      });
      setImplantado(template.id);
      onImplantado(flowId);
    } catch (e) {
      // Texto técnico (código do Firestore, "Failed to fetch") vai só para o
      // diagnóstico — a tela sempre mostra uma mensagem acionável.
      reportarErro(e, "flows:implantar-template");
      setErro("Não foi possível implantar este template agora. Tente novamente em alguns instantes.");
    } finally {
      setImplantando(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-950">Templates prontos para produção</h2>
        <p className="mt-0.5 text-xs text-ink-400">
          Grafo pré-conectado, guardrails já apontados e arestas de fallback em cada ponto de falha — implante e
          ajuste os detalhes depois.
        </p>
      </div>

      {erro && <p className="text-xs text-state-error">{erro}</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {templates.map((template) => {
          const doSetorAtivo = workspace?.setor === template.setor;
          const aberto = expandido === template.id;
          const nosFallback = template.grafo.nos.filter((n) => n.tipo === "fallback").length;
          const arestasFallback = template.grafo.arestas.filter((a) => a.tipo !== "sucesso").length;

          return (
            <div
              key={template.id}
              className={cn(
                "flex flex-col gap-2 rounded-[var(--radius-md)] border p-3",
                doSetorAtivo ? "border-signal-500/50 bg-signal-50" : "border-ink-100 bg-white"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-ink-950">{template.nome}</p>
                {doSetorAtivo && (
                  <span className="flex-none rounded-full bg-signal-100 px-2 py-0.5 text-[10px] font-medium text-signal-700">
                    seu nicho
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-500">{template.resumo}</p>
              <p className="mono text-[11px] text-ink-400">
                {template.grafo.nos.length} nós · {template.grafo.arestas.length} arestas · {nosFallback} nó(s) de
                fallback · {arestasFallback} transição(ões) de erro/escalonamento
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  loading={implantando === template.id}
                  disabled={implantando !== null}
                  onClick={() => implantar(template)}
                >
                  {implantado === template.id ? "Implantar novamente" : "Implantar em 1 clique"}
                </Button>
                <button
                  type="button"
                  onClick={() => setExpandido(aberto ? null : template.id)}
                  className="text-[11px] font-medium text-signal-600 hover:underline"
                >
                  {aberto ? "ocultar grafo" : "ver grafo"}
                </button>
                {implantado === template.id && (
                  <span className="rounded-full bg-state-done-bg px-2 py-0.5 text-[10px] font-medium text-state-done">
                    fluxo criado
                  </span>
                )}
              </div>

              {aberto && <FlowGraphView grafo={template.grafo} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default FlowTemplateGallery;
