# SOP — Implantação de Cliente Novo em < 3 Minutos

> Guia operacional para quem implanta um cliente real (imobiliária, construtora, clínica, etc.) no AgentFlow. Cada passo abaixo foi verificado no código-fonte em 2026-11-10 — rótulos de botão e caminhos de clique são exatos, não aproximados. Se a UI mudar, este documento precisa ser revalidado contra o código antes de ser usado em venda.

## Pré-requisito: o que já funciona de ponta a ponta hoje

Só dois canais de entrada têm ingestão real de mensagens: **Web Widget Corporativo (Embed)** e **WhatsApp Business (Cloud API)**. Webhook genérico, E-mail, Armazenamento, API externa e SMS/Twilio ainda só *registram o canal* — não recebem mensagem real (a UI já avisa isso no próprio seletor de tipo). **Não prometa esses canais a um cliente pagante ainda.**

---

## Passo 1 — Criar (ou confirmar) o workspace do cliente — ~40s

- Se o cliente é novo: vá em `/onboarding` → preencha o nome do workspace → avance → escolha o **setor primário** (nicho: Construtora & Imobiliária, Clínica de Alto Padrão, E-commerce, etc.) → clique **"Criar workspace"**.
- Se o workspace já existe e o nicho precisa mudar: Configurações → card **"Workspace"** → seção **"Nicho ativo"** → botão **"Trocar nicho"** (só aparece para admin) → reabre o quiz de onboarding e atualiza nicho, moeda e regime de encargos juntos.
- Confirme moeda e regime de encargos em **Governança → Parâmetros** — qualquer ajuste ali reflete em Configurações e na Neural Inbox em tempo real.

## Passo 2 — Ativar o canal real do cliente — ~60s

Em **Canais & Integrações**:

1. Botão **"Novo conector"**.
2. Dê um nome e selecione o tipo:
   - **Web Widget Corporativo (Embed)** → copie o snippet gerado (botão **"Copiar"**) e cole no `<head>` do site do cliente. Já funciona ponta a ponta (Shield-Layer, Radar de Sentimento, Circuit Breaker).
   - **WhatsApp Business (Cloud API)** → preencha o **Phone Number ID** (vem do Meta for Developers → seu app → WhatsApp → API Setup). Mensagens reais só chegam depois de `META_WEBHOOK_SECRET` e credenciais da Cloud API estarem configuradas no ambiente — confirme com o time técnico antes de repassar ao cliente como "pronto".
3. Botão **"Adicionar"**.

## Passo 3 — Validar com dados de demonstração no Sandbox — ~40s

Em **Fluxos**, role até a seção **"Sandbox"** (ela já existe dentro da própria página de Fluxos, não é uma rota separada):

1. Botão **"Carregar Payload de Exemplo"** — preenche automaticamente um payload calibrado para o nicho ativo do workspace (vem de `flowDemoData.ts`, um exemplo por setor).
2. Botão **"Executar teste"** — roda isolado, não afeta dado real.
3. Com o resultado na tela, clique **"Enviar como lead de teste para a Neural Inbox"** — isso cria uma conversa de demonstração real, passando pelo mesmo pipeline (Shield-Layer, Circuit Breaker) de uma mensagem de cliente verdadeira, só rotulada como teste.
4. Clique no link **"abrir na Neural Inbox →"** que aparece em seguida.

## Passo 4 — Validar o atendimento na Neural Inbox — ~30s

A conversa de teste já abre direto (deep-link `/inbox?conversa={id}`). Confirme:
- A mensagem mascarada (Shield-Layer) aparece correta.
- O Radar de Sentimento / índice de frustração está calculado.
- Se o nicho tiver painel dedicado (ex.: Lead de Alto Padrão para Imobiliário/Construtora), ele aparece lateral à conversa.

Responda a mensagem de teste manualmente para confirmar que o envio do operador também funciona.

## Passo 5 — Extrair ROI e entregar o link exclusivo ao cliente — ~30s

- **Relatório para o seu time / apresentação de venda:** Governança → botão **"Baixar Relatório Executivo PDF"** (gera localmente, com selo de auditoria embutido).
- **Link exclusivo do cliente (o que você entrega a ele):** Fluxos → card **"Link Único do Cliente"** → botão **"Gerar link do portal"** (gera um slug único, verificado contra o workspace — não dá pra adivinhar o portal de outro cliente) → botão **"Copiar link para o cliente"** → envie por WhatsApp. O QR Code ao lado é gerado no navegador, sem serviço terceiro.

O cliente abre `/portal/{slug}` e acompanha ROI e atendimentos em tempo real, sem precisar de login no AgentFlow.

---

## Checklist de 3 minutos (ordem exata)

1. [ ] Onboarding ou "Trocar nicho" → setor correto escolhido
2. [ ] Conector real ativo (Widget ou WhatsApp) — **nunca** Webhook/E-mail/SMS/API externa como canal prometido
3. [ ] Fluxos → Sandbox → "Carregar Payload de Exemplo" → "Executar teste" → "Enviar como lead de teste para a Neural Inbox"
4. [ ] Abrir a conversa criada na Neural Inbox e responder manualmente
5. [ ] Governança → "Baixar Relatório Executivo PDF" (seu uso interno)
6. [ ] Fluxos → "Gerar link do portal" → "Copiar link para o cliente" → enviar

## O que NÃO fazer

- Não ative/prometa canais sem ingestão real (ver aviso no próprio seletor de "Tipo" em Canais & Integrações).
- Não pule o Passo 3 — é a única forma de provar ao cliente que o pipeline completo (Shield-Layer → Inbox → métricas) funciona antes dele mandar tráfego real.
- Não gere o link do portal antes do conector e do teste de sandbox — o cliente pode abrir o link e ver um workspace sem nenhum atendimento, o que parece quebrado mesmo não sendo.
