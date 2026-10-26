"use client";

// Página da Neural Inbox — central de atendimento omnichannel.

import { NeuralInbox } from "@/components/chat/NeuralInbox";
import { useMedirCarregamentoRota } from "@/lib/telemetry/useRoutePerformance";

export default function InboxPage() {
  // `NeuralInbox` gerencia o próprio carregamento de dados internamente —
  // medir aqui captura o tempo de mount-até-primeiro-paint da rota (um sinal
  // mais grosso que o de `/flows`, que mede até os dados chegarem). Ver
  // ADR-0005.
  useMedirCarregamentoRota("/inbox");
  return <NeuralInbox />;
}
