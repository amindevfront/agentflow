"use client";

import { cn } from "@/lib/utils";

export interface OpcaoFiltro<T extends string> {
  valor: T;
  label: string;
  /** Contador opcional exibido ao lado do rótulo. */
  contagem?: number;
}

interface SegmentedFilterProps<T extends string> {
  opcoes: Array<OpcaoFiltro<T>>;
  selecionado: T;
  onChange: (valor: T) => void;
  rotuloGrupo: string;
}

/**
 * Grupo de filtros em pílula — mesmo padrão já usado na tela de Execuções,
 * extraído para reuso. Não introduz token novo.
 */
export function SegmentedFilter<T extends string>({
  opcoes,
  selecionado,
  onChange,
  rotuloGrupo,
}: SegmentedFilterProps<T>) {
  return (
    <div role="group" aria-label={rotuloGrupo} className="flex flex-wrap gap-1.5">
      {opcoes.map((opcao) => {
        const ativo = opcao.valor === selecionado;
        return (
          <button
            key={opcao.valor}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(opcao.valor)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              ativo ? "bg-ink-950 text-white" : "bg-mist-50 text-ink-500 hover:bg-ink-100"
            )}
          >
            {opcao.label}
            {typeof opcao.contagem === "number" && (
              <span className={cn("mono ml-1.5", ativo ? "text-ink-200" : "text-ink-400")}>
                {opcao.contagem}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
