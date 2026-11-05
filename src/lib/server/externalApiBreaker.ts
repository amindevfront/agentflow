// Disjuntor de resiliência para chamadas de rede a provedores externos (hoje:
// a Anthropic em `orchestratorAdmin.ts`) — SERVER-ONLY.
//
// Vocabulário: "circuit breaker" já nomeia outro mecanismo neste código
// (`detectarCircuitBreakerPorSlaVencido` em `@/lib/inbox/firestore` — segurança
// conversacional por SLA estourado, nada a ver com rede). Para não colidir,
// este arquivo chama o seu mecanismo de "disjuntor".
//
// Estado por instância de processo, não distribuído: em Fluid Compute a mesma
// instância atende várias requisições em sequência, então o estado acumula
// localmente entre chamadas — suficiente para parar de martelar um provedor
// fora do ar sem precisar de armazenamento compartilhado. Uma instância fria
// (cold start) sempre começa fechada.
//
// Três estados clássicos:
//   fechado     → chamadas passam normalmente; cada falha incrementa o
//                 contador de falhas consecutivas.
//   aberto      → chamadas são recusadas IMEDIATAMENTE, sem tocar a rede, até
//                 o tempo de resfriamento passar. É isto que poupa o provedor
//                 (e a latência de quem chama) durante uma indisponibilidade.
//   meio-aberto → depois do resfriamento, exatamente uma chamada de teste
//                 passa; sucesso fecha o disjuntor, falha reabre e reinicia o
//                 resfriamento.
//
// O que este módulo NÃO faz: retry. Combinar retry (`@/lib/promiseUtils`,
// `retryWithTimeout`) com o disjuntor é responsabilidade de quem chama
// `executar` — o disjuntor só decide SE a chamada (ou a série de tentativas)
// deve acontecer, nunca quantas vezes tentar.

export type EstadoDisjuntor = "fechado" | "aberto" | "meio-aberto";

export interface ConfiguracaoDisjuntor {
  /** Falhas consecutivas que abrem o disjuntor. */
  limiarFalhas: number;
  /** Tempo de resfriamento, em ms, antes de permitir a tentativa em meio-aberto. */
  resfriamentoMs: number;
}

/** Lançado quando o disjuntor está aberto — a chamada real nunca aconteceu. */
export class ErroDisjuntorAberto extends Error {
  constructor(nome: string) {
    super(`Disjuntor "${nome}" está aberto — chamada recusada sem tentar a rede.`);
    this.name = "ErroDisjuntorAberto";
  }
}

export class DisjuntorChamadaExterna {
  private estado: EstadoDisjuntor = "fechado";
  private falhasConsecutivas = 0;
  private abriuEmMs = 0;

  constructor(
    private readonly nome: string,
    private readonly config: ConfiguracaoDisjuntor,
    /** Injetável em teste; em produção é sempre `Date.now`. */
    private readonly agoraMs: () => number = () => Date.now()
  ) {}

  /** Estado efetivo agora — resolve a transição aberto → meio-aberto pela passagem do tempo. */
  estadoAtual(): EstadoDisjuntor {
    if (this.estado === "aberto" && this.agoraMs() - this.abriuEmMs >= this.config.resfriamentoMs) {
      return "meio-aberto";
    }
    return this.estado;
  }

  /**
   * Executa `fn` sob o disjuntor. Lança `ErroDisjuntorAberto` sem chamar `fn`
   * quando o disjuntor está aberto (degradação graciosa: quem chama trata
   * isto como qualquer outra falha do provedor, só que sem esperar a rede).
   */
  async executar<T>(fn: () => Promise<T>): Promise<T> {
    const estadoEfetivo = this.estadoAtual();
    if (estadoEfetivo === "aberto") {
      throw new ErroDisjuntorAberto(this.nome);
    }

    try {
      const resultado = await fn();
      this.falhasConsecutivas = 0;
      this.estado = "fechado";
      return resultado;
    } catch (erro) {
      this.falhasConsecutivas += 1;
      // Em meio-aberto, a tentativa de teste é a única chance: uma falha
      // reabre na hora, independente do limiar configurado.
      if (estadoEfetivo === "meio-aberto" || this.falhasConsecutivas >= this.config.limiarFalhas) {
        if (this.estado !== "aberto") {
          console.error(
            `[disjuntor:${this.nome}] abriu após ${this.falhasConsecutivas} falha(s) consecutiva(s).`
          );
        }
        this.estado = "aberto";
        this.abriuEmMs = this.agoraMs();
      }
      throw erro;
    }
  }
}
