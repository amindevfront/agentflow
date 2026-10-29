/*!
 * AgentFlow — Web Widget Corporativo (Embed)
 *
 * Script único, sem dependências externas, pensado para ser colado em
 * QUALQUER site de terceiro (EUA/UK/Europa/Brasil) sem conflitar com o CSS
 * ou o JS do host: todo o visual é inline, dentro de um único elemento
 * raiz, e nenhuma variável é exposta no escopo global além do necessário.
 *
 * O que este script faz:
 *   1. lê seus próprios atributos (`data-workspace-id`) a partir da tag
 *      <script> que o carregou;
 *   2. gera/reaproveita um `visitorId` anônimo em localStorage;
 *   3. desenha um botão flutuante + painel de chat;
 *   4. envia cada mensagem para `POST {origem-do-script}/api/inbox/webhook/widget`
 *      — a mesma origem de onde este arquivo foi servido, nunca um domínio
 *      fixo no código.
 *
 * O que este script NÃO faz (ainda, documentado — não escondido): não
 * exibe respostas do operador em tempo real. A mensagem chega de verdade na
 * Neural Inbox do workspace (passa pelo mesmo Shield-Layer, Radar de
 * Sentimento e Circuit Breaker de qualquer outro canal), mas a resposta do
 * atendente hoje chega por fora deste chat (WhatsApp/e-mail/telefone
 * informado) ou numa futura versão com leitura ao vivo.
 */
(function () {
  "use strict";

  var scriptAtual = document.currentScript;
  if (!scriptAtual) {
    // Fallback para carregamento dinâmico/assíncrono, onde
    // `document.currentScript` já não está disponível no momento da execução.
    var candidatos = document.querySelectorAll("script[data-workspace-id]");
    scriptAtual = candidatos[candidatos.length - 1] || null;
  }
  if (!scriptAtual) {
    console.error("[AgentFlow Widget] não foi possível localizar a própria tag <script> — adicione data-workspace-id.");
    return;
  }

  var workspaceId = scriptAtual.getAttribute("data-workspace-id");
  if (!workspaceId) {
    console.error('[AgentFlow Widget] atributo "data-workspace-id" ausente — o widget não será exibido.');
    return;
  }

  var origemScript;
  try {
    origemScript = new URL(scriptAtual.src, window.location.href).origin;
  } catch (erro) {
    console.error("[AgentFlow Widget] não foi possível determinar a origem do script:", erro);
    return;
  }

  var ENDPOINT = origemScript + "/api/inbox/webhook/widget";
  var CHAVE_VISITOR_ID = "__agentflow_widget_visitor_id";

  function obterVisitorId() {
    try {
      var existente = window.localStorage.getItem(CHAVE_VISITOR_ID);
      if (existente) return existente;
      var novo =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      window.localStorage.setItem(CHAVE_VISITOR_ID, novo);
      return novo;
    } catch (erro) {
      // localStorage pode estar indisponível (modo privado, cota cheia) — um
      // id efêmero por carregamento de página ainda permite enviar a mensagem,
      // só não preserva a mesma conversa entre visitas.
      return "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
  }

  var visitorId = obterVisitorId();

  // Paleta espelhada 1:1 de src/app/globals.css — nenhuma cor nova.
  var TOKEN = {
    signal600: "#1450F0",
    signal700: "#0B3FCB",
    ink950: "#0A0F1A",
    ink500: "#59697D",
    ink100: "#E4E9EE",
    mist50: "#F5F7F9",
    white: "#FFFFFF",
    stateError: "#C22A2E",
    stateErrorBg: "#FBE7E7",
  };

  function el(tag, estilos, atributos) {
    var elemento = document.createElement(tag);
    if (estilos) Object.assign(elemento.style, estilos);
    if (atributos) {
      Object.keys(atributos).forEach(function (chave) {
        elemento.setAttribute(chave, atributos[chave]);
      });
    }
    return elemento;
  }

  function montarUI() {
    var raiz = el("div", { position: "fixed", bottom: "20px", right: "20px", zIndex: "2147483000" });

    var botao = el(
      "button",
      {
        width: "56px",
        height: "56px",
        borderRadius: "999px",
        border: "none",
        background: TOKEN.signal600,
        color: TOKEN.white,
        cursor: "pointer",
        boxShadow: "0 8px 24px rgba(10, 15, 26, 0.24)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Arial, sans-serif",
      },
      { "aria-label": "Abrir chat de atendimento", type: "button" }
    );
    botao.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    var painel = el("div", {
      display: "none",
      position: "absolute",
      bottom: "68px",
      right: "0",
      width: "320px",
      maxHeight: "440px",
      background: TOKEN.white,
      borderRadius: "16px",
      boxShadow: "0 8px 24px rgba(10, 15, 26, 0.24)",
      overflow: "hidden",
      fontFamily: "Arial, sans-serif",
      flexDirection: "column",
    });

    var cabecalho = el("div", {
      background: TOKEN.ink950,
      color: TOKEN.white,
      padding: "14px 16px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    });
    cabecalho.innerHTML = '<strong style="font-size:14px;">Fale com a gente</strong>';
    var botaoFechar = el(
      "button",
      {
        background: "transparent",
        border: "none",
        color: TOKEN.white,
        cursor: "pointer",
        fontSize: "18px",
        lineHeight: "1",
      },
      { "aria-label": "Fechar chat", type: "button" }
    );
    botaoFechar.textContent = "×";
    cabecalho.appendChild(botaoFechar);

    var corpo = el("div", {
      flex: "1",
      overflowY: "auto",
      padding: "12px 16px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      background: TOKEN.mist50,
      minHeight: "160px",
    });

    var introducao = el("p", { fontSize: "12px", color: TOKEN.ink500, margin: "0 0 4px 0" });
    introducao.textContent = "Envie sua mensagem — nossa equipe responde em breve.";
    corpo.appendChild(introducao);

    var statusErro = el("p", {
      fontSize: "12px",
      color: TOKEN.stateError,
      background: TOKEN.stateErrorBg,
      borderRadius: "8px",
      padding: "8px 10px",
      margin: "0",
      display: "none",
    });
    corpo.appendChild(statusErro);

    var rodape = el("div", {
      display: "flex",
      gap: "8px",
      padding: "12px",
      borderTop: "1px solid " + TOKEN.ink100,
      background: TOKEN.white,
    });

    var campoTexto = el(
      "textarea",
      {
        flex: "1",
        resize: "none",
        height: "40px",
        padding: "8px 10px",
        borderRadius: "8px",
        border: "1px solid " + TOKEN.ink100,
        fontFamily: "Arial, sans-serif",
        fontSize: "13px",
        outline: "none",
      },
      { placeholder: "Digite sua mensagem...", "aria-label": "Mensagem" }
    );

    var botaoEnviar = el(
      "button",
      {
        background: TOKEN.signal600,
        color: TOKEN.white,
        border: "none",
        borderRadius: "8px",
        padding: "0 16px",
        cursor: "pointer",
        fontSize: "13px",
        fontWeight: "600",
      },
      { type: "button" }
    );
    botaoEnviar.textContent = "Enviar";

    rodape.appendChild(campoTexto);
    rodape.appendChild(botaoEnviar);

    painel.appendChild(cabecalho);
    painel.appendChild(corpo);
    painel.appendChild(rodape);

    raiz.appendChild(painel);
    raiz.appendChild(botao);
    document.body.appendChild(raiz);

    var aberto = false;
    function alternarPainel(abrir) {
      aberto = typeof abrir === "boolean" ? abrir : !aberto;
      painel.style.display = aberto ? "flex" : "none";
    }
    botao.addEventListener("click", function () {
      alternarPainel();
    });
    botaoFechar.addEventListener("click", function () {
      alternarPainel(false);
    });

    function adicionarMensagemAoLog(texto, deQuem) {
      var bolha = el("div", {
        alignSelf: deQuem === "visitante" ? "flex-end" : "flex-start",
        maxWidth: "85%",
        padding: "8px 10px",
        borderRadius: "10px",
        fontSize: "13px",
        background: deQuem === "visitante" ? TOKEN.signal600 : TOKEN.white,
        color: deQuem === "visitante" ? TOKEN.white : TOKEN.ink950,
        border: deQuem === "visitante" ? "none" : "1px solid " + TOKEN.ink100,
      });
      bolha.textContent = texto;
      corpo.appendChild(bolha);
      corpo.scrollTop = corpo.scrollHeight;
    }

    var enviando = false;
    function enviarMensagem() {
      var texto = campoTexto.value.trim();
      if (!texto || enviando) return;

      enviando = true;
      statusErro.style.display = "none";
      botaoEnviar.disabled = true;
      botaoEnviar.textContent = "Enviando...";

      fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: workspaceId, visitorId: visitorId, texto: texto }),
      })
        .then(function (resposta) {
          return resposta.json().then(function (dados) {
            if (!resposta.ok) {
              var mensagem =
                (dados && dados.erro && dados.erro.mensagem) ||
                "Não foi possível enviar sua mensagem agora. Tente novamente em instantes.";
              throw new Error(mensagem);
            }
            return dados;
          });
        })
        .then(function () {
          adicionarMensagemAoLog(texto, "visitante");
          campoTexto.value = "";
          adicionarMensagemAoLog("Mensagem recebida — nossa equipe vai te responder em breve.", "sistema");
        })
        .catch(function (erro) {
          statusErro.textContent = erro && erro.message ? erro.message : "Falha ao enviar. Tente novamente.";
          statusErro.style.display = "block";
        })
        .finally(function () {
          enviando = false;
          botaoEnviar.disabled = false;
          botaoEnviar.textContent = "Enviar";
        });
    }

    botaoEnviar.addEventListener("click", enviarMensagem);
    campoTexto.addEventListener("keydown", function (evento) {
      if (evento.key === "Enter" && !evento.shiftKey) {
        evento.preventDefault();
        enviarMensagem();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montarUI);
  } else {
    montarUI();
  }
})();
