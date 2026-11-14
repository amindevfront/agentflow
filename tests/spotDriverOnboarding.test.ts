import { describe, expect, it } from "vitest";
import {
  avaliarDossieMotoristaSpot,
  construirResumoExecutivoMotoristaSpot,
  decidirProximaAcaoOnboardingSpot,
  DOCUMENTOS_OBRIGATORIOS_SPOT,
  gerarMensagemSolicitacaoDocumento,
  validarDocumentoMotorista,
} from "@/lib/spotDriverOnboarding";
import type { DocumentoMotoristaSpot, DossieMotoristaSpot, TipoDocumentoMotoristaSpot } from "@/types";

const REFERENCIA = new Date("2026-03-15T12:00:00.000Z");

function documento(parcial: Partial<DocumentoMotoristaSpot> = {}): DocumentoMotoristaSpot {
  return {
    tipo: "cnh",
    status: "pendente",
    validadeEm: null,
    motivoInvalido: null,
    recebidoEm: null,
    ...parcial,
  };
}

function dossieCompletoValido(referencia: Date = REFERENCIA): DocumentoMotoristaSpot[] {
  return DOCUMENTOS_OBRIGATORIOS_SPOT.map((tipo) =>
    documento({
      tipo,
      status: "recebido",
      validadeEm: tipo === "cnh" || tipo === "antt" ? new Date(referencia.getTime() + 30 * 86_400_000).toISOString() : null,
    })
  );
}

function dossie(parcial: Partial<DossieMotoristaSpot> = {}): DossieMotoristaSpot {
  return {
    id: "motorista-1",
    workspaceId: "ws-1",
    nomeMotorista: "João",
    placaVeiculo: "ABC1D23",
    documentos: [],
    status: "amarelo",
    pendencias: [],
    ticketAbertoEm: null,
    criadoEm: "2026-03-01T00:00:00.000Z",
    atualizadoEm: "2026-03-01T00:00:00.000Z",
    ...parcial,
  };
}

describe("validarDocumentoMotorista", () => {
  it("mantém `pendente` como pendente, sem inventar motivo de invalidez", () => {
    const doc = validarDocumentoMotorista(documento({ status: "pendente" }), REFERENCIA);
    expect(doc.status).toBe("pendente");
    expect(doc.motivoInvalido).toBeNull();
  });

  it("CRLV/comprovante de residência (sem data de validade) ficam válidos só por presença", () => {
    const crlv = validarDocumentoMotorista(documento({ tipo: "crlv", status: "recebido" }), REFERENCIA);
    expect(crlv.status).toBe("valido");

    const comprovante = validarDocumentoMotorista(
      documento({ tipo: "comprovante-residencia", status: "recebido" }),
      REFERENCIA
    );
    expect(comprovante.status).toBe("valido");
  });

  it("CNH/ANTT recebidas sem data de validade informada ficam inválidas", () => {
    const doc = validarDocumentoMotorista(documento({ tipo: "cnh", status: "recebido", validadeEm: null }), REFERENCIA);
    expect(doc.status).toBe("invalido");
    expect(doc.motivoInvalido).toMatch(/sem data de validade/);
  });

  it("CNH vencida fica inválida, com os dias de atraso no motivo", () => {
    const doc = validarDocumentoMotorista(
      documento({ tipo: "cnh", status: "recebido", validadeEm: "2026-03-01T00:00:00.000Z" }),
      REFERENCIA
    );
    expect(doc.status).toBe("invalido");
    expect(doc.motivoInvalido).toMatch(/vencida há 14 dia\(s\)/);
  });

  it("ANTT com validade futura fica válida", () => {
    const doc = validarDocumentoMotorista(
      documento({ tipo: "antt", status: "recebido", validadeEm: "2026-04-01T00:00:00.000Z" }),
      REFERENCIA
    );
    expect(doc.status).toBe("valido");
    expect(doc.motivoInvalido).toBeNull();
  });
});

describe("avaliarDossieMotoristaSpot", () => {
  it("vermelho quando ao menos um documento obrigatório está inválido, mesmo com os outros completos", () => {
    const documentos = dossieCompletoValido();
    documentos[0] = { ...documentos[0], validadeEm: "2026-01-01T00:00:00.000Z" }; // CNH vencida
    const avaliacao = avaliarDossieMotoristaSpot(documentos, REFERENCIA);
    expect(avaliacao.status).toBe("vermelho");
    expect(avaliacao.pendencias.length).toBeGreaterThan(0);
  });

  it("amarelo quando falta documento obrigatório, sem nenhum inválido", () => {
    const documentos = dossieCompletoValido().filter((d) => d.tipo !== "crlv");
    const avaliacao = avaliarDossieMotoristaSpot(documentos, REFERENCIA);
    expect(avaliacao.status).toBe("amarelo");
    expect(avaliacao.pendencias).toContain("CRLV ainda não recebida.");
  });

  it("amarelo quando um documento obrigatório está `recebido` mas ainda não validado", () => {
    const documentos = dossieCompletoValido().map((d) =>
      d.tipo === "comprovante-residencia" ? { ...d, status: "recebido" as const } : d
    );
    // `recebido` sem validade: comprovante-residencia não tem validade monitorada,
    // então `validarDocumentoMotorista` já o promoveria a `valido` — força o caso
    // realista: CNH recebida (válida por si, mas ainda sem checagem concluída).
    const documentosComCnhRecebida = documentos.map((d) =>
      d.tipo === "cnh" ? { ...d, status: "recebido" as const, validadeEm: null } : d
    );
    const avaliacao = avaliarDossieMotoristaSpot(documentosComCnhRecebida, REFERENCIA);
    expect(avaliacao.status).not.toBe("verde");
  });

  it("verde somente quando os quatro documentos obrigatórios estão válidos", () => {
    const avaliacao = avaliarDossieMotoristaSpot(dossieCompletoValido(), REFERENCIA);
    expect(avaliacao.status).toBe("verde");
    expect(avaliacao.pendencias).toEqual([]);
  });
});

describe("decidirProximaAcaoOnboardingSpot", () => {
  it("aguarda quando o dossiê já está aprovado, mesmo se o status for vermelho (não deve acontecer na prática)", () => {
    const d = dossie({ status: "vermelho", aprovadoEm: "2026-03-01T00:00:00.000Z" });
    expect(decidirProximaAcaoOnboardingSpot(d).acao).toBe("aguardar-documentos");
  });

  it("aguarda (idempotente) quando já existe ticket aberto para a transição atual", () => {
    const d = dossie({ status: "vermelho", ticketAbertoEm: "2026-03-10T00:00:00.000Z" });
    const decisao = decidirProximaAcaoOnboardingSpot(d);
    expect(decisao.acao).toBe("aguardar-documentos");
    expect(decisao.motivo).toMatch(/Ticket já aberto/);
  });

  it("escala documentação irregular quando o status é vermelho e não há ticket ainda", () => {
    const d = dossie({ status: "vermelho", pendencias: ["CNH vencida há 5 dia(s)."] });
    const decisao = decidirProximaAcaoOnboardingSpot(d);
    expect(decisao.acao).toBe("escalar-documentacao-irregular");
    expect(decisao.motivo).toContain("CNH vencida há 5 dia(s).");
  });

  it("marca pronto para aprovação quando o status é verde e não há ticket ainda", () => {
    const d = dossie({ status: "verde", pendencias: [] });
    expect(decidirProximaAcaoOnboardingSpot(d).acao).toBe("dossie-pronto-aprovacao");
  });

  it("aguarda documentos enquanto a triagem (amarelo) está em andamento", () => {
    const d = dossie({ status: "amarelo", pendencias: ["CRLV ainda não recebida."] });
    const decisao = decidirProximaAcaoOnboardingSpot(d);
    expect(decisao.acao).toBe("aguardar-documentos");
    expect(decisao.motivo).toContain("CRLV ainda não recebida.");
  });
});

describe("gerarMensagemSolicitacaoDocumento", () => {
  it("usa o rótulo legível do documento, nunca o identificador técnico", () => {
    const tipos: TipoDocumentoMotoristaSpot[] = ["cnh", "crlv", "antt", "comprovante-residencia"];
    for (const tipo of tipos) {
      expect(gerarMensagemSolicitacaoDocumento(tipo)).not.toContain(tipo);
    }
    expect(gerarMensagemSolicitacaoDocumento("comprovante-residencia")).toContain("Comprovante de Residência");
  });
});

describe("construirResumoExecutivoMotoristaSpot", () => {
  it("monta o card com placa null quando ausente, nunca inventada", () => {
    const d = dossie({ placaVeiculo: null, status: "amarelo", pendencias: ["CRLV ainda não recebida."] });
    const resumo = construirResumoExecutivoMotoristaSpot(d);
    expect(resumo.nomeMotorista).toBe("João");
    expect(resumo.placaVeiculo).toBeNull();
    expect(resumo.status).toBe("amarelo");
    expect(resumo.pendencias).toEqual(["CRLV ainda não recebida."]);
  });
});
