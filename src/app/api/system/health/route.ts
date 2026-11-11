// GET /api/system/health — painel único de saúde do sistema (Configurações,
// exclusivo de admin).
//
// Antes desta rota, cada capacidade (Admin SDK, trilha de auditoria, IA de
// orquestração, transcrição de áudio, WhatsApp Cloud API) só revelava estar
// mal configurada quando alguém tropeçava nela em produção — um 503 isolado
// no meio de uma demonstração pro cliente, sem nenhum lugar pra ver todas de
// uma vez ANTES disso acontecer. Esta rota só agrega diagnósticos que já
// existiam e já eram usados individualmente por outras rotas
// (`diagnosticoAdmin`, `diagnosticoCripto`, `diagnosticoOrquestrador`,
// `diagnosticoTranscricao`, `diagnosticoWhatsapp`) — nenhuma lógica nova de
// verificação, só a primeira vista unificada delas.
//
// Nunca expõe o VALOR de nenhuma variável — só o nome de qual está ausente,
// mesma informação que já aparece nas mensagens de erro 503 dessas rotas.

import { diagnosticoAdmin, firestoreAdmin } from "@/lib/server/firebaseAdmin";
import {
  diagnosticoCripto,
  diagnosticoMetaMessaging,
  diagnosticoOrquestrador,
  diagnosticoTranscricao,
  diagnosticoTwilio,
  diagnosticoWhatsapp,
} from "@/lib/server/env";
import { ErroApi, comGuarda, respostaJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = comGuarda(async ({ usuario }) => {
  const diagAdmin = diagnosticoAdmin();

  let papel: unknown = null;
  if (diagAdmin.pronto) {
    const snap = await firestoreAdmin().collection("users").doc(usuario.uid).get();
    papel = snap.exists ? (snap.data() as { papel?: unknown }).papel : null;
  }
  if (papel !== "admin") {
    throw new ErroApi(403, "Apenas administradores podem ver o status do sistema.", "papel_insuficiente");
  }

  return respostaJson({
    adminSdk: { pronto: diagAdmin.pronto, faltando: diagAdmin.pronto ? [] : [diagAdmin.motivo ?? "desconhecido"] },
    auditoria: diagnosticoCripto(),
    orquestradorIA: diagnosticoOrquestrador(),
    transcricaoAudio: diagnosticoTranscricao(),
    whatsapp: diagnosticoWhatsapp(),
    twilio: diagnosticoTwilio(),
    metaMessaging: diagnosticoMetaMessaging(),
  });
}, {});
