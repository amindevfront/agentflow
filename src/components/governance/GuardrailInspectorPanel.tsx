"use client";

// Inspetor de guardrails.
//
// Permite validar uma política contra um payload real antes de colocá-la em
// produção. A inspeção roda em `/api/guardrails/inspect`, no servidor, que é a
// fonte de verdade: um veredito calculado no browser é visível e alterável por
// quem o executa, e portanto não serve como controle.
//
// A resposta da rota traz apenas texto mascarado. Nada re-hidratado atravessa a
// fronteira da API.

import { useState } from "react";
import type {
  GuardrailVerdict,
  InboundInspection,
  OutboundInspection,
  PiiKind,
} from "@/types";
import { POLITICAS_PREDEFINIDAS, ROTULO_POR_KIND } from "@/lib/guardrails";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/Button";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { cn } from "@/lib/utils";

type IdPolitica = keyof typeof POLITICAS_PREDEFINIDAS;

const OPCOES_POLITICA: Array<{ valor: IdPolitica; label: string }> = [
  { valor: "padrao", label: "Padrão" },
  { valor: "no-critico", label: "Nó crítico" },
  { valor: "sandbox", label: "Sandbox" },
];

const corVeredito: Record<GuardrailVerdict, string> = {
  permitido: "bg-state-done-bg text-state-done",
  mascarado: "bg-signal-100 text-signal-700",
  transbordo: "bg-state-run-bg text-state-run",
  bloqueado: "bg-state-error-bg text-state-error",
};

const PAYLOAD_EXEMPLO = `{
  "cliente": {
    "nome": "Maria Souza",
    "cpf": "529.982.247-25",
    "email": "maria.souza@exemplo.com.br",
    "telefone": "(11) 98765-4321"
  },
  "pedido": { "id": "PED-4471", "valor": "R$ 12.480,00" },
  "observacao": "Cliente pediu desconto"
}`;

interface RespostaInspecao {
  traceId?: string;
  entrada?: InboundInspection;
  saida?: (OutboundInspection & { saidaFinal: string }) | null;
  erro?: { codigo: string; mensagem: string };
}

export function GuardrailInspectorPanel() {
  const [politica, setPolitica] = useState<IdPolitica>("padrao");
  const [payload, setPayload] = useState(PAYLOAD_EXEMPLO);
  const [amostras, setAmostras] = useState("");
  const [contextos, setContextos] = useState("");
  const [resultado, setResultado] = useState<RespostaInspecao | null>(null);
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const definicao = POLITICAS_PREDEFINIDAS[politica];

  async function inspecionar() {
    setErro(null);
    setExecutando(true);
    setResultado(null);

    try {
      const usuario = auth?.currentUser;
      if (!usuario) {
        throw new Error("Sessão expirada. Entre novamente para usar o inspetor.");
      }

      // Cada linha não vazia é uma amostra/contexto independente.
      const listaAmostras = amostras.split("\n").map((l) => l.trim()).filter(Boolean);
      const listaContextos = contextos.split("\n").map((l) => l.trim()).filter(Boolean);

      const resposta = await fetch("/api/guardrails/inspect", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await usuario.getIdToken()}`,
        },
        body: JSON.stringify({
          payload,
          politica,
          amostras: listaAmostras,
          contextos: listaContextos,
        }),
      });

      const dados = (await resposta.json().catch(() => ({}))) as RespostaInspecao;
      if (!resposta.ok) {
        throw new Error(dados.erro?.mensagem ?? `Falha na inspeção (HTTP ${resposta.status}).`);
      }
      setResultado(dados);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível inspecionar o payload.");
    } finally {
      setExecutando(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Inspetor de guardrails</h3>
          <p className="mt-0.5 text-xs text-ink-400">
            Valide uma política contra um payload real. A inspeção roda no servidor e não grava nada.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">Política</span>
          <SegmentedFilter
            rotuloGrupo="Política de guardrail"
            opcoes={OPCOES_POLITICA}
            selecionado={politica}
            onChange={setPolitica}
          />
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-ink-500">
            <dt>Mascarar PII</dt>
            <dd className="mono text-ink-700">{definicao.mascararPii ? "sim" : "não"}</dd>
            <dt>Exigir fundamentação</dt>
            <dd className="mono text-ink-700">
              {definicao.exigirFundamentacao ? `≥ ${definicao.minGroundedness}` : "não"}
            </dd>
            <dt>Amostras de consistência</dt>
            <dd className="mono text-ink-700">{definicao.amostrasConsistencia}</dd>
            <dt>Consistência mínima</dt>
            <dd className="mono text-ink-700">{definicao.minConsistencia}</dd>
            <dt>Limiar de valor sensível</dt>
            <dd className="mono text-ink-700">R$ {definicao.limiarValorSensivel}</dd>
            <dt>Máx. visitas por nó</dt>
            <dd className="mono text-ink-700">{definicao.maxVisitasPorNo}</dd>
          </dl>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="gr-payload" className="text-sm font-medium text-ink-700">
            Payload de entrada
          </label>
          <textarea
            id="gr-payload"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            rows={10}
            className="mono rounded-[var(--radius-sm)] border border-ink-100 bg-white p-3 text-xs text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="gr-amostras" className="text-sm font-medium text-ink-700">
            Amostras de saída do modelo
          </label>
          <textarea
            id="gr-amostras"
            value={amostras}
            onChange={(e) => setAmostras(e.target.value)}
            rows={3}
            placeholder="Uma amostra por linha. Duas ou mais ativam a checagem de consistência estocástica."
            className="mono rounded-[var(--radius-sm)] border border-ink-100 bg-white p-3 text-xs text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="gr-contextos" className="text-sm font-medium text-ink-700">
            Contexto de fundamentação
          </label>
          <textarea
            id="gr-contextos"
            value={contextos}
            onChange={(e) => setContextos(e.target.value)}
            rows={3}
            placeholder="Um trecho por linha. A saída é verificada contra estes dados."
            className="mono rounded-[var(--radius-sm)] border border-ink-100 bg-white p-3 text-xs text-ink-950 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" loading={executando} onClick={inspecionar}>
            Inspecionar
          </Button>
          <span className="text-xs text-ink-400">Não afeta execuções reais.</span>
        </div>

        {erro && <p className="text-xs text-state-error">{erro}</p>}
      </section>

      <section className="flex flex-col gap-4 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
        {!resultado?.entrada ? (
          <p className="text-xs text-ink-400">
            Execute uma inspeção para ver o veredito, as violações e o payload mascarado.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink-950">Resultado</h3>
              <span className="mono text-xs text-ink-400">{resultado.traceId}</span>
            </div>

            <BlocoInspecao titulo="Entrada" inspecao={resultado.entrada} />
            {resultado.saida && <BlocoInspecao titulo="Saída" inspecao={resultado.saida} />}

            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                Payload sanitizado (o que sairia para a API externa)
              </h4>
              <pre className="mono max-h-56 overflow-auto rounded-[var(--radius-sm)] bg-ink-950 p-3 text-xs text-mist-50">
                {resultado.entrada.payloadSanitizado || "(bloqueado — nada seria enviado)"}
              </pre>
            </div>

            {resultado.entrada.piiDetectada.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Categorias detectadas
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {resultado.entrada.piiDetectada.map((kind: PiiKind) => (
                    <span
                      key={kind}
                      className="rounded-full bg-signal-100 px-2.5 py-1 text-[11px] font-medium text-signal-700"
                    >
                      {ROTULO_POR_KIND[kind]}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** Bloco compartilhado entre a inspeção de entrada e a de saída. */
function BlocoInspecao({
  titulo,
  inspecao,
}: {
  titulo: string;
  inspecao: InboundInspection | OutboundInspection;
}) {
  const consistencia = "consistencia" in inspecao ? inspecao.consistencia : undefined;
  const fundamentacao = "fundamentacao" in inspecao ? inspecao.fundamentacao : undefined;

  return (
    <div className="rounded-[var(--radius-sm)] border border-ink-100 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink-700">{titulo}</span>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium",
            corVeredito[inspecao.veredito]
          )}
        >
          {inspecao.veredito}
        </span>
      </div>
      <p className="mono mt-1 text-[11px] text-ink-400">
        severidade {inspecao.severidadeMaxima} · {inspecao.duracaoMs}ms · política{" "}
        {inspecao.politicaId}
      </p>

      {inspecao.violacoes.length === 0 ? (
        <p className="mt-2 text-xs text-state-done">Nenhuma violação detectada.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {inspecao.violacoes.map((violacao, indice) => (
            <li key={`${violacao.regra}-${indice}`} className="text-xs text-ink-700">
              <span className="mono text-[11px] text-ink-500">{violacao.regra}</span> ·{" "}
              {violacao.mensagem}
            </li>
          ))}
        </ul>
      )}

      {consistencia && consistencia.amostras > 1 && (
        <p className="mono mt-2 text-[11px] text-ink-400">
          consistência {consistencia.similaridadeMedia} (desvio {consistencia.desvioPadrao}) em{" "}
          {consistencia.amostras} amostras
        </p>
      )}
      {fundamentacao && (
        <p className="mono mt-0.5 text-[11px] text-ink-400">
          fundamentação {fundamentacao.score} em {fundamentacao.afirmacoesAvaliadas} afirmações
        </p>
      )}
    </div>
  );
}
