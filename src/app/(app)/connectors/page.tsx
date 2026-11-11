"use client";

import { useEffect, useState, type FormEvent } from "react";
import { subscribeConnectors, createConnector, deleteConnector } from "@/lib/firestore";
import { registrarEventoAuditoriaSilencioso } from "@/lib/auditLog";
import { fetchComTimeout } from "@/lib/fetchComTimeout";
import { auth } from "@/lib/firebase";
import { useWorkspace } from "@/lib/workspace";
import { connectorSchema, primeiraMensagemZod } from "@/lib/validation/schemas";
import { gerarWidgetEmbedSnippet } from "@/lib/inbox/channelAdapters";
import { Pill } from "@/components/ui/Pill";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { DeleteIconButton } from "@/components/ui/DeleteIconButton";
import type { Connector } from "@/types";

// Canais Globais (EUA/UK/Europa): os dois últimos tipos, além dos quatro já
// existentes, são os novos adaptadores de mensageria — ver
// `@/lib/inbox/channelAdapters`.
const CONNECTOR_TYPES = [
  "Webhook",
  "E-mail",
  "Armazenamento",
  "API externa",
  "SMS / Twilio Gateway",
  "Web Widget Corporativo (Embed)",
  "WhatsApp Business (Cloud API)",
];

const TIPO_WIDGET = "Web Widget Corporativo (Embed)";
const TIPO_WHATSAPP = "WhatsApp Business (Cloud API)";
const TIPO_SMS = "SMS / Twilio Gateway";
const TIPOS_COM_INGESTAO_REAL = new Set([TIPO_WIDGET, TIPO_WHATSAPP, TIPO_SMS]);
const TIPOS_SEM_INGESTAO_REAL = new Set(CONNECTOR_TYPES.filter((t) => !TIPOS_COM_INGESTAO_REAL.has(t)));

export default function ConnectorsPage() {
  const { workspaceId } = useWorkspace();
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState(CONNECTOR_TYPES[0]);
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState("");
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [nomeError, setNomeError] = useState<string | null>(null);
  const [snippetExpandidoId, setSnippetExpandidoId] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [conectorParaExcluir, setConectorParaExcluir] = useState<Connector | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [whatsappFaltando, setWhatsappFaltando] = useState<string[] | null>(null);
  const [twilioFaltando, setTwilioFaltando] = useState<string[] | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeConnectors(workspaceId, setConnectors);
  }, [workspaceId]);

  const temConectorWhatsapp = connectors.some((c) => c.tipo === TIPO_WHATSAPP);
  const temConectorSms = connectors.some((c) => c.tipo === TIPO_SMS);

  // Aviso real, não suposição: um conector "conectado" na tela não significa
  // que o servidor tem as credenciais do provedor — ver `diagnosticoWhatsapp`/
  // `diagnosticoTwilio` em `@/lib/server/env`. Só checa quando existe pelo
  // menos um conector de algum desses tipos, pra não gastar uma chamada à toa.
  useEffect(() => {
    if (!temConectorWhatsapp && !temConectorSms) {
      setWhatsappFaltando(null);
      setTwilioFaltando(null);
      return;
    }
    let cancelado = false;
    (async () => {
      try {
        const usuarioAtual = auth?.currentUser;
        if (!usuarioAtual) return;
        const resposta = await fetchComTimeout(
          "/api/system/health",
          { headers: { authorization: `Bearer ${await usuarioAtual.getIdToken()}` } },
          "",
          10_000
        );
        if (!resposta.ok || cancelado) return;
        const dados = (await resposta.json()) as {
          whatsapp?: { pronto: boolean; faltando: string[] };
          twilio?: { pronto: boolean; faltando: string[] };
        };
        if (cancelado) return;
        if (temConectorWhatsapp) setWhatsappFaltando(dados.whatsapp?.pronto ? null : (dados.whatsapp?.faltando ?? []));
        if (temConectorSms) setTwilioFaltando(dados.twilio?.pronto ? null : (dados.twilio?.faltando ?? []));
      } catch {
        // Silencioso de propósito: isto é um aviso de conveniência, não uma
        // ação crítica — uma falha de rede aqui não pode virar outro erro
        // na tela de Conectores.
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [temConectorWhatsapp, temConectorSms]);

  async function copiarSnippet(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Clipboard pode estar indisponível (permissão negada, contexto não seguro) —
      // o snippet continua selecionável/copiável manualmente no <pre>.
    }
  }

  async function confirmarExclusaoConector() {
    if (!conectorParaExcluir) return;
    setExcluindo(true);
    try {
      await deleteConnector(conectorParaExcluir.id);
      registrarEventoAuditoriaSilencioso({
        tipo: "conector.excluido",
        recurso: `connectors/${conectorParaExcluir.id}`,
        workspaceId: conectorParaExcluir.workspaceId,
        detalhes: { nome: conectorParaExcluir.nome, tipo: conectorParaExcluir.tipo },
      });
      setConectorParaExcluir(null);
    } finally {
      setExcluindo(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;

    const validado = connectorSchema.safeParse({ nome, tipo });
    if (!validado.success) {
      setNomeError(primeiraMensagemZod(validado.error));
      return;
    }

    if (tipo === TIPO_WHATSAPP && metaPhoneNumberId.trim().length === 0) {
      setNomeError('Informe o "Phone Number ID" do Meta for Developers para este conector.');
      return;
    }
    if (tipo === TIPO_SMS && twilioPhoneNumber.trim().length === 0) {
      setNomeError("Informe o número Twilio (formato E.164, ex.: +15551234567) para este conector.");
      return;
    }

    setNomeError(null);
    setSaving(true);
    try {
      // Web Widget, WhatsApp e SMS/Twilio são os tipos de conector com
      // ingestão real implementada ponta a ponta nesta versão (ver
      // `widgetHabilitado` em `@/lib/server/inboxWidgetAdmin`,
      // `resolverConectorPorPhoneNumberId` em `@/lib/server/whatsappCloudApiAdmin`
      // e `resolverConectorPorNumeroTwilio` em `@/lib/server/twilioSmsAdmin`).
      // Os demais tipos (Webhook, E-mail, API externa) ainda não têm o
      // provedor real ligado — "não configurado" é honesto para eles.
      const status = TIPOS_COM_INGESTAO_REAL.has(validado.data.tipo) ? "conectado" : "nao-configurado";
      await createConnector(workspaceId, {
        ...validado.data,
        status,
        ...(validado.data.tipo === TIPO_WHATSAPP ? { metaPhoneNumberId: metaPhoneNumberId.trim() } : {}),
        ...(validado.data.tipo === TIPO_SMS ? { twilioPhoneNumber: twilioPhoneNumber.trim() } : {}),
      });
      setNome("");
      setMetaPhoneNumberId("");
      setTwilioPhoneNumber("");
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-ink-950">Canais &amp; Integrações (WhatsApp/APIs)</p>
          <p className="mono text-xs text-ink-400">
            {connectors.length} conector{connectors.length === 1 ? "" : "es"}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          Novo conector
        </Button>
      </div>

      {whatsappFaltando && whatsappFaltando.length > 0 && (
        <div className="rounded-[var(--radius-sm)] border border-state-run-ink/40 bg-state-run-bg p-3">
          <p className="text-xs font-semibold text-ink-900">
            ⚠️ O WhatsApp aparece &quot;conectado&quot; aqui, mas o servidor ainda não está pronto para receber mensagem real.
          </p>
          <p className="mt-1 text-[11px] text-ink-600">
            Falta configurar no servidor: <span className="mono">{whatsappFaltando.join(", ")}</span> — e registrar a
            URL do webhook no Meta for Developers. Peça ajuda técnica; sem isso, nenhuma mensagem chega de verdade.
          </p>
        </div>
      )}

      {twilioFaltando && twilioFaltando.length > 0 && (
        <div className="rounded-[var(--radius-sm)] border border-state-run-ink/40 bg-state-run-bg p-3">
          <p className="text-xs font-semibold text-ink-900">
            ⚠️ O SMS aparece &quot;conectado&quot; aqui, mas o servidor ainda não está pronto para receber/enviar mensagem real.
          </p>
          <p className="mt-1 text-[11px] text-ink-600">
            Falta configurar no servidor: <span className="mono">{twilioFaltando.join(", ")}</span> — e registrar a
            URL do webhook na conta Twilio (Messaging → número → &quot;A message comes in&quot;). Peça ajuda técnica;
            sem isso, nenhuma mensagem chega de verdade.
          </p>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field
              label="Nome do conector"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              errorText={nomeError ?? undefined}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-ink-700" htmlFor="connector-tipo">
              Tipo
            </label>
            <select
              id="connector-tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="h-10 rounded-[var(--radius-sm)] border border-ink-100 bg-white px-3 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-100"
            >
              {CONNECTOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                  {TIPOS_SEM_INGESTAO_REAL.has(t) ? " — ainda não recebe mensagens reais" : ""}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" loading={saving} size="sm">
            Adicionar
          </Button>
        </form>
      )}

      {showForm && tipo === TIPO_WHATSAPP && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 p-3">
          <Field
            label="Phone Number ID (Meta for Developers)"
            value={metaPhoneNumberId}
            onChange={(e) => setMetaPhoneNumberId(e.target.value)}
            placeholder="Ex.: 109876543210987"
            helpText='Fica no painel do Meta for Developers, dentro do seu app → WhatsApp → API Setup. NÃO é o número de telefone — é o "Phone Number ID" interno do Meta.'
          />
          <p className="text-[11px] text-ink-400">
            Pra mensagens reais chegarem, falta configurar <span className="mono">META_WEBHOOK_SECRET</span> e{" "}
            <span className="mono">WHATSAPP_ACCESS_TOKEN</span> no ambiente, e registrar a URL deste webhook no painel
            do Meta. Peça ajuda técnica pra esse passo — é configuração fora do AgentFlow, feita uma única vez.
          </p>
        </div>
      )}

      {showForm && tipo === TIPO_SMS && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 p-3">
          <Field
            label="Número Twilio (formato E.164)"
            value={twilioPhoneNumber}
            onChange={(e) => setTwilioPhoneNumber(e.target.value)}
            placeholder="Ex.: +15551234567"
            helpText="O número de SMS da conta Twilio do cliente — é o campo To que a Twilio envia em todo webhook."
          />
          <p className="text-[11px] text-ink-400">
            Pra mensagens reais chegarem, falta configurar <span className="mono">TWILIO_ACCOUNT_SID</span>,{" "}
            <span className="mono">TWILIO_AUTH_TOKEN</span> e <span className="mono">TWILIO_PHONE_NUMBER</span> no
            ambiente, e apontar o webhook deste número (Twilio Console → Messaging → número → &quot;A message comes
            in&quot;) para <span className="mono">/api/inbox/webhook/twilio</span>. Peça ajuda técnica pra esse
            passo — é configuração fora do AgentFlow, feita uma única vez.
          </p>
        </div>
      )}

      {showForm && tipo === TIPO_WIDGET && workspaceId && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-ink-700">
              Snippet de embed — cole no <span className="mono">&lt;head&gt;</span> do seu site
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                copiarSnippet(gerarWidgetEmbedSnippet({ workspaceId, baseUrl: window.location.origin }))
              }
            >
              {copiado ? "Copiado!" : "Copiar"}
            </Button>
          </div>
          <pre className="mono overflow-x-auto rounded-[var(--radius-sm)] border border-ink-100 bg-white p-2.5 text-[11px] text-ink-700">
            {gerarWidgetEmbedSnippet({ workspaceId, baseUrl: window.location.origin })}
          </pre>
          <p className="text-[11px] text-ink-400">
            Já funciona de ponta a ponta: mensagens enviadas pelo widget chegam na Neural Inbox passando pelo mesmo
            Shield-Layer, Radar de Sentimento e Circuit Breaker dos demais canais. Ainda não há exibição de resposta
            do atendente em tempo real dentro do próprio widget — essa resposta chega por fora, hoje.
          </p>
        </div>
      )}

      {showForm && TIPOS_SEM_INGESTAO_REAL.has(tipo) && (
        <div className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-state-run-ink/40 bg-state-run-bg p-3">
          <p className="text-xs font-medium text-ink-700">
            Este tipo ainda não recebe mensagens reais nesta versão.
          </p>
          <p className="text-[11px] text-ink-500">
            O registro salva o nome do canal para planejamento, mas a ligação com o provedor de verdade (Instagram/
            Facebook via Meta) ainda não está disponível — a rota de recebimento existe e valida a assinatura do
            provedor, mas responde que a ingestão não está pronta. Os canais que já funcionam de ponta a ponta hoje
            são <span className="font-medium">Web Widget Corporativo</span>,{" "}
            <span className="font-medium">WhatsApp Business (Cloud API)</span> e{" "}
            <span className="font-medium">SMS / Twilio Gateway</span>.
          </p>
        </div>
      )}

      {connectors.length === 0 ? (
        <EmptyState
          title="Nenhum conector configurado"
          description="Conecte webhooks, e-mail ou APIs externas para acionar seus fluxos."
          action={
            <Button size="sm" onClick={() => setShowForm(true)}>
              Novo conector
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {connectors.map((c) => (
            <div key={c.id} className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-ink-100 bg-white p-4">
              <div className="flex items-center gap-3">
                <Avatar name={c.nome} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-950">{c.nome}</p>
                  <p className="truncate text-xs text-ink-500">{c.tipo}</p>
                </div>
                <Pill status={c.status} />
                <DeleteIconButton label={`Excluir conector ${c.nome}`} onClick={() => setConectorParaExcluir(c)} />
              </div>
              {c.tipo === TIPO_WIDGET && workspaceId && (
                <>
                  <button
                    type="button"
                    onClick={() => setSnippetExpandidoId((atual) => (atual === c.id ? null : c.id))}
                    className="self-start text-[11px] font-medium text-signal-600 hover:text-signal-700"
                  >
                    {snippetExpandidoId === c.id ? "ocultar snippet" : "ver snippet de embed"}
                  </button>
                  {snippetExpandidoId === c.id && (
                    <pre className="mono overflow-x-auto rounded-[var(--radius-sm)] border border-ink-100 bg-mist-50 p-2.5 text-[10px] text-ink-700">
                      {gerarWidgetEmbedSnippet({ workspaceId, baseUrl: window.location.origin })}
                    </pre>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={conectorParaExcluir !== null}
        onClose={() => setConectorParaExcluir(null)}
        titleId="excluir-conector-title"
        title={`Excluir "${conectorParaExcluir?.nome ?? ""}"?`}
        body={
          conectorParaExcluir &&
          TIPOS_COM_INGESTAO_REAL.has(conectorParaExcluir.tipo) &&
          connectors.filter((c) => c.tipo === conectorParaExcluir.tipo).length <= 1
            ? `Este é o ÚNICO conector "${conectorParaExcluir.tipo}" deste workspace, e é um canal REAL. Ao excluir, qualquer mensagem nova por este canal passa a falhar na hora — o widget já embedado no site do cliente mostra erro, ou o número de WhatsApp para de receber. Mensagens já recebidas continuam na Neural Inbox; isto não apaga conversas.`
            : "O conector é removido permanentemente. Mensagens que ele já recebeu continuam na Neural Inbox — isto não apaga conversas, só desliga este canal para novas mensagens."
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConectorParaExcluir(null)}>
              Cancelar
            </Button>
            <Button variant="danger-solid" size="sm" loading={excluindo} onClick={confirmarExclusaoConector}>
              Sim, excluir
            </Button>
          </>
        }
      />
    </div>
  );
}
