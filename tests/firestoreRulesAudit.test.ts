// Auditoria estática de `firestore.rules` — garante multi-tenancy estrita
// (ver ADR-0005, item 3).
//
// Por que estático, e não um teste real contra o emulador do Firestore:
// `@firebase/rules-unit-testing` exige o Firestore Emulator, que por sua vez
// exige JDK 11+ — este ambiente só tem JDK 8 disponível (confirmado via
// `java -version` ao preparar esta ADR). Em vez de simular um teste de
// emulador que nenhuma CI real rodaria sem essa dependência, este arquivo
// faz uma verificação ESTRUTURAL do texto das regras: toda coleção com dados
// de um tenant precisa gatear leitura/escrita por `belongsToWorkspace`/
// `isAdminOf`, e nenhuma coleção sensível pode ter `if true` fora das DUAS
// exceções já documentadas no próprio arquivo de regras. Isto não substitui
// um teste comportamental real (não executa a CEL, não verifica que a
// FUNÇÃO está correta) — mas pega exatamente a classe de regressão mais
// perigosa: alguém afrouxando uma regra sem querer, ou esquecendo de
// escopar uma coleção nova por workspace. Rodar via emulador fica
// documentado como trabalho futuro na ADR-0005, assim que JDK 11+ estiver
// disponível no ambiente de CI.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CAMINHO_REGRAS = resolve(__dirname, "..", "firestore.rules");
const TEXTO_REGRAS = readFileSync(CAMINHO_REGRAS, "utf-8");

/**
 * Extrai o corpo de um bloco `match /caminho/{...} { ... }`, respeitando
 * chaves aninhadas (sub-coleções) — uma extração por regex simples quebraria
 * ao encontrar a primeira `}` de uma sub-coleção interna.
 */
function corpoDoMatch(texto: string, caminhoMatch: string): string {
  const prefixo = `match ${caminhoMatch}`;
  const inicioMatch = texto.indexOf(prefixo);
  if (inicioMatch === -1) {
    throw new Error(`Bloco "match ${caminhoMatch}" não encontrado em firestore.rules.`);
  }
  // `caminhoMatch` já termina em `}` (o parâmetro, ex. "{workspaceId}") — a
  // chave de ABERTURA do bloco é a PRÓXIMA depois dessa, não a primeira
  // chave que aparece (que seria a do próprio parâmetro).
  const inicioChave = texto.indexOf("{", inicioMatch + prefixo.length);
  let profundidade = 0;
  for (let i = inicioChave; i < texto.length; i++) {
    if (texto[i] === "{") profundidade++;
    if (texto[i] === "}") {
      profundidade--;
      if (profundidade === 0) return texto.slice(inicioChave + 1, i);
    }
  }
  throw new Error(`Chave de fechamento não encontrada para "match ${caminhoMatch}".`);
}

/** Linhas de `allow ...` fora de comentário, para checar `if true` sem alarme falso em prosa de comentário. */
function linhasDeAllow(corpo: string): string[] {
  return corpo
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("allow ") && !l.startsWith("//"));
}

describe("firestore.rules — auditoria estrutural de multi-tenancy", () => {
  // Toda coleção abaixo guarda dados de UM workspace e precisa gatear leitura
  // e escrita por pertencimento (`belongsToWorkspace`/`isAdminOf`) — nenhuma
  // delas pode ter uma linha `allow ...: if true` sem condição adicional.
  const COLECOES_ESCOPADAS_POR_WORKSPACE = [
    "/workspaces/{workspaceId}",
    "/flows/{flowId}",
    "/flowRuns/{runId}",
    "/connectors/{connectorId}",
    "/credentials/{credentialId}",
    "/hitlTickets/{ticketId}",
    "/conversations/{conversationId}",
    "/operatorProfiles/{uid}",
    "/agentProfiles/{agentId}",
    "/campaigns/{campaignId}",
    "/optOuts/{optOutId}",
    "/nicheAttachments/{attachmentId}",
    "/appointments/{appointmentId}",
    "/shipments/{shipmentId}",
    "/contratosImobiliarios/{contratoId}",
    "/pedidosEcommerce/{pedidoId}",
  ];

  it.each(COLECOES_ESCOPADAS_POR_WORKSPACE)("%s referencia belongsToWorkspace/isAdminOf e não usa 'if true' puro", (caminho) => {
    const corpo = corpoDoMatch(TEXTO_REGRAS, caminho);
    expect(corpo).toMatch(/belongsToWorkspace\(|isAdminOf\(/);

    for (const linha of linhasDeAllow(corpo)) {
      // "if true" isolado (sem mais nada na condição) é a assinatura de uma
      // regra aberta por engano. `allow create: if isSignedIn();` em
      // `workspaces` é uma condição diferente (exige auth, não abre tudo) e
      // não cai neste padrão.
      expect(linha, `linha suspeita em ${caminho}: "${linha}"`).not.toMatch(/:\s*if true\s*;/);
    }
  });

  it("users/{uid}: leitura do próprio doc é permitida mesmo antes dele existir, leitura de outro exige mesmo workspace", () => {
    const corpo = corpoDoMatch(TEXTO_REGRAS, "/users/{uid}");
    expect(corpo).toMatch(/request\.auth\.uid == uid/);
    expect(corpo).toMatch(/belongsToWorkspace\(/);
  });

  it("invites/{inviteId}: a ÚNICA leitura sem autenticação é 'get' (aceite de convite) — 'list' continua escopado", () => {
    const corpo = corpoDoMatch(TEXTO_REGRAS, "/invites/{inviteId}");
    expect(corpo).toMatch(/allow get:\s*if true;/);
    expect(corpo).not.toMatch(/allow list:\s*if true;/);
    expect(corpo).toMatch(/allow list:[^;]*belongsToWorkspace\(/);
  });

  const COLECOES_SEM_LEITURA_DE_CLIENTE = [
    "/credentialSecrets/{secretId}",
    "/messageVaults/{vaultId}",
    "/recipientVaults/{vaultId}",
    "/_rateLimits/{bucketId}",
  ];

  it.each(COLECOES_SEM_LEITURA_DE_CLIENTE)("%s nega leitura a todo cliente (allow read: if false)", (caminho) => {
    const corpo = corpoDoMatch(TEXTO_REGRAS, caminho);
    expect(corpo).toMatch(/allow read(,\s*write)?:\s*if false;/);
  });

  const COLECOES_SOMENTE_ADMIN_SDK = ["/flowRuns/{runId}", "/auditLogs/{entryId}", "/auditChainHead/{workspaceId}"];

  it.each(COLECOES_SOMENTE_ADMIN_SDK)("%s nega toda escrita de cliente (allow write: if false)", (caminho) => {
    const corpo = corpoDoMatch(TEXTO_REGRAS, caminho);
    expect(corpo).toMatch(/allow write:\s*if false;/);
  });

  it("não existe nenhuma linha 'allow read, write: if true' em todo o arquivo", () => {
    expect(TEXTO_REGRAS).not.toMatch(/allow\s+(read|write|read,\s*write)\s*:\s*if\s+true\s*;/);
  });

  it("workspaces/{workspaceId}: create é a única operação que não depende de isAdminOf (onboarding, documentado), mas exige donoUid == auth.uid", () => {
    const corpo = corpoDoMatch(TEXTO_REGRAS, "/workspaces/{workspaceId}");
    expect(corpo).toMatch(/allow create:\s*if isSignedIn\(\)\s*&&\s*request\.resource\.data\.donoUid == request\.auth\.uid;/);
    expect(corpo).toMatch(/allow update:\s*if isAdminOf\(workspaceId\);/);
    expect(corpo).toMatch(/allow delete:\s*if false;/);
  });

  it("users/{uid}: papel/workspaceId nunca são escolha livre de quem escreve o próprio documento", () => {
    const corpo = corpoDoMatch(TEXTO_REGRAS, "/users/{uid}");

    // Regressão que isto existe para pegar: um `allow write` genérico
    // bastando `request.auth.uid == uid` permite autopromoção a admin de
    // QUALQUER workspace só por escrever o próprio documento — por isso a
    // escrita tem de estar dividida em `create`/`update`, nunca um `write`
    // único cobrindo os dois.
    expect(corpo).not.toMatch(/allow write:\s*if isSignedIn\(\)\s*&&\s*request\.auth\.uid == uid;/);

    // Criação só por onboarding self-serve (dono do próprio workspace, novo
    // ou ainda inexistente) ou por convite pendente que corresponda
    // exatamente a papel/workspaceId/e-mail.
    expect(corpo).toMatch(/allow create:[\s\S]*?request\.resource\.data\.papel == 'admin'/);
    expect(corpo).toMatch(/donoUid == request\.auth\.uid/);
    expect(corpo).toMatch(/conviteAceitoId/);
    expect(corpo).toMatch(/invites\/\$\(request\.resource\.data\.conviteAceitoId\)/);

    // Depois de criado, papel e workspaceId são imutáveis — nenhuma
    // atualização legítima os reescreve.
    expect(corpo).toMatch(
      /allow update:[\s\S]*?request\.resource\.data\.papel == resource\.data\.papel[\s\S]*?request\.resource\.data\.workspaceId == resource\.data\.workspaceId/
    );
    expect(corpo).toMatch(/allow delete:\s*if false;/);
  });

  it("invites/{inviteId}: só admin cria (inclusive escolher papel), e a única transição permitida é pendente -> aceito", () => {
    const corpo = corpoDoMatch(TEXTO_REGRAS, "/invites/{inviteId}");

    // Regressão que isto existe para pegar: `allow create` bastando
    // `belongsToWorkspace` deixa qualquer `operacoes` forjar um convite de
    // admin; `allow update` bastando `isSignedIn()` deixa qualquer usuário
    // autenticado reescrever o papel/workspace de um convite de OUTRO
    // tenant.
    expect(corpo).not.toMatch(/allow create:\s*if belongsToWorkspace\(/);
    expect(corpo).toMatch(/allow create:[\s\S]*?isAdminOf\(request\.resource\.data\.workspaceId\)/);

    expect(corpo).not.toMatch(/allow update:\s*if isSignedIn\(\);/);
    expect(corpo).toMatch(/allow update:[\s\S]*?resource\.data\.status == 'pendente'/);
    expect(corpo).toMatch(/allow update:[\s\S]*?request\.resource\.data\.papel == resource\.data\.papel/);
    expect(corpo).toMatch(/allow update:[\s\S]*?request\.resource\.data\.workspaceId == resource\.data\.workspaceId/);
  });
});
