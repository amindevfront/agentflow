"use client";

// UI injetada na Neural Inbox pela gaveta Logística.
//
// Dois painéis em sequência operacional: primeiro a INGESTÃO (o que o
// cliente acabou de pedir — peso, cubagem, criticidade), depois a TRIAGEM
// (onde a carga está, SLA, demurrage, câmbio). É a ordem em que o
// despachante trabalha, e a razão de a ingestão não ter sido embutida no
// painel de triagem: uma cotação nova não tem código de rastreio nenhum
// para triar.

import type { InboxModuleContext } from "../types";
import { CargoIntakePanel } from "@/components/niche/CargoIntakePanel";
import { CargoTriagePanel } from "@/components/niche/CargoTriagePanel";

export function LogisticsInboxExtras(contexto: InboxModuleContext) {
  return (
    <>
      <CargoIntakePanel {...contexto} />
      <CargoTriagePanel
        textoParaExtrairCodigo={contexto.ultimaMensagemCliente}
        onInsertResposta={contexto.inserirNaResposta}
      />
    </>
  );
}
