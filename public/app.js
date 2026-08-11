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

  const actionButtons = Array.from(document.querySelectorAll("[data-action]"));
  const otherActionButtons = [
    $("btn-extracao-completa"),
    $("btn-a-violar"),
    $("btn-violar-hoje"),
    $("btn-violar-amanha"),
    $("btn-violar-semanal"),
    $("btn-report-diario"),
    $("btn-report-consolidado"),
    $("btn-categorias-encerramento"),
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
  const ALL_DIALOG_IDS = ["extracao-dialog", "violar-dialog", "consolidado-dialog", "categorias-dialog"];

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
    $("heatmap-block").classList.add("hidden");
  }

  // Ação/caixa/filtros da última extração exibida na tela — usado pelo botão
  // "Baixar arquivo" para refazer exatamente a mesma busca, já pedindo o
  // formato de arquivo (mesmo que o usuário troque a caixa depois de ver o
  // resultado). "lastExtraBody" carrega parâmetros específicos da ação
  // (grupos/status/período na Extração completa, por exemplo).
  let lastAction = null;
  let lastCaixa = null;
  let lastExtraBody = {};

  const ACTION_LABELS = {
    "extracao-completa": "Extração completa",
    "violar-hoje": "Chamados a violar hoje",
    "violar-amanha": "Chamados a violar amanhã",
    "violar-semanal": "Plano semanal (próximos 7 dias)",
    violados: "Chamados violados",
  };

  // Tom de cor do card de total, de acordo com o significado da ação
  // (mesma paleta de status usada no resto do app: informativo, alerta, crítico).
  const ACTION_TONE = {
    "extracao-completa": "tone-accent",
    "violar-hoje": "tone-warning",
    "violar-amanha": "tone-warning",
    "violar-semanal": "tone-warning",
    violados: "tone-danger",
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
      ...actionButtons,
      ...otherActionButtons,
      $("btn-download"),
      $("btn-categorias-gerar"),
      $("btn-extracao-gerar"),
    ].forEach((btn) => (btn.disabled = busy));
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

  // A janela de SLA (07:00 às 23:59) só existe de verdade em "A violar
  // hoje/amanhã" — nas outras ações (Extração completa, Violados,
  // Categorias de Encerramento, Plano semanal) mostrar essa janela seria
  // enganoso, então elas ficam só com a data simples.
  function rotuloDataResultado(action) {
    if (action === "violar-hoje") return `Dia de hoje (07:00 às 23:59) — ${dataVigente(0)}`;
    if (action === "violar-amanha") return `Amanhã (07:00 às 23:59) — ${dataVigente(1)}`;
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
    closeAllDialogs();
    clearBanner();
    appView.classList.add("hidden");
    loginCard.classList.remove("hidden");
    carregarJqlAtual();
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

  carregarJqlAtual();

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
      closeAllDialogs();
      clearBanner();
      carregarJqlAtual();
    });
  });

  // ------------------------------------------------------------- ações
  const ACTION_ENDPOINTS = {
    "extracao-completa": "/api/extracao-completa",
    "violar-hoje": "/api/violar-hoje",
    "violar-amanha": "/api/violar-amanha",
    "violar-semanal": "/api/violar-semanal",
    violados: "/api/violados",
  };

  actionButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      const endpoint = ACTION_ENDPOINTS[action];

      const projetos = projetosSelecionados();
      if (!projetos.length) {
        setBanner("Selecione ao menos um projeto.", "error");
        return;
      }

      closeAllDialogs();

      setBusy(true);
      setBanner("Buscando chamados no Jira...", "info");
      hideAllResults();

      try {
        // Sem "format" no corpo: o servidor devolve os dados para exibir na
        // tela (não um arquivo) — o download vira uma ação separada.
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
    });
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

  function renderResults(action, data) {
    $("results-title").textContent = `RESULTADOS — ${ACTION_LABELS[action]}`;
    $("results-date").textContent = rotuloDataResultado(action);
    renderSummary(action, data.summary, data.por_grupo);
    renderTable(data.fields, data.rows);
    resultsCard.classList.remove("hidden");
    resultsCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function summaryCard(value, label, tone) {
    const card = document.createElement("div");
    card.className = "summary-card" + (tone ? ` ${tone}` : "");

    const valueEl = document.createElement("div");
    valueEl.className = "summary-value";
    valueEl.textContent = value;

    const labelEl = document.createElement("div");
    labelEl.className = "summary-label";
    labelEl.textContent = label;

    card.append(valueEl, labelEl);
    return card;
  }

  function renderSummary(action, summary, porGrupo) {
    const totalCardsEl = $("summary-cards");
    const porGrupoBlock = $("por-grupo-block");
    const porGrupoCardsEl = $("por-grupo-cards");
    totalCardsEl.innerHTML = "";
    porGrupoCardsEl.innerHTML = "";

    const totalCard = summaryCard(summary.total, "Total de chamados", ACTION_TONE[action]);

    if (porGrupo && porGrupo.length) {
      // Total desce para a mesma linha dos cards por grupo, como primeiro card.
      porGrupoCardsEl.append(totalCard);
      porGrupo.forEach(({ grupo, total }) => {
        porGrupoCardsEl.append(summaryCard(total, grupo));
      });
      porGrupoBlock.classList.remove("hidden");
      totalCardsEl.classList.add("hidden");
    } else {
      totalCardsEl.append(totalCard);
      totalCardsEl.classList.remove("hidden");
      porGrupoBlock.classList.add("hidden");
    }

    const assigneesEl = $("top-assignees");
    assigneesEl.innerHTML = "";
    if (summary.top_assignees && summary.top_assignees.length) {
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

  $("btn-report-diario").addEventListener("click", async () => {
    closeAllDialogs();
    setBusy(true);
    setBanner("Gerando report diário...", "info");
    try {
      const resp = await apiCall("/api/report-diario", { caixa: state.caixa });
      const data = await resp.json();
      if (!resp.ok) {
        setBanner(data.error || "Erro ao gerar report.", "error");
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
