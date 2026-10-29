import { describe, expect, it } from "vitest";
import type { Conversation } from "@/types";
import {
  EXPEDIENTE_PADRAO,
  calcularReceitaRecuperadaMadrugada,
  foraDoExpediente,
  identificarPicoForaExpediente,
  type JanelaExpediente,
} from "@/lib/inbox/revenueRescue";

// 2026-01-05 é segunda-feira; 2026-01-10 é sábado — datas fixas e conhecidas
// evitam que o teste dependa do dia da semana em que é executado.
const SEGUNDA = (hora: number, minuto = 0) => new Date(2026, 0, 5, hora, minuto);
const SABADO = (hora: number) => new Date(2026, 0, 10, hora, 0);

function criarConversa(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv_1",
    workspaceId: "default",
    canal: "whatsapp",
    participante: { nome: "Cliente Teste", identificadorMascarado: "[[PII:TELEFONE:1]]" },
    assunto: "Dúvida sobre produto",
    status: "resolvida",
    prioridade: "p3",
    atribuidoTipo: "humano",
    frustrationIndex: 0,
    frustrationTendencia: "estavel",
    circuitBreakerAtivo: false,
    ultimaMensagemPreview: "Obrigado pela ajuda!",
    ultimaMensagemEm: SEGUNDA(3).toISOString(),
    criadaEm: SEGUNDA(3).toISOString(),
    totalMensagens: 4,
    totalMensagensCliente: 2,
    ...overrides,
  };
}

describe("foraDoExpediente", () => {
  it("considera dentro do expediente um horário comercial em dia útil", () => {
    expect(foraDoExpediente(SEGUNDA(14))).toBe(false);
  });

  it("considera fora do expediente a madrugada de um dia útil", () => {
    expect(foraDoExpediente(SEGUNDA(3))).toBe(true);
  });

  it("considera fora do expediente a noite de um dia útil", () => {
    expect(foraDoExpediente(SEGUNDA(20))).toBe(true);
  });

  it("início do expediente é inclusive", () => {
    expect(foraDoExpediente(SEGUNDA(EXPEDIENTE_PADRAO.inicioHora))).toBe(false);
  });

  it("fim do expediente é exclusive", () => {
    expect(foraDoExpediente(SEGUNDA(EXPEDIENTE_PADRAO.fimHora))).toBe(true);
  });

  it("considera fim de semana fora do expediente mesmo em horário comercial", () => {
    expect(foraDoExpediente(SABADO(14))).toBe(true);
  });

  it("respeita uma janela de expediente customizada", () => {
    const janela24h: JanelaExpediente = { inicioHora: 0, fimHora: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6] };
    expect(foraDoExpediente(SEGUNDA(3), janela24h)).toBe(false);
    expect(foraDoExpediente(SABADO(14), janela24h)).toBe(false);
  });

  it("devolve false para uma data inválida, em vez de lançar", () => {
    expect(foraDoExpediente(new Date("não-é-uma-data"))).toBe(false);
  });
});

describe("calcularReceitaRecuperadaMadrugada", () => {
  it("devolve zero para lista vazia", () => {
    const resultado = calcularReceitaRecuperadaMadrugada([]);
    expect(resultado.totalConversas).toBe(0);
    expect(resultado.totalAltaIntencaoComercial).toBe(0);
    expect(resultado.totalMensagensCliente).toBe(0);
    expect(resultado.conversas).toEqual([]);
  });

  it("conta apenas conversas RESOLVIDAS com primeiro contato fora do expediente", () => {
    const resolvidaDeMadrugada = criarConversa({ id: "c1", status: "resolvida", criadaEm: SEGUNDA(3).toISOString() });
    const resolvidaEmHorarioComercial = criarConversa({
      id: "c2",
      status: "resolvida",
      criadaEm: SEGUNDA(14).toISOString(),
    });
    const abertaDeMadrugada = criarConversa({ id: "c3", status: "aberta", criadaEm: SEGUNDA(3).toISOString() });

    const resultado = calcularReceitaRecuperadaMadrugada([
      resolvidaDeMadrugada,
      resolvidaEmHorarioComercial,
      abertaDeMadrugada,
    ]);

    expect(resultado.totalConversas).toBe(1);
    expect(resultado.conversas.map((c) => c.id)).toEqual(["c1"]);
  });

  it("conta como alta intenção comercial apenas roteamento 'comercial' com confiança suficiente", () => {
    const base = { status: "resolvida" as const, criadaEm: SEGUNDA(22).toISOString() };
    const comercialConfiante = criarConversa({
      id: "c1",
      ...base,
      roteamento: {
        intencao: { categoria: "comercial", confianca: 0.8, sinais: [] },
        complexidade: 0.3,
        candidatos: [],
        escolhido: null,
        decididoEm: SEGUNDA(22).toISOString(),
      },
    });
    const comercialPoucoConfiante = criarConversa({
      id: "c2",
      ...base,
      roteamento: {
        intencao: { categoria: "comercial", confianca: 0.2, sinais: [] },
        complexidade: 0.3,
        candidatos: [],
        escolhido: null,
        decididoEm: SEGUNDA(22).toISOString(),
      },
    });
    const tecnicaConfiante = criarConversa({
      id: "c3",
      ...base,
      roteamento: {
        intencao: { categoria: "tecnico", confianca: 0.9, sinais: [] },
        complexidade: 0.3,
        candidatos: [],
        escolhido: null,
        decididoEm: SEGUNDA(22).toISOString(),
      },
    });
    const semRoteamento = criarConversa({ id: "c4", ...base });

    const resultado = calcularReceitaRecuperadaMadrugada([
      comercialConfiante,
      comercialPoucoConfiante,
      tecnicaConfiante,
      semRoteamento,
    ]);

    expect(resultado.totalConversas).toBe(4);
    expect(resultado.totalAltaIntencaoComercial).toBe(1);
  });

  it("soma mensagens de cliente apenas das conversas elegíveis", () => {
    const elegivel = criarConversa({
      id: "c1",
      status: "resolvida",
      criadaEm: SEGUNDA(3).toISOString(),
      totalMensagensCliente: 5,
    });
    const naoElegivel = criarConversa({
      id: "c2",
      status: "resolvida",
      criadaEm: SEGUNDA(14).toISOString(),
      totalMensagensCliente: 100,
    });

    const resultado = calcularReceitaRecuperadaMadrugada([elegivel, naoElegivel]);
    expect(resultado.totalMensagensCliente).toBe(5);
  });

  it("respeita uma janela de expediente customizada em vez da padrão", () => {
    const madrugada = criarConversa({ id: "c1", status: "resolvida", criadaEm: SEGUNDA(3).toISOString() });
    const janela24h: JanelaExpediente = { inicioHora: 0, fimHora: 24, diasUteis: [0, 1, 2, 3, 4, 5, 6] };

    const comPadrao = calcularReceitaRecuperadaMadrugada([madrugada]);
    const comJanelaCustomizada = calcularReceitaRecuperadaMadrugada([madrugada], janela24h);

    expect(comPadrao.totalConversas).toBe(1);
    expect(comJanelaCustomizada.totalConversas).toBe(0);
  });
});

describe("identificarPicoForaExpediente", () => {
  it("devolve null quando há menos de 3 conversas — evita apontar pico sem sinal real", () => {
    const duasConversas = [
      criarConversa({ id: "c1", criadaEm: SEGUNDA(22).toISOString() }),
      criarConversa({ id: "c2", criadaEm: SEGUNDA(22).toISOString() }),
    ];
    expect(identificarPicoForaExpediente(duasConversas)).toBeNull();
  });

  it("identifica a hora local com mais primeiros contatos", () => {
    const conversas = [
      criarConversa({ id: "c1", criadaEm: SEGUNDA(22, 10).toISOString() }),
      criarConversa({ id: "c2", criadaEm: SEGUNDA(22, 40).toISOString() }),
      criarConversa({ id: "c3", criadaEm: SEGUNDA(3, 0).toISOString() }),
    ];
    expect(identificarPicoForaExpediente(conversas)).toEqual({ hora: 22, total: 2 });
  });

  it("ignora datas inválidas sem lançar", () => {
    const conversas = [
      criarConversa({ id: "c1", criadaEm: "não-é-uma-data" }),
      criarConversa({ id: "c2", criadaEm: SEGUNDA(22).toISOString() }),
      criarConversa({ id: "c3", criadaEm: SEGUNDA(22).toISOString() }),
      criarConversa({ id: "c4", criadaEm: SEGUNDA(22).toISOString() }),
    ];
    expect(identificarPicoForaExpediente(conversas)).toEqual({ hora: 22, total: 3 });
  });
});
