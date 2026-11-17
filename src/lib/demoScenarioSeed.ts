"use client";

// Semeadura de um Cenário de Demonstração — escrita real, pelo caminho real.
//
// Nada aqui é um atalho: as conversas nascem por `criarConversa` +
// `registrarMensagemCliente`, exatamente o mesmo pipeline que uma mensagem
// de WhatsApp de verdade percorre (Shield-Layer, mascaramento de PII, Radar
// de Sentimento, Circuit Breaker). É por isso que a demonstração é honesta:
// o que o C-Level vê na tela foi produzido pelo motor de produção, só que a
// partir de um lead fictício e explicitamente rotulado (`origemSandbox`).
//
// Falha parcial é tratada como parcial, nunca como sucesso: cada item
// semeado é contado individualmente e os erros voltam agregados, para a UI
// poder dizer "3 de 5 foram criados" em vez de fingir que tudo entrou.

import { criarConversa, registrarMensagemCliente } from "@/lib/inbox/firestore";
import { criarCarga } from "@/lib/shipments";
import { reportarErro } from "@/lib/telemetry/errorReporting";
import type { DemoScenario } from "@/lib/demoScenarios";

export interface ResultadoSemeadura {
  conversasCriadas: number;
  mensagensCriadas: number;
  cargasCriadas: number;
  /** Itens que falharam, já em linguagem de operador — nunca o texto técnico do erro. */
  falhas: string[];
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Cria as conversas e cargas do cenário no workspace informado.
 *
 * Sequencial de propósito: `registrarMensagemCliente` recalcula o índice de
 * frustração sobre o histórico da própria conversa a cada mensagem — disparar
 * as mensagens em paralelo produziria um índice final dependente da ordem de
 * resolução das promessas, ou seja, não determinístico entre duas execuções
 * do mesmo cenário.
 */
export async function semearCenario(cenario: DemoScenario, workspaceId: string): Promise<ResultadoSemeadura> {
  const resultado: ResultadoSemeadura = {
    conversasCriadas: 0,
    mensagensCriadas: 0,
    cargasCriadas: 0,
    falhas: [],
  };

  const carimbo = Date.now().toString(36);

  for (const lead of cenario.leads) {
    try {
      const conversa = await criarConversa({
        canal: lead.canal,
        nomeParticipante: lead.nome,
        identificadorParticipante: `${lead.identificador}:${carimbo}`,
        assunto: lead.assunto,
        workspaceId,
        origemSandbox: true,
      });
      resultado.conversasCriadas += 1;

      for (const texto of lead.mensagens) {
        try {
          await registrarMensagemCliente({
            conversationId: conversa.id,
            texto,
            canal: lead.canal,
            workspaceId,
          });
          resultado.mensagensCriadas += 1;
        } catch (erro) {
          reportarErro(erro, "demo-scenario:mensagem");
          resultado.falhas.push(`Mensagem de ${lead.nome} não pôde ser registrada.`);
        }
      }
    } catch (erro) {
      reportarErro(erro, "demo-scenario:conversa");
      resultado.falhas.push(`Conversa de ${lead.nome} não pôde ser criada.`);
    }
  }

  for (const carga of cenario.cargas) {
    try {
      await criarCarga({
        codigoRastreio: carga.codigoRastreio,
        origem: carga.origem,
        destino: carga.destino,
        status: carga.status,
        previsaoEntrega: new Date(Date.now() + carga.previsaoEmDias * DIA_MS).toISOString(),
        workspaceId,
        freeTimeDias: carga.freeTimeDias,
        custoDiarioDemurrageBrl: carga.custoDiarioDemurrageBrl,
        valorFreteUsd: carga.valorFreteUsd,
        cambioContratadoBrl: carga.cambioContratadoBrl,
      });
      resultado.cargasCriadas += 1;
    } catch (erro) {
      reportarErro(erro, "demo-scenario:carga");
      resultado.falhas.push(`Carga ${carga.codigoRastreio} não pôde ser registrada.`);
    }
  }

  return resultado;
}
