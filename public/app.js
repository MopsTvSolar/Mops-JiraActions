(() => {
  "use strict";

  // Credenciais ficam só nesta variável em memória: nunca em localStorage,
  // sessionStorage ou cookie. Somem sozinhas ao fechar/recarregar a aba.
  // "caixa" é só a seleção da caixa solucionadora atual (não é segredo).
  const state = { email: null, token: null, caixa: "solar" };

  const $ = (id) => document.getElementById(id);

  const loginCard = $("login-card");
  const appView = $("app-view");
  const loginError = $("login-error");
  const resultBanner = $("result-banner");
  const reportBox = $("report-box");
  const consolidadoDialog = $("consolidado-dialog");
  const resultsCard = $("results-card");

  const otherActionButtons = [
    $("btn-extracao-completa"),
    $("btn-a-violar"),
    $("btn-violar-hoje"),
    $("btn-violar-amanha"),
    $("btn-violar-semanal"),
    $("btn-violados"),
    $("btn-report-diario"),
    $("btn-report-consolidado"),
    $("btn-categorias-encerramento"),
    $("btn-criados-resolvidos"),
    $("btn-reabertos"),
    $("btn-criticos"),
    $("btn-analistas-encerramento"),
    $("btn-report-geral"),
  ];

  // Grupos ("caixas") de cada caixa solucionadora — espelha CAIXAS em
  // api/index.py. Usado só pra popular os checkboxes de "Selecionar
  // caixas"; a validação de verdade (o que é aceito de fato) é sempre
  // refeita no servidor.
  const CAIXA_GRUPOS = {
    solar: [
      "CLBR-TI-OPS-OGS-SOLAR-SALESFORCE-N2",
      "CLBR-TI-OPS-OGS SOLAR SALESFORCE",
      "CLBR-TI-OPS-PROD SOLAR SALESFORCE",
    ],
    tv: ["CLBR-TI-OPS-MOPS TV DO FUTURO", "CLBR-TI-OPS-MOPS-TV DO FUTURO N2"],
  };

  // Rótulo curto de cada grupo, só pra caber discretamente dentro dos
  // quadrados do heatmap semanal (nome completo não cabe).
  const GRUPO_LABEL_CURTO = {
    "CLBR-TI-OPS-OGS SOLAR SALESFORCE": "N1",
    "CLBR-TI-OPS-OGS-SOLAR-SALESFORCE-N2": "N2",
    "CLBR-TI-OPS-PROD SOLAR SALESFORCE": "PROD",
    "CLBR-TI-OPS-MOPS TV DO FUTURO": "N1",
    "CLBR-TI-OPS-MOPS-TV DO FUTURO N2": "N2",
  };

  // Espelha PROJETOS_DISPONIVEIS em api/index.py — vale para A violar,
  // Violados, Extração completa e Categorias de Encerramento (Report
  // Diário/Consolidado não usam isso, têm lógica própria de projeto).
  const PROJETOS_DISPONIVEIS = ["Central de Incidentes", "Abertura de Chamados"];

  // Espelha STATUS_OPTIONS em api/index.py (mesma lista do jira_gui.py).
  const STATUS_OPTIONS = [
    "Triagem",
    "Aguardando Suporte",
    "Aguardando Fornecedor",
    "Reaberto",
    "Em atendimento",
    "Aguardando Cliente",
    "Aberto",
    "Encaminhado",
    "Encerrado",
    "Resolvido",
    "Cancelado",
  ];

  function buildCheckboxes(container, options, namePrefix) {
    container.innerHTML = "";
    options.forEach((opcao, i) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = true;
      input.id = `${namePrefix}-${i}`;
      input.dataset.value = opcao;
      label.append(input, document.createTextNode(` ${opcao}`));
      container.append(label);
    });
  }

  function checkedValues(container) {
    return Array.from(container.querySelectorAll("input:checked")).map((el) => el.dataset.value);
  }

  // Painel "PROJETOS": sempre visível, marcado com os dois por padrão.
  // Lido na hora em cada ação (não guardado em "state") — mesmo padrão dos
  // checkboxes de grupos/status da Extração completa.
  buildCheckboxes($("projetos-checkboxes"), PROJETOS_DISPONIVEIS, "projeto");

  function projetosSelecionados() {
    return checkedValues($("projetos-checkboxes"));
  }

  document.querySelectorAll("#projetos-checkboxes input").forEach((el) => {
    el.addEventListener("change", () => carregarJqlAtual());
  });

  // Só um painel de opções fica aberto por vez: ao clicar em qualquer botão
  // (abra ele um painel próprio ou dispare uma ação na hora), os outros que
  // estavam abertos retraem primeiro.
  const ALL_DIALOG_IDS = [
    "extracao-dialog",
    "violar-dialog",
    "consolidado-dialog",
    "categorias-dialog",
    "criados-resolvidos-dialog",
    "reabertos-dialog",
    "violados-dialog",
    "criticos-dialog",
    "analistas-dialog",
    "geral-dialog",
  ];

  function closeAllDialogs(exceptId) {
    ALL_DIALOG_IDS.forEach((id) => {
      if (id !== exceptId) $(id).classList.remove("open");
    });
  }

  // Só um resultado fica visível por vez (tabela padrão — que inclui o
  // heatmap semanal quando é o caso — ou as tabelas de categorias). Evita
  // mostrar dois de uma vez.
  function hideAllResults() {
    resultsCard.classList.add("hidden");
    $("categorias-results").classList.add("hidden");
    $("criados-resolvidos-results").classList.add("hidden");
    $("criticos-results").classList.add("hidden");
    $("analista-detalhe").classList.add("hidden");
    $("sem-chamados-block").classList.add("hidden");
    $("report-diario-hero").classList.add("hidden");
    $("heatmap-block").classList.add("hidden");
    $("geral-results").classList.add("hidden");
    hideHoverPopover();
  }

  // Ação/caixa/filtros da última extração exibida na tela — usado pelo botão
  // "Baixar arquivo" para refazer exatamente a mesma busca, já pedindo o
  // formato de arquivo (mesmo que o usuário troque a caixa depois de ver o
  // resultado). "lastExtraBody" carrega parâmetros específicos da ação
  // (grupos/status/período na Extração completa, por exemplo).
  let lastAction = null;
  let lastCaixa = null;
  let lastExtraBody = {};

  // Seções acumuladas pela última execução do Relatório Geral, no formato que
  // o backend espera para montar o PDF combinado (ver /api/relatorio-geral-pdf).
  let lastGeralSecoes = [];

  const ACTION_LABELS = {
    "extracao-completa": "Extração completa",
    "violar-hoje": "Chamados a violar hoje",
    "violar-amanha": "Chamados a violar amanhã",
    "violar-semanal": "Plano semanal (próximos 7 dias)",
    violados: "Chamados violados",
    reabertos: "Chamados reabertos",
    "report-diario": "Chamados resolvidos hoje",
  };

  // Tom de cor do card de total, de acordo com o significado da ação
  // (mesma paleta de status usada no resto do app: informativo, alerta, crítico).
  const ACTION_TONE = {
    "extracao-completa": "tone-accent",
    "violar-hoje": "tone-warning",
    "violar-amanha": "tone-warning",
    "violar-semanal": "tone-warning",
    violados: "tone-danger",
    reabertos: "tone-warning",
    "report-diario": "tone-accent",
  };

  function setBanner(message, kind) {
    resultBanner.textContent = message;
    resultBanner.className = kind ? `show ${kind}` : "";
  }

  function clearBanner() {
    resultBanner.className = "";
  }

  function setBusy(busy) {
    [
      ...otherActionButtons,
      $("btn-download"),
      $("btn-categorias-gerar"),
      $("btn-extracao-gerar"),
      $("btn-criados-resolvidos-gerar"),
      $("btn-reabertos-gerar"),
      $("btn-violados-gerar"),
      $("btn-criticos-gerar"),
      $("btn-geral-gerar"),
    ].forEach((btn) => (btn.disabled = busy));
    if (!busy) {
      $("btn-geral-pdf").disabled = lastGeralSecoes.length === 0;
    } else {
      $("btn-geral-pdf").disabled = true;
    }
  }

  // Data vigente (data local do navegador), pra exibir discretamente junto
  // dos resultados — não é usada em nenhum cálculo, só contexto visual de
  // "isso reflete o Jira em tal dia".
  function dataVigente(offsetDias = 0) {
    const data = new Date();
    data.setDate(data.getDate() + offsetDias);
    const dd = String(data.getDate()).padStart(2, "0");
    const mm = String(data.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${data.getFullYear()}`;
  }

  // Converte "aaaa-mm-dd" (valor de <input type="date"> e do campo "data" dos
  // dias de Criados x Resolvidos) para "dd/mm/aaaa".
  function formatarDataBR(isoDate) {
    const [ano, mes, dia] = isoDate.split("-");
    return `${dia}/${mes}/${ano}`;
  }

  // A janela de SLA (07:00 às 23:59) só existe de verdade em "A violar
  // hoje/amanhã" — nas outras ações (Extração completa, Violados,
  // Categorias de Encerramento, Plano semanal) mostrar essa janela seria
  // enganoso, então elas ficam só com a data simples.
  function rotuloDataResultado(action) {
    if (action === "violar-hoje") return `Dia de hoje (07:00 às 23:59) — ${dataVigente(0)}`;
    if (action === "violar-amanha") return `Amanhã (07:00 às 23:59) — ${dataVigente(1)}`;
    if (action === "report-diario") return `Dia de hoje — ${dataVigente(0)}`;
    return dataVigente(0);
  }

  function escapeText(value) {
    if (value === null || value === undefined) return "";
    // Defesa extra: se algum campo chegar como objeto/lista não tratado no
    // servidor, mostra algo legível em vez de "[object Object]".
    if (typeof value === "object") {
      if (Array.isArray(value)) return value.map(escapeText).filter(Boolean).join(", ");
      return value.name || value.displayName || value.value || JSON.stringify(value);
    }
    return String(value);
  }

  async function apiCall(path, extraBody) {
    const body = Object.assign({ email: state.email, token: state.token }, extraBody || {});
    const resp = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return resp;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function filenameFromDisposition(header, fallback) {
    if (!header) return fallback;
    const match = /filename="?([^"]+)"?/.exec(header);
    return match ? match[1] : fallback;
  }

  // ------------------------------------------------------------ conexão
  $("btn-connect").addEventListener("click", async () => {
    const email = $("input-email").value.trim();
    const token = $("input-token").value;

    loginError.style.display = "none";
    if (!email || !token) {
      loginError.textContent = "Informe e-mail e API Token.";
      loginError.style.display = "block";
      return;
    }

    const btn = $("btn-connect");
    btn.disabled = true;
    btn.textContent = "Conectando...";

    try {
      const resp = await apiCall("/api/connect", { email, token });
      const data = await resp.json();

      if (!resp.ok) {
        loginError.textContent = data.error || "Falha ao conectar.";
        loginError.style.display = "block";
        return;
      }

      state.email = email;
      state.token = token;

      $("status-identity").textContent = `Conectado como ${data.displayName} (${email})`;
      loginCard.classList.add("hidden");
      appView.classList.remove("hidden");
    } catch (e) {
      loginError.textContent = "Não foi possível conectar ao servidor.";
      loginError.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = "Conectar";
    }
  });

  $("btn-logout").addEventListener("click", () => {
    state.email = null;
    state.token = null;
    state.caixa = "solar";
    document.querySelectorAll(".caixa-btn").forEach((b) => b.classList.toggle("active", b.dataset.caixa === "solar"));
    $("input-email").value = "";
    $("input-token").value = "";
    reportBox.value = "";
    $("btn-report-copiar").disabled = true;
    $("btn-report-pdf").disabled = true;
    $("btn-report-limpar").disabled = true;
    hideAllResults();
    lastAction = null;
    lastCaixa = null;
    lastExtraBody = {};
    $("geral-blocks").innerHTML = "";
    lastGeralSecoes = [];
    $("btn-geral-pdf").disabled = true;
    closeAllDialogs();
    clearBanner();
    appView.classList.add("hidden");
    loginCard.classList.remove("hidden");
    carregarJqlAtual();
    atualizarBotaoCriticos();
    buildGeralCheckboxes();
  });

  // Segurança extra: se o navegador restaurar a página do cache (bfcache),
  // força novo login em vez de reaproveitar credenciais em memória.
  window.addEventListener("pagehide", () => {
    state.email = null;
    state.token = null;
  });

  // ------------------------------------------------------ caixa solucionadora
  // Query geral (fixa no servidor) da caixa atual — só leitura, não é
  // segredo, não precisa estar logado pra ver. Atualiza sozinha ao trocar
  // de caixa no alternador.
  async function carregarJqlAtual() {
    const codeEl = $("jql-atual-code");
    const labelEl = $("jql-atual-label");
    try {
      const resp = await apiCall("/api/jql-atual", { caixa: state.caixa, projetos: projetosSelecionados() });
      const data = await resp.json();
      if (!resp.ok) {
        codeEl.textContent = data.error || "Não foi possível carregar a query.";
        return;
      }
      labelEl.textContent = `QUERY GERAL — ${data.label.toUpperCase()}`;
      codeEl.textContent = data.jql || "(nenhuma JQL configurada no servidor para esta caixa)";
    } catch (e) {
      codeEl.textContent = "Não foi possível conectar ao servidor.";
    }
  }

  // "Chamados Críticos" (COTI) é uma classificação específica da caixa Mops
  // Solar — não faz sentido pra Mops Tv do Futuro, então o botão some fora
  // dela (e a checkbox correspondente some do Relatório Geral).
  function atualizarBotaoCriticos() {
    $("btn-criticos").classList.toggle("hidden", state.caixa !== "solar");
  }

  // O roster de "Analistas de Encerramento" é uma lista fixa de nomes da
  // caixa Mops Solar — mesma lógica de Chamados Críticos: some fora dela.
  function atualizarBotaoAnalistas() {
    $("btn-analistas-encerramento").classList.toggle("hidden", state.caixa !== "solar");
  }

  carregarJqlAtual();
  atualizarBotaoCriticos();
  atualizarBotaoAnalistas();

  document.querySelectorAll(".caixa-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      document.querySelectorAll(".caixa-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.caixa = btn.dataset.caixa;

      // Resultado/report exibido é da caixa anterior — some até rodar de novo.
      hideAllResults();
      lastAction = null;
      lastCaixa = null;
      lastExtraBody = {};
      reportBox.value = "";
      $("btn-report-copiar").disabled = true;
      $("btn-report-pdf").disabled = true;
      $("btn-report-limpar").disabled = true;
      $("geral-blocks").innerHTML = "";
      lastGeralSecoes = [];
      $("btn-geral-pdf").disabled = true;
      closeAllDialogs();
      clearBanner();
      carregarJqlAtual();
      atualizarBotaoCriticos();
      atualizarBotaoAnalistas();
      buildGeralCheckboxes();
    });
  });

  // ------------------------------------------------------------- ações
  const ACTION_ENDPOINTS = {
    "extracao-completa": "/api/extracao-completa",
    "violar-hoje": "/api/violar-hoje",
    "violar-amanha": "/api/violar-amanha",
    "violar-semanal": "/api/violar-semanal",
    violados: "/api/violados",
    reabertos: "/api/reabertos",
    "report-diario": "/api/report-diario",
  };

  // --------------------------------------------------------------- violados
  // Abre um painel de opções (mesmo efeito do botão Categorias de
  // Encerramento) em vez de buscar na hora: "Tudo" (comportamento de sempre,
  // sem filtro de data), "Hoje" ou um período personalizado — filtrando pelo
  // horário em que o SLA estourou.
  $("btn-violados").addEventListener("click", () => {
    const dialog = $("violados-dialog");
    const abrindo = !dialog.classList.contains("open");
    closeAllDialogs("violados-dialog");
    if (abrindo) {
      const hoje = new Date().toISOString().slice(0, 10);
      if (!$("violados-input-inicio").value) $("violados-input-inicio").value = hoje;
      if (!$("violados-input-fim").value) $("violados-input-fim").value = hoje;
    }
    dialog.classList.toggle("open", abrindo);
  });

  $("btn-violados-cancelar").addEventListener("click", () => {
    $("violados-dialog").classList.remove("open");
  });

  document.querySelectorAll('input[name="violados-modo"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const personalizado = document.querySelector('input[name="violados-modo"]:checked').value === "personalizado";
      $("violados-periodo-fields").style.display = personalizado ? "flex" : "none";
    });
  });

  $("btn-violados-gerar").addEventListener("click", async () => {
    const modo = document.querySelector('input[name="violados-modo"]:checked').value;

    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    let inicio = "";
    let fim = "";
    if (modo === "hoje") {
      const hoje = new Date().toISOString().slice(0, 10);
      inicio = hoje;
      fim = hoje;
    } else if (modo === "personalizado") {
      inicio = $("violados-input-inicio").value;
      fim = $("violados-input-fim").value;
      if (!inicio || !fim) {
        setBanner("Informe as duas datas.", "error");
        return;
      }
    }

    const extraBody = { projetos };
    if (inicio && fim) {
      extraBody.inicio = inicio;
      extraBody.fim = fim;
    }

    $("violados-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Buscando chamados no Jira...", "info");
    hideAllResults();
    try {
      const resp = await apiCall("/api/violados", { caixa: state.caixa, ...extraBody });
      const data = await resp.json();

      if (!resp.ok) {
        setBanner(data.error || "Erro ao executar a ação.", "error");
        return;
      }

      lastAction = "violados";
      lastCaixa = state.caixa;
      lastExtraBody = extraBody;
      renderResults("violados", data);
      if (inicio && fim) {
        $("results-date").textContent = `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;
      }
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // ------------------------------------------------------- extração completa
  // Diferente das outras 3 ações: abre um painel de opções (mesmo efeito do
  // botão Categorias de Encerramento) em vez de buscar na hora — deixa
  // escolher caixas/status/período antes de rodar.
  $("btn-extracao-completa").addEventListener("click", () => {
    const dialog = $("extracao-dialog");
    const abrindo = !dialog.classList.contains("open");
    closeAllDialogs("extracao-dialog");
    if (abrindo) {
      buildCheckboxes($("extracao-grupos-checkboxes"), CAIXA_GRUPOS[state.caixa] || [], "extracao-grupo");
      buildCheckboxes($("extracao-status-checkboxes"), STATUS_OPTIONS, "extracao-status");
    }
    dialog.classList.toggle("open", abrindo);
  });

  $("btn-extracao-cancelar").addEventListener("click", () => {
    $("extracao-dialog").classList.remove("open");
  });

  $("btn-extracao-gerar").addEventListener("click", async () => {
    const grupos = checkedValues($("extracao-grupos-checkboxes"));
    const status = checkedValues($("extracao-status-checkboxes"));
    const projetos = projetosSelecionados();
    if (!grupos.length) {
      setBanner("Selecione ao menos uma caixa.", "error");
      return;
    }
    if (!status.length) {
      setBanner("Selecione ao menos um status.", "error");
      return;
    }
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    const inicio = $("extracao-input-inicio").value;
    const fim = $("extracao-input-fim").value;
    if ((inicio && !fim) || (!inicio && fim)) {
      setBanner("Informe as duas datas (início e fim) ou nenhuma.", "error");
      return;
    }

    const extraBody = { grupos, status, projetos, inicio, fim };

    $("extracao-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Buscando chamados no Jira...", "info");
    hideAllResults();
    try {
      const resp = await apiCall("/api/extracao-completa", { caixa: state.caixa, ...extraBody });
      const data = await resp.json();

      if (!resp.ok) {
        setBanner(data.error || "Erro ao executar a ação.", "error");
        return;
      }

      lastAction = "extracao-completa";
      lastCaixa = state.caixa;
      lastExtraBody = extraBody;
      renderResults("extracao-completa", data);
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // ------------------------------------------------------------- a violar
  // "A violar" agora é um único botão com 3 opções: Hoje e Amanhã reusam a
  // tela padrão de resultados (tabela + cards, igual antes); Plano semanal
  // mostra um mapa de calor à parte (heatmap-grid), sem tabela.
  $("btn-a-violar").addEventListener("click", () => {
    const dialog = $("violar-dialog");
    const abrindo = !dialog.classList.contains("open");
    closeAllDialogs("violar-dialog");
    dialog.classList.toggle("open", abrindo);
  });

  async function runViolar(action, endpoint) {
    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    $("violar-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Buscando chamados no Jira...", "info");
    hideAllResults();
    try {
      const resp = await apiCall(endpoint, { caixa: state.caixa, projetos });
      const data = await resp.json();

      if (!resp.ok) {
        setBanner(data.error || "Erro ao executar a ação.", "error");
        return;
      }

      lastAction = action;
      lastCaixa = state.caixa;
      lastExtraBody = { projetos };
      renderResults(action, data);
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  }

  $("btn-violar-hoje").addEventListener("click", () => runViolar("violar-hoje", ACTION_ENDPOINTS["violar-hoje"]));
  $("btn-violar-amanha").addEventListener("click", () =>
    runViolar("violar-amanha", ACTION_ENDPOINTS["violar-amanha"])
  );

  // ------------------------------------------------------- report diário
  // Ação direta, sem diálogo (sempre "hoje") — mesmo padrão "tabela" de
  // Violados/Reabertos: o ranking "Top Analistas do dia" sai de graça do
  // summary.top_assignees, calculado a partir das mesmas linhas da tabela.
  $("btn-report-diario").addEventListener("click", async () => {
    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    closeAllDialogs();
    setBusy(true);
    setBanner("Buscando chamados resolvidos hoje...", "info");
    hideAllResults();
    try {
      const resp = await apiCall(ACTION_ENDPOINTS["report-diario"], { caixa: state.caixa, projetos });
      const data = await resp.json();
      if (!resp.ok) {
        setBanner(data.error || "Erro ao buscar chamados resolvidos hoje.", "error");
        return;
      }

      lastAction = "report-diario";
      lastCaixa = state.caixa;
      lastExtraBody = { projetos };
      renderResults("report-diario", data);
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // Tons do mapa de calor: só marca os dias com carga MAIOR em relação ao
  // pior dia da semana visível — o resto fica na cor neutra do card, sem
  // chamar atenção à toa (dia com 0 ou pouca coisa não precisa de destaque).
  function heatTone(total, max) {
    if (max <= 0 || total <= 0) return "";
    const proporcao = total / max;
    if (proporcao >= 0.75) return "tone-danger";
    if (proporcao >= 0.4) return "tone-warning";
    return "";
  }

  function renderHeatmap(dias) {
    const grid = $("heatmap-grid");
    grid.innerHTML = "";

    const max = dias.reduce((m, d) => Math.max(m, d.total), 0);

    dias.forEach((dia) => {
      const tile = document.createElement("div");
      const tom = heatTone(dia.total, max);
      tile.className = "heat-tile" + (tom ? ` ${tom}` : "");

      const label = document.createElement("span");
      label.className = "heat-tile-label";
      label.textContent = dia.dia_semana;

      const value = document.createElement("span");
      value.className = "heat-tile-value";
      value.textContent = dia.total;

      tile.append(label, value);

      // Detalhamento por caixa, bem discreto — só quando há chamados no dia
      // (dia vazio não ganha uma linha "N1 0 / N2 0 / PROD 0" à toa). Uma
      // linha por caixa, empilhadas, em vez de tudo junto numa linha só.
      const porGrupoComChamados = (dia.por_grupo || []).filter((g) => g.total > 0);
      if (porGrupoComChamados.length) {
        const breakdown = document.createElement("div");
        breakdown.className = "heat-tile-breakdown";
        porGrupoComChamados.forEach((g) => {
          const row = document.createElement("div");
          row.className = "heat-tile-breakdown-row";

          const rowLabel = document.createElement("span");
          rowLabel.textContent = GRUPO_LABEL_CURTO[g.grupo] || g.grupo;

          const rowValue = document.createElement("span");
          rowValue.textContent = g.total;

          row.append(rowLabel, rowValue);
          breakdown.append(row);
        });
        tile.append(breakdown);
      }

      grid.append(tile);
    });

    $("heatmap-block").classList.remove("hidden");
  }

  $("btn-violar-semanal").addEventListener("click", async () => {
    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    $("violar-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Montando o plano semanal...", "info");
    hideAllResults();
    try {
      const resp = await apiCall("/api/violar-semanal", { caixa: state.caixa, projetos });
      const data = await resp.json();

      if (!resp.ok) {
        setBanner(data.error || "Erro ao montar o plano semanal.", "error");
        return;
      }

      lastAction = "violar-semanal";
      lastCaixa = state.caixa;
      lastExtraBody = { projetos };

      // Heatmap + summary + tabela, tudo dentro do MESMO card de
      // resultados (results-card) — não chama renderResults() só porque
      // ela não sabe mostrar o heatmap-block, mas monta o resto igual.
      renderHeatmap(data.dias);
      $("results-title").textContent = `RESULTADOS — ${ACTION_LABELS["violar-semanal"]}`;
      $("results-date").textContent = rotuloDataResultado("violar-semanal");
      renderSummary("violar-semanal", data.summary, null);
      renderTable(data.fields, data.rows);
      resultsCard.classList.remove("hidden");
      resultsCard.scrollIntoView({ behavior: "smooth", block: "nearest" });

      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // --------------------------------------------------------- resultados
  const MAX_ROWS_RENDERED = 500;

  // Só no Report Diário (caixa Mops Solar): quem do roster fixo de
  // Analistas de Encerramento não aparece como assignee de nenhuma linha —
  // cálculo local em cima do que a busca principal já trouxe, sem pedir
  // nada novo ao Jira. Fora daí (outra ação, ou caixa Tv do Futuro, onde o
  // roster nem se aplica) o bloco fica escondido.
  function renderSemChamadosEncerrados(action, rows) {
    const bloco = $("sem-chamados-block");
    if (action !== "report-diario" || state.caixa !== "solar") {
      bloco.classList.add("hidden");
      return;
    }

    const resolveramHoje = new Set(rows.map((r) => r.assignee).filter(Boolean));
    const semChamados = ANALISTAS_ENCERRAMENTO_ROSTER.filter((nome) => !resolveramHoje.has(nome));

    const lista = $("sem-chamados-lista");
    lista.innerHTML = "";
    if (!semChamados.length) {
      bloco.classList.add("hidden");
      return;
    }
    semChamados.forEach((nome) => {
      const tag = document.createElement("span");
      tag.className = "tag tag-nao";
      tag.textContent = nome;
      lista.append(tag);
    });
    bloco.classList.remove("hidden");
  }

  // Preenche uma tabela genérica (fora de #results-table) a partir das
  // colunas já vindas prontas nas linhas — usado pelas 3 tabelas em collapse
  // do card central do Report Diário. Mesmas colunas de quem gerou a linha
  // (Reabertos/Violados/a tabela principal), sem reformatar nada.
  function preencherTabelaGenerica(tableId, rows) {
    const thead = document.querySelector(`#${tableId} thead`);
    const tbody = document.querySelector(`#${tableId} tbody`);
    thead.innerHTML = "";
    tbody.innerHTML = "";

    if (!rows || !rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.textContent = "Nenhum chamado.";
      tr.append(td);
      tbody.append(tr);
      return;
    }

    const fields = Object.keys(rows[0]);
    const trHead = document.createElement("tr");
    fields.forEach((field) => {
      const th = document.createElement("th");
      th.textContent = field;
      trHead.append(th);
    });
    thead.append(trHead);

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      fields.forEach((field) => {
        const td = document.createElement("td");
        td.textContent = escapeText(row[field]);
        tr.append(td);
      });
      tbody.append(tr);
    });
  }

  // Card central só do Report Diário: os 3 números do dia juntos (resolvidos
  // / violados / reabertos), no início dos resultados. Com ele, o card
  // "Total" da linha por grupo (N1/N2/PROD) logo abaixo fica redundante —
  // renderSummary pula ele quando a action é "report-diario" (ver mais abaixo).
  // Clicar em qualquer um dos 3 abre/fecha a tabela correspondente (mesmas
  // colunas de quem gerou aquela linha) — os 3 painéis começam sempre
  // fechados a cada nova busca.
  function renderHeroReportDiario(data) {
    const bloco = $("report-diario-hero");
    const temTudo =
      data.summary && typeof data.summary.total === "number" &&
      typeof data.violados_hoje === "number" &&
      typeof data.reabertos_hoje === "number";
    if (!temTudo) {
      bloco.classList.add("hidden");
      return;
    }
    $("hero-resolvidos").textContent = data.summary.total;
    $("hero-violados").textContent = data.violados_hoje;
    $("hero-reabertos").textContent = data.reabertos_hoje;

    preencherTabelaGenerica("hero-table-resolvidos", data.rows);
    preencherTabelaGenerica("hero-table-violados", data.violados_hoje_rows);
    preencherTabelaGenerica("hero-table-reabertos", data.reabertos_hoje_rows);
    ["resolvidos", "violados", "reabertos"].forEach((chave) => {
      $(`hero-collapse-${chave}`).classList.remove("open");
    });

    bloco.classList.remove("hidden");
  }

  document.querySelectorAll(".hero-clickable").forEach((el) => {
    el.addEventListener("click", () => {
      $(`hero-collapse-${el.dataset.hero}`).classList.toggle("open");
    });
  });

  function renderResults(action, data) {
    $("results-title").textContent = `RESULTADOS — ${ACTION_LABELS[action]}`;
    $("results-date").textContent = rotuloDataResultado(action);
    renderSummary(action, data.summary, data.por_grupo, data.por_turno);
    if (action === "report-diario") {
      renderHeroReportDiario(data);
    } else {
      $("report-diario-hero").classList.add("hidden");
    }
    renderPorDiaViolados(data.por_dia, data.rows);
    renderTable(data.fields, data.rows);
    renderSemChamadosEncerrados(action, data.rows);
    resultsCard.classList.remove("hidden");
    resultsCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ------------------------------------------------ popover de hover (copiar)
  // Um único elemento flutuante reaproveitado por todas as células "Quantidade"
  // da tabela VIOLADOS POR DIA — passar o mouse mostra as keys daquele dia,
  // clicar numa key copia ela pra área de transferência. Some com um pequeno
  // atraso (não no mouseleave direto) pra dar tempo do cursor entrar no
  // próprio popover sem ele fechar no meio do caminho.
  let hoverPopoverEl = null;
  let hoverPopoverHideTimeout = null;

  function getHoverPopover() {
    if (!hoverPopoverEl) {
      hoverPopoverEl = document.createElement("div");
      hoverPopoverEl.className = "hover-popover hidden";
      hoverPopoverEl.addEventListener("mouseenter", cancelHoverPopoverHide);
      hoverPopoverEl.addEventListener("mouseleave", scheduleHoverPopoverHide);
      document.body.append(hoverPopoverEl);
    }
    return hoverPopoverEl;
  }

  function cancelHoverPopoverHide() {
    if (hoverPopoverHideTimeout) {
      clearTimeout(hoverPopoverHideTimeout);
      hoverPopoverHideTimeout = null;
    }
  }

  function hideHoverPopover() {
    cancelHoverPopoverHide();
    if (hoverPopoverEl) hoverPopoverEl.classList.add("hidden");
  }

  function scheduleHoverPopoverHide() {
    cancelHoverPopoverHide();
    hoverPopoverHideTimeout = setTimeout(hideHoverPopover, 200);
  }

  async function copiarTexto(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch (e) {
      return false;
    }
  }

  function showHoverPopover(anchorEl, keys) {
    const popover = getHoverPopover();
    popover.innerHTML = "";

    const titulo = document.createElement("div");
    titulo.className = "hover-popover-title";
    titulo.textContent = `${keys.length} chamado${keys.length === 1 ? "" : "s"}`;
    popover.append(titulo);

    // Copia tudo de uma vez, no formato 'KEY1', 'KEY2', 'KEY3' — pronto pra
    // colar num "key IN (...)" de JQL, por exemplo.
    const copiarTodos = document.createElement("div");
    copiarTodos.className = "hover-popover-copy-all";
    copiarTodos.textContent = "Copiar todos";
    copiarTodos.addEventListener("click", async () => {
      const texto = keys.map((key) => `'${key}'`).join(", ");
      const copiou = await copiarTexto(texto);
      copiarTodos.textContent = copiou ? "Copiado!" : "Erro ao copiar";
      setTimeout(() => {
        copiarTodos.textContent = "Copiar todos";
      }, 900);
    });
    popover.append(copiarTodos);

    // Lista com altura fixa (~4 linhas) e rolagem — evita um popover gigante
    // quando o dia tem dezenas de chamados.
    const lista = document.createElement("div");
    lista.className = "hover-popover-list";
    keys.forEach((key) => {
      const item = document.createElement("span");
      item.className = "hover-popover-key";
      item.textContent = key;
      item.addEventListener("click", async () => {
        const copiou = await copiarTexto(key);
        item.textContent = copiou ? "Copiado!" : "Erro ao copiar";
        item.classList.add(copiou ? "copiado" : "erro-copia");
        setTimeout(() => {
          item.textContent = key;
          item.classList.remove("copiado", "erro-copia");
        }, 900);
      });
      lista.append(item);
    });
    popover.append(lista);

    popover.classList.remove("hidden");

    const anchorRect = anchorEl.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    let top = anchorRect.bottom + 6;
    let left = anchorRect.left;
    if (left + popoverRect.width > window.innerWidth - 8) {
      left = window.innerWidth - popoverRect.width - 8;
    }
    if (top + popoverRect.height > window.innerHeight - 8) {
      top = anchorRect.top - popoverRect.height - 6;
    }
    popover.style.top = `${Math.max(8, top)}px`;
    popover.style.left = `${Math.max(8, left)}px`;
  }

  // Só existe em Violados — quantidade de violados por dia, dias sem nenhum
  // violado não vêm no "por_dia" (o servidor já não os inclui). "rows" (os
  // chamados completos, já disponíveis na resposta) alimenta o hover da
  // coluna "Quantidade": passar o mouse mostra as keys daquele dia, com opção
  // de clicar em cada uma pra copiar.
  function renderPorDiaViolados(porDia, rows) {
    const block = $("por-dia-violados-block");
    const thead = document.querySelector("#por-dia-violados-table thead");
    const tbody = document.querySelector("#por-dia-violados-table tbody");
    thead.innerHTML = "";
    tbody.innerHTML = "";
    hideHoverPopover();

    if (!porDia || !porDia.length) {
      block.classList.add("hidden");
      return;
    }

    const chavesPorDia = {};
    (rows || []).forEach((row) => {
      if (!row.sla_estourou_em) return;
      const dia = row.sla_estourou_em.slice(0, 10);
      (chavesPorDia[dia] = chavesPorDia[dia] || []).push(row.key);
    });

    // "Previsto" (quem tinha prazo pra violar naquele dia, violado ou não)
    // só vem preenchido com período definido (Hoje/Personalizado) — no modo
    // "Tudo" a coluna nem aparece, em vez de mostrar 0 pra tudo.
    const temPrevisto = porDia.some((d) => d.previsto !== undefined);

    const trHead = document.createElement("tr");
    const colunas = ["Data"];
    if (temPrevisto) colunas.push("Previsto pra violar");
    colunas.push("Violados");
    colunas.push("Reaberto?");
    colunas.forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      trHead.append(th);
    });
    thead.append(trHead);

    porDia.forEach(({ data: diaIso, total, previsto, previsto_chaves: previstoChaves, reaberto }) => {
      const tr = document.createElement("tr");
      const tdData = document.createElement("td");
      tdData.textContent = formatarDataBR(diaIso);
      tr.append(tdData);
      if (temPrevisto) {
        const tdPrevisto = document.createElement("td");
        tdPrevisto.textContent = previsto;
        tdPrevisto.className = "violados-qtd-hover";
        tdPrevisto.addEventListener("mouseenter", () => {
          cancelHoverPopoverHide();
          showHoverPopover(tdPrevisto, previstoChaves || []);
        });
        tdPrevisto.addEventListener("mouseleave", scheduleHoverPopoverHide);
        tr.append(tdPrevisto);
      }
      const tdTotal = document.createElement("td");
      tdTotal.textContent = total;
      tdTotal.className = "violados-qtd-hover";
      const keysDoDia = chavesPorDia[diaIso] || [];
      tdTotal.addEventListener("mouseenter", () => {
        cancelHoverPopoverHide();
        showHoverPopover(tdTotal, keysDoDia);
      });
      tdTotal.addEventListener("mouseleave", scheduleHoverPopoverHide);
      tr.append(tdTotal);
      const tdReaberto = document.createElement("td");
      const tag = document.createElement("span");
      tag.className = `tag ${reaberto ? "tag-sim" : "tag-nao"}`;
      tag.textContent = reaberto ? "Sim" : "Não";
      tdReaberto.append(tag);
      tr.append(tdReaberto);
      tbody.append(tr);
    });

    block.classList.remove("hidden");
  }

  function summaryCard(value, label, tone, topAssignees) {
    const card = document.createElement("div");
    card.className = "summary-card" + (tone ? ` ${tone}` : "");

    const valueEl = document.createElement("div");
    valueEl.className = "summary-value";
    valueEl.textContent = value;

    const labelEl = document.createElement("div");
    labelEl.className = "summary-label";
    labelEl.textContent = label;

    card.append(valueEl, labelEl);

    // Ranking "Top responsáveis" só daquele grupo — acompanha a coluna da
    // caixa em vez de um ranking único combinando tudo.
    if (topAssignees && topAssignees.length) {
      const ol = document.createElement("ol");
      ol.className = "summary-card-top-assignees";
      topAssignees.forEach(([nome, count]) => {
        const li = document.createElement("li");
        const nameSpan = document.createElement("span");
        nameSpan.textContent = nome;
        const countSpan = document.createElement("span");
        countSpan.className = "count";
        countSpan.textContent = ` — ${count}`;
        li.append(nameSpan, countSpan);
        ol.append(li);
      });
      card.append(ol);
    }

    return card;
  }

  function renderSummary(action, summary, porGrupo, porTurno) {
    const totalCardsEl = $("summary-cards");
    const porGrupoBlock = $("por-grupo-block");
    const porGrupoCardsEl = $("por-grupo-cards");
    totalCardsEl.innerHTML = "";
    porGrupoCardsEl.innerHTML = "";

    const totalCard = summaryCard(summary.total, "Total de chamados", ACTION_TONE[action]);

    // Quando o card por grupo já vem com o ranking próprio (top_assignees),
    // o bloco "Top responsáveis" combinado abaixo fica redundante — some pra
    // não repetir a mesma informação duas vezes.
    const temTopPorGrupo = porGrupo && porGrupo.some((g) => g.top_assignees && g.top_assignees.length);

    if (porGrupo && porGrupo.length) {
      // Total desce para a mesma linha dos cards por grupo, como primeiro
      // card — exceto no Report Diário, que já mostra o total no card
      // central "62 / 2 / 0" logo acima, então repeti-lo aqui seria redundante.
      if (action !== "report-diario") {
        porGrupoCardsEl.append(totalCard);
      }
      porGrupo.forEach(({ grupo, total, top_assignees }) => {
        porGrupoCardsEl.append(summaryCard(total, GRUPO_LABEL_CURTO[grupo] || grupo, null, top_assignees));
      });
      porGrupoBlock.classList.remove("hidden");
      totalCardsEl.classList.add("hidden");
    } else {
      totalCardsEl.append(totalCard);
      totalCardsEl.classList.remove("hidden");
      porGrupoBlock.classList.add("hidden");
    }

    // Só existe em Violados — contagem de chamados violados por turno do dia.
    const porTurnoBlock = $("por-turno-block");
    const porTurnoCardsEl = $("por-turno-cards");
    porTurnoCardsEl.innerHTML = "";
    if (porTurno && porTurno.length) {
      porTurno.forEach(({ turno, total }) => {
        porTurnoCardsEl.append(summaryCard(total, turno));
      });
      porTurnoBlock.classList.remove("hidden");
    } else {
      porTurnoBlock.classList.add("hidden");
    }

    const assigneesEl = $("top-assignees");
    assigneesEl.innerHTML = "";
    if (!temTopPorGrupo && summary.top_assignees && summary.top_assignees.length) {
      const title = document.createElement("div");
      title.className = "top-assignees-title";
      title.textContent = "Top responsáveis";
      assigneesEl.append(title);

      const ol = document.createElement("ol");
      summary.top_assignees.forEach(([nome, count]) => {
        const li = document.createElement("li");
        const nameSpan = document.createElement("span");
        nameSpan.textContent = nome;
        const countSpan = document.createElement("span");
        countSpan.className = "count";
        countSpan.textContent = ` — ${count}`;
        li.append(nameSpan, countSpan);
        ol.append(li);
      });
      assigneesEl.append(ol);
    }
  }

  function renderTable(fields, rows) {
    const thead = document.querySelector("#results-table thead");
    const tbody = document.querySelector("#results-table tbody");
    thead.innerHTML = "";
    tbody.innerHTML = "";

    if (!rows || !rows.length) {
      $("table-note").textContent = "Nenhum chamado encontrado para os critérios atuais.";
      return;
    }

    const trHead = document.createElement("tr");
    fields.forEach((field) => {
      const th = document.createElement("th");
      th.textContent = field;
      trHead.append(th);
    });
    thead.append(trHead);

    const shown = rows.slice(0, MAX_ROWS_RENDERED);
    shown.forEach((row) => {
      const tr = document.createElement("tr");
      fields.forEach((field) => {
        const td = document.createElement("td");
        td.textContent = escapeText(row[field]);
        tr.append(td);
      });
      tbody.append(tr);
    });

    $("table-note").textContent =
      rows.length > MAX_ROWS_RENDERED
        ? `Mostrando ${MAX_ROWS_RENDERED} de ${rows.length} chamados — baixe o arquivo para ver todos.`
        : `${rows.length} chamado${rows.length === 1 ? "" : "s"}.`;
  }

  $("btn-download").addEventListener("click", async () => {
    if (!lastAction) return;
    const endpoint = ACTION_ENDPOINTS[lastAction];
    const format = $("download-format").value;

    setBusy(true);
    setBanner("Gerando arquivo...", "info");
    try {
      const resp = await apiCall(endpoint, { format, caixa: lastCaixa, ...lastExtraBody });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setBanner(data.error || "Erro ao gerar arquivo.", "error");
        return;
      }

      const contentType = resp.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        const data = await resp.json();
        setBanner(data.message || "Nenhum resultado encontrado.", "info");
        return;
      }

      const blob = await resp.blob();
      const filename = filenameFromDisposition(resp.headers.get("Content-Disposition"), "chamados_jira.zip");
      triggerDownload(blob, filename);
      setBanner(`Arquivo gerado: ${filename}`, "success");
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // ------------------------------------------------------------ reports
  function showReport(text) {
    reportBox.value = text;
    $("btn-report-copiar").disabled = false;
    $("btn-report-pdf").disabled = false;
    $("btn-report-limpar").disabled = false;
  }


  $("btn-report-consolidado").addEventListener("click", () => {
    closeAllDialogs("consolidado-dialog");
    const hoje = new Date().toISOString().slice(0, 10);
    $("input-inicio").value = hoje;
    $("input-fim").value = hoje;
    consolidadoDialog.classList.add("open");
  });

  $("btn-consolidado-cancelar").addEventListener("click", () => {
    consolidadoDialog.classList.remove("open");
  });

  $("btn-consolidado-gerar").addEventListener("click", async () => {
    const inicio = $("input-inicio").value;
    const fim = $("input-fim").value;
    if (!inicio || !fim) {
      setBanner("Informe as duas datas.", "error");
      return;
    }

    consolidadoDialog.classList.remove("open");
    setBusy(true);
    setBanner("Gerando relatório consolidado...", "info");
    try {
      const resp = await apiCall("/api/relatorio-consolidado", { inicio, fim, caixa: state.caixa });
      const data = await resp.json();
      if (!resp.ok) {
        setBanner(data.error || "Erro ao gerar relatório.", "error");
        return;
      }
      showReport(data.text);
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // -------------------------------------------- categorias de encerramento
  $("btn-categorias-encerramento").addEventListener("click", () => {
    const dialog = $("categorias-dialog");
    const abrindo = !dialog.classList.contains("open");
    closeAllDialogs("categorias-dialog");
    if (abrindo) {
      const hoje = new Date().toISOString().slice(0, 10);
      $("cat-input-inicio").value = hoje;
      $("cat-input-fim").value = hoje;
    }
    dialog.classList.toggle("open", abrindo);
  });

  $("btn-categorias-cancelar").addEventListener("click", () => {
    $("categorias-dialog").classList.remove("open");
  });

  function renderCategoriaTable(prefixo, secao) {
    const bloco = $(`categorias-${prefixo}-block`);
    const tabela = $(`cat-${prefixo}-table`);
    const thead = tabela.querySelector("thead");
    const tbody = tabela.querySelector("tbody");
    thead.innerHTML = "";
    tbody.innerHTML = "";

    if (!secao) {
      bloco.classList.add("hidden");
      return;
    }

    $(`cat-${prefixo}-total`).textContent = secao.total_chamados;
    $(`cat-${prefixo}-categorizados`).textContent = secao.total_categorizados;

    const trHead = document.createElement("tr");
    ["Categoria", "Quantidade", "%"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      trHead.append(th);
    });
    thead.append(trHead);

    if (!secao.categorias.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = "Nenhum chamado categorizado no período.";
      tr.append(td);
      tbody.append(tr);
    } else {
      secao.categorias.forEach(({ categoria, quantidade, percentual }) => {
        const tr = document.createElement("tr");
        const tdCategoria = document.createElement("td");
        tdCategoria.textContent = categoria;
        const tdQuantidade = document.createElement("td");
        tdQuantidade.textContent = quantidade;
        const tdPercentual = document.createElement("td");
        tdPercentual.textContent = `${percentual}%`;
        tr.append(tdCategoria, tdQuantidade, tdPercentual);
        tbody.append(tr);
      });
    }

    bloco.classList.remove("hidden");
  }

  $("btn-categorias-gerar").addEventListener("click", async () => {
    const inicio = $("cat-input-inicio").value;
    const fim = $("cat-input-fim").value;
    if (!inicio || !fim) {
      setBanner("Informe as duas datas.", "error");
      return;
    }

    const encerrados = $("cat-check-encerrados").checked;
    const reabertos = $("cat-check-reabertos").checked;
    if (!encerrados && !reabertos) {
      setBanner('Selecione ao menos "Encerrados" ou "Reabertos".', "error");
      return;
    }

    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    const topN = Number($("cat-top-n").value);

    $("categorias-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Buscando categorias de encerramento...", "info");
    try {
      const resp = await apiCall("/api/categorias-encerramento", {
        inicio,
        fim,
        encerrados,
        reabertos,
        top_n: topN,
        caixa: state.caixa,
        projetos,
      });
      const data = await resp.json();
      if (!resp.ok) {
        setBanner(data.error || "Erro ao buscar categorias de encerramento.", "error");
        return;
      }
      renderCategoriaTable("encerrados", data.encerrados);
      renderCategoriaTable("reabertos", data.reabertos);
      $("categorias-date").textContent = dataVigente();
      $("categorias-results").classList.remove("hidden");
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // -------------------------------------------------- criados x resolvidos
  $("btn-criados-resolvidos").addEventListener("click", () => {
    const dialog = $("criados-resolvidos-dialog");
    const abrindo = !dialog.classList.contains("open");
    closeAllDialogs("criados-resolvidos-dialog");
    if (abrindo) {
      const hoje = new Date().toISOString().slice(0, 10);
      $("cr-input-inicio").value = hoje;
      $("cr-input-fim").value = hoje;
    }
    dialog.classList.toggle("open", abrindo);
  });

  $("btn-criados-resolvidos-cancelar").addEventListener("click", () => {
    $("criados-resolvidos-dialog").classList.remove("open");
  });

  // Seta de tendência do dia: resolvidos > criados (backlog encolhendo) sobe,
  // resolvidos < criados (backlog crescendo) desce. "ascii" usa "^"/"v" em vez
  // dos triângulos Unicode — necessário para o PDF do Relatório Geral, cuja
  // fonte padrão (Helvetica/WinAnsi) não tem esses glifos.
  function setaTendencia(criados, resolvidos, ascii) {
    if (resolvidos > criados) return ascii ? "^" : "▲";
    if (resolvidos < criados) return ascii ? "v" : "▼";
    return ascii ? "-" : "–";
  }

  function setaTendenciaClasse(criados, resolvidos) {
    if (resolvidos > criados) return "cr-seta-up";
    if (resolvidos < criados) return "cr-seta-down";
    return "cr-seta-neutro";
  }

  // Anel "dentro do prazo x fora do prazo": duas cores de status fixas
  // (verde = dentro/bom, vermelho = fora/violado) — a cor segue o
  // significado do estado, nunca qual fatia é maior. Técnica de 2 arcos
  // sobrepostos via stroke-dasharray/dashoffset, com um pequeno gap (3px)
  // entre eles pra separar os segmentos sem precisar de borda.
  function buildPrazoDonutEl(dentro, fora, percentualDentro) {
    const total = dentro + fora;
    const size = 160;
    const strokeWidth = 22;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const gap = 3;
    const svgNS = "http://www.w3.org/2000/svg";

    function arc(len, offset, className) {
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", size / 2);
      circle.setAttribute("cy", size / 2);
      circle.setAttribute("r", radius);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke-width", strokeWidth);
      circle.setAttribute("stroke-linecap", "round");
      circle.setAttribute("stroke-dasharray", `${Math.max(len, 0)} ${circumference}`);
      circle.setAttribute("stroke-dashoffset", -offset);
      circle.classList.add(className);
      return circle;
    }

    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.classList.add("prazo-donut-svg");

    const group = document.createElementNS(svgNS, "g");
    group.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);

    if (total > 0) {
      const dentroFull = (dentro / total) * circumference;
      const foraFull = circumference - dentroFull;
      if (dentro > 0) group.append(arc(Math.max(dentroFull - gap, 0), 0, "prazo-donut-dentro"));
      if (fora > 0) group.append(arc(Math.max(foraFull - gap, 0), dentroFull, "prazo-donut-fora"));
    } else {
      group.append(arc(circumference, 0, "prazo-donut-track"));
    }
    svg.append(group);

    const valor = document.createElement("div");
    valor.className = "prazo-donut-valor";
    valor.textContent = dentro;
    const linha = document.createElement("div");
    linha.className = "prazo-donut-linha";
    const pct = document.createElement("div");
    pct.className = "prazo-donut-pct";
    pct.textContent = `${percentualDentro}%`;

    const centro = document.createElement("div");
    centro.className = "prazo-donut-centro";
    centro.append(valor, linha, pct);

    const holder = document.createElement("div");
    holder.className = "prazo-donut-holder";
    holder.append(svg, centro);

    function legendaItem(dotClass, texto) {
      const item = document.createElement("span");
      item.className = "prazo-donut-legenda-item";
      const dot = document.createElement("span");
      dot.className = `prazo-donut-dot ${dotClass}`;
      item.append(dot, document.createTextNode(texto));
      return item;
    }

    const legenda = document.createElement("div");
    legenda.className = "prazo-donut-legenda";
    legenda.append(
      legendaItem("prazo-donut-dot-dentro", `Dentro do prazo (${dentro})`),
      legendaItem("prazo-donut-dot-fora", `Fora do prazo (${fora})`)
    );

    const wrap = document.createElement("div");
    wrap.className = "prazo-donut";
    wrap.append(holder, legenda);
    return wrap;
  }

  // Card por grupo (N1/N2/PROD) de "Criados x Resolvidos": contador de
  // encerrados no período + média diária (total ÷ dias do período
  // selecionado) + TMA aproximado (16h de expediente ÷ média diária — não é
  // o tempo real em "Em atendimento", é só uma estimativa a partir do volume).
  function criadosResolvidosGrupoCard(grupo, total, mediaDiaria, tmaHoras) {
    const card = document.createElement("div");
    card.className = "summary-card";

    const valueEl = document.createElement("div");
    valueEl.className = "summary-value";
    valueEl.textContent = total;

    const labelEl = document.createElement("div");
    labelEl.className = "summary-label";
    labelEl.textContent = GRUPO_LABEL_CURTO[grupo] || grupo;

    const mediaEl = document.createElement("div");
    mediaEl.className = "summary-label";
    mediaEl.style.marginTop = "2px";
    mediaEl.textContent = `Média: ${mediaDiaria}/dia`;

    card.append(valueEl, labelEl, mediaEl);

    if (typeof tmaHoras === "number") {
      const tmaEl = document.createElement("div");
      tmaEl.className = "summary-label";
      tmaEl.style.marginTop = "2px";
      tmaEl.textContent = `TMA: ${tmaHoras}h`;
      card.append(tmaEl);
    }

    return card;
  }

  function renderCriadosResolvidos(data, inicio, fim) {
    const saldo = data.total_criados - data.total_resolvidos;

    const cardsEl = $("cr-summary-cards");
    cardsEl.innerHTML = "";
    cardsEl.append(summaryCard(data.total_criados, "Criados no período", "tone-accent"));
    cardsEl.append(summaryCard(data.total_resolvidos, "Resolvidos (Encerrado/Resolvido)", "tone-warning"));
    cardsEl.append(summaryCard(saldo, "Saldo (criados − resolvidos)", saldo > 0 ? "tone-danger" : ""));

    const donutEl = $("cr-prazo-donut");
    donutEl.innerHTML = "";
    if (typeof data.percentual_dentro_prazo === "number") {
      donutEl.append(
        buildPrazoDonutEl(data.resolvidos_dentro_prazo, data.resolvidos_fora_prazo, data.percentual_dentro_prazo)
      );
      donutEl.classList.remove("hidden");
    } else {
      donutEl.classList.add("hidden");
    }

    const porGrupoBlock = $("cr-por-grupo-block");
    const porGrupoCardsEl = $("cr-por-grupo-cards");
    porGrupoCardsEl.innerHTML = "";
    if (data.por_grupo && data.por_grupo.length) {
      data.por_grupo.forEach(({ grupo, total, media_diaria, tma_horas }) => {
        porGrupoCardsEl.append(criadosResolvidosGrupoCard(grupo, total, media_diaria, tma_horas));
      });
      porGrupoBlock.classList.remove("hidden");
    } else {
      porGrupoBlock.classList.add("hidden");
    }

    const thead = document.querySelector("#cr-table thead");
    const tbody = document.querySelector("#cr-table tbody");
    thead.innerHTML = "";
    tbody.innerHTML = "";

    const trHead = document.createElement("tr");
    ["Data", "Criados", "Resolvidos", "Seta"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      trHead.append(th);
    });
    thead.append(trHead);

    (data.dias || []).forEach((dia) => {
      const tr = document.createElement("tr");
      const tdData = document.createElement("td");
      tdData.textContent = formatarDataBR(dia.data);
      const tdCriados = document.createElement("td");
      tdCriados.textContent = dia.criados;
      const tdResolvidos = document.createElement("td");
      tdResolvidos.textContent = dia.resolvidos;
      const tdSeta = document.createElement("td");
      tdSeta.textContent = setaTendencia(dia.criados, dia.resolvidos);
      tdSeta.className = setaTendenciaClasse(dia.criados, dia.resolvidos);
      tr.append(tdData, tdCriados, tdResolvidos, tdSeta);
      tbody.append(tr);
    });

    $("cr-date").textContent = `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;
    $("criados-resolvidos-results").classList.remove("hidden");
  }

  $("btn-criados-resolvidos-gerar").addEventListener("click", async () => {
    const inicio = $("cr-input-inicio").value;
    const fim = $("cr-input-fim").value;
    if (!inicio || !fim) {
      setBanner("Informe as duas datas.", "error");
      return;
    }

    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    $("criados-resolvidos-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Buscando chamados criados x resolvidos...", "info");
    hideAllResults();
    try {
      const resp = await apiCall("/api/criados-resolvidos", { inicio, fim, caixa: state.caixa, projetos });
      const data = await resp.json();
      if (!resp.ok) {
        setBanner(data.error || "Erro ao buscar criados x resolvidos.", "error");
        return;
      }
      renderCriadosResolvidos(data, inicio, fim);
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // ---------------------------------------------------------------- reabertos
  // Diferente de Criados x Resolvidos: o resultado é uma lista de chamados
  // (fields/rows/summary, igual Violados/Extração completa), então reaproveita
  // a mesma tela de RESULTADOS (renderResults) em vez de uma tabela própria.
  $("btn-reabertos").addEventListener("click", () => {
    const dialog = $("reabertos-dialog");
    const abrindo = !dialog.classList.contains("open");
    closeAllDialogs("reabertos-dialog");
    if (abrindo) {
      const hoje = new Date().toISOString().slice(0, 10);
      $("reabertos-input-inicio").value = hoje;
      $("reabertos-input-fim").value = hoje;
    }
    dialog.classList.toggle("open", abrindo);
  });

  $("btn-reabertos-cancelar").addEventListener("click", () => {
    $("reabertos-dialog").classList.remove("open");
  });

  $("btn-reabertos-gerar").addEventListener("click", async () => {
    const inicio = $("reabertos-input-inicio").value;
    const fim = $("reabertos-input-fim").value;
    if (!inicio || !fim) {
      setBanner("Informe as duas datas.", "error");
      return;
    }

    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    const extraBody = { inicio, fim, projetos };

    $("reabertos-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Buscando chamados no Jira...", "info");
    hideAllResults();
    try {
      const resp = await apiCall("/api/reabertos", { caixa: state.caixa, ...extraBody });
      const data = await resp.json();

      if (!resp.ok) {
        setBanner(data.error || "Erro ao executar a ação.", "error");
        return;
      }

      lastAction = "reabertos";
      lastCaixa = state.caixa;
      lastExtraBody = extraBody;
      renderResults("reabertos", data);
      $("results-date").textContent = `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;
      if (typeof data.percentual_reabertura === "number") {
        $("summary-cards").append(
          summaryCard(
            `${data.percentual_reabertura}%`,
            `dos ${data.total_criados_periodo} criados no período`,
            "tone-warning"
          )
        );
      }
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // ---------------------------------------------------------------- críticos
  $("btn-criticos").addEventListener("click", () => {
    const dialog = $("criticos-dialog");
    const abrindo = !dialog.classList.contains("open");
    closeAllDialogs("criticos-dialog");
    if (abrindo) {
      const hoje = new Date().toISOString().slice(0, 10);
      if (!$("criticos-input-inicio").value) $("criticos-input-inicio").value = hoje;
      if (!$("criticos-input-fim").value) $("criticos-input-fim").value = hoje;
    }
    dialog.classList.toggle("open", abrindo);
  });

  $("btn-criticos-cancelar").addEventListener("click", () => {
    $("criticos-dialog").classList.remove("open");
  });

  // Grupo 1 de 3 (COTI): mesmos dados de sempre, agora num único bloco
  // inline — sem a separação em "ANALÍTICO"/"NEGÓCIO". Grupos 2 e 3 entram
  // depois, como blocos próprios dentro de #criticos-results.
  function renderChamadosCriticos(data, inicio, fim) {
    const cotiEl = $("criticos-coti-cards");
    cotiEl.innerHTML = "";
    cotiEl.append(
      summaryCard(data.total_criticos_abertos, "Total de COTI Abertos (WAS P0/P1/P2)", "tone-accent")
    );
    cotiEl.append(
      summaryCard(data.total_criticos_atual, "Total real de COTI (IN P0/P1/P2 atualmente)", "tone-danger")
    );
    cotiEl.append(
      summaryCard(
        `${data.total_pontuais} (${data.percentual_pontuais}%)`,
        "Pontuais (abertos − atual)",
        "tone-warning"
      )
    );
    cotiEl.append(
      summaryCard(
        `${data.percentual_criticos}%`,
        `COTI sobre ${data.total_criados} chamados criados no período`,
        "tone-accent"
      )
    );

    // Grupo 2 de 3 (Chamados Clarinha): Frame 1 = contador, Frame 2 = tabela
    // por nível — campo "Nível de Escalonamento".
    const frame1 = $("criticos-clarinha-frame1");
    frame1.innerHTML = "";
    frame1.append(
      summaryCard(data.total_escalonados, "Chamados escalonados (Nível de Escalonamento preenchido)", "tone-warning")
    );
    frame1.append(
      summaryCard(
        data.total_escalonados_abertos,
        "Chamados abertos ainda (fora de Cancelado/Resolvido/Encerrado)",
        "tone-danger"
      )
    );

    const clarinhaThead = document.querySelector("#criticos-clarinha-table thead");
    const clarinhaTbody = document.querySelector("#criticos-clarinha-table tbody");
    clarinhaThead.innerHTML = "";
    clarinhaTbody.innerHTML = "";

    const clarinhaTrHead = document.createElement("tr");
    ["Nível", "Quantidade"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      clarinhaTrHead.append(th);
    });
    clarinhaThead.append(clarinhaTrHead);

    if (!data.por_nivel || !data.por_nivel.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 2;
      td.textContent = "Nenhum chamado escalonado categorizado no período.";
      tr.append(td);
      clarinhaTbody.append(tr);
    } else {
      data.por_nivel.forEach(({ nivel, total }) => {
        const tr = document.createElement("tr");
        const tdNivel = document.createElement("td");
        tdNivel.textContent = nivel;
        const tdTotal = document.createElement("td");
        tdTotal.textContent = total;
        tr.append(tdNivel, tdTotal);
        clarinhaTbody.append(tr);
      });
    }

    // Grupo 3 de 3 (Escalonamento Informal): uma linha por "Responsável pela
    // Solicitação MOPS", com o total de chamados priorizados e quantos já
    // foram resolvidos — mais uma linha de totais somados no fim.
    const informalThead = document.querySelector("#criticos-informal-table thead");
    const informalTbody = document.querySelector("#criticos-informal-table tbody");
    informalThead.innerHTML = "";
    informalTbody.innerHTML = "";

    const informalTrHead = document.createElement("tr");
    ["Responsável pela Solicitação MOPS", "Chamados priorizados", "Chamados resolvidos"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      informalTrHead.append(th);
    });
    informalThead.append(informalTrHead);

    const escalonamentoInformal = data.escalonamento_informal || [];
    if (!escalonamentoInformal.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = "Nenhum chamado com esse campo preenchido no período.";
      tr.append(td);
      informalTbody.append(tr);
    } else {
      let somaPriorizados = 0;
      let somaResolvidos = 0;
      escalonamentoInformal.forEach(({ responsavel, priorizados, resolvidos }) => {
        somaPriorizados += priorizados;
        somaResolvidos += resolvidos;
        const tr = document.createElement("tr");
        const tdNome = document.createElement("td");
        tdNome.textContent = responsavel;
        const tdPriorizados = document.createElement("td");
        tdPriorizados.textContent = priorizados;
        const tdResolvidos = document.createElement("td");
        tdResolvidos.textContent = resolvidos;
        tr.append(tdNome, tdPriorizados, tdResolvidos);
        informalTbody.append(tr);
      });

      const trTotal = document.createElement("tr");
      trTotal.className = "data-table-total-row";
      const tdTotalLabel = document.createElement("td");
      tdTotalLabel.textContent = "Total";
      const tdTotalPriorizados = document.createElement("td");
      tdTotalPriorizados.textContent = somaPriorizados;
      const tdTotalResolvidos = document.createElement("td");
      tdTotalResolvidos.textContent = somaResolvidos;
      trTotal.append(tdTotalLabel, tdTotalPriorizados, tdTotalResolvidos);
      informalTbody.append(trTotal);
    }

    $("criticos-date").textContent = `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;
    $("criticos-results").classList.remove("hidden");
  }

  $("btn-criticos-gerar").addEventListener("click", async () => {
    const inicio = $("criticos-input-inicio").value;
    const fim = $("criticos-input-fim").value;
    if (!inicio || !fim) {
      setBanner("Informe as duas datas.", "error");
      return;
    }

    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    $("criticos-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Buscando chamados críticos...", "info");
    hideAllResults();
    try {
      const resp = await apiCall("/api/chamados-criticos", { inicio, fim, caixa: state.caixa, projetos });
      const data = await resp.json();
      if (!resp.ok) {
        setBanner(data.error || "Erro ao buscar chamados críticos.", "error");
        return;
      }
      renderChamadosCriticos(data, inicio, fim);
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // ---------------------------------------------------- analistas de encerramento
  // Time fixo (roster), não depende de período nem de nova busca no Jira —
  // fica disponível assim que o painel abre. Escolher um nome + o período em
  // Data início/Data fim é que dispara a busca de verdade (buscarDetalheAnalista).
  const ANALISTAS_ENCERRAMENTO_ROSTER = [
    "CRISTIAN SARAIVA BETTUCI",
    "DANIEL DOS SANTOS REIS",
    "DIEGHO MORAES BISTRATINI",
    "DIEGO VERGA TEIXEIRA",
    "EDUARDO MARTINS DOS SANTOS",
    "EURICO ALEXANDRE RAMOS DA SILVA",
    "FILIPI DA SILVA SOUZA",
    "GUILHERME BONDEZAN YONAMINE",
    "HUMBERTO SANTOS DIAS",
    "JOAO PEDRO VILLAS BOAS DE CARVALHO",
    "JOAO VITOR FALBI",
    "JONATAS DA SILVA PEREIRA",
    "JULIA OLIVEIRA LONGHI",
    "LEONARDO CHIMINELLI",
    "LETICIA NOVARINO BRITTO",
    "MAURICIO JOSE PRADO CHINI",
    "MICHELLE CRISTINA DA SILVA RICARDO",
    "PAULO MARCELO MELO GOMES",
    "TAMIRES COSTA SANTOS",
    "THIAGO BORGHI LOPES GALVAO",
    "VINICIUS SOARES PEREIRA MARTINS DE MOURA",
  ];
  let analistasAtuais = ANALISTAS_ENCERRAMENTO_ROSTER;
  let analistasIndiceAtivo = -1;

  // Remove acentos pra busca tolerante ("jose" encontra "JOSE"/"José").
  function normalizarBusca(texto) {
    return texto
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  }

  function analistasFiltrados(busca) {
    const termo = normalizarBusca(busca.trim());
    if (!termo) return analistasAtuais;
    return analistasAtuais.filter((nome) => normalizarBusca(nome).includes(termo));
  }

  // Destaca o trecho batido (só quando o match é direto, sem acento
  // envolvido — mais simples que mapear posições através da normalização).
  function destacarTrecho(nome, termo) {
    if (!termo) return document.createTextNode(nome);
    const idx = nome.toLowerCase().indexOf(termo.toLowerCase());
    if (idx === -1) return document.createTextNode(nome);
    const frag = document.createDocumentFragment();
    frag.append(document.createTextNode(nome.slice(0, idx)));
    const mark = document.createElement("mark");
    mark.textContent = nome.slice(idx, idx + termo.length);
    frag.append(mark);
    frag.append(document.createTextNode(nome.slice(idx + termo.length)));
    return frag;
  }

  const CALENDARIO_MESES = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  const CALENDARIO_DOW = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  // Um mini-calendário por mês tocado pelo período — dias fora do período
  // (mas dentro do mesmo mês) aparecem esmaecidos; os "buracos" de
  // alinhamento antes do dia 1 ficam totalmente em branco.
  function construirCalendario(dias) {
    const porMes = new Map();
    dias.forEach((dia) => {
      const chaveMes = dia.data.slice(0, 7);
      if (!porMes.has(chaveMes)) porMes.set(chaveMes, []);
      porMes.get(chaveMes).push(dia);
    });

    const container = document.createElement("div");

    Array.from(porMes.keys())
      .sort()
      .forEach((chaveMes) => {
        const porData = new Map(porMes.get(chaveMes).map((d) => [d.data, d]));
        const [ano, mes] = chaveMes.split("-").map(Number);

        const bloco = document.createElement("div");
        bloco.className = "calendario-mes";

        const titulo = document.createElement("div");
        titulo.className = "calendario-mes-titulo";
        titulo.textContent = `${CALENDARIO_MESES[mes - 1]} de ${ano}`;
        bloco.append(titulo);

        const grid = document.createElement("div");
        grid.className = "calendario-grid";

        CALENDARIO_DOW.forEach((label) => {
          const dow = document.createElement("div");
          dow.className = "calendario-dow";
          dow.textContent = label;
          grid.append(dow);
        });

        // getDay(): 0=Dom...6=Sáb — converte pra semana começando na Segunda.
        const primeiroDoMes = new Date(ano, mes - 1, 1);
        const offsetSemana = (primeiroDoMes.getDay() + 6) % 7;
        for (let i = 0; i < offsetSemana; i++) {
          const vazio = document.createElement("div");
          vazio.className = "calendario-dia vazio";
          grid.append(vazio);
        }

        const totalDiasMes = new Date(ano, mes, 0).getDate();
        for (let dia = 1; dia <= totalDiasMes; dia++) {
          const chaveDia = `${chaveMes}-${String(dia).padStart(2, "0")}`;
          const info = porData.get(chaveDia);

          const celula = document.createElement("div");
          celula.className = "calendario-dia" + (info ? "" : " vazio");

          const numero = document.createElement("div");
          numero.className = "calendario-dia-numero";
          numero.textContent = dia;
          celula.append(numero);

          if (info && (info.encerrados_resolvidos || info.reabertos)) {
            const infoEl = document.createElement("div");
            infoEl.className = "calendario-dia-info";
            if (info.encerrados_resolvidos) {
              const linha = document.createElement("span");
              linha.className = "calendario-dia-encerrados";
              linha.textContent = `E ${info.encerrados_resolvidos}`;
              infoEl.append(linha);
            }
            if (info.reabertos) {
              const linha = document.createElement("span");
              linha.className = "calendario-dia-reabertos";
              linha.textContent = `R ${info.reabertos}`;
              infoEl.append(linha);
            }
            celula.append(infoEl);
          }

          grid.append(celula);
        }

        bloco.append(grid);
        container.append(bloco);
      });

    return container;
  }

  function renderAnalistaDetalhe(data, analista, inicio, fim) {
    // O título usa .section-label (text-transform: uppercase) — sem o
    // .date-badge aqui, o "a" do intervalo de datas vira "A" maiúsculo.
    const tituloEl = $("analista-detalhe-titulo");
    tituloEl.textContent = "";
    tituloEl.append(`${analista} — `);
    const dataBadge = document.createElement("span");
    dataBadge.className = "date-badge";
    dataBadge.textContent = `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;
    tituloEl.append(dataBadge);

    const cardsEl = $("analista-detalhe-cards");
    cardsEl.innerHTML = "";
    cardsEl.append(
      summaryCard(data.total_encerrados_resolvidos, "Chamados Encerrados/Resolvidos", "tone-accent")
    );
    cardsEl.append(
      summaryCard(
        `${data.total_reabertos} (${data.percentual_reabertos}%)`,
        `Reabertos no período — % sobre ${data.total_resolvidos_gerais} resolvidos gerais`,
        "tone-warning"
      )
    );

    const fThead = document.querySelector("#analista-fornecedor-table thead");
    const fTbody = document.querySelector("#analista-fornecedor-table tbody");
    fThead.innerHTML = "";
    fTbody.innerHTML = "";
    const fTrHead = document.createElement("tr");
    ["Fornecedor Responsável", "Quantidade"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      fTrHead.append(th);
    });
    fThead.append(fTrHead);

    const porFornecedor = data.por_fornecedor || [];
    if (!porFornecedor.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 2;
      td.textContent = "Nenhum chamado aguardando fornecedor no período.";
      tr.append(td);
      fTbody.append(tr);
    } else {
      let somaFornecedor = 0;
      porFornecedor.forEach(({ fornecedor, total }) => {
        somaFornecedor += total;
        const tr = document.createElement("tr");
        const tdNome = document.createElement("td");
        tdNome.textContent = fornecedor;
        const tdTotal = document.createElement("td");
        tdTotal.textContent = total;
        tr.append(tdNome, tdTotal);
        fTbody.append(tr);
      });
      const trTotal = document.createElement("tr");
      trTotal.className = "data-table-total-row";
      const tdLabel = document.createElement("td");
      tdLabel.textContent = "Total";
      const tdSoma = document.createElement("td");
      tdSoma.textContent = somaFornecedor;
      trTotal.append(tdLabel, tdSoma);
      fTbody.append(trTotal);
    }

    const cThead = document.querySelector("#analista-categorias-table thead");
    const cTbody = document.querySelector("#analista-categorias-table tbody");
    cThead.innerHTML = "";
    cTbody.innerHTML = "";
    const cTrHead = document.createElement("tr");
    ["Categoria de Encerramento", "Quantidade"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      cTrHead.append(th);
    });
    cThead.append(cTrHead);

    const topCategorias = data.top_categorias || [];
    if (!topCategorias.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 2;
      td.textContent = "Nenhum chamado categorizado no período.";
      tr.append(td);
      cTbody.append(tr);
    } else {
      topCategorias.forEach(({ categoria, total }) => {
        const tr = document.createElement("tr");
        const tdNome = document.createElement("td");
        tdNome.textContent = categoria;
        const tdTotal = document.createElement("td");
        tdTotal.textContent = total;
        tr.append(tdNome, tdTotal);
        cTbody.append(tr);
      });
    }

    const calEl = $("analista-calendario");
    calEl.innerHTML = "";
    calEl.append(construirCalendario(data.calendario || []));

    $("analista-detalhe").classList.remove("hidden");
  }

  async function buscarDetalheAnalista(analista) {
    const inicio = $("analistas-input-inicio").value;
    const fim = $("analistas-input-fim").value;
    if (!inicio || !fim) return;

    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    $("analista-detalhe").classList.add("hidden");
    setBusy(true);
    setBanner(`Buscando dados de ${analista}...`, "info");
    try {
      const resp = await apiCall("/api/analista-detalhe", {
        analista,
        inicio,
        fim,
        caixa: state.caixa,
        projetos,
      });
      const data = await resp.json();
      if (!resp.ok) {
        setBanner(data.error || "Erro ao buscar dados do analista.", "error");
        return;
      }
      // A busca é lenta (pode passar de 1 minuto) e "Fechar"/trocar de caixa
      // continuam clicáveis nesse meio tempo — se o painel foi fechado
      // enquanto isso, reabre aqui, senão o resultado chega mas fica
      // escondido atrás do "collapse" do painel.
      $("analistas-dialog").classList.add("open");
      renderAnalistaDetalhe(data, analista, inicio, fim);
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  }

  function selecionarAnalista(nome) {
    $("analistas-busca").value = nome;
    fecharAnalistasDropdown();
    buscarDetalheAnalista(nome);
  }

  function fecharAnalistasDropdown() {
    $("analistas-dropdown").classList.add("hidden");
    $("analistas-busca").setAttribute("aria-expanded", "false");
    analistasIndiceAtivo = -1;
  }

  function marcarIndiceAtivo(dropdown, indice) {
    dropdown.querySelectorAll(".combobox-option").forEach((el, i) => {
      const ativo = i === indice;
      el.classList.toggle("active", ativo);
      if (ativo) el.scrollIntoView({ block: "nearest" });
    });
  }

  function abrirAnalistasDropdown() {
    const dropdown = $("analistas-dropdown");
    const termo = $("analistas-busca").value.trim();
    const filtrados = analistasFiltrados(termo);
    dropdown.innerHTML = "";
    analistasIndiceAtivo = -1;

    if (!filtrados.length) {
      const vazio = document.createElement("div");
      vazio.className = "combobox-empty";
      vazio.textContent = "Nenhum analista encontrado.";
      dropdown.append(vazio);
    } else {
      filtrados.forEach((nome) => {
        const opt = document.createElement("div");
        opt.className = "combobox-option";
        opt.setAttribute("role", "option");
        opt.append(destacarTrecho(nome, termo));
        // mousedown (não click) dispara antes do blur do input, senão o
        // dropdown já teria fechado quando o clique "chegasse".
        opt.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selecionarAnalista(nome);
        });
        dropdown.append(opt);
      });
    }

    dropdown.classList.remove("hidden");
    $("analistas-busca").setAttribute("aria-expanded", "true");
  }

  $("analistas-busca").addEventListener("input", abrirAnalistasDropdown);
  $("analistas-busca").addEventListener("focus", abrirAnalistasDropdown);
  $("analistas-busca").addEventListener("blur", () => {
    setTimeout(fecharAnalistasDropdown, 120);
  });

  $("analistas-busca").addEventListener("keydown", (e) => {
    const dropdown = $("analistas-dropdown");
    if (dropdown.classList.contains("hidden")) return;
    const opcoesEls = dropdown.querySelectorAll(".combobox-option");
    if (!opcoesEls.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      analistasIndiceAtivo = Math.min(analistasIndiceAtivo + 1, opcoesEls.length - 1);
      marcarIndiceAtivo(dropdown, analistasIndiceAtivo);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      analistasIndiceAtivo = Math.max(analistasIndiceAtivo - 1, 0);
      marcarIndiceAtivo(dropdown, analistasIndiceAtivo);
    } else if (e.key === "Enter") {
      if (analistasIndiceAtivo >= 0) {
        e.preventDefault();
        const filtrados = analistasFiltrados($("analistas-busca").value.trim());
        if (filtrados[analistasIndiceAtivo]) selecionarAnalista(filtrados[analistasIndiceAtivo]);
      }
    } else if (e.key === "Escape") {
      fecharAnalistasDropdown();
    }
  });

  // Data início, Data fim e Analista ficam numa linha só, sempre visíveis. O
  // dropdown mostra o roster fixo assim que o painel abre (sem chamada ao
  // Jira pra montar a lista); escolher um nome com o período preenchido é
  // que dispara a busca de verdade (buscarDetalheAnalista).
  function prepararAnalistasDropdown() {
    analistasAtuais = ANALISTAS_ENCERRAMENTO_ROSTER;
    $("analistas-busca").value = "";
    $("analistas-busca").disabled = false;
    fecharAnalistasDropdown();
    $("analista-detalhe").classList.add("hidden");
    $("analistas-status").textContent =
      `${ANALISTAS_ENCERRAMENTO_ROSTER.length} analistas disponíveis — selecione um nome com o período preenchido.`;
  }

  $("btn-analistas-encerramento").addEventListener("click", () => {
    const dialog = $("analistas-dialog");
    const abrindo = !dialog.classList.contains("open");
    closeAllDialogs("analistas-dialog");
    dialog.classList.toggle("open", abrindo);
    if (abrindo) {
      const hoje = new Date().toISOString().slice(0, 10);
      if (!$("analistas-input-inicio").value) $("analistas-input-inicio").value = hoje;
      if (!$("analistas-input-fim").value) $("analistas-input-fim").value = hoje;
      hideAllResults();
      prepararAnalistasDropdown();
    }
  });

  $("btn-analistas-cancelar").addEventListener("click", () => {
    $("analistas-dialog").classList.remove("open");
  });

  // Trocar de data não mexe no roster (é fixo) — só limpa o detalhe já
  // mostrado, já que os números eram do período anterior.
  $("analistas-input-inicio").addEventListener("change", () => $("analista-detalhe").classList.add("hidden"));
  $("analistas-input-fim").addEventListener("change", () => $("analista-detalhe").classList.add("hidden"));

  // --------------------------------------------------------- relatório geral
  // Não é uma busca própria: reexecuta as ações já existentes (mesmos
  // endpoints acima) com os filtros padrão (tudo marcado) e um período
  // compartilhado, e empilha o resultado de cada uma num bloco só. O PDF
  // combinado é montado no servidor a partir das seções acumuladas aqui.
  const GERAL_ACOES = [
    { id: "extracao-completa", label: "📋 Extração completa", endpoint: "/api/extracao-completa", kind: "tabela" },
    { id: "violar-hoje", label: "⏰ A violar hoje", endpoint: "/api/violar-hoje", kind: "tabela" },
    { id: "violar-amanha", label: "📅 A violar amanhã", endpoint: "/api/violar-amanha", kind: "tabela" },
    { id: "violar-semanal", label: "📆 Plano semanal (7 dias)", endpoint: "/api/violar-semanal", kind: "semanal" },
    { id: "violados", label: "🔴 Violados", endpoint: "/api/violados", kind: "tabela" },
    {
      id: "categorias-encerramento",
      label: "🏷️ Categorias de Encerramento",
      endpoint: "/api/categorias-encerramento",
      kind: "categorias",
    },
    {
      id: "criados-resolvidos",
      label: "📈 Criados x Resolvidos",
      endpoint: "/api/criados-resolvidos",
      kind: "criados-resolvidos",
    },
    { id: "reabertos", label: "🔄 Reabertos", endpoint: "/api/reabertos", kind: "tabela" },
    {
      id: "chamados-criticos",
      label: "🚨 Chamados Críticos",
      endpoint: "/api/chamados-criticos",
      kind: "criticos",
      soloSolar: true,
    },
  ];

  const ACOES_QUE_USAM_PROJETO = [
    "extracao-completa",
    "violar-hoje",
    "violar-amanha",
    "violar-semanal",
    "violados",
    "categorias-encerramento",
    "criados-resolvidos",
    "reabertos",
    "chamados-criticos",
  ];
  const ACOES_QUE_EXIGEM_PERIODO = [
    "categorias-encerramento",
    "criados-resolvidos",
    "reabertos",
    "chamados-criticos",
  ];

  function buildGeralCheckboxes() {
    const container = $("geral-acoes-checkboxes");
    container.innerHTML = "";
    GERAL_ACOES.filter((acao) => !acao.soloSolar || state.caixa === "solar").forEach((acao) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = true;
      input.id = `geral-acao-${acao.id}`;
      input.dataset.value = acao.id;
      label.append(input, document.createTextNode(` ${acao.label}`));
      container.append(label);
    });
  }
  buildGeralCheckboxes();

  function geralBlockWrapper(titulo) {
    const wrapper = document.createElement("div");
    wrapper.className = "geral-block";
    const h = document.createElement("div");
    h.className = "geral-block-title";
    h.textContent = titulo;
    wrapper.append(h);
    $("geral-blocks").append(wrapper);
    return wrapper;
  }

  // Mesma lógica de renderTable(), mas devolve um elemento novo em vez de
  // escrever em #results-table — os blocos do Relatório Geral ficam
  // empilhados, não podem competir pelo mesmo <table> fixo.
  function buildDataTableEl(fields, rows) {
    const holder = document.createElement("div");

    if (!rows || !rows.length) {
      const note = document.createElement("div");
      note.className = "hint";
      note.style.margin = "0";
      note.textContent = "Nenhum chamado encontrado para os critérios atuais.";
      holder.append(note);
      return holder;
    }

    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");

    const trHead = document.createElement("tr");
    fields.forEach((field) => {
      const th = document.createElement("th");
      th.textContent = field;
      trHead.append(th);
    });
    thead.append(trHead);

    rows.slice(0, MAX_ROWS_RENDERED).forEach((row) => {
      const tr = document.createElement("tr");
      fields.forEach((field) => {
        const td = document.createElement("td");
        td.textContent = escapeText(row[field]);
        tr.append(td);
      });
      tbody.append(tr);
    });

    table.append(thead, tbody);
    wrap.append(table);
    holder.append(wrap);

    if (rows.length > MAX_ROWS_RENDERED) {
      const note = document.createElement("div");
      note.className = "hint";
      note.style.margin = "8px 0 0";
      note.textContent = `Mostrando ${MAX_ROWS_RENDERED} de ${rows.length} chamados — baixe o arquivo pela ação individual para ver todos.`;
      holder.append(note);
    }

    return holder;
  }

  function buildCategoriaTableEl(titulo, secao) {
    const holder = document.createElement("div");
    const h = document.createElement("div");
    h.className = "top-assignees-title";
    h.textContent = `${titulo} — ${secao.total_chamados} chamados (${secao.total_categorizados} categorizados)`;
    holder.append(h);

    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");

    const trHead = document.createElement("tr");
    ["Categoria", "Quantidade", "%"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      trHead.append(th);
    });
    thead.append(trHead);

    if (!secao.categorias.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = "Nenhum chamado categorizado no período.";
      tr.append(td);
      tbody.append(tr);
    } else {
      secao.categorias.forEach(({ categoria, quantidade, percentual }) => {
        const tr = document.createElement("tr");
        const tdCategoria = document.createElement("td");
        tdCategoria.textContent = categoria;
        const tdQuantidade = document.createElement("td");
        tdQuantidade.textContent = quantidade;
        const tdPercentual = document.createElement("td");
        tdPercentual.textContent = `${percentual}%`;
        tr.append(tdCategoria, tdQuantidade, tdPercentual);
        tbody.append(tr);
      });
    }

    table.append(thead, tbody);
    wrap.append(table);
    holder.append(wrap);
    return holder;
  }

  function renderGeralTabela(acao, data) {
    const total = data.summary.total;
    const wrapper = geralBlockWrapper(`${acao.label} — ${total} chamado${total === 1 ? "" : "s"}`);

    const resumoLinhas = [`Total: ${total} chamado${total === 1 ? "" : "s"}`];
    (data.por_grupo || []).forEach(({ grupo, total: t }) => resumoLinhas.push(`${grupo}: ${t}`));
    (data.por_turno || []).forEach(({ turno, total: t }) => resumoLinhas.push(`${turno}: ${t}`));
    if (data.summary.top_assignees && data.summary.top_assignees.length) {
      const top = data.summary.top_assignees.map(([nome, c]) => `${nome} (${c})`).join(", ");
      resumoLinhas.push(`Top responsáveis: ${top}`);
    }
    if (typeof data.percentual_reabertura === "number") {
      resumoLinhas.push(
        `Percentual de reabertura: ${data.percentual_reabertura}% (${total} de ${data.total_criados_periodo} criados no período)`
      );
    }

    const resumoEl = document.createElement("div");
    resumoEl.className = "geral-block-resumo";
    resumoLinhas.forEach((linha) => {
      const p = document.createElement("div");
      p.textContent = linha;
      resumoEl.append(p);
    });
    wrapper.append(resumoEl);
    wrapper.append(buildDataTableEl(data.fields, data.rows));

    lastGeralSecoes.push({
      titulo: acao.label,
      resumo: resumoLinhas,
      tabela: data.rows && data.rows.length ? { fields: data.fields, rows: data.rows } : null,
    });
  }

  function renderGeralSemanal(acao, data) {
    const total = (data.rows || []).length;
    const wrapper = geralBlockWrapper(`${acao.label} — ${total} chamado${total === 1 ? "" : "s"}`);

    const dias = data.dias || [];
    const max = dias.reduce((m, d) => Math.max(m, d.total), 0);
    const heatWrap = document.createElement("div");
    heatWrap.className = "heatmap-grid";
    heatWrap.style.marginBottom = "10px";
    dias.forEach((dia) => {
      const tile = document.createElement("div");
      const tom = heatTone(dia.total, max);
      tile.className = "heat-tile" + (tom ? ` ${tom}` : "");
      const label = document.createElement("span");
      label.className = "heat-tile-label";
      label.textContent = dia.dia_semana;
      const value = document.createElement("span");
      value.className = "heat-tile-value";
      value.textContent = dia.total;
      tile.append(label, value);
      heatWrap.append(tile);
    });
    wrapper.append(heatWrap);
    wrapper.append(buildDataTableEl(data.fields, data.rows));

    const resumoLinhas = [`Total (7 dias): ${total}`, ...dias.map((d) => `${d.dia_semana}: ${d.total}`)];

    lastGeralSecoes.push({
      titulo: acao.label,
      resumo: resumoLinhas,
      tabela: data.rows && data.rows.length ? { fields: data.fields, rows: data.rows } : null,
    });
  }

  function renderGeralCategorias(acao, data) {
    const wrapper = geralBlockWrapper(acao.label);
    const secoesPdf = [];

    if (data.encerrados) {
      wrapper.append(buildCategoriaTableEl("Encerrados", data.encerrados));
      secoesPdf.push({
        titulo: `${acao.label} — Encerrados`,
        tabela: {
          fields: ["Categoria", "Quantidade", "%"],
          rows: data.encerrados.categorias.map((c) => ({
            Categoria: c.categoria,
            Quantidade: c.quantidade,
            "%": c.percentual,
          })),
        },
      });
    }
    if (data.reabertos) {
      const div = document.createElement("div");
      div.style.marginTop = "14px";
      div.append(buildCategoriaTableEl("Reabertos", data.reabertos));
      wrapper.append(div);
      secoesPdf.push({
        titulo: `${acao.label} — Reabertos`,
        tabela: {
          fields: ["Categoria", "Quantidade", "%"],
          rows: data.reabertos.categorias.map((c) => ({
            Categoria: c.categoria,
            Quantidade: c.quantidade,
            "%": c.percentual,
          })),
        },
      });
    }

    lastGeralSecoes.push(...secoesPdf);
  }

  function renderGeralCriadosResolvidos(acao, data) {
    const saldo = data.total_criados - data.total_resolvidos;
    const wrapper = geralBlockWrapper(`${acao.label} — ${data.total_criados} criados / ${data.total_resolvidos} resolvidos`);

    const resumoLinhas = [
      `Criados no período: ${data.total_criados}`,
      `Resolvidos no período (Encerrado/Resolvido): ${data.total_resolvidos}`,
      `Saldo (criados − resolvidos): ${saldo}`,
    ];
    if (typeof data.percentual_dentro_prazo === "number") {
      resumoLinhas.push(
        `Dentro do prazo: ${data.resolvidos_dentro_prazo} (${data.percentual_dentro_prazo}%)`,
        `Fora do prazo: ${data.resolvidos_fora_prazo} (${data.percentual_fora_prazo}%)`
      );
    }
    const resumoEl = document.createElement("div");
    resumoEl.className = "geral-block-resumo";
    resumoLinhas.forEach((linha) => {
      const p = document.createElement("div");
      p.textContent = linha;
      resumoEl.append(p);
    });
    wrapper.append(resumoEl);

    const fields = ["Data", "Criados", "Resolvidos", "Seta"];
    const dias = data.dias || [];
    const rows = dias.map((d) => ({
      Data: formatarDataBR(d.data),
      Criados: d.criados,
      Resolvidos: d.resolvidos,
      Seta: setaTendencia(d.criados, d.resolvidos),
    }));
    wrapper.append(buildDataTableEl(fields, rows));

    // O PDF (fonte Helvetica/WinAnsi) não tem os triângulos Unicode usados na
    // tela — a seção enviada para /api/relatorio-geral-pdf usa a versão ASCII.
    const rowsPdf = dias.map((d) => ({
      Data: formatarDataBR(d.data),
      Criados: d.criados,
      Resolvidos: d.resolvidos,
      Seta: setaTendencia(d.criados, d.resolvidos, true),
    }));

    lastGeralSecoes.push({
      titulo: acao.label,
      resumo: resumoLinhas,
      tabela: rowsPdf.length ? { fields, rows: rowsPdf } : null,
    });
  }

  function renderGeralCriticos(acao, data) {
    const wrapper = geralBlockWrapper(`${acao.label} — ${data.percentual_criticos}% COTI`);

    const resumoLinhas = [
      `Total de chamados criados no período: ${data.total_criados}`,
      `Total de COTI Abertos (WAS P0/P1/P2): ${data.total_criticos_abertos}`,
      `Total real de COTI (IN P0/P1/P2 atualmente): ${data.total_criticos_atual}`,
      `Pontuais (abertos − atual): ${data.total_pontuais} (${data.percentual_pontuais}%)`,
      `Percentual de COTI sobre criados no período: ${data.percentual_criticos}%`,
      `Chamados escalonados (Nível de Escalonamento): ${data.total_escalonados}`,
      `Chamados abertos ainda (fora de Cancelado/Resolvido/Encerrado): ${data.total_escalonados_abertos}`,
    ];
    (data.por_nivel || []).forEach(({ nivel, total }) => resumoLinhas.push(`  ${nivel}: ${total}`));

    const escalonamentoInformal = data.escalonamento_informal || [];
    const somaPriorizados = escalonamentoInformal.reduce((s, r) => s + r.priorizados, 0);
    const somaResolvidos = escalonamentoInformal.reduce((s, r) => s + r.resolvidos, 0);
    resumoLinhas.push(
      `Escalonamento informal — total priorizados: ${somaPriorizados}, total resolvidos: ${somaResolvidos}`
    );

    const resumoEl = document.createElement("div");
    resumoEl.className = "geral-block-resumo";
    resumoLinhas.forEach((linha) => {
      const p = document.createElement("div");
      p.textContent = linha;
      resumoEl.append(p);
    });
    wrapper.append(resumoEl);

    const informalFields = ["Responsável", "Priorizados", "Resolvidos"];
    const informalRows = escalonamentoInformal.map((r) => ({
      Responsável: r.responsavel,
      Priorizados: r.priorizados,
      Resolvidos: r.resolvidos,
    }));
    if (informalRows.length) {
      informalRows.push({ Responsável: "Total", Priorizados: somaPriorizados, Resolvidos: somaResolvidos });
      wrapper.append(buildDataTableEl(informalFields, informalRows));
    }

    lastGeralSecoes.push({
      titulo: acao.label,
      resumo: resumoLinhas,
      tabela: informalRows.length ? { fields: informalFields, rows: informalRows } : null,
    });
  }

  function renderGeralBloco(acao, data) {
    if (acao.kind === "tabela") renderGeralTabela(acao, data);
    else if (acao.kind === "semanal") renderGeralSemanal(acao, data);
    else if (acao.kind === "categorias") renderGeralCategorias(acao, data);
    else if (acao.kind === "criados-resolvidos") renderGeralCriadosResolvidos(acao, data);
    else if (acao.kind === "criticos") renderGeralCriticos(acao, data);
  }

  $("btn-report-geral").addEventListener("click", () => {
    const dialog = $("geral-dialog");
    const abrindo = !dialog.classList.contains("open");
    closeAllDialogs("geral-dialog");
    if (abrindo) {
      const hoje = new Date().toISOString().slice(0, 10);
      if (!$("geral-input-inicio").value) $("geral-input-inicio").value = hoje;
      if (!$("geral-input-fim").value) $("geral-input-fim").value = hoje;
    }
    dialog.classList.toggle("open", abrindo);
  });

  $("btn-geral-cancelar").addEventListener("click", () => {
    $("geral-dialog").classList.remove("open");
  });

  $("btn-geral-gerar").addEventListener("click", async () => {
    const acoesSelecionadas = checkedValues($("geral-acoes-checkboxes"));
    if (!acoesSelecionadas.length) {
      setBanner("Selecione ao menos uma ação para o Relatório Geral.", "error");
      return;
    }

    const projetos = projetosSelecionados();
    if (acoesSelecionadas.some((id) => ACOES_QUE_USAM_PROJETO.includes(id)) && !projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    const inicio = $("geral-input-inicio").value;
    const fim = $("geral-input-fim").value;
    if (acoesSelecionadas.some((id) => ACOES_QUE_EXIGEM_PERIODO.includes(id)) && (!inicio || !fim)) {
      setBanner(
        "Informe o período (obrigatório para Categorias de Encerramento, Criados x Resolvidos, Reabertos e Chamados Críticos).",
        "error"
      );
      return;
    }

    const topN = Number($("geral-top-n").value);

    $("geral-dialog").classList.remove("open");
    hideAllResults();
    $("geral-blocks").innerHTML = "";
    lastGeralSecoes = [];
    $("btn-geral-pdf").disabled = true;

    setBusy(true);
    setBanner("Gerando relatório geral...", "info");

    try {
      for (const acaoId of acoesSelecionadas) {
        const acao = GERAL_ACOES.find((a) => a.id === acaoId);
        setBanner(`Gerando relatório geral... (${acao.label})`, "info");

        const body = { caixa: state.caixa };
        if (ACOES_QUE_USAM_PROJETO.includes(acaoId)) {
          body.projetos = projetos;
        }
        if (acaoId === "extracao-completa") {
          body.inicio = inicio;
          body.fim = fim;
        }
        if (acaoId === "categorias-encerramento") {
          body.inicio = inicio;
          body.fim = fim;
          body.top_n = topN;
          body.encerrados = true;
          body.reabertos = true;
        }
        if (acaoId === "criados-resolvidos") {
          body.inicio = inicio;
          body.fim = fim;
        }
        if (acaoId === "reabertos") {
          body.inicio = inicio;
          body.fim = fim;
        }
        if (acaoId === "chamados-criticos") {
          body.inicio = inicio;
          body.fim = fim;
        }

        const resp = await apiCall(acao.endpoint, body);
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(`${acao.label}: ${data.error || "erro ao gerar."}`);
        }

        renderGeralBloco(acao, data);
      }

      $("geral-date").textContent = dataVigente();
      $("geral-results").classList.remove("hidden");
      $("geral-results").scrollIntoView({ behavior: "smooth", block: "nearest" });
      clearBanner();
    } catch (e) {
      setBanner(e.message || "Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  $("btn-geral-pdf").addEventListener("click", async () => {
    if (!lastGeralSecoes.length) return;

    setBusy(true);
    setBanner("Gerando PDF do relatório geral...", "info");
    try {
      const resp = await fetch("/api/relatorio-geral-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo: "Relatório Geral", secoes: lastGeralSecoes }),
        cache: "no-store",
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setBanner(data.error || "Erro ao exportar PDF.", "error");
        return;
      }

      const blob = await resp.blob();
      const filename = filenameFromDisposition(resp.headers.get("Content-Disposition"), "relatorio_geral.pdf");
      triggerDownload(blob, filename);
      setBanner(`PDF gerado: ${filename}`, "success");
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  $("btn-report-copiar").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(reportBox.value);
      setBanner("Report copiado para a área de transferência.", "success");
    } catch (e) {
      reportBox.select();
      document.execCommand("copy");
    }
  });

  $("btn-report-limpar").addEventListener("click", () => {
    reportBox.value = "";
    $("btn-report-copiar").disabled = true;
    $("btn-report-pdf").disabled = true;
    $("btn-report-limpar").disabled = true;
    clearBanner();
  });

  $("btn-report-pdf").addEventListener("click", async () => {
    const texto = reportBox.value.trim();
    if (!texto) return;

    setBusy(true);
    try {
      const resp = await fetch("/api/exportar-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: texto }),
        cache: "no-store",
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setBanner(data.error || "Erro ao exportar PDF.", "error");
        return;
      }

      const blob = await resp.blob();
      const filename = filenameFromDisposition(resp.headers.get("Content-Disposition"), "relatorio.pdf");
      triggerDownload(blob, filename);
      setBanner(`PDF gerado: ${filename}`, "success");
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // ------------------------------------------------- dicionário de queries
  // Painel de referência, sempre disponível (independe de login) — não
  // entra no grupo dos outros painéis (closeAllDialogs), fica fora da área
  // logada e não compete com eles por espaço na tela.
  $("btn-info-queries").addEventListener("click", () => {
    $("info-queries").classList.toggle("open");
  });

  // ---------------------------------------------------- autologin (dev local)
  // "/api/dev-autologin" só existe quando o servidor roda via
  // "python api/index.py" direto (nunca em produção na Vercel — lá a rota
  // nem é registrada, então isso não faz nada e falha em silêncio). Poupa
  // ter que digitar e-mail/token de novo a cada teste local.
  (async () => {
    try {
      const resp = await fetch("/api/dev-autologin", { cache: "no-store" });
      if (!resp.ok) return;
      const data = await resp.json();
      if (!data.email || !data.token) return;
      $("input-email").value = data.email;
      $("input-token").value = data.token;
      $("btn-connect").click();
    } catch (e) {
      // sem servidor de dev-autologin (produção) — segue pro login normal.
    }
  })();
})();
