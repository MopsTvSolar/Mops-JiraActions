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
  const resultsCard = $("results-card");

  const otherActionButtons = [
    $("btn-violados"),
    $("btn-colaboradores"),
    $("btn-report-vini"),
    $("btn-tv-resolvidos-reabertos"),
    $("btn-report-diario"),
    $("btn-cache"),
    $("btn-pareto-solar"),
    $("btn-material-icg"),
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
  // "label" é só o texto mostrado (INC/PDST); "value" continua sendo o
  // nome real do projeto no Jira, que é o que vai pro servidor.
  const PROJETOS_DISPONIVEIS = [
    { value: "Central de Incidentes", label: "INC" },
    { value: "Abertura de Chamados", label: "PDST" },
  ];

  // Seções do Report Vini que podem ser marcadas/desmarcadas na hora de
  // exportar o PDF — a tela sempre mostra as 3 (mesmo padrão de sempre),
  // só o PDF é que pode sair reduzido. "Criados / Encerrados por Grupo
  // Solucionador" viaja junto de "Criados x Resolvidos" (é uma sub-seção
  // dela, só aparece quando o campo Grupo Solucionador foi resolvido).
  const VINI_PDF_SECOES = [
    { value: "criados_resolvidos", label: "Criados x Resolvidos (TMA/SLA)" },
    { value: "reabertos", label: "Reabertos" },
    { value: "categorias", label: "Categorias de Encerramento" },
  ];

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

  // Valor especial do dropdown de Classificação (Análise de Jornada) que
  // significa "todas de uma vez" — espelha JORNADA_GERAL em api/index.py.
  const JORNADA_GERAL = "__geral__";

  // Valores do campo "Classificação" (JQL: "Classificação" = "..."), usados
  // pelo dropdown de Análise de Jornada — a lista muda conforme a caixa
  // solucionadora, mesmo campo/valor nas duas, só o conjunto de opções
  // válidas é diferente (curadoria passada manualmente, não vem do Jira).
  const CLASSIFICACAO_OPCOES = {
    solar: [
      "Ache aqui",
      "Canais críticos",
      "Comercial PF",
      "CTI",
      "Filtro VT",
      "Financeiro",
      "Indisponibilidade",
      "Jornada CAP",
      "Lentidão",
      "LGPD",
      "Mudança de endereço",
      "PME fixa",
      "PME móvel",
      "Proactive monitoring",
      "Rentabilização móvel",
      "Rentabilização Residencial",
      "Residencial/Multi para Móvel",
      "Retenção móvel",
      "Retenção Residencial",
      "Suporte a Vendas - BackOffice Comercial",
      "Técnica",
      "Troca de plano n1",
      "V360",
    ],
    tv: [
      "Cadastro - Mídia social",
      "Cadastro - Móvel",
      "Cadastro - Netsms",
      "Cadastro - Novo BSS",
      "Cancelamento - Novo BSS",
      "Compras - Mídia social",
      "Compras - Móvel",
      "Compras - Netsms",
      "Compras - Novo BSS",
      "Conectividade - Mídia social",
      "Conectividade - Netsms",
      "Conectividade - Novo BSS",
      "Entrada - Mídia social",
      "Entrada - Móvel",
      "Entrada - Netsms",
      "Entrada - Novo BSS",
      "Financeiro - Mídia social",
      "Financeiro - Móvel",
      "Financeiro - Netsms",
      "Financeiro - Novo BSS",
      "Fraude",
      "Informações da conta - Mídia social",
      "Informações da conta - Móvel",
      "Informações da conta - Netsms",
      "Informações da conta - Novo BSS",
      "Legenda - Mídia social",
      "Legenda - Móvel",
      "Legenda - Netsms",
      "Legenda - Novo BSS",
      "Lentidão",
      "Lentidão - Mídia social",
      "Lentidão - Móvel",
      "Lentidão - Netsms",
      "Lentidão - Novo BSS",
      "Play - Mídia social",
      "Play - Móvel",
      "Play - Netsms",
      "Play - Novo BSS",
      "Programas regionais - Mídia social",
      "Programas regionais - Móvel",
      "Programas regionais - Netsms",
      "Programas regionais - Novo BSS",
      "Qualidade da imagem - Mídia social",
      "Qualidade da imagem - Novo BSS",
      "Relatórios e dados - Novo BSS",
      "Segurança - Mídia social",
      "Segurança - Móvel",
      "Segurança - Netsms",
      "Segurança - Novo BSS",
    ],
  };

  // "options" aceita string simples (valor = rótulo, ex.: STATUS_OPTIONS)
  // ou {value, label} quando o texto mostrado precisa ser diferente do
  // valor enviado ao servidor (ex.: PROJETOS_DISPONIVEIS, "INC" na tela
  // mas "Central de Incidentes" na JQL).
  function buildCheckboxes(container, options, namePrefix) {
    container.innerHTML = "";
    options.forEach((opcao, i) => {
      const valor = typeof opcao === "object" ? opcao.value : opcao;
      const rotulo = typeof opcao === "object" ? opcao.label : opcao;
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = true;
      input.id = `${namePrefix}-${i}`;
      input.dataset.value = valor;
      label.append(input, document.createTextNode(` ${rotulo}`));
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
  buildCheckboxes($("vini-pdf-secoes-checkboxes"), VINI_PDF_SECOES, "vini-pdf-secao");

  function projetosSelecionados() {
    return checkedValues($("projetos-checkboxes"));
  }

  // Só um painel de opções fica aberto por vez: ao clicar em qualquer botão
  // (abra ele um painel próprio ou dispare uma ação na hora), os outros que
  // estavam abertos retraem primeiro.
  const ALL_DIALOG_IDS = [
    "colaboradores-dialog",
    "violados-dialog",
    "report-vini-dialog",
    "tv-resolvidos-reabertos-dialog",
  ];

  // Cada ação é uma "página" só: abrir/trocar de painel de opções já limpa o
  // resultado da ação anterior na hora (não espera o "Gerar"), em vez de
  // deixar os dois visíveis ao mesmo tempo e a tela ir se acrescentando.
  function closeAllDialogs(exceptId) {
    ALL_DIALOG_IDS.forEach((id) => {
      if (id !== exceptId) $(id).classList.remove("open");
    });
    hideAllResults();
  }

  // Só um resultado fica visível por vez (tabela padrão — que inclui o
  // heatmap semanal quando é o caso — ou as tabelas de categorias). Evita
  // mostrar dois de uma vez.
  function hideAllResults() {
    resultsCard.classList.add("hidden");
    $("colaboradores-results").classList.add("hidden");
    $("report-vini-results").classList.add("hidden");
    $("report-diario-results").classList.add("hidden");
    $("cache-results").classList.add("hidden");
    $("pareto-solar-results").classList.add("hidden");
    $("extracao-lote-results").classList.add("hidden");
    $("material-icg-results").classList.add("hidden");
    $("pareto-sub-modal").classList.add("hidden");
    hideHoverPopover();
  }

  // Home (#home-view) só aparece quando nada está selecionado: nenhum
  // diálogo de ação aberto e nenhum resultado visível. Em vez de espalhar
  // essa checagem em cada handler, observa as classes dos próprios
  // elementos e recalcula sozinho sempre que algum deles muda.
  const RESULT_BLOCK_IDS = [
    "results-card",
    "colaboradores-results",
    "report-vini-results",
    "report-diario-results",
    "cache-results",
    "pareto-solar-results",
    "extracao-lote-results",
    "material-icg-results",
  ];

  // Qual item do menu lateral corresponde a cada diálogo/resultado — usado só
  // pra destacar visualmente (.active) a ação atualmente aberta na tela,
  // igual um CRM marca a seção corrente no menu. "results-card" é
  // compartilhado por várias ações (Extração completa/por Query, A violar,
  // Violados, Reabertos, Jornada), então esse caso usa "lastAction" (já
  // existe mais abaixo, pro botão "Baixar arquivo") em vez do id do bloco.
  const DIALOG_TO_NAV = {
    "colaboradores-dialog": "btn-colaboradores",
    "violados-dialog": "btn-violados",
    "report-vini-dialog": "btn-report-vini",
    "tv-resolvidos-reabertos-dialog": "btn-tv-resolvidos-reabertos",
  };

  const RESULT_TO_NAV = {
    "colaboradores-results": "btn-colaboradores",
    "report-vini-results": "btn-report-vini",
    "report-diario-results": "btn-report-diario",
    "cache-results": "btn-cache",
    "pareto-solar-results": "btn-pareto-solar",
    "extracao-lote-results": "btn-extracao-lote",
    "material-icg-results": "btn-material-icg",
  };

  const LAST_ACTION_TO_NAV = {
    violados: "btn-violados",
  };

  // "btn-report-diario" não tem diálogo próprio (ação direta, sempre "hoje")
  // — não aparece em DIALOG_TO_NAV, então entra à parte aqui.
  const NAV_ITEM_IDS = [
    ...new Set([
      ...Object.values(DIALOG_TO_NAV),
      "btn-report-diario",
      "btn-cache",
      "btn-pareto-solar",
      "btn-extracao-lote",
      "btn-material-icg",
    ]),
  ];

  function updateNavActiveState() {
    const dialogAberto = ALL_DIALOG_IDS.find((id) => $(id).classList.contains("open"));
    let activeNavId = null;
    if (dialogAberto) {
      activeNavId = DIALOG_TO_NAV[dialogAberto];
    } else {
      const resultVisivel = RESULT_BLOCK_IDS.find(
        (id) => id !== "results-card" && !$(id).classList.contains("hidden")
      );
      if (resultVisivel) {
        activeNavId = RESULT_TO_NAV[resultVisivel] || null;
      } else if (!resultsCard.classList.contains("hidden")) {
        activeNavId = LAST_ACTION_TO_NAV[lastAction] || null;
      }
    }
    NAV_ITEM_IDS.forEach((id) => $(id).classList.toggle("active", id === activeNavId));
  }

  function updateHomeVisibility() {
    const algumDialogoAberto = ALL_DIALOG_IDS.some((id) => $(id).classList.contains("open"));
    const algumResultadoVisivel = RESULT_BLOCK_IDS.some((id) => !$(id).classList.contains("hidden"));
    // Enquanto uma busca está em andamento (loading-overlay visível), o
    // diálogo já fechou e o resultado novo ainda não chegou — sem essa
    // checagem, o dash principal reaparece por trás do overlay de loading.
    const carregando = !$("loading-overlay").classList.contains("hidden");
    $("home-view").classList.toggle("hidden", algumDialogoAberto || algumResultadoVisivel || carregando);
    updateNavActiveState();
  }

  const homeVisibilityObserver = new MutationObserver(updateHomeVisibility);
  [...ALL_DIALOG_IDS, ...RESULT_BLOCK_IDS, "loading-overlay"].forEach((id) => {
    homeVisibilityObserver.observe($(id), { attributes: true, attributeFilter: ["class"] });
  });
  updateHomeVisibility();

  // Ícone de casa no topo do menu: fecha qualquer diálogo/resultado aberto e
  // volta pro dashboard principal (home-view), sem mexer no restante do
  // estado (caixa, credenciais, última busca pro botão "Baixar arquivo").
  $("btn-home").addEventListener("click", () => {
    closeAllDialogs();
    hideAllResults();
    clearBanner();
  });

  // Recolher/expandir o menu lateral — vira uma faixa só de ícones (ver
  // regras "body.sidebar-collapsed" em style.css, restritas a telas largas
  // o bastante pro menu ser fixo). Preferência é só de UI (não é credencial
  // nem dado do Jira), então tudo bem guardar no localStorage pra lembrar
  // entre recarregamentos — ao contrário de email/token, que nunca são
  // persistidos.
  const sidebarToggleBtn = $("btn-sidebar-toggle");

  function aplicarSidebarColapsada(colapsada) {
    document.body.classList.toggle("sidebar-collapsed", colapsada);
    sidebarToggleBtn.setAttribute("aria-expanded", String(!colapsada));
    sidebarToggleBtn.title = colapsada ? "Expandir menu" : "Recolher menu";
    sidebarToggleBtn.setAttribute("aria-label", sidebarToggleBtn.title);
  }

  let sidebarColapsadaSalva = false;
  try {
    sidebarColapsadaSalva = localStorage.getItem("mops-sidebar-collapsed") === "1";
  } catch (e) {
    // localStorage indisponível (aba privada/bloqueado) — segue com o menu expandido.
  }
  aplicarSidebarColapsada(sidebarColapsadaSalva);

  sidebarToggleBtn.addEventListener("click", () => {
    const colapsada = !document.body.classList.contains("sidebar-collapsed");
    aplicarSidebarColapsada(colapsada);
    try {
      localStorage.setItem("mops-sidebar-collapsed", colapsada ? "1" : "0");
    } catch (e) {
      // segue sem lembrar entre recarregamentos.
    }
  });

  // Filtro de caixa (Solar/Claro Tv) do painel inteiro da home — 1
  // seletor só, no topo de "DASHBOARDS", escondendo via CSS (ver
  // "#home-view[data-caixa-filtro]" em style.css) todo bloco marcado com
  // data-caixa que não bate com a escolha. Preferência de UI, mesmo
  // padrão do recolher/expandir menu acima: persiste em localStorage, não
  // é credencial nem dado do Jira.
  const homeCaixaFiltroSelect = $("home-caixa-filtro-select");
  const homeViewEl = $("home-view");

  function aplicarHomeCaixaFiltro(caixa) {
    homeViewEl.dataset.caixaFiltro = caixa;
    homeCaixaFiltroSelect.value = caixa;
  }

  let homeCaixaFiltroSalva = "solar";
  try {
    homeCaixaFiltroSalva = localStorage.getItem("mops-home-caixa-filtro") || "solar";
  } catch (e) {
    // localStorage indisponível — segue com "solar" (padrão).
  }
  aplicarHomeCaixaFiltro(homeCaixaFiltroSalva);

  homeCaixaFiltroSelect.addEventListener("change", () => {
    aplicarHomeCaixaFiltro(homeCaixaFiltroSelect.value);
    try {
      localStorage.setItem("mops-home-caixa-filtro", homeCaixaFiltroSelect.value);
    } catch (e) {
      // segue sem lembrar entre recarregamentos.
    }
  });

  // Botão geral de atualizar da home (recarrega tudo, mesma função do
  // login) — não depende de login, então já liga desde já. O botão
  // individual por widget (aplicarHomeReloadButtons) é ligado mais abaixo,
  // logo depois de HOME_WIDGET_RELOAD_REGISTRO ser declarado (um "const"
  // — chamar a função aqui em cima quebraria com "Cannot access ... before
  // initialization", já que "const" fica em temporal dead zone até a
  // linha da declaração rodar, diferente de function que é hoisted).
  $("btn-home-reload-geral").addEventListener("click", () => {
    carregarHomeDashboardsGradual();
  });

  // Tooltip nativo (title) com o nome da ação em cada item do menu — só é
  // visível de fato com o menu recolhido (ícone sozinho, sem rótulo), mas
  // não atrapalha em nada com o menu expandido.
  document.querySelectorAll(".nav-item").forEach((item) => {
    const label = item.querySelector(".nav-label");
    if (label && !item.title) item.title = label.textContent.trim();
  });

  // Ação/caixa/filtros da última extração exibida na tela — usado pelo botão
  // "Baixar arquivo" para refazer exatamente a mesma busca, já pedindo o
  // formato de arquivo (mesmo que o usuário troque a caixa depois de ver o
  // resultado). "lastExtraBody" carrega parâmetros específicos da ação
  // (grupos/status/período na Extração completa, por exemplo).
  let lastAction = null;
  let lastCaixa = null;
  let lastExtraBody = {};

  const ACTION_LABELS = {
    violados: "Chamados violados",
  };

  // Tom de cor do card de total, de acordo com o significado da ação
  // (mesma paleta de status usada no resto do app: informativo, alerta, crítico).
  const ACTION_TONE = {
    violados: "tone-danger",
  };

  // Usa classList (não "className = ...") de propósito: setBusy() liga/
  // desliga "is-loading" nesse mesmo elemento (o spinner do banner) de forma
  // independente — reatribuir className aqui apagaria essa classe sempre
  // que uma mensagem nova chegasse no meio de uma busca em andamento.
  function setBanner(message, kind) {
    resultBanner.textContent = message;
    // Mesma mensagem no overlay centralizado — só fica visível enquanto
    // setBusy(true) estiver ativo (ver #loading-overlay/setBusy).
    $("loading-overlay-text").textContent = message;
    resultBanner.classList.remove("info", "error", "success");
    if (kind) resultBanner.classList.add(kind);
    resultBanner.classList.toggle("show", Boolean(kind));
  }

  function clearBanner() {
    resultBanner.classList.remove("show", "info", "error", "success");
  }

  // "is-loading" no banner (spinner via CSS, ver .is-loading::before) segue
  // o mesmo início/fim de setBusy — não a mensagem do banner, que às vezes
  // é "info" sem estar mais carregando (ex.: "nenhum resultado encontrado").
  function setBusy(busy) {
    resultBanner.classList.toggle("is-loading", busy);
    $("loading-overlay").classList.toggle("hidden", !busy);
    [
      ...otherActionButtons,
      $("btn-download"),
      $("btn-violados-gerar"),
      $("btn-vini-gerar"),
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

  // Converte "aaaa-mm-dd" (valor de <input type="date"> e do campo "data" dos
  // dias de Criados x Resolvidos) para "dd/mm/aaaa".
  function formatarDataBR(isoDate) {
    const [ano, mes, dia] = isoDate.split("-");
    return `${dia}/${mes}/${ano}`;
  }

  function rotuloDataResultado() {
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

  // Carrega os widgets da home todos de uma vez (em paralelo) — o login em
  // si não espera essa função (chamada sem await), só a home vai
  // preenchendo assim que cada chamada retorna.
  async function carregarHomeDashboardsGradual() {
    const loaders = [
      carregarHomeSlaCache,
      carregarHomeCriadosResolvidosCache,
      carregarHomeReabertosMes,
      carregarHomeGrupoCriacao,
      carregarHomeFornecedorCriacao,
      carregarHomeCriadosMes,
      carregarHomeColaboradoresCache,
      carregarHomeClassificacaoFunil,
      carregarHomeViolarSemanal,
      carregarHomeCotiMes,
    ];
    await Promise.all(loaders.map((loader) => loader()));
  }

  // Botão individual de atualizar, 1 por widget da home — injetado em
  // cada ".home-dashboard-title-row" (em vez de repetir o <button> em
  // cada card no index.html) a partir de um registro {container → loader}.
  // "home-violados-abertos" e "home-violar-semanal" caem no mesmo loader
  // (vêm da mesma chamada /api/home-violar-semanal — ver
  // carregarHomeViolarSemanal), então os 2 cards ganham botão próprio, mas
  // clicar em qualquer um atualiza os dois juntos.
  const HOME_WIDGET_RELOAD_REGISTRO = [
    ["home-sla-mes", carregarHomeSlaCache],
    ["home-criados-resolvidos-mes", carregarHomeCriadosResolvidosCache],
    ["home-grupo-criacao", carregarHomeGrupoCriacao],
    ["home-fornecedor-criacao", carregarHomeFornecedorCriacao],
    ["home-criados-mes", carregarHomeCriadosMes],
    ["home-reabertos-mes", carregarHomeReabertosMes],
    ["home-colaboradores-mes", carregarHomeColaboradoresCache],
    ["home-classificacao-funil", carregarHomeClassificacaoFunil],
    ["home-violados-abertos", carregarHomeViolarSemanal],
    ["home-violar-semanal", carregarHomeViolarSemanal],
    ["home-coti-mes", carregarHomeCotiMes],
  ];

  function aplicarHomeReloadButtons() {
    HOME_WIDGET_RELOAD_REGISTRO.forEach(([containerId, loader]) => {
      const container = document.getElementById(containerId);
      const card = container && container.closest(".home-dashboard-card");
      const tituloRow = card && card.querySelector(".home-dashboard-title-row");
      if (!tituloRow || tituloRow.querySelector(".home-reload-btn")) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "home-reload-btn";
      btn.title = "Atualizar";
      btn.textContent = "↻";
      btn.addEventListener("click", () => loader());
      tituloRow.append(btn);
    });
  }
  aplicarHomeReloadButtons();

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
    btn.classList.add("is-loading");
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
      carregarHomeDashboardsGradual();
    } catch (e) {
      loginError.textContent = "Não foi possível conectar ao servidor.";
      loginError.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.classList.remove("is-loading");
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
    hideAllResults();
    lastAction = null;
    lastCaixa = null;
    lastExtraBody = {};
    closeAllDialogs();
    clearBanner();
    appView.classList.add("hidden");
    loginCard.classList.remove("hidden");
    atualizarBotaoReportVini();
    atualizarBotaoTvResolvidosReabertos();
    atualizarBotaoParetoSolar();
    atualizarBotaoMaterialIcg();
  });

  // Segurança extra: se o navegador restaurar a página do cache (bfcache),
  // força novo login em vez de reaproveitar credenciais em memória.
  window.addEventListener("pagehide", () => {
    state.email = null;
    state.token = null;
  });

  // ------------------------------------------------------ caixa solucionadora
  // "Report Vini" só faz sentido em Mops Tv do Futuro (usa a tag Claro Tv
  // +/Claro Streaming Box de Categorias de Encerramento, que só existe
  // nessa caixa) — o botão some fora dela.
  function atualizarBotaoReportVini() {
    $("btn-report-vini").classList.toggle("hidden", state.caixa !== "tv");
  }

  // "Resolvidos e Reabertos (Excel)" é específico da caixa Mops Tv do
  // Futuro — mesma lógica de Report Vini: some fora dela.
  function atualizarBotaoTvResolvidosReabertos() {
    $("btn-tv-resolvidos-reabertos").classList.toggle("hidden", state.caixa !== "tv");
  }

  // "Pareto Solar" só faz sentido em Mops Solar (grupos N1/N2 fixos do
  // lado do servidor) — mesma lógica de Report Vini, mas invertida: some
  // fora da caixa Solar.
  function atualizarBotaoParetoSolar() {
    $("btn-pareto-solar").classList.toggle("hidden", state.caixa !== "solar");
  }

  // "Material ICG" também é específico de Mops Solar (metas passadas pelo
  // usuário — SLA 95%, reabertura 4% etc. — são todas do Solar) — mesma
  // lógica de Pareto Solar.
  function atualizarBotaoMaterialIcg() {
    $("btn-material-icg").classList.toggle("hidden", state.caixa !== "solar");
  }

  atualizarBotaoReportVini();
  atualizarBotaoTvResolvidosReabertos();
  atualizarBotaoParetoSolar();
  atualizarBotaoMaterialIcg();

  // ------------------------------------------------- dashboards da home
  // Os dois widgets abaixo mostram Solar e Claro Tv sempre juntos (não
  // dependem do alternador de caixa) — cada caixa usa seus próprios grupos
  // (CAIXAS[caixa]["grupos"], já resolvidos do lado do servidor: 3 pra
  // Solar, 2 pra Claro Tv sem "Prod"), então "respeitar as regras de cada
  // caixa" já acontece sozinho, sem nenhum código condicional aqui.
  const HOME_DASH_MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const HOME_DASH_CORES = ["#f2555c", "#f5a524", "#34d399", "#c9a227", "#4f9cf9", "#f472b6"];
  const HOME_CAIXA_LABEL = { solar: "Solar", tv: "Claro Tv" };

  function formatarMesAno(mesIso) {
    const [ano, mes] = mesIso.split("-").map(Number);
    return `${HOME_DASH_MESES_ABREV[mes - 1]} ${ano}`;
  }

  function homeCardErro(container, mensagem) {
    container.innerHTML = "";
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = mensagem;
    container.append(p);
  }

  // Monta um sub-bloco "rótulo da caixa + conteúdo" — mesmo cabeçalho nos
  // dois widgets (Grupo Solucionador × Mês e A violar semanal).
  function homeCaixaSubbloco(caixa, conteudoEl) {
    const bloco = document.createElement("div");
    bloco.className = "home-dashboard-subblock";
    bloco.dataset.caixa = caixa;

    const subtitle = document.createElement("div");
    subtitle.className = "home-dashboard-subtitle";
    subtitle.textContent = HOME_CAIXA_LABEL[caixa] || caixa;
    bloco.append(subtitle, conteudoEl);
    return bloco;
  }

  // Base de qualquer tabela "X × mês de criação" da home (réplica de um
  // Two Dimensional Filter Statistics do Jira): rank + bolinha colorida +
  // rótulo da linha, uma coluna por mês, coluna/linha de Total — usado
  // tanto por Grupo Solucionador (grupos fixos) quanto por Fornecedor
  // Responsável (valores descobertos nos dados, já vem ordenado do maior
  // pro menor). "colunaLabel" é o texto do cabeçalho da 1ª coluna;
  // "obterLabelLinha" extrai o texto de cada linha.
  function construirTabelaMesCriacao(dados, colunaLabel, obterLabelLinha) {
    const table = document.createElement("table");
    table.className = "data-table home-dashboard-table";

    const thead = document.createElement("thead");
    const trHead = document.createElement("tr");
    const thGrupo = document.createElement("th");
    thGrupo.textContent = colunaLabel;
    trHead.append(thGrupo);
    dados.meses.forEach((mes) => {
      const th = document.createElement("th");
      th.textContent = formatarMesAno(mes);
      trHead.append(th);
    });
    const thTotal = document.createElement("th");
    thTotal.textContent = "Total";
    trHead.append(thTotal);
    thead.append(trHead);
    table.append(thead);

    const tbody = document.createElement("tbody");
    dados.linhas.forEach((linha, i) => {
      const tr = document.createElement("tr");
      const tdGrupo = document.createElement("td");
      const dot = document.createElement("span");
      dot.className = "home-dashboard-dot";
      dot.style.background = HOME_DASH_CORES[i % HOME_DASH_CORES.length];
      tdGrupo.append(dot, document.createTextNode(obterLabelLinha(linha)));
      tr.append(tdGrupo);
      linha.por_mes.forEach((valor) => {
        const td = document.createElement("td");
        td.textContent = valor || "-";
        tr.append(td);
      });
      const tdTotal = document.createElement("td");
      tdTotal.textContent = linha.total;
      tr.append(tdTotal);
      tbody.append(tr);
    });

    const trTotal = document.createElement("tr");
    trTotal.className = "data-table-total-row";
    const tdLabelTotal = document.createElement("td");
    tdLabelTotal.textContent = "Total (issues)";
    trTotal.append(tdLabelTotal);
    dados.totais_por_mes.forEach((valor) => {
      const td = document.createElement("td");
      td.textContent = valor || "-";
      trTotal.append(td);
    });
    const tdGrandTotal = document.createElement("td");
    tdGrandTotal.textContent = dados.total_geral;
    trTotal.append(tdGrandTotal);
    tbody.append(trTotal);
    table.append(tbody);

    return table;
  }

  function construirTabelaGrupoCriacao(dados) {
    return construirTabelaMesCriacao(dados, "Grupo Solucionador", (linha) => GRUPO_LABEL_CURTO[linha.grupo] || linha.grupo);
  }

  function construirTabelaFornecedorCriacao(dados) {
    return construirTabelaMesCriacao(dados, "Fornecedor Responsável", (linha) => linha.fornecedor);
  }

  // Anel "dentro do prazo x fora do prazo": duas cores de status fixas
  // (verde = dentro/bom, vermelho = fora/violado) — a cor segue o
  // significado do estado, nunca qual fatia é maior. Técnica de 2 arcos
  // sobrepostos via stroke-dasharray/dashoffset, com um pequeno gap (3px)
  // entre eles pra separar os segmentos sem precisar de borda. Compartilhado
  // pelo widget "SLA" da home e pelo Report Vini.
  function buildPrazoDonutEl(dentro, fora, percentualDentro) {
    const total = dentro + fora;
    const size = 160;
    const strokeWidth = 22;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const svgNS = "http://www.w3.org/2000/svg";

    function arc(len, offset, className) {
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", size / 2);
      circle.setAttribute("cy", size / 2);
      circle.setAttribute("r", radius);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke-width", strokeWidth);
      circle.setAttribute("stroke-linecap", "butt");
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
      // "Fora do prazo" sempre desenhado como o anel INTEIRO por baixo (nunca
      // como uma fatia curta isolada) — com uma fatia pequena, um arco curto
      // com ponta arredondada fica parecendo um blob quadrado colado no anel
      // em vez de acompanhar a curva. Desenhando o vermelho como o círculo
      // completo e o verde por cima (só cobrindo a parte "dentro"), a
      // transição entre as duas cores sempre fica lisa, do tamanho que for.
      if (fora > 0) group.append(arc(circumference, 0, "prazo-donut-fora"));
      if (dentro > 0) group.append(arc(dentroFull, 0, "prazo-donut-dentro"));
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

  // Réplica de um gadget nativo do Jira (Grupo Solucionador × mês de
  // criação, entre os chamados abertos) — um sub-bloco por caixa, carrega
  // uma vez ao logar (não precisa recarregar ao trocar de caixa, já mostra
  // as duas).
  // "Reabertos do mês": % de reabertura do começo do mês até hoje. Era a
  // mesma função/rota do "SLA" (home_sla_mes) — o pedaço de SLA virou
  // widget à parte, histórico e 100% cache (carregarHomeSlaCache abaixo),
  // então essa função ficou só com a parte de reabertos.
  async function carregarHomeReabertosMes() {
    const reabertosEl = $("home-reabertos-mes");
    reabertosEl.innerHTML = "";

    try {
      // Sem "projetos": os cards da home sempre consideram só "Central de
      // Incidentes", fixo no servidor — não seguem o painel "PROJETOS".
      const resp = await apiCall("/api/home-reabertos-mes", {});
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(reabertosEl, data.error || "Erro ao carregar.");
        return;
      }

      data.caixas.forEach(({ caixa, percentual_reabertura: percentualReabertura, total_criados_periodo: totalCriadosPeriodo }) => {
        const card = summaryCard(
          `${percentualReabertura}% / ${totalCriadosPeriodo}`,
          HOME_CAIXA_LABEL[caixa] || caixa,
          "tone-warning"
        );
        card.dataset.caixa = caixa;
        reabertosEl.append(card);
      });
    } catch (e) {
      homeCardErro(reabertosEl, "Não foi possível conectar ao servidor.");
    }
  }

  // Miniatura do anel de SLA (só a fatia verde/vermelha proporcional ao
  // percentual + o próprio percentual no centro, sem contagem nem legenda
  // — essas só cabem no donut grande de buildPrazoDonutEl) — usada no
  // histórico "SLA" da home (1 anel por mês, muitos lado a lado).
  function construirSlaMiniDonut(percentualDentro, total) {
    const size = 54;
    const strokeWidth = 7;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const svgNS = "http://www.w3.org/2000/svg";

    function arc(len, className) {
      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", size / 2);
      circle.setAttribute("cy", size / 2);
      circle.setAttribute("r", radius);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke-width", strokeWidth);
      circle.setAttribute("stroke-linecap", "butt");
      circle.setAttribute("stroke-dasharray", `${Math.max(len, 0)} ${circumference}`);
      circle.classList.add(className);
      return circle;
    }

    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.classList.add("prazo-donut-svg", "prazo-donut-svg--mini");

    const group = document.createElementNS(svgNS, "g");
    group.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
    if (total > 0) {
      group.append(arc(circumference, "prazo-donut-fora"));
      group.append(arc((percentualDentro / 100) * circumference, "prazo-donut-dentro"));
    } else {
      group.append(arc(circumference, "prazo-donut-track"));
    }
    svg.append(group);

    const pct = document.createElement("div");
    pct.className = "prazo-donut-mini-pct";
    pct.textContent = total > 0 ? `${percentualDentro}%` : "—";

    const holder = document.createElement("div");
    holder.className = "prazo-donut-mini-holder";
    holder.append(svg, pct);
    return holder;
  }

  // 1 linha = 1 grupo (rótulo à esquerda + 1 mini anel por mês, na ordem
  // que vier em "meses"). Reaproveitada pelas 3 linhas de Solar (N1/N2/
  // Prod) e pela linha única de Claro Tv.
  function construirSlaHistoricoLinha(caixaId, rotulo, meses, linhasPorMes) {
    const porMes = Object.fromEntries(linhasPorMes.map((item) => [item.mes, item]));

    const linha = document.createElement("div");
    linha.className = "home-sla-historico-row";
    linha.dataset.caixa = caixaId;

    const label = document.createElement("div");
    label.className = "home-sla-historico-label";
    label.textContent = rotulo;
    linha.append(label);

    const circulos = document.createElement("div");
    circulos.className = "home-sla-historico-circulos";
    meses.forEach((mes) => {
      const item = porMes[mes] || { dentro_prazo: 0, fora_prazo: 0, percentual_dentro_prazo: 0 };
      const total = item.dentro_prazo + item.fora_prazo;

      const wrap = document.createElement("div");
      wrap.className = "home-sla-historico-item";
      wrap.title = `${formatarMesAno(mes)} — ${item.dentro_prazo} dentro / ${item.fora_prazo} fora do prazo`;

      const mesLabel = document.createElement("span");
      mesLabel.className = "home-sla-historico-mes";
      mesLabel.textContent = formatarMesAno(mes).split(" ")[0];

      wrap.append(mesLabel, construirSlaMiniDonut(item.percentual_dentro_prazo, total));
      circulos.append(wrap);
    });
    linha.append(circulos);

    return linha;
  }

  // "SLA" (tag "Cacheado"): histórico de todos os meses do cache, 1 mini
  // anel por mês — geral por caixa, sem separar por grupo (pedido
  // explícito do usuário): Solar é N1+N2+Prod juntos, Claro Tv é N1+N2
  // juntos (ver _cache_sla_historico em api/index.py).
  async function carregarHomeSlaCache() {
    const container = $("home-sla-mes");
    homeCardErro(container, "Carregando...");

    try {
      const resp = await apiCall("/api/home-sla-cache", {});
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(container, data.error || "Erro ao carregar.");
        return;
      }

      container.innerHTML = "";
      container.append(
        construirSlaHistoricoLinha("solar", "Solar", data.meses, data.solar),
        construirSlaHistoricoLinha("tv", "Claro Tv", data.meses, data.tv)
      );
    } catch (e) {
      homeCardErro(container, "Não foi possível conectar ao servidor.");
    }
  }

  // Baselines (linha de referência amarela) do gráfico "Criados x
  // Resolvidos por mês" — valores fixos pedidos pelo usuário.
  const CRIADOS_RESOLVIDOS_BASELINES = [1530, 1870];

  // Offset fixo (px) do "0" da escala (base das barras) até a borda de
  // baixo de ".home-sla-chart-bars"/".home-sla-chart-eixo": padding-bottom
  // de ".home-sla-chart-bars" (4px) + gap de ".home-sla-chart-col" (6px) +
  // altura de ".home-sla-chart-col-mes" (line-height: 14px) = 24px. Usado
  // igual nos dois lugares (linha e rótulo do eixo) pra garantir que
  // fiquem exatamente na mesma altura, em vez de duas contas separadas
  // que podiam divergir por 1px.
  const CRIADOS_RESOLVIDOS_OFFSET_BASE = 24;

  // Gráfico de coluna "Criados e Resolvidos por mês" (par de barrinhas por
  // mês, vermelho = criados / verde = resolvidos, com o número em cima de
  // cada barra), escala própria (maior valor entre todos os meses/
  // criados/resolvidos/baselines = 100% da altura disponível) + linha de
  // baseline amarela contínua (1 só elemento cobrindo a largura toda, em
  // vez de 1 segmento por mês — não quebra nos respiros entre meses).
  function construirCriadosResolvidosChart(meses, linhasPorMes) {
    const porMes = Object.fromEntries(linhasPorMes.map((item) => [item.mes, item]));
    const maior = Math.max(
      1,
      ...CRIADOS_RESOLVIDOS_BASELINES,
      ...linhasPorMes.flatMap((item) => [item.criados, item.resolvidos])
    );
    const alturaMax = 160;
    const bottomDoValor = (valor) => CRIADOS_RESOLVIDOS_OFFSET_BASE + (valor / maior) * alturaMax;

    // Índices da malha cartesiana (ticks em cinza-claro, redondos — passo
    // arredondado pra centena mais próxima, mirando ~5 linhas) — os
    // baselines (amarelo) já têm seus próprios rótulos, separados.
    const gridStep = Math.max(100, Math.round(maior / 5 / 100) * 100);
    const gridValores = [];
    for (let v = 0; v <= maior; v += gridStep) {
      gridValores.push(v);
    }

    const wrap = document.createElement("div");
    wrap.className = "home-sla-chart-inner";

    const legenda = document.createElement("div");
    legenda.className = "home-sla-chart-legenda";
    legenda.innerHTML =
      '<span><span class="home-sla-chart-legenda-dot home-sla-chart-legenda-dot--criados"></span>Criados</span>' +
      '<span><span class="home-sla-chart-legenda-dot home-sla-chart-legenda-dot--resolvidos"></span>Resolvidos</span>' +
      CRIADOS_RESOLVIDOS_BASELINES.map(
        (v) => `<span><span class="home-sla-chart-legenda-dot home-sla-chart-legenda-dot--baseline"></span>Baseline ${v}</span>`
      ).join("");
    wrap.append(legenda);

    const plot = document.createElement("div");
    plot.className = "home-sla-chart-plot";

    // Eixo com o valor de cada baseline à esquerda da linha pontilhada
    // (estilo "1870 -------"), fora da área que rola na horizontal — fica
    // sempre visível mesmo rolando os meses.
    const eixo = document.createElement("div");
    eixo.className = "home-sla-chart-eixo";
    gridValores.forEach((valorGrid) => {
      const linha = document.createElement("div");
      linha.className = "home-sla-chart-eixo-linha home-sla-chart-eixo-linha--grid";
      linha.style.bottom = `${bottomDoValor(valorGrid)}px`;
      eixo.append(linha);

      const rotulo = document.createElement("span");
      rotulo.className = "home-sla-chart-eixo-valor home-sla-chart-eixo-valor--grid";
      rotulo.style.bottom = `${bottomDoValor(valorGrid)}px`;
      rotulo.textContent = valorGrid;
      eixo.append(rotulo);
    });
    CRIADOS_RESOLVIDOS_BASELINES.forEach((valorBase) => {
      const linha = document.createElement("div");
      linha.className = "home-sla-chart-eixo-linha home-sla-chart-eixo-linha--baseline";
      linha.style.bottom = `${bottomDoValor(valorBase)}px`;
      eixo.append(linha);

      const rotulo = document.createElement("span");
      rotulo.className = "home-sla-chart-eixo-valor";
      rotulo.style.bottom = `${bottomDoValor(valorBase)}px`;
      rotulo.textContent = valorBase;
      eixo.append(rotulo);
    });
    plot.append(eixo);

    const bars = document.createElement("div");
    bars.className = "home-sla-chart-bars";
    meses.forEach((mes) => {
      const item = porMes[mes] || { criados: 0, resolvidos: 0 };

      const col = document.createElement("div");
      col.className = "home-sla-chart-col";

      const par = document.createElement("div");
      par.className = "home-sla-chart-par";
      [
        ["criados", "Criados", item.criados],
        ["resolvidos", "Resolvidos", item.resolvidos],
      ].forEach(([tipo, rotuloTipo, valor]) => {
        const bar = document.createElement("div");
        bar.className = `home-sla-chart-bar home-sla-chart-bar--${tipo}`;
        bar.style.height = `${Math.max((valor / maior) * alturaMax, valor ? 2 : 0)}px`;

        // Popover no mousehover (mesmo padrão do Pareto, ver
        // showParetoPopover) em vez de "title" nativo — mostra mês + tipo
        // + quantidade exata da barra.
        const tooltip = `${formatarMesAno(mes)} — ${rotuloTipo}: ${valor}`;
        bar.addEventListener("mouseenter", () => {
          cancelHoverPopoverHide();
          showParetoPopover(bar, tooltip);
        });
        bar.addEventListener("mouseleave", scheduleHoverPopoverHide);

        par.append(bar);
      });
      col.append(par);

      const mesLabel = document.createElement("span");
      mesLabel.className = "home-sla-chart-col-mes";
      mesLabel.textContent = formatarMesAno(mes).split(" ")[0];
      col.append(mesLabel);

      bars.append(col);
    });

    // Linha de baseline contínua (1 só elemento, largura fixa em px = soma
    // de todas as colunas de mês + os respiros entre elas — "left: 0;
    // right: 0" não funcionaria aqui porque ".home-sla-chart-bars" rola na
    // horizontal: o tamanho do elemento, pra um filho absoluto, é o da
    // "viewport" visível, não o do conteúdo rolável; só largura explícita
    // cobre o conteúdo todo e rola junto com as barras). Mesmo "bottom"
    // (via CRIADOS_RESOLVIDOS_OFFSET_BASE) do rótulo no eixo, pra garantir
    // que batam exatamente.
    const larguraTotalPx = meses.length * 56 + Math.max(meses.length - 1, 0) * 16;

    // Malha cartesiana (linhas cinza-claro, mesmo truque de elemento único
    // e largura fixa da baseline acima) — desenhada antes da baseline, pra
    // ficar por baixo dela (ordem no DOM = ordem de pintura).
    gridValores.forEach((valorGrid) => {
      const grade = document.createElement("div");
      grade.className = "home-sla-chart-grid";
      grade.style.bottom = `${bottomDoValor(valorGrid)}px`;
      grade.style.width = `${larguraTotalPx}px`;
      bars.append(grade);
    });

    CRIADOS_RESOLVIDOS_BASELINES.forEach((valorBase) => {
      const baseline = document.createElement("div");
      baseline.className = "home-sla-chart-baseline";
      baseline.style.bottom = `${bottomDoValor(valorBase)}px`;
      baseline.style.width = `${larguraTotalPx}px`;
      baseline.title = `Baseline: ${valorBase}`;
      bars.append(baseline);
    });

    plot.append(bars);
    wrap.append(plot);

    return wrap;
  }

  // "Criados x Resolvidos por mês" (tag "Cacheado"): histórico de todos os
  // meses do cache, por caixa (Solar: N1+N2+Prod juntos; Claro Tv: N1+N2
  // juntos — ver _cache_criados_resolvidos_historico em api/index.py). 1
  // gráfico por caixa, cada um marcado com data-caixa — o seletor global
  // do painel (ver aplicarHomeCaixaFiltro) esconde o que não está
  // selecionado via CSS, igual aos outros widgets da home.
  async function carregarHomeCriadosResolvidosCache() {
    const container = $("home-criados-resolvidos-mes");
    homeCardErro(container, "Carregando...");

    try {
      const resp = await apiCall("/api/home-criados-resolvidos-cache", {});
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(container, data.error || "Erro ao carregar.");
        return;
      }

      container.innerHTML = "";
      if (!data.meses.length) {
        container.append(Object.assign(document.createElement("p"), { className: "hint", textContent: "Nenhum chamado nas planilhas de cache." }));
        return;
      }
      Object.entries(data.caixas).forEach(([caixaId, linhas]) => {
        const bloco = document.createElement("div");
        bloco.dataset.caixa = caixaId;
        bloco.append(construirCriadosResolvidosChart(data.meses, linhas));
        container.append(bloco);
      });
    } catch (e) {
      homeCardErro(container, "Não foi possível conectar ao servidor.");
    }
  }

  async function carregarHomeGrupoCriacao() {
    const container = $("home-grupo-criacao");
    homeCardErro(container, "Carregando...");

    try {
      const resp = await apiCall("/api/home-grupo-criacao", {});
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(container, data.error || "Erro ao carregar.");
        return;
      }

      container.innerHTML = "";
      data.caixas.forEach(({ caixa, ...dados }) => {
        const wrap = document.createElement("div");
        wrap.className = "table-wrap";
        wrap.append(construirTabelaGrupoCriacao(dados));
        container.append(homeCaixaSubbloco(caixa, wrap));
      });
    } catch (e) {
      homeCardErro(container, "Não foi possível conectar ao servidor.");
    }
  }

  async function carregarHomeFornecedorCriacao() {
    const container = $("home-fornecedor-criacao");
    homeCardErro(container, "Carregando...");

    try {
      const resp = await apiCall("/api/home-fornecedor-criacao", {});
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(container, data.error || "Erro ao carregar.");
        return;
      }

      container.innerHTML = "";
      data.caixas.forEach(({ caixa, ...dados }) => {
        const wrap = document.createElement("div");
        wrap.className = "table-wrap";
        wrap.append(construirTabelaFornecedorCriacao(dados));
        container.append(homeCaixaSubbloco(caixa, wrap));
      });
    } catch (e) {
      homeCardErro(container, "Não foi possível conectar ao servidor.");
    }
  }

  // "Chamados Criados": mesmo estilo de tile de "A violar" (quadradinho
  // com heat tone), rótulo = DIA DO MÊS (1, 2, 3...) em vez de dia da
  // semana — mas os grupos (N1/N2/PROD Solar, N1/N2 Tv) vêm somados numa
  // linha só por caixa, não uma linha por grupo. Como o mês inteiro não
  // cabe em 7 colunas fixas, os tiles quebram linha livremente
  // (home-criados-tiles).
  function construirTilesCriados(dias) {
    const valores = dias.map((dia) => ({
      diaMes: parseInt(dia.data.slice(8, 10), 10),
      total: (dia.por_grupo || []).reduce((soma, g) => soma + g.total, 0),
      p0p1p2: (dia.por_grupo || []).reduce((soma, g) => soma + g.p0p1p2, 0),
    }));

    const tiles = document.createElement("div");
    tiles.className = "home-criados-tiles";

    const max = valores.reduce((m, v) => Math.max(m, v.total), 0);
    valores.forEach((v) => {
      const tile = document.createElement("div");
      const tom = heatTone(v.total, max);
      tile.className = "home-violar-tile" + (tom ? ` ${tom}` : "");

      const diaLabel = document.createElement("span");
      diaLabel.className = "home-violar-tile-label";
      diaLabel.textContent = v.diaMes;

      const valor = document.createElement("span");
      valor.className = "home-violar-tile-value";
      valor.textContent = v.total;

      tile.append(diaLabel, valor);

      if (v.p0p1p2 > 0) {
        const p0p1p2El = document.createElement("span");
        p0p1p2El.className = "home-violar-tile-p0p1p2";
        p0p1p2El.textContent = v.p0p1p2;
        p0p1p2El.title = `${v.p0p1p2} chamado${v.p0p1p2 === 1 ? "" : "s"} já foi P0/P1/P2`;
        tile.append(p0p1p2El);
      }

      tiles.append(tile);
    });

    return tiles;
  }

  async function carregarHomeCriadosMes() {
    const container = $("home-criados-mes");
    homeCardErro(container, "Carregando...");

    try {
      const resp = await apiCall("/api/home-criados-mes", {});
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(container, data.error || "Erro ao carregar.");
        return;
      }

      container.innerHTML = "";
      data.caixas.forEach(({ caixa, dias }) => {
        container.append(homeCaixaSubbloco(caixa, construirTilesCriados(dias)));
      });
    } catch (e) {
      homeCardErro(container, "Não foi possível conectar ao servidor.");
    }
  }

  // Mini gráfico de pizza (dentro do prazo x violado) pra célula de tabela
  // — mesmas cores do donut grande (buildPrazoDonutEl), só que em
  // conic-gradient (bem mais barato que SVG numa tabela com várias linhas).
  function buildMiniPieEl(percentualDentro) {
    const pct = Math.max(0, Math.min(100, percentualDentro));
    const pie = document.createElement("span");
    pie.className = "home-colab-pizza";
    pie.style.setProperty("--pct", `${pct}%`);
    pie.title = `${percentualDentro}% dentro do prazo`;
    return pie;
  }

  // "Colaboradores": tabela por colaborador (Resolvidos/Violados/Reabertos +
  // mini pizza de % dentro do prazo), do começo do mês até hoje.
  function construirTabelaColaboradores(linhas) {
    const table = document.createElement("table");
    table.className = "data-table home-dashboard-table";

    const thead = document.createElement("thead");
    const trHead = document.createElement("tr");
    ["Colaborador", "Resolvidos", "Violados", "Reabertos", "%"].forEach((texto) => {
      const th = document.createElement("th");
      th.textContent = texto;
      trHead.append(th);
    });
    thead.append(trHead);
    table.append(thead);

    const tbody = document.createElement("tbody");
    if (!linhas.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.className = "hint";
      td.textContent = "Nenhum chamado resolvido ou reaberto no período.";
      tr.append(td);
      tbody.append(tr);
    }
    linhas.forEach(({ colaborador, resolvidos, violados, reabertos, percentual_dentro_prazo: percentual }) => {
      const tr = document.createElement("tr");

      const tdNome = document.createElement("td");
      tdNome.textContent = colaborador;
      tr.append(tdNome);

      [resolvidos, violados, reabertos].forEach((valor) => {
        const td = document.createElement("td");
        td.textContent = valor;
        tr.append(td);
      });

      const tdPct = document.createElement("td");
      const pctWrap = document.createElement("div");
      pctWrap.className = "home-colab-pct";
      pctWrap.append(buildMiniPieEl(percentual), document.createTextNode(`${percentual}%`));
      tdPct.append(pctWrap);
      tr.append(tdPct);

      tbody.append(tr);
    });
    table.append(tbody);

    return table;
  }

  // "Colaboradores" com cache: uma coluna por mês, cada uma com 3 números
  // empilhados (Resolvidos em verde, Violados em vermelho, Reabertos em
  // amarelo) — dados vêm só das planilhas de cache (sem consultar o Jira
  // na hora, ver home_colaboradores_cache/_cache_colaboradores_mensal em
  // api/index.py), daí a tag "Cacheado" no lugar de "Mês atual".
  // Célula com os 3 números empilhados (Resolvidos/Violados/Reabertos) —
  // reaproveitada tanto nas colunas de mês quanto na coluna "Total".
  function construirCelulaColabMensal(dados) {
    const cell = document.createElement("div");
    cell.className = "home-colab-mensal-cell";
    [
      ["resolvidos", dados.resolvidos],
      ["violados", dados.violados],
      ["reabertos", dados.reabertos],
    ].forEach(([tipo, valor]) => {
      const span = document.createElement("span");
      span.className = `home-colab-mensal-${tipo}`;
      span.textContent = valor;
      cell.append(span);
    });
    return cell;
  }

  function construirTabelaColaboradoresMensal(meses, colaboradores) {
    const table = document.createElement("table");
    table.className = "data-table home-dashboard-table home-colab-mensal-table";

    const thead = document.createElement("thead");
    const trHead = document.createElement("tr");
    const thNome = document.createElement("th");
    thNome.textContent = "Colaborador";
    trHead.append(thNome);
    meses.forEach((mes) => {
      const th = document.createElement("th");
      th.textContent = formatarMesAno(mes);
      trHead.append(th);
    });
    const thTotal = document.createElement("th");
    thTotal.textContent = "Total";
    thTotal.className = "home-colab-mensal-total-col";
    trHead.append(thTotal);
    const thSla = document.createElement("th");
    thSla.textContent = "SLA";
    thSla.className = "home-colab-mensal-total-col";
    trHead.append(thSla);
    thead.append(trHead);
    table.append(thead);

    const tbody = document.createElement("tbody");
    if (!colaboradores.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = meses.length + 3;
      td.className = "hint";
      td.textContent = "Nenhum chamado resolvido nas planilhas de cache.";
      tr.append(td);
      tbody.append(tr);
    }

    colaboradores.forEach(({ nome, total, por_mes: porMes }) => {
      const tr = document.createElement("tr");
      const tdNome = document.createElement("td");
      tdNome.textContent = nome;
      tr.append(tdNome);

      meses.forEach((mes) => {
        const dados = porMes[mes] || { resolvidos: 0, violados: 0, reabertos: 0 };
        const td = document.createElement("td");
        td.append(construirCelulaColabMensal(dados));
        tr.append(td);
      });

      const tdTotal = document.createElement("td");
      tdTotal.className = "home-colab-mensal-total-col";
      tdTotal.append(construirCelulaColabMensal(total || { resolvidos: 0, violados: 0, reabertos: 0 }));
      tr.append(tdTotal);

      const tdSla = document.createElement("td");
      tdSla.className = "home-colab-mensal-total-col";
      const pct = total && total.percentual_dentro_prazo;
      if (pct === null || pct === undefined) {
        tdSla.textContent = "—";
        tdSla.classList.add("hint");
      } else {
        const pctWrap = document.createElement("div");
        pctWrap.className = "home-colab-pct";
        pctWrap.append(buildMiniPieEl(pct), document.createTextNode(`${pct}%`));
        tdSla.append(pctWrap);
      }
      tr.append(tdSla);

      tbody.append(tr);
    });
    table.append(tbody);

    return table;
  }

  async function carregarHomeColaboradoresCache() {
    const container = $("home-colaboradores-mes");
    homeCardErro(container, "Carregando...");

    try {
      const resp = await apiCall("/api/home-colaboradores-cache", {});
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(container, data.error || "Erro ao carregar.");
        return;
      }

      container.innerHTML = "";
      data.caixas.forEach(({ caixa, colaboradores }) => {
        const wrap = document.createElement("div");
        wrap.className = "table-wrap";
        wrap.append(construirTabelaColaboradoresMensal(data.meses, colaboradores));
        container.append(homeCaixaSubbloco(caixa, wrap));
      });
    } catch (e) {
      homeCardErro(container, "Não foi possível conectar ao servidor.");
    }
  }

  // Popover customizado (mesmo elemento flutuante compartilhado de
  // getHoverPopover/hideHoverPopover) pra mostrar o top 5 de
  // Sub-Classificação de uma barra do funil, no mousehover.
  function showHomeFunilPopover(anchorEl, classificacao, porSub) {
    const popover = getHoverPopover();
    popover.innerHTML = "";

    const titulo = document.createElement("div");
    titulo.className = "hover-popover-title";
    titulo.textContent = classificacao;
    popover.append(titulo);

    if (!porSub.length) {
      const vazio = document.createElement("div");
      vazio.className = "hint";
      vazio.textContent = "Sem Sub-Classificação preenchida.";
      popover.append(vazio);
    } else {
      porSub.forEach(({ sub_classificacao: sub, total }) => {
        const linha = document.createElement("div");
        linha.className = "home-funil-popover-row";
        const nomeEl = document.createElement("span");
        nomeEl.textContent = sub;
        const totalEl = document.createElement("span");
        totalEl.textContent = total;
        linha.append(nomeEl, totalEl);
        popover.append(linha);
      });
    }

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

  // Base de qualquer gráfico "funil" da tela: barras decrescentes alinhadas
  // à esquerda (a maior = 100% de largura), cores alternadas — usado tanto
  // por "Classificação — Funil" (com hover de Sub-Classificação, via
  // "onBar") quanto por "Análise de EPS" (sem hover). "itens" já vem
  // ordenado do maior pro menor (most_common do backend); "obterLabel"/
  // "obterValor" extraem o texto/número de cada item.
  function construirFunilBars(itens, obterLabel, obterValor, onBar, vazioTexto) {
    const wrap = document.createElement("div");
    wrap.className = "home-funil";

    if (!itens.length) {
      const vazio = document.createElement("span");
      vazio.className = "hint";
      vazio.textContent = vazioTexto || "Nenhum dado no período.";
      wrap.append(vazio);
      return wrap;
    }

    const max = obterValor(itens[0]);
    itens.forEach((item, i) => {
      const total = obterValor(item);
      const row = document.createElement("div");
      row.className = "home-funil-row";

      const bar = document.createElement("div");
      bar.className = "home-funil-bar";
      bar.style.width = `${max ? Math.max((total / max) * 100, 12) : 0}%`;
      bar.style.background = HOME_DASH_CORES[i % HOME_DASH_CORES.length];

      const label = document.createElement("span");
      label.className = "home-funil-label";
      label.textContent = obterLabel(item);

      const valor = document.createElement("span");
      valor.className = "home-funil-valor";
      valor.textContent = total;

      bar.append(label, valor);
      if (onBar) onBar(bar, item);
      row.append(bar);
      wrap.append(row);
    });

    return wrap;
  }

  // "Classificação — Funil": top 5 já vindo do backend (most_common(5)).
  // Mousehover em cada barra mostra o top 5 de Sub-Classificação daquela
  // Classificação (showHomeFunilPopover).
  function construirFunilClassificacao(ranking) {
    return construirFunilBars(
      ranking,
      (item) => item.classificacao,
      (item) => item.total,
      (bar, item) => {
        bar.addEventListener("mouseenter", () => {
          cancelHoverPopoverHide();
          showHomeFunilPopover(bar, item.classificacao, item.por_subclassificacao || []);
        });
        bar.addEventListener("mouseleave", scheduleHoverPopoverHide);
      },
      "Nenhum chamado classificado no período."
    );
  }

  // "Análise de EPS": mesmas barras de funil, sem hover — top 5 abertores/
  // resolvidos/reabertos por EPS (campo "PROP_Site"), já ordenado pelo
  // backend (most_common(5)).
  function construirFunilEps(ranking) {
    return construirFunilBars(
      ranking,
      (item) => item.eps,
      (item) => item.total,
      null,
      "Nenhum dado de EPS no período."
    );
  }

  async function carregarHomeClassificacaoFunil() {
    const container = $("home-classificacao-funil");
    homeCardErro(container, "Carregando...");

    try {
      // Sem "projetos": ver nota em carregarHomeSlaMes.
      const resp = await apiCall("/api/home-classificacao-funil", {});
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(container, data.error || "Erro ao carregar.");
        return;
      }

      container.innerHTML = "";
      data.caixas.forEach(({ caixa, ranking }) => {
        container.append(homeCaixaSubbloco(caixa, construirFunilClassificacao(ranking)));
      });
    } catch (e) {
      homeCardErro(container, "Não foi possível conectar ao servidor.");
    }
  }

  // "A violar" dos próximos 7 dias — uma linha por GRUPO (não por caixa):
  // Solar sai em 3 linhas (N1/N2/Prod), Claro Tv em 2 (N1/N2, sem "Prod" —
  // CAIXA_GRUPOS["tv"] não tem esse grupo). Cada linha usa o próprio pico
  // da semana pra colorir (heatTone), já que os grupos têm volumes bem
  // diferentes entre si.
  function construirTilesGrupoViolar(dias, grupo) {
    const valores = dias.map((dia) => {
      const entrada = (dia.por_grupo || []).find((g) => g.grupo === grupo);
      return {
        dia_semana: dia.dia_semana,
        total: entrada ? entrada.total : 0,
        semResponsavel: entrada ? entrada.sem_responsavel : 0,
        porStatus: entrada ? entrada.por_status || [] : [],
      };
    });

    const tiles = document.createElement("div");
    tiles.className = "home-violar-tiles";

    const max = valores.reduce((m, v) => Math.max(m, v.total), 0);
    valores.forEach((v) => {
      const tile = document.createElement("div");
      const tom = heatTone(v.total, max);
      tile.className = "home-violar-tile" + (tom ? ` ${tom}` : "");

      const diaLabel = document.createElement("span");
      diaLabel.className = "home-violar-tile-label";
      diaLabel.textContent = v.dia_semana;

      const valor = document.createElement("span");
      valor.className = "home-violar-tile-value";
      valor.textContent = v.total;

      tile.append(diaLabel, valor);

      // Hover: detalhamento por status daquele dia (ex.: "Em atendimento: 3").
      // Sem chamados, mantém só um aviso de que não há nada a violar.
      tile.title = v.porStatus.length
        ? v.porStatus.map(([status, qtd]) => `${status}: ${qtd}`).join("\n")
        : "Nenhum chamado a violar";

      // Sutil: só aparece quando tem pelo menos 1 sem responsável, discreto
      // (menor, opacidade reduzida) pra não competir com o número principal.
      if (v.semResponsavel > 0) {
        const semResp = document.createElement("span");
        semResp.className = "home-violar-tile-sem-responsavel";
        semResp.textContent = `${v.semResponsavel} sem resp.`;
        semResp.title = `${v.semResponsavel} chamado${v.semResponsavel === 1 ? "" : "s"} sem responsável`;
        tile.append(semResp);
      }

      tiles.append(tile);
    });

    return tiles;
  }

  function construirGruposViolar(caixa, dias) {
    const container = document.createElement("div");
    container.className = "home-violar-grupos";

    (CAIXA_GRUPOS[caixa] || []).forEach((grupo) => {
      const row = document.createElement("div");
      row.className = "home-violar-group-row";

      const label = document.createElement("span");
      label.className = "home-violar-group-label";
      label.textContent = GRUPO_LABEL_CURTO[grupo] || grupo;

      row.append(label, construirTilesGrupoViolar(dias, grupo));
      container.append(row);
    });

    return container;
  }

  // 1 coluna por grupo (N1/N2/PROD pra Solar, N1/N2 pra Claro Tv),
  // separadas por divisor vertical — dentro de cada coluna, os mesmos 4
  // cards (A violar/Violados/Aguardando Fornecedor/PDST), só que contando
  // apenas aquele grupo (ver extra_por_grupo/fetch_*_por_grupo em
  // api/index.py e jira_extractor.py).
  // Ordem fixa das colunas (N1, N2, PROD) — diferente da ordem de
  // GRUPOS_SOLUCIONADOR no backend (N2, N1, Prod, histórica/usada em
  // vários outros lugares do app), então o reordenamento é só aqui, na
  // hora de montar as colunas, sem mexer na constante global.
  const HOME_VIOLADOS_ORDEM_LABEL = ["N1", "N2", "PROD"];

  function construirVioladosPorGrupo(extraPorGrupo) {
    const grid = document.createElement("div");
    grid.className = "home-violados-grid";

    const gruposComIndice = (extraPorGrupo.violados || []).map((item, index) => ({ grupo: item.grupo, index }));
    gruposComIndice.sort((a, b) => {
      const labelA = a.grupo ? GRUPO_LABEL_CURTO[a.grupo] || a.grupo : "Total";
      const labelB = b.grupo ? GRUPO_LABEL_CURTO[b.grupo] || b.grupo : "Total";
      return HOME_VIOLADOS_ORDEM_LABEL.indexOf(labelA) - HOME_VIOLADOS_ORDEM_LABEL.indexOf(labelB);
    });

    gruposComIndice.forEach(({ grupo, index }) => {
      const valorDoGrupo = (metrica) => (extraPorGrupo[metrica] || [])[index]?.total ?? 0;

      const col = document.createElement("div");
      col.className = "home-violados-grid-col";

      const titulo = document.createElement("div");
      titulo.className = "home-violados-grid-col-titulo";
      titulo.textContent = grupo ? GRUPO_LABEL_CURTO[grupo] || grupo : "Total";
      col.append(titulo);

      const cards = document.createElement("div");
      cards.className = "home-violados-grid-col-cards";
      cards.append(
        summaryCard(valorDoGrupo("a_violar"), "A violar", "tone-warning"),
        summaryCard(valorDoGrupo("violados"), "Violados", "tone-danger"),
        summaryCard(valorDoGrupo("aguardando_fornecedor"), "Fornecedor", "tone-info"),
        summaryCard(valorDoGrupo("pdst"), "PDST", "tone-neutral")
      );
      col.append(cards);

      grid.append(col);
    });

    return grid;
  }

  async function carregarHomeViolarSemanal() {
    const container = $("home-violar-semanal");
    const abertosEl = $("home-violados-abertos");
    homeCardErro(container, "Carregando...");
    abertosEl.innerHTML = "";

    try {
      // Sem "projetos": ver nota em carregarHomeSlaMes.
      const resp = await apiCall("/api/home-violar-semanal", {});
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(container, data.error || "Erro ao carregar.");
        return;
      }

      container.innerHTML = "";
      data.caixas.forEach(({ caixa, extra_por_grupo: extraPorGrupo, dias }) => {
        if (extraPorGrupo) {
          abertosEl.append(homeCaixaSubbloco(caixa, construirVioladosPorGrupo(extraPorGrupo)));
        }

        container.append(homeCaixaSubbloco(caixa, construirGruposViolar(caixa, dias)));
      });
    } catch (e) {
      homeCardErro(container, "Não foi possível conectar ao servidor.");
    }
  }

  // "Chamados Críticos (COTI) — Mês atual": mesmos 4 cards da ação
  // "Chamados Críticos" (renderChamadosCriticos), do começo do mês até
  // hoje. COTI é específico da caixa Solar — sem sub-bloco por caixa, só
  // um bloco direto.
  async function carregarHomeCotiMes() {
    const container = $("home-coti-mes");
    homeCardErro(container, "Carregando...");

    try {
      // Sem "projetos": ver nota em carregarHomeSlaMes.
      const resp = await apiCall("/api/home-coti-mes", {});
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(container, data.error || "Erro ao carregar.");
        return;
      }

      container.innerHTML = "";
      container.append(
        summaryCard(data.total_criticos_abertos, "Total de COTI Abertos (WAS P0/P1/P2)", "tone-accent")
      );
      container.append(
        summaryCard(data.total_criticos_atual, "Total real de COTI (IN P0/P1/P2 atualmente)", "tone-danger")
      );
      container.append(
        summaryCard(
          `${data.total_pontuais} (${data.percentual_pontuais}%)`,
          "Pontuais (abertos − atual)",
          "tone-warning"
        )
      );
      container.append(
        summaryCard(
          `${data.percentual_criticos}%`,
          `COTI sobre ${data.total_criados} chamados criados no período`,
          "tone-accent"
        )
      );
    } catch (e) {
      homeCardErro(container, "Não foi possível conectar ao servidor.");
    }
  }

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
      closeAllDialogs();
      clearBanner();
      atualizarBotaoReportVini();
      atualizarBotaoTvResolvidosReabertos();
      atualizarBotaoParetoSolar();
      atualizarBotaoMaterialIcg();
    });
  });

  // Menu "AÇÕES" (barra lateral) expande/recolhe a lista de botões — mesmo
  // padrão .collapse/.open já usado em todos os outros painéis do app.
  $("btn-acoes-toggle").addEventListener("click", () => {
    const grid = $("acoes-grid");
    const abrindo = !grid.classList.contains("open");
    grid.classList.toggle("open", abrindo);
    $("acoes-toggle-icon").textContent = abrindo ? "▾" : "▸";
  });

  // Menu "REPORTS" (barra lateral) — mesmo padrão de expandir/recolher do
  // menu "AÇÕES" acima.
  $("btn-reports-toggle").addEventListener("click", () => {
    const grid = $("reports-grid");
    const abrindo = !grid.classList.contains("open");
    grid.classList.toggle("open", abrindo);
    $("reports-toggle-icon").textContent = abrindo ? "▾" : "▸";
  });

  // ------------------------------------------------------------- ações
  const ACTION_ENDPOINTS = {
    violados: "/api/violados",
  };

  // --------------------------------------------------------------- violados
  // Abre um painel de opções (mesmo efeito do botão Categorias de
  // Encerramento) em vez de buscar na hora: "Tudo" (comportamento de sempre,
  // sem filtro de data), "Hoje" ou um período personalizado — filtrando pelo
  // horário em que o SLA estourou.
  $("btn-violados").addEventListener("click", () => {
    const dialog = $("violados-dialog");
    const jaAberto = dialog.classList.contains("open");
    closeAllDialogs("violados-dialog");
    if (!jaAberto) {
      const hoje = new Date().toISOString().slice(0, 10);
      if (!$("violados-input-inicio").value) $("violados-input-inicio").value = hoje;
      if (!$("violados-input-fim").value) $("violados-input-fim").value = hoje;
    }
    dialog.classList.add("open");
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

  // --------------------------------------------------------- extração em lote
  // Lista de queries (JQL + nome do arquivo), roda 1 de cada vez, em ordem
  // — cada uma em 3 passos (preparar/lote/salvar, mesmo padrão de
  // sincronizarCache em Cache de Chamados): preparar roda a JQL e traz as
  // colunas base; lote preenche as 5 colunas calculadas aos poucos (até
  // EXTRACAO_LOTE_TAMANHO chaves por vez, pra não pesar a API — pedido
  // explícito do usuário); salvar grava o .xlsx pronto na pasta de
  // destino. Só então segue pra próxima query da lista.
  const EXTRACAO_LOTE_PASTA_PADRAO = "C:\\Users\\edufe\\OneDrive\\Área de Trabalho\\Cache\\TV";
  const EXTRACAO_LOTE_COL_CHAVE = "Número do Chamado";
  let extracaoLoteLinhas = [];
  let extracaoLoteRodando = false;

  function extracaoLoteRenumerar() {
    extracaoLoteLinhas.forEach(({ tdNum }, index) => {
      tdNum.textContent = index + 1;
    });
  }

  function extracaoLoteAtualizarRemover() {
    const podeRemover = extracaoLoteLinhas.length > 1;
    extracaoLoteLinhas.forEach(({ btnRemover }) => {
      btnRemover.disabled = !podeRemover || extracaoLoteRodando;
    });
  }

  function criarLinhaExtracaoLote() {
    const tr = document.createElement("tr");

    const tdNum = document.createElement("td");
    tdNum.className = "extracao-lote-col-num";
    tr.append(tdNum);

    const tdJql = document.createElement("td");
    const jqlEl = document.createElement("textarea");
    jqlEl.className = "extracao-lote-input-jql";
    jqlEl.rows = 2;
    jqlEl.placeholder = 'Ex.: "Grupo Solucionador[...]" IN (...) AND created >= "2026-01-01 00:00" AND created <= "2026-01-31 23:59"';
    tdJql.append(jqlEl);
    tr.append(tdJql);

    const tdNome = document.createElement("td");
    tdNome.className = "extracao-lote-col-nome";
    const nomeEl = document.createElement("input");
    nomeEl.type = "text";
    nomeEl.placeholder = "jan-2026";
    tdNome.append(nomeEl);
    tr.append(tdNome);

    const tdStatus = document.createElement("td");
    tdStatus.className = "extracao-lote-col-status extracao-lote-status--idle";
    tdStatus.textContent = "Aguardando";
    tr.append(tdStatus);

    const tdBtn = document.createElement("td");
    tdBtn.className = "extracao-lote-col-acao";
    const btnRemover = document.createElement("button");
    btnRemover.type = "button";
    btnRemover.className = "btn-secondary";
    btnRemover.textContent = "✕";
    btnRemover.title = "Remover linha";
    btnRemover.addEventListener("click", () => {
      extracaoLoteLinhas = extracaoLoteLinhas.filter((l) => l.tr !== tr);
      tr.remove();
      extracaoLoteAtualizarRemover();
      extracaoLoteRenumerar();
    });
    tdBtn.append(btnRemover);
    tr.append(tdBtn);

    const linha = { tr, tdNum, jqlEl, nomeEl, tdStatus, btnRemover };
    extracaoLoteLinhas.push(linha);
    $("extracao-lote-table").querySelector("tbody").append(tr);
    extracaoLoteAtualizarRemover();
    extracaoLoteRenumerar();
    return linha;
  }

  // "tipo": idle (aguardando, antes de iniciar) | rodando (passo atual) |
  // ok (salvo com sucesso) | erro (parou nessa linha). Texto nunca é
  // cortado (ver CSS, sem nowrap/ellipsis) — mensagem de erro pode ser
  // longa (ex.: caminho do arquivo, erro do Jira) e precisa aparecer
  // inteira, mesmo que quebre em várias linhas dentro da célula.
  function extracaoLoteSetStatus(linha, texto, tipo) {
    linha.tdStatus.textContent = texto;
    linha.tdStatus.className = `extracao-lote-col-status extracao-lote-status--${tipo}`;
  }

  $("btn-extracao-lote").addEventListener("click", () => {
    closeAllDialogs();
    $("extracao-lote-results").classList.remove("hidden");
    if (!$("extracao-lote-pasta").value) {
      $("extracao-lote-pasta").value = EXTRACAO_LOTE_PASTA_PADRAO;
    }
    if (!extracaoLoteLinhas.length) {
      criarLinhaExtracaoLote();
    }
  });

  $("btn-extracao-lote-add").addEventListener("click", () => {
    criarLinhaExtracaoLote();
  });

  $("btn-extracao-lote-iniciar").addEventListener("click", async () => {
    if (extracaoLoteRodando) return;

    const pasta = $("extracao-lote-pasta").value.trim() || EXTRACAO_LOTE_PASTA_PADRAO;
    const formato = $("extracao-lote-formato").value || "xlsx";
    const fila = extracaoLoteLinhas.filter((l) => l.jqlEl.value.trim() && l.nomeEl.value.trim());
    if (!fila.length) {
      setBanner("Preencha ao menos 1 linha com query e nome do arquivo.", "error");
      return;
    }

    extracaoLoteRodando = true;
    const btnIniciar = $("btn-extracao-lote-iniciar");
    const btnAdd = $("btn-extracao-lote-add");
    const statusEl = $("extracao-lote-status");
    btnIniciar.disabled = true;
    btnAdd.disabled = true;
    $("extracao-lote-formato").disabled = true;
    $("extracao-lote-pasta").disabled = true;
    extracaoLoteLinhas.forEach((linha) => {
      linha.jqlEl.disabled = true;
      linha.nomeEl.disabled = true;
      extracaoLoteSetStatus(linha, "Aguardando", "idle");
    });
    extracaoLoteAtualizarRemover();

    for (let i = 0; i < fila.length; i++) {
      const linha = fila[i];
      const jql = linha.jqlEl.value.trim();
      const nomeArquivo = linha.nomeEl.value.trim();
      statusEl.textContent = `Executando ${i + 1}/${fila.length}...`;

      try {
        extracaoLoteSetStatus(linha, "Executando a query...", "rodando");
        const prepResp = await apiCall("/api/extracao-lote/preparar", { jql });
        const prep = await prepResp.json();
        if (!prepResp.ok) {
          extracaoLoteSetStatus(linha, prep.error || "Erro ao executar a query.", "erro");
          continue;
        }

        const linhas = prep.linhas || [];
        const porChave = Object.fromEntries(linhas.map((l) => [l[EXTRACAO_LOTE_COL_CHAVE], l]));
        const lotes = dividirEmLotes(Object.keys(porChave), prep.lote || CACHE_SYNC_LOTE);

        let falhou = false;
        for (let b = 0; b < lotes.length; b++) {
          extracaoLoteSetStatus(linha, `Lote ${b + 1}/${lotes.length}...`, "rodando");
          const loteResp = await apiCall("/api/extracao-lote/lote", { chaves: lotes[b] });
          const loteData = await loteResp.json();
          if (!loteResp.ok) {
            extracaoLoteSetStatus(linha, loteData.error || "Erro num lote.", "erro");
            falhou = true;
            break;
          }
          Object.entries(loteData.resultados).forEach(([chave, campos]) => {
            if (porChave[chave]) Object.assign(porChave[chave], campos);
          });
        }
        if (falhou) continue;

        extracaoLoteSetStatus(linha, "Salvando o arquivo...", "rodando");
        const salvarResp = await apiCall("/api/extracao-lote/salvar", {
          pasta,
          nome_arquivo: nomeArquivo,
          linhas,
          formato,
        });
        const salvarData = await salvarResp.json();
        if (!salvarResp.ok) {
          extracaoLoteSetStatus(linha, salvarData.error || "Erro ao salvar o arquivo.", "erro");
          continue;
        }
        extracaoLoteSetStatus(linha, `${salvarData.total} chamado(s) salvos em "${salvarData.caminho}".`, "ok");
      } catch (e) {
        extracaoLoteSetStatus(linha, "Não foi possível conectar ao servidor.", "erro");
      }
    }

    statusEl.textContent = "Concluído.";
    extracaoLoteRodando = false;
    btnIniciar.disabled = false;
    btnAdd.disabled = false;
    $("extracao-lote-formato").disabled = false;
    $("extracao-lote-pasta").disabled = false;
    extracaoLoteLinhas.forEach(({ jqlEl, nomeEl }) => {
      jqlEl.disabled = false;
      nomeEl.disabled = false;
    });
    extracaoLoteAtualizarRemover();
  });

  // Tons do mapa de calor (home dashboard "A violar"): só marca os dias com
  // carga MAIOR em relação ao pior dia da semana visível — o resto fica na
  // cor neutra do card, sem chamar atenção à toa (dia com 0 ou pouca coisa
  // não precisa de destaque).
  function heatTone(total, max) {
    if (max <= 0 || total <= 0) return "";
    const proporcao = total / max;
    if (proporcao >= 0.75) return "tone-danger";
    if (proporcao >= 0.4) return "tone-warning";
    return "";
  }

  // --------------------------------------------------------- resultados
  const MAX_ROWS_RENDERED = 500;

  function renderResults(action, data) {
    $("results-title").textContent = `RESULTADOS — ${ACTION_LABELS[action]}`;
    $("results-date").textContent = rotuloDataResultado();
    renderSummary(action, data.summary, data.por_turno);
    renderPorDiaViolados(data.por_dia, data.rows);
    renderTable(data.fields, data.rows);
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

  // Popover flutuante do Pareto Solar — só o nome por inteiro da categoria
  // (rótulo do eixo X vem truncado) + quantidade/%, sem reservar espaço
  // fixo na tela: aparece ancorado na barra só enquanto o mouse está em
  // cima (mesmo popover/posicionamento de showHomeFunilPopover acima).
  // "texto": string (1 linha, comportamento original) ou array de strings
  // (1 tópico com marcador por linha, pedido explícito do usuário — "em
  // tópicos, com quebra de linha").
  function showParetoPopover(anchorEl, texto) {
    const popover = getHoverPopover();
    popover.innerHTML = "";

    if (Array.isArray(texto)) {
      texto.forEach((linha) => {
        const item = document.createElement("div");
        item.className = "hover-popover-item";
        item.textContent = linha;
        popover.append(item);
      });
    } else {
      const titulo = document.createElement("div");
      titulo.className = "hover-popover-title";
      titulo.textContent = texto;
      popover.append(titulo);
    }

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

  function renderSummary(action, summary, porTurno) {
    const totalCardsEl = $("summary-cards");
    totalCardsEl.innerHTML = "";
    totalCardsEl.append(summaryCard(summary.total, "Total de chamados", ACTION_TONE[action]));

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

  // ------------------------------------------------------------ colaboradores
  // Tabela por colaborador (Resolvidos/Violados/Reabertos/% — construirTabelaColaboradores)
  // de um único período, consultando o Jira na hora — diferente do widget
  // "Colaboradores" da home (tag "Cacheado"), que não consulta o Jira e
  // mostra uma coluna por mês a partir das planilhas de cache. Aqui é só
  // da caixa/projetos selecionados no momento (não as duas caixas juntas)
  // e com período escolhido pelo usuário.
  $("btn-colaboradores").addEventListener("click", () => {
    const dialog = $("colaboradores-dialog");
    const jaAberto = dialog.classList.contains("open");
    closeAllDialogs("colaboradores-dialog");
    if (!jaAberto) {
      if (!$("colaboradores-input-inicio").value) {
        const hoje = new Date();
        $("colaboradores-input-inicio").value = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
        $("colaboradores-input-fim").value = hoje.toISOString().slice(0, 10);
      }
    }
    dialog.classList.add("open");
  });

  $("btn-colaboradores-cancelar").addEventListener("click", () => {
    $("colaboradores-dialog").classList.remove("open");
  });

  $("btn-colaboradores-gerar").addEventListener("click", async () => {
    const inicio = $("colaboradores-input-inicio").value;
    const fim = $("colaboradores-input-fim").value;
    if (!inicio || !fim) {
      setBanner("Informe as duas datas.", "error");
      return;
    }

    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    $("colaboradores-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Buscando chamados no Jira...", "info");
    hideAllResults();
    try {
      const resp = await apiCall("/api/colaboradores", { caixa: state.caixa, inicio, fim, projetos });
      const data = await resp.json();

      if (!resp.ok) {
        setBanner(data.error || "Erro ao executar a ação.", "error");
        return;
      }

      $("colaboradores-date").textContent = `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;
      const wrap = $("colaboradores-table-wrap");
      wrap.innerHTML = "";
      wrap.append(construirTabelaColaboradores(data.colaboradores));
      $("colaboradores-results").classList.remove("hidden");
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // ---------------------------------------------------------- report vini
  $("btn-report-vini").addEventListener("click", () => {
    const dialog = $("report-vini-dialog");
    closeAllDialogs("report-vini-dialog");
    dialog.classList.add("open");
  });

  $("btn-vini-cancelar").addEventListener("click", () => {
    $("report-vini-dialog").classList.remove("open");
  });

  // Consolida no mesmo resultado o que hoje fica espalhado em 3 ações
  // (Criados x Resolvidos, Reabertos, Categorias de Encerramento) — as duas
  // primeiras reaproveitam os mesmos builders de card/donut já usados na
  // ação "Criados x Resolvidos"; a terceira reaproveita buildCategoriaTableEl
  // (mesmo formato dividido Claro Tv +/Claro Streaming Box de lá).
  // Guardado pro "Exportar PDF" reaproveitar sem refazer a busca — mesmo
  // dado já renderizado em tela.
  let lastViniData = null;
  let lastViniInicio = null;
  let lastViniFim = null;

  // Card por grupo (N1/N2/PROD) de "Criados x Resolvidos" — usado pelo
  // Report Vini: contador de encerrados no período + média diária (total ÷
  // dias do período selecionado) + TMA aproximado (16h de expediente ÷
  // média diária — não é o tempo real em "Em atendimento", é só uma
  // estimativa a partir do volume). Valor principal em formato
  // "criados/resolvidos" (ex.: "20/10") — pra ver os dois números do grupo
  // num relance só, em vez de só o total resolvido.
  function criadosResolvidosGrupoCard(grupo, criados, total, mediaDiaria, tmaHoras) {
    const card = document.createElement("div");
    card.className = "summary-card";

    const valueEl = document.createElement("div");
    valueEl.className = "summary-value";
    valueEl.textContent = `${criados}/${total}`;

    const labelEl = document.createElement("div");
    labelEl.className = "summary-label";
    labelEl.textContent = GRUPO_LABEL_CURTO[grupo] || grupo;

    const descricaoEl = document.createElement("div");
    descricaoEl.className = "summary-label";
    descricaoEl.style.marginTop = "2px";
    descricaoEl.textContent = "Criados / Resolvidos";

    const mediaEl = document.createElement("div");
    mediaEl.className = "summary-label";
    mediaEl.style.marginTop = "2px";
    mediaEl.textContent = `Média: ${mediaDiaria}/dia`;

    card.append(valueEl, labelEl, descricaoEl, mediaEl);

    if (typeof tmaHoras === "number") {
      const tmaEl = document.createElement("div");
      tmaEl.className = "summary-label";
      tmaEl.style.marginTop = "2px";
      tmaEl.textContent = `TMA: ${tmaHoras}h`;
      card.append(tmaEl);
    }

    return card;
  }

  function renderReportVini(data, inicio, fim) {
    lastViniData = data;
    lastViniInicio = inicio;
    lastViniFim = fim;

    const cr = data.criados_resolvidos;
    const saldo = cr.total_criados - cr.total_resolvidos;

    const cardsEl = $("vini-cr-summary-cards");
    cardsEl.innerHTML = "";
    cardsEl.append(summaryCard(cr.total_criados, "Criados no período", "tone-accent"));
    cardsEl.append(summaryCard(cr.total_resolvidos, "Resolvidos (Encerrado/Resolvido)", "tone-warning"));
    cardsEl.append(summaryCard(saldo, "Saldo (criados − resolvidos)", saldo > 0 ? "tone-danger" : ""));

    const donutEl = $("vini-cr-prazo-donut");
    donutEl.innerHTML = "";
    if (typeof cr.percentual_dentro_prazo === "number") {
      donutEl.append(buildPrazoDonutEl(cr.resolvidos_dentro_prazo, cr.resolvidos_fora_prazo, cr.percentual_dentro_prazo));
      donutEl.classList.remove("hidden");
    } else {
      donutEl.classList.add("hidden");
    }

    const porGrupoBlock = $("vini-cr-por-grupo-block");
    const porGrupoCardsEl = $("vini-cr-por-grupo-cards");
    porGrupoCardsEl.innerHTML = "";
    if (cr.por_grupo && cr.por_grupo.length) {
      cr.por_grupo.forEach(({ grupo, criados, total, media_diaria, tma_horas }) => {
        porGrupoCardsEl.append(criadosResolvidosGrupoCard(grupo, criados, total, media_diaria, tma_horas));
      });
      porGrupoBlock.classList.remove("hidden");
    } else {
      porGrupoBlock.classList.add("hidden");
    }

    const reabertosEl = $("vini-reabertos-cards");
    reabertosEl.innerHTML = "";
    reabertosEl.append(summaryCard(data.reabertos.total, "Total de chamados", "tone-danger"));
    reabertosEl.append(
      summaryCard(`${data.reabertos.percentual}%`, `dos ${data.reabertos.total_criados_periodo} criados no período`, "tone-accent")
    );

    const categoriasBlock = $("vini-categorias-block");
    categoriasBlock.innerHTML = "";
    categoriasBlock.append(buildCategoriaTableEl("Encerrados", data.categorias_encerrados));

    $("vini-date").textContent = `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;
    $("report-vini-results").classList.remove("hidden");
  }

  $("btn-vini-gerar").addEventListener("click", async () => {
    const inicio = $("vini-input-inicio").value;
    const fim = $("vini-input-fim").value;
    if (!inicio || !fim) {
      setBanner("Informe as duas datas.", "error");
      return;
    }

    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    $("report-vini-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Gerando Report Vini... pode demorar num período grande (checa a categoria de cada chamado encerrado).", "info");
    hideAllResults();
    try {
      const resp = await apiCall("/api/report-vini", { inicio, fim, caixa: state.caixa, projetos });
      const data = await resp.json();
      if (!resp.ok) {
        setBanner(data.error || "Erro ao gerar o Report Vini.", "error");
        return;
      }
      renderReportVini(data, inicio, fim);
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // Monta as seções pro PDF (formato aceito por /api/relatorio-geral-pdf)
  // com o mesmo visual da tela — cards coloridos (não texto corrido) e o
  // donut de Dentro/Fora do prazo (ver _construir_cards_pdf/
  // _construir_donut_pdf em jira_extractor.py). "secoesSelecionadas" (ver
  // VINI_PDF_SECOES) filtra quais das 3 seções entram no PDF — a tela
  // continua mostrando as 3 sempre, só a exportação é que pode sair
  // reduzida.
  function viniSecoesPdf(data, inicio, fim, secoesSelecionadas) {
    const periodo = `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;
    const secoes = [];

    if (secoesSelecionadas.includes("criados_resolvidos")) {
      const cr = data.criados_resolvidos;
      const saldo = cr.total_criados - cr.total_resolvidos;

      const secaoCriadosResolvidos = {
        titulo: `Criados x Resolvidos (TMA / SLA) — ${periodo}`,
        cards: [
          { valor: cr.total_criados, label: "Criados no período", tone: "accent" },
          { valor: cr.total_resolvidos, label: "Resolvidos (Encerrado/Resolvido)", tone: "warning" },
          { valor: saldo, label: "Saldo (criados − resolvidos)", tone: saldo > 0 ? "danger" : undefined },
        ],
      };
      if (typeof cr.percentual_dentro_prazo === "number") {
        secaoCriadosResolvidos.donut = {
          dentro: cr.resolvidos_dentro_prazo,
          fora: cr.resolvidos_fora_prazo,
          percentual: cr.percentual_dentro_prazo,
        };
      }
      secoes.push(secaoCriadosResolvidos);

      if (cr.por_grupo && cr.por_grupo.length) {
        secoes.push({
          titulo: "Criados / Encerrados por Grupo Solucionador",
          cards: cr.por_grupo.map(({ grupo, criados, total, media_diaria, tma_horas }) => ({
            valor: `${criados}/${total}`,
            label: `${GRUPO_LABEL_CURTO[grupo] || grupo}\nMédia: ${media_diaria}/dia${
              typeof tma_horas === "number" ? `\nTMA: ${tma_horas}h` : ""
            }`,
          })),
        });
      }
    }

    if (secoesSelecionadas.includes("reabertos")) {
      secoes.push({
        titulo: `Chamados Reabertos — ${periodo}`,
        cards: [
          { valor: data.reabertos.total, label: "Total de chamados", tone: "danger" },
          { valor: `${data.reabertos.percentual}%`, label: `dos ${data.reabertos.total_criados_periodo} criados no período`, tone: "accent" },
        ],
      });
    }

    if (secoesSelecionadas.includes("categorias")) {
      secoes.push(...categoriaSecoesPdf("Top 5 Categorias de Encerramento — Encerrados", data.categorias_encerrados));
    }

    return secoes;
  }

  $("btn-vini-pdf").addEventListener("click", async () => {
    if (!lastViniData) return;

    const secoesSelecionadas = checkedValues($("vini-pdf-secoes-checkboxes"));
    if (!secoesSelecionadas.length) {
      setBanner("Selecione ao menos uma seção para o PDF.", "error");
      return;
    }

    const botao = $("btn-vini-pdf");
    botao.disabled = true;
    setBanner("Gerando PDF...", "info");
    try {
      const secoes = viniSecoesPdf(lastViniData, lastViniInicio, lastViniFim, secoesSelecionadas);
      const resp = await apiCall("/api/relatorio-geral-pdf", {
        secoes,
        titulo: "Mops Tv do Futuro — Report Vini",
        arquivo: "report_vini",
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setBanner(data.error || "Erro ao gerar o PDF.", "error");
        return;
      }
      const blob = await resp.blob();
      const filename = filenameFromDisposition(resp.headers.get("Content-Disposition"), "report_vini.pdf");
      triggerDownload(blob, filename);
      setBanner(`PDF gerado: ${filename}`, "success");
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      botao.disabled = false;
    }
  });

  // ----------------------------------- resolvidos e reabertos (excel, tv)
  // Botão direto (sem tela de resultados): baixa um Excel de 2 abas pro
  // período escolhido — "Resolvidos e Encerrados" + "Reabertos" — ver
  // /api/tv-resolvidos-reabertos em api/index.py.
  $("btn-tv-resolvidos-reabertos").addEventListener("click", () => {
    const dialog = $("tv-resolvidos-reabertos-dialog");
    closeAllDialogs("tv-resolvidos-reabertos-dialog");
    $("tv-rr-status").textContent = "";
    dialog.classList.add("open");
  });

  $("btn-tv-rr-cancelar").addEventListener("click", () => {
    $("tv-resolvidos-reabertos-dialog").classList.remove("open");
  });

  $("btn-tv-rr-gerar").addEventListener("click", async () => {
    const inicio = $("tv-rr-input-inicio").value;
    const fim = $("tv-rr-input-fim").value;
    const statusEl = $("tv-rr-status");
    if (!inicio || !fim) {
      statusEl.textContent = "Informe as duas datas (início e fim).";
      return;
    }

    const botao = $("btn-tv-rr-gerar");
    botao.disabled = true;
    statusEl.classList.add("is-loading");
    statusEl.textContent = "Gerando Excel...";
    try {
      const resp = await apiCall("/api/tv-resolvidos-reabertos", { caixa: state.caixa, inicio, fim });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        statusEl.textContent = data.error || "Erro ao gerar o Excel.";
        return;
      }

      const contentType = resp.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        const data = await resp.json();
        statusEl.textContent = data.message || "Nenhum chamado encontrado.";
        return;
      }

      const blob = await resp.blob();
      const filename = filenameFromDisposition(resp.headers.get("Content-Disposition"), "tv_resolvidos_reabertos.xlsx");
      triggerDownload(blob, filename);
      statusEl.textContent = `Excel gerado: ${filename}`;
    } catch (e) {
      statusEl.textContent = "Não foi possível conectar ao servidor.";
    } finally {
      statusEl.classList.remove("is-loading");
      botao.disabled = false;
    }
  });

  // ---------------------------------------------------- report diário
  // Ação direta (sem diálogo, sempre "hoje") — consolida num resultado só o
  // que hoje é visto espalhado em 3 ações (A violar, Violados, Reabertos,
  // todas escopadas ao dia atual) mais o ranking de quem mais resolveu hoje
  // ("Top analistas do dia", mesmo summaryCard com ranking embutido já
  // usado nos cards "por grupo" de Criados x Resolvidos/A violar).
  // Funciona nas duas caixas — não é restrito a Solar nem a Claro Tv.
  function renderReportDiario(data) {
    $("report-diario-date").textContent = formatarDataBR(data.data);

    const cardsEl = $("report-diario-summary-cards");
    cardsEl.innerHTML = "";
    cardsEl.append(summaryCard(data.a_violar_hoje, "A violar no dia", "tone-warning"));
    cardsEl.append(summaryCard(data.violados_hoje, "Violados no dia", "tone-danger"));
    cardsEl.append(summaryCard(data.reabertos_hoje, "Reabertos", "tone-warning"));

    const topEl = $("report-diario-top-cards");
    topEl.innerHTML = "";
    topEl.append(summaryCard(data.resolvidos_hoje, "Resolvidos hoje", "tone-accent", data.top_analistas));

    $("report-diario-results").classList.remove("hidden");
  }

  $("btn-report-diario").addEventListener("click", async () => {
    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    closeAllDialogs();
    setBusy(true);
    setBanner("Gerando Report Diário...", "info");
    hideAllResults();
    try {
      const resp = await apiCall("/api/report-diario", { caixa: state.caixa, projetos });
      const data = await resp.json();
      if (!resp.ok) {
        setBanner(data.error || "Erro ao gerar o Report Diário.", "error");
        return;
      }
      renderReportDiario(data);
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // -------------------------------------------------------- cache de chamados
  // Lista as planilhas .xlsx da pasta de cache local (uma por mês, ver
  // CACHE_DIR em api/index.py) — ação direta, sem diálogo, igual Report
  // Diário. A planilha do mês corrente é criada sozinha (sem botão, sem
  // avisar) assim que a tela carrega com o usuário logado — ver
  // _cache_garantir_mes_atual em api/index.py. Cada linha mostra quantos
  // chamados daquela planilha ainda estão em aberto (Status fora de
  // Encerrado/Resolvido/Cancelado/Reprovado/Arquivado —
  // CACHE_STATUS_FECHADOS em api/index.py) e tem um botão "Sincronizar"
  // que (1) consulta esses chamados no Jira e sobrescreve a célula
  // "Status" de quem mudou e (2) busca quem foi criado depois da "data
  // corte" (chamado mais recente já na planilha) e acrescenta como linha
  // nova (/api/cache/sincronizar).
  function formatarDataHoraBR(isoString) {
    if (!isoString) return null;
    const data = new Date(isoString);
    if (Number.isNaN(data.getTime())) return null;
    const dd = String(data.getDate()).padStart(2, "0");
    const mm = String(data.getMonth() + 1).padStart(2, "0");
    const hh = String(data.getHours()).padStart(2, "0");
    const min = String(data.getMinutes()).padStart(2, "0");
    return `${dd}/${mm} ${hh}:${min}`;
  }

  function cacheStatusTexto(sincronizadoEm) {
    const formatado = formatarDataHoraBR(sincronizadoEm);
    return formatado ? `Sincronizado em ${formatado}` : "Nunca sincronizado";
  }

  // Espelha CAIXAS em api/index.py — ordem/colunas fixas da tabela de
  // Cache (uma coluna por caixa, em vez de empilhar tudo numa célula só).
  // "prod" sai separado de "solar" (pedido explícito — ver CACHE_GRUPO_
  // PARA_CAIXA no servidor); "outros" (chamados cujo Grupo Solucionador
  // não bate com nenhuma caixa conhecida) é best-effort, normalmente 0.
  const CACHE_CAIXA_COLUNAS = ["solar", "prod", "tv", "outros"];

  // Preenche as 4 células de caixa de uma linha — "abertosPorCaixa" vem do
  // servidor já sem chaves zeradas (CACHE_GRUPO_PARA_CAIXA só soma quem
  // tem pelo menos 1 aberto), então toda caixa ausente vira 0 aqui.
  function preencherCelulasCaixas(tds, abertosPorCaixa) {
    CACHE_CAIXA_COLUNAS.forEach((caixaId) => {
      const valor = abertosPorCaixa ? abertosPorCaixa[caixaId] || 0 : null;
      tds[caixaId].textContent = valor === null ? "—" : valor;
      // Destaca (negrito + cor de alerta) quem tem pelo menos 1 chamado em
      // aberto naquela caixa — bate o olho em vez de precisar ler número
      // por número.
      tds[caixaId].classList.toggle("cache-valor-positivo", Boolean(valor));
    });
  }

  // "Seções" de cache: 1 por pasta registrada na tela (pedido explícito do
  // usuário: "tenho mais de uma pasta de cache" — ver AskUserQuestion
  // respondida com "Várias seções empilhadas, 1 por pasta"). Cada seção é
  // {id, label, caixa, pasta} — "caixa" decide a JQL usada pra achar
  // chamados novos (Solar/Tv, ver CACHE_PARTICOES em api/index.py),
  // "pasta" é o caminho de verdade lido/gravado (vazio = usa a pasta
  // padrão da caixa, decidida pelo servidor). Preferência de UI local (não
  // é credencial nem dado do Jira), então persiste em localStorage — mesmo
  // padrão do recolher de menu lá em cima. Começa com Solar + Tv (as 2
  // partições que já existem hoje); o usuário pode adicionar outras pastas
  // (ex.: uma cópia/backup) ou remover as padrão.
  const CACHE_SECOES_STORAGE_KEY = "mops-cache-secoes";
  const CACHE_SECOES_PADRAO = [
    { id: "solar", label: "Cache Solar", caixa: "solar", pasta: "" },
    { id: "tv", label: "Cache Tv", caixa: "tv", pasta: "" },
  ];

  function carregarSecoesCacheSalvas() {
    try {
      const bruto = localStorage.getItem(CACHE_SECOES_STORAGE_KEY);
      if (!bruto) return CACHE_SECOES_PADRAO.map((s) => ({ ...s }));
      const lista = JSON.parse(bruto);
      if (Array.isArray(lista) && lista.length) return lista;
    } catch (e) {
      // localStorage indisponível/corrompido — segue com o padrão (Solar + Tv).
    }
    return CACHE_SECOES_PADRAO.map((s) => ({ ...s }));
  }

  function salvarSecoesCache(secoes) {
    try {
      localStorage.setItem(
        CACHE_SECOES_STORAGE_KEY,
        JSON.stringify(secoes.map(({ id, label, caixa, pasta }) => ({ id, label, caixa, pasta })))
      );
    } catch (e) {
      // segue sem lembrar entre recarregamentos.
    }
  }

  let cacheSecoes = carregarSecoesCacheSalvas();

  // Monta o card de 1 seção (cabeçalho com nome editável + remover,
  // toolbar com Caixa/Pasta/Sincronizar tudo/Recarregar, status e tabela
  // própria) — tudo isolado em "secao.el" (nunca IDs globais), pra dar pra
  // ter várias seções na tela ao mesmo tempo sem uma pisar na outra.
  function construirSecaoCache(secao) {
    const card = document.createElement("div");
    card.className = "card cache-secao";

    const header = document.createElement("div");
    header.className = "cache-secao-header";

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "cache-secao-label-input";
    labelInput.value = secao.label;
    labelInput.addEventListener("change", () => {
      secao.label = labelInput.value.trim() || secao.label;
      labelInput.value = secao.label;
      salvarSecoesCache(cacheSecoes);
    });

    const btnRemover = document.createElement("button");
    btnRemover.type = "button";
    btnRemover.className = "btn-secondary cache-secao-remover";
    btnRemover.textContent = "✕ Remover";
    btnRemover.title = "Remover esta seção da tela (não apaga a pasta nem os arquivos)";
    btnRemover.addEventListener("click", () => {
      cacheSecoes = cacheSecoes.filter((s) => s.id !== secao.id);
      salvarSecoesCache(cacheSecoes);
      renderCacheSecoes();
    });

    header.append(labelInput, btnRemover);

    const toolbar = document.createElement("div");
    toolbar.className = "results-header cache-toolbar";
    toolbar.style.marginBottom = "10px";

    const caixaLabel = document.createElement("label");
    caixaLabel.className = "cache-particao-label";
    caixaLabel.append("Caixa: ");
    const caixaSelect = document.createElement("select");
    caixaSelect.className = "cache-caixa-select";
    [
      { id: "solar", nome: "Solar" },
      { id: "tv", nome: "Tv" },
    ].forEach(({ id, nome }) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = nome;
      caixaSelect.append(opt);
    });
    caixaSelect.value = secao.caixa;
    caixaLabel.append(caixaSelect);

    const pastaField = document.createElement("div");
    pastaField.className = "field cache-pasta-field";
    pastaField.style.marginBottom = "0";
    const pastaLabelEl = document.createElement("label");
    pastaLabelEl.textContent = "Pasta de origem";
    const pastaInputRow = document.createElement("div");
    pastaInputRow.className = "cache-pasta-input-row";
    const pastaInput = document.createElement("input");
    pastaInput.type = "text";
    pastaInput.value = secao.pasta || "";
    const btnEscolherPasta = document.createElement("button");
    btnEscolherPasta.type = "button";
    btnEscolherPasta.className = "btn-secondary";
    btnEscolherPasta.title = "Escolher pasta";
    btnEscolherPasta.textContent = "📁";
    pastaInputRow.append(pastaInput, btnEscolherPasta);
    pastaField.append(pastaLabelEl, pastaInputRow);

    const botoes = document.createElement("div");
    botoes.className = "cache-toolbar-botoes";
    const btnSincronizarTudo = document.createElement("button");
    btnSincronizarTudo.type = "button";
    btnSincronizarTudo.className = "btn-primary";
    btnSincronizarTudo.textContent = "⟳ Sincronizar tudo";
    const btnRecarregar = document.createElement("button");
    btnRecarregar.type = "button";
    btnRecarregar.className = "btn-secondary";
    btnRecarregar.textContent = "↻ Recarregar";
    botoes.append(btnSincronizarTudo, btnRecarregar);

    toolbar.append(caixaLabel, pastaField, botoes);

    const statusEl = document.createElement("div");
    statusEl.className = "hint";
    statusEl.style.marginBottom = "10px";

    const tableWrap = document.createElement("div");
    tableWrap.className = "table-wrap cache-table-wrap";
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Planilha", "Status", "Solar", "Prod", "Claro Tv", "Outros", ""].forEach((titulo) => {
      const th = document.createElement("th");
      th.textContent = titulo;
      headRow.append(th);
    });
    thead.append(headRow);
    const tbody = document.createElement("tbody");
    table.append(thead, tbody);
    tableWrap.append(table);

    card.append(header, toolbar, statusEl, tableWrap);

    secao.el = { card, labelInput, caixaSelect, pastaInput, btnEscolherPasta, btnSincronizarTudo, btnRecarregar, statusEl, tbody };
    secao.linhas = [];
    secao.pastasPadrao = {};

    // Trocar de caixa troca também a pasta exibida pra pasta PADRÃO
    // daquela caixa (o usuário ainda pode editar o campo depois, antes de
    // "Recarregar", se quiser apontar pra outro lugar).
    caixaSelect.addEventListener("change", () => {
      secao.caixa = caixaSelect.value;
      if (secao.pastasPadrao[secao.caixa]) {
        pastaInput.value = secao.pastasPadrao[secao.caixa];
        secao.pasta = pastaInput.value;
      }
      salvarSecoesCache(cacheSecoes);
      carregarSecaoCache(secao);
    });

    pastaInput.addEventListener("change", () => {
      secao.pasta = pastaInput.value.trim();
      salvarSecoesCache(cacheSecoes);
    });

    // Abre um seletor de pasta NATIVO do sistema operacional (tkinter, no
    // desktop de quem roda o servidor — só funciona localmente, ver
    // /api/cache/escolher-pasta em api/index.py) — preenche o campo com o
    // caminho escolhido e já recarrega a tabela. Cancelar o diálogo não
    // faz nada (pasta vem vazia, campo não é mexido).
    btnEscolherPasta.addEventListener("click", async () => {
      btnEscolherPasta.disabled = true;
      const textoOriginal = btnEscolherPasta.textContent;
      btnEscolherPasta.textContent = "...";
      statusEl.textContent = "Abrindo seletor de pasta (verifique a janela do servidor)...";
      try {
        const resp = await apiCall("/api/cache/escolher-pasta", { pasta: pastaInput.value.trim() });
        const data = await resp.json();
        if (!resp.ok) {
          statusEl.textContent = data.error || "Erro ao abrir o seletor de pasta.";
          return;
        }
        if (data.pasta) {
          pastaInput.value = data.pasta;
          secao.pasta = data.pasta;
          salvarSecoesCache(cacheSecoes);
          carregarSecaoCache(secao);
        } else {
          statusEl.textContent = "";
        }
      } catch (e) {
        statusEl.textContent = "Não foi possível conectar ao servidor.";
      } finally {
        btnEscolherPasta.disabled = false;
        btnEscolherPasta.textContent = textoOriginal;
      }
    });

    btnRecarregar.addEventListener("click", () => carregarSecaoCache(secao));
    btnSincronizarTudo.addEventListener("click", () => sincronizarTudoSecao(secao));

    return card;
  }

  function renderCacheTableSecao(secao, arquivos) {
    const { tbody } = secao.el;
    tbody.innerHTML = "";
    secao.linhas = [];

    if (!arquivos.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "hint";
      td.textContent = "Nenhuma planilha encontrada na pasta de cache.";
      tr.append(td);
      tbody.append(tr);
      return;
    }

    arquivos.forEach((arquivo) => {
      const tr = document.createElement("tr");

      const tdNome = document.createElement("td");
      tdNome.textContent = arquivo.nome;

      const tdStatus = document.createElement("td");
      tdStatus.textContent = cacheStatusTexto(arquivo.sincronizado_em);

      const tdsCaixas = {};
      CACHE_CAIXA_COLUNAS.forEach((caixaId) => {
        tdsCaixas[caixaId] = document.createElement("td");
      });
      preencherCelulasCaixas(tdsCaixas, arquivo.abertos === null || arquivo.abertos === undefined ? null : arquivo.abertos_por_caixa);

      const tdAcao = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary";
      btn.textContent = "Sincronizar";
      btn.addEventListener("click", () => sincronizarSecaoCache(secao, arquivo.nome, tdStatus, tdsCaixas, btn));
      tdAcao.append(btn);

      tr.append(tdNome, tdStatus, ...CACHE_CAIXA_COLUNAS.map((c) => tdsCaixas[c]), tdAcao);
      tbody.append(tr);

      secao.linhas.push({ nome: arquivo.nome, tdStatus, tdsCaixas, btn });
    });
  }

  async function carregarSecaoCache(secao) {
    const { statusEl, pastaInput } = secao.el;
    statusEl.classList.add("is-loading");
    statusEl.textContent = "Carregando planilhas...";
    try {
      const pasta = pastaInput.value.trim();
      const resp = await apiCall("/api/cache/arquivos", { caixa: secao.caixa, pasta });
      const data = await resp.json();
      statusEl.classList.remove("is-loading");
      if (!resp.ok) {
        statusEl.textContent = data.error || "Erro ao listar a pasta de cache.";
        secao.el.tbody.innerHTML = "";
        return;
      }
      (data.caixas || []).forEach(({ id, pasta_padrao: pastaPadrao }) => {
        secao.pastasPadrao[id] = pastaPadrao;
      });
      if (!pastaInput.value) {
        pastaInput.value = data.pasta;
      }
      secao.pasta = pastaInput.value;
      salvarSecoesCache(cacheSecoes);
      renderCacheTableSecao(secao, data.arquivos || []);
      statusEl.textContent = "";
    } catch (e) {
      statusEl.classList.remove("is-loading");
      statusEl.textContent = "Não foi possível conectar ao servidor.";
    }
  }

  function renderCacheSecoes() {
    const container = $("cache-secoes");
    container.innerHTML = "";
    cacheSecoes.forEach((secao) => {
      container.append(construirSecaoCache(secao));
      carregarSecaoCache(secao);
    });
  }

  // Espelha CACHE_SYNC_LOTE em api/index.py — nº de chamados (sempre pelo
  // número do chamado, INC-xxxxxx/PDST-xxxxxx, nunca a planilha inteira de
  // uma vez) por chamada a /api/cache/sincronizar-lote, pra não pesar a
  // API do Jira. Quem decide o tamanho de fato é o servidor (devolvido por
  // sincronizar-preparar); isso aqui é só o valor esperado, pra montar os
  // lotes do mesmo tamanho sem precisar de mais uma ida ao servidor.
  const CACHE_SYNC_LOTE = 150;

  function dividirEmLotes(itens, tamanho) {
    const lotes = [];
    for (let i = 0; i < itens.length; i += tamanho) {
      lotes.push(itens.slice(i, i + tamanho));
    }
    return lotes;
  }

  // Sincronização em lotes, pra não jogar uma planilha inteira (pode
  // passar de 1500 chamados) numa única requisição pesada: 1) preparar
  // devolve a lista de chamados que precisam de alguma consulta ao Jira
  // (status/Violado/Já foi Reaberto/Data de Resolução) e já migra as
  // colunas se faltarem;
  // 2) um lote de cada vez (sincronizar-lote) processa até CACHE_SYNC_LOTE
  // chamados, e o botão da própria linha mostra o progresso (ex.: "03/10")
  // conforme cada lote volta; 3) finalizar busca os chamados novos criados
  // desde a última sincronização e fecha a planilha.
  // "pularSeVazio": usado só pelo "Sincronizar tudo" (ver sincronizarTudo)
  // — se "preparar" devolver 0 entradas pendentes (nenhum chamado bate com
  // a regra de conferência: nem aberto, nem fechado há pouco, nem
  // faltando Violado/Reaberto/Resolução), pula esse arquivo inteiro (nem
  // o passo "finalizar" roda), sem gastar tempo/chamadas de API num mês
  // que não tem nada pra conferir. O botão individual "Sincronizar" de
  // cada linha continua sempre rodando os 3 passos (inclusive buscar
  // chamados novos), mesmo com 0 pendentes — só "Sincronizar tudo" pula.
  async function sincronizarSecaoCache(secao, nome, tdStatus, tdsCaixas, btn, pularSeVazio = false) {
    btn.disabled = true;
    const textoOriginal = btn.textContent;
    const statusEl = secao.el.statusEl;
    const pasta = secao.el.pastaInput.value.trim();
    statusEl.textContent = `Preparando "${nome}"...`;
    btn.textContent = "Preparando...";

    try {
      const prepResp = await apiCall("/api/cache/sincronizar-preparar", { nome, caixa: secao.caixa, pasta });
      const prep = await prepResp.json();
      if (!prepResp.ok) {
        statusEl.textContent = prep.error || `Erro ao preparar "${nome}".`;
        return;
      }

      if (pularSeVazio && prep.entradas.length === 0) {
        statusEl.textContent = `"${nome}": nada dentro da regra de conferência, pulado.`;
        return;
      }

      const lotes = dividirEmLotes(prep.entradas, prep.lote || CACHE_SYNC_LOTE);
      const totalPasso = lotes.length + 1; // +1 do passo "finalizar"
      const digitos = String(totalPasso).length;
      const rotuloPasso = (atual) => `${String(atual).padStart(digitos, "0")}/${totalPasso}`;

      let atualizados = 0;
      for (let i = 0; i < lotes.length; i++) {
        btn.textContent = rotuloPasso(i + 1);
        statusEl.textContent = `Sincronizando "${nome}": lote ${rotuloPasso(i + 1)}...`;
        const resp = await apiCall("/api/cache/sincronizar-lote", {
          nome,
          entradas: lotes[i],
          caixa: secao.caixa,
          pasta,
        });
        const data = await resp.json();
        if (!resp.ok) {
          statusEl.textContent = data.error || `Erro ao sincronizar "${nome}".`;
          return;
        }
        atualizados += data.atualizados;
      }

      btn.textContent = rotuloPasso(totalPasso);
      statusEl.textContent = `Sincronizando "${nome}": buscando chamados novos...`;
      const finalResp = await apiCall("/api/cache/sincronizar-finalizar", { nome, caixa: secao.caixa, pasta });
      const data = await finalResp.json();
      if (!finalResp.ok) {
        statusEl.textContent = data.error || `Erro ao sincronizar "${nome}".`;
        return;
      }

      tdStatus.textContent = cacheStatusTexto(data.sincronizado_em);
      preencherCelulasCaixas(tdsCaixas, data.abertos_por_caixa);
      statusEl.textContent = `"${nome}": ${prep.entradas.length} verificado(s), ${atualizados} atualizado(s), ${data.novos} novo(s).`;
    } catch (e) {
      statusEl.textContent = "Não foi possível conectar ao servidor.";
    } finally {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
  }

  // "Sincronizar tudo" (de 1 seção): roda sincronizarSecaoCache de cada
  // planilha DAQUELA seção, uma de cada vez — espera o arquivo atual
  // terminar (3 passos: preparar, cada lote, finalizar) antes de começar o
  // próximo, nunca em paralelo (pedido explícito do usuário: "respeitando
  // a execução de cada um"). Desabilita o botão "Sincronizar" de toda
  // linha da seção enquanto roda, pra evitar um clique avulso disparar a
  // mesma planilha 2 vezes ao mesmo tempo. "pularSeVazio" (ver
  // sincronizarSecaoCache): só processa de verdade os meses com pelo
  // menos 1 chamado dentro da regra de conferência — os demais são
  // pulados (nem passam pelo "finalizar"). Cada seção tem seu próprio
  // botão/estado — sincronizar uma não afeta as outras.
  async function sincronizarTudoSecao(secao) {
    const btnTudo = secao.el.btnSincronizarTudo;
    const textoOriginal = btnTudo.textContent;
    const linhas = secao.linhas;
    if (!linhas.length) return;

    btnTudo.disabled = true;
    linhas.forEach(({ btn }) => {
      btn.disabled = true;
    });

    for (let i = 0; i < linhas.length; i++) {
      const { nome, tdStatus, tdsCaixas, btn } = linhas[i];
      btnTudo.textContent = `Sincronizando ${i + 1}/${linhas.length}...`;
      await sincronizarSecaoCache(secao, nome, tdStatus, tdsCaixas, btn, true);
    }

    btnTudo.disabled = false;
    btnTudo.textContent = textoOriginal;
  }

  $("btn-cache").addEventListener("click", () => {
    closeAllDialogs();
    $("cache-results").classList.remove("hidden");
    renderCacheSecoes();
  });

  // "+ Adicionar pasta": registra uma nova seção vazia (Solar por padrão,
  // sem pasta própria ainda — o usuário edita o nome/caixa/pasta direto no
  // card recém-criado) e persiste a lista inteira.
  $("btn-cache-adicionar-secao").addEventListener("click", () => {
    cacheSecoes.push({
      id: `secao-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: "Nova pasta",
      caixa: "solar",
      pasta: "",
    });
    salvarSecoesCache(cacheSecoes);
    renderCacheSecoes();
  });

  // "Pareto Solar": diagrama de Pareto clássico (barras de frequência +
  // linha de % acumulado em 2º eixo) — modelo pedido explicitamente pelo
  // usuário (imagem de referência). Em SVG puro (sem lib de gráfico: é só
  // barra + linha + 2 eixos, não justifica uma dependência nova).

  // Arredonda o teto do eixo esquerdo (frequência) pra um valor "redondo"
  // (1/2/5 × potência de 10) — mesma lógica de qualquer lib de gráfico,
  // senão a grade fica em números quebrados tipo 0/73.4/146.8/....
  function paretoEixoMax(valor) {
    if (valor <= 0) return 10;
    const grandeza = Math.pow(10, Math.floor(Math.log10(valor)));
    const normalizado = valor / grandeza;
    let passo;
    if (normalizado <= 1) passo = 1;
    else if (normalizado <= 2) passo = 2;
    else if (normalizado <= 5) passo = 5;
    else passo = 10;
    return passo * grandeza;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  }

  // Nome completo só aparece no hover da barra (popover flutuante, ver
  // showParetoPopover) — o rótulo do eixo X é sempre truncado num tamanho
  // fixo de caracteres pra caber no slot sem invadir o vizinho (categoria
  // pode ter nome bem longo).
  const PARETO_X_LABEL_MAX_CHARS = 18;

  function truncarCategoria(nome) {
    if (!nome || nome.length <= PARETO_X_LABEL_MAX_CHARS) return nome || "";
    return `${nome.slice(0, PARETO_X_LABEL_MAX_CHARS - 1)}…`;
  }

  function construirParetoChart(categorias, onBarClick) {
    const holder = document.createElement("div");
    holder.className = "pareto-chart-holder";

    if (!categorias.length) {
      const vazio = document.createElement("span");
      vazio.className = "hint";
      vazio.textContent = "Nenhum chamado classificado no período.";
      holder.append(vazio);
      return holder;
    }

    const n = categorias.length;
    const slotW = 92;
    const marginLeft = 50;
    const marginRight = 50;
    const marginTop = 24;
    const marginBottom = 96;
    const chartW = n * slotW;
    const chartH = 240;
    const width = marginLeft + chartW + marginRight;
    const height = marginTop + chartH + marginBottom;

    // "Outros" pode ser maior que a 1ª categoria individual (soma de
    // dezenas delas) — não dá pra assumir categorias[0] como o maior.
    const eixoMax = paretoEixoMax(Math.max(...categorias.map((c) => c.quantidade)));
    const yEsq = (qtd) => marginTop + chartH - (qtd / eixoMax) * chartH;
    const yDir = (pct) => marginTop + chartH - (Math.min(pct, 100) / 100) * chartH;

    const svg = svgEl("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      class: "pareto-chart-svg",
    });

    // Grade horizontal + rótulos dos 2 eixos (esquerdo: frequência,
    // direito: % acumulado), sempre nas mesmas 5 faixas (0/20/40/60/80/100%
    // do teto de cada eixo).
    const PASSOS = 5;
    for (let i = 0; i <= PASSOS; i++) {
      const frac = i / PASSOS;
      const y = marginTop + chartH - frac * chartH;
      svg.append(svgEl("line", { x1: marginLeft, x2: marginLeft + chartW, y1: y, y2: y, class: "pareto-grid-line" }));

      const labelEsq = svgEl("text", { x: marginLeft - 8, y: y + 4, class: "pareto-axis-label", "text-anchor": "end" });
      labelEsq.textContent = Math.round(eixoMax * frac);
      svg.append(labelEsq);

      const labelDir = svgEl("text", { x: marginLeft + chartW + 8, y: y + 4, class: "pareto-axis-label" });
      labelDir.textContent = `${Math.round(frac * 100)}%`;
      svg.append(labelDir);
    }

    // Barras (frequência), rótulo da quantidade em cima de cada uma, e os
    // pontos da linha de % acumulado (desenhada depois, por cima das
    // barras — mesma ordem do modelo de referência).
    const pontosLinha = [];
    const barLabelYs = [];
    categorias.forEach((item, i) => {
      const cx = marginLeft + i * slotW + slotW / 2;
      const barW = slotW * 0.62;
      const barY = yEsq(item.quantidade);
      const tooltip = `${item.categoria} — ${item.quantidade} (${item.percentual}%)`;

      const barEl = svgEl("rect", {
        x: cx - barW / 2,
        y: barY,
        width: barW,
        height: marginTop + chartH - barY,
        class: "pareto-bar",
      });
      barEl.addEventListener("mouseenter", () => {
        cancelHoverPopoverHide();
        showParetoPopover(barEl, tooltip);
      });
      barEl.addEventListener("mouseleave", scheduleHoverPopoverHide);
      if (onBarClick) {
        barEl.addEventListener("click", () => onBarClick(item));
      }
      svg.append(barEl);

      const labelQtdY = barY - 6;
      barLabelYs.push(labelQtdY);
      const labelQtd = svgEl("text", { x: cx, y: labelQtdY, class: "pareto-bar-label", "text-anchor": "middle" });
      labelQtd.textContent = item.quantidade;
      svg.append(labelQtd);

      pontosLinha.push([cx, yDir(item.percentual_acumulado)]);

      // Nome da categoria rotacionado, truncado (nome completo só na
      // barra, via "tooltip" acima) — sem truncar, nome grande passava por
      // cima do slot vizinho.
      const labelX = svgEl("text", {
        x: cx,
        y: marginTop + chartH + 16,
        class: "pareto-x-label",
        "text-anchor": "end",
        transform: `rotate(-40 ${cx} ${marginTop + chartH + 16})`,
      });
      labelX.textContent = truncarCategoria(item.categoria);
      svg.append(labelX);
    });

    const pathD = pontosLinha.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
    svg.append(svgEl("path", { d: pathD, class: "pareto-line" }));
    categorias.forEach((item, i) => {
      const [x, y] = pontosLinha[i];
      svg.append(svgEl("circle", { cx: x, cy: y, r: 4, class: "pareto-line-dot" }));
      // O ponto da linha (eixo da direita) pode cair bem na altura do
      // rótulo da barra daquele mesmo slot (eixo da esquerda) — são
      // escalas independentes, a coincidência é normal. Quando chega
      // perto, desce o rótulo do % pra baixo do ponto em vez de cima,
      // senão os dois textos ficam um em cima do outro.
      const labelPctYAcima = y - 10;
      const colide = Math.abs(labelPctYAcima - barLabelYs[i]) < 14;
      const labelPctY = colide ? y + 14 : labelPctYAcima;
      const labelPct = svgEl("text", { x, y: labelPctY, class: "pareto-line-label", "text-anchor": "middle" });
      labelPct.textContent = `${item.percentual_acumulado}%`;
      svg.append(labelPct);
    });

    svg.append(
      svgEl("line", {
        x1: marginLeft,
        x2: marginLeft + chartW,
        y1: marginTop + chartH,
        y2: marginTop + chartH,
        class: "pareto-axis-line",
      })
    );

    const scrollWrap = document.createElement("div");
    scrollWrap.className = "table-wrap pareto-chart-scroll";
    scrollWrap.append(svg);
    holder.append(scrollWrap);

    const legend = document.createElement("div");
    legend.className = "pareto-legend";
    legend.innerHTML =
      '<span class="pareto-legend-item"><span class="pareto-legend-swatch pareto-legend-swatch--bar"></span>Frequência</span>' +
      '<span class="pareto-legend-item"><span class="pareto-legend-swatch pareto-legend-swatch--line"></span>Acumulado</span>';
    holder.append(legend);

    return holder;
  }

  // Seletor de mês (<select> + conteúdo do mês escolhido, dentro de um
  // único ".card" estático no HTML — ver pareto-*-mes-select/-track em
  // index.html) — reaproveitado pelos 4 gráficos do Pareto Solar
  // (Classificação, Categoria de Encerramento, Categoria de Encerramento
  // só reabertos, Fornecedor Responsável), cada um com seu próprio
  // <select>/card (fechado nesta factory, não precisa de 4 jogos de
  // variável solto no escopo do módulo). "obterTitulo"/"obterCardsEl"/
  // "onBarClick" de cada chamada ficam guardados aqui (via closure) pra
  // reaproveitar na troca do <select> sem precisar passar tudo de novo.
  //
  // O <select> é irmão de "track" dentro do ".card" (não filho) —
  // "track.innerHTML = ''" abaixo só limpa o conteúdo do mês anterior,
  // nunca toca no <select> (ele precisa sobreviver a cada re-render pra
  // não perder o listener de "change").
  function criarParetoSeletorMes(ids) {
    const track = $(ids.track);
    const selectEl = $(ids.select);
    let meses = [];
    let obterTitulo = null;
    let obterCardsEl = null;
    let onBarClick = null;

    // "ids.titulo" (nome da seção — "Classificação", "Categoria de
    // Encerramento" etc.) é o título grande; o que antes era o título
    // (mês/total) sai pequeno, no canto esquerdo (pedido explícito do
    // usuário).
    function renderizarSlide() {
      track.innerHTML = "";
      const mesPayload = meses[selectEl.selectedIndex];
      if (!mesPayload) return;

      const slide = document.createElement("div");
      slide.className = "pareto-carousel-slide";

      const tituloSecao = document.createElement("div");
      tituloSecao.className = "pareto-titulo-destaque";
      tituloSecao.textContent = ids.titulo;
      slide.append(tituloSecao);

      const subtitle = document.createElement("div");
      subtitle.className = "pareto-subtitulo-info";
      subtitle.textContent = obterTitulo(mesPayload);
      slide.append(subtitle);

      const chart = construirParetoChart(
        mesPayload.categorias,
        onBarClick ? (item) => onBarClick(mesPayload, item) : null
      );
      if (obterCardsEl) {
        const row = document.createElement("div");
        row.className = "pareto-slide-row";
        row.append(obterCardsEl(mesPayload), chart);
        slide.append(row);
      } else {
        slide.append(chart);
      }
      track.append(slide);
    }

    selectEl.addEventListener("change", renderizarSlide);

    // "obterTitulo" monta o texto do subtítulo (varia o que entre
    // parênteses: "classificados" vs. "categorizados"). "obterCardsEl" é
    // opcional — só "Categoria de Encerramento (só reabertos)" usa, pra
    // colocar os cards de Quantidade/Percentual de abertura do lado
    // esquerdo do gráfico. "onBarClick" é opcional — só "Classificação"
    // usa, pro drill-down de Sub-Classificação (popup) ao clicar numa
    // barra. Mês mais recente (último do array) começa selecionado.
    function renderizar(novosMeses, novoObterTitulo, novoObterCardsEl, novoOnBarClick) {
      meses = novosMeses;
      obterTitulo = novoObterTitulo;
      obterCardsEl = novoObterCardsEl;
      onBarClick = novoOnBarClick;

      selectEl.innerHTML = "";
      meses.forEach((mesPayload, i) => {
        const option = document.createElement("option");
        option.value = i;
        option.textContent = formatarMesAno(mesPayload.mes);
        selectEl.append(option);
      });
      selectEl.selectedIndex = meses.length - 1;
      renderizarSlide();
    }

    return { renderizar };
  }

  const paretoClassificacaoCarousel = criarParetoSeletorMes({
    track: "pareto-solar-track",
    select: "pareto-solar-mes-select",
    titulo: "Classificação",
  });
  const paretoCategoriaCarousel = criarParetoSeletorMes({
    track: "pareto-categoria-track",
    select: "pareto-categoria-mes-select",
    titulo: "Categoria de Encerramento",
  });
  const paretoReabertoCarousel = criarParetoSeletorMes({
    track: "pareto-reaberto-track",
    select: "pareto-reaberto-mes-select",
    titulo: "Categoria de Encerramento (Só Reabertos)",
  });
  const paretoFornecedorCarousel = criarParetoSeletorMes({
    track: "pareto-fornecedor-track",
    select: "pareto-fornecedor-mes-select",
    titulo: "Fornecedor Responsável (Aguardando Fornecedor)",
  });

  function paretoTituloMes(sufixo) {
    return (mesPayload) =>
      `${formatarMesAno(mesPayload.mes)} — ${mesPayload.total_chamados} encerrados` +
      ` (${mesPayload.total_categorizados} ${sufixo})`;
  }

  // "Fornecedor Responsável" não é sobre encerrados — é quem está
  // ATUALMENTE "Aguardando Fornecedor", então o subtítulo é outro (sem
  // "encerrados"/"categorizados", que não fazem sentido aqui).
  function paretoTituloMesFornecedor(mesPayload) {
    return `${formatarMesAno(mesPayload.mes)} — ${mesPayload.total_chamados} aguardando fornecedor`;
  }

  // Cards do lado esquerdo do carrossel "Categoria de Encerramento (só
  // reabertos)" — "Quantidade Total" é todo chamado CRIADO naquele mês
  // (INC, N1/N2 Solar, resolvido ou não: os 100% da conta); "Reabertos" é
  // o subconjunto que já foi reaberto em algum momento; "Percentual de
  // abertura" é esse subconjunto sobre os 100% acima (não sobre os
  // encerrados/categorizados do gráfico ao lado).
  function construirParetoReabertoCards(mesPayload) {
    const wrap = document.createElement("div");
    wrap.className = "summary-cards pareto-slide-cards";
    wrap.append(
      summaryCard(mesPayload.criados_no_mes, "Quantidade Total", "tone-accent"),
      summaryCard(mesPayload.reabertos_no_mes, "Reabertos", "tone-danger"),
      summaryCard(`${mesPayload.percentual_reabertura}%`, "Percentual de abertura", "tone-warning")
    );
    return wrap;
  }

  // Popup de drill-down — clicar numa barra do gráfico "Classificação"
  // abre um Pareto só daquela Classificação, no mesmo mês, com um
  // carrossel de 3 cards (mesma Classificação/mês, só troca o que conta
  // como barra) — espelha PARETO_SOLAR_DRILLDOWN_CAMPOS no backend. Os 3
  // já são buscados em paralelo na abertura (dado pequeno, 1 Classificação
  // só) — diferente do carrossel de mês da tela de trás, que troca de
  // requisição a cada navegação.
  const PARETO_SUB_MODAL_CAMPOS = [
    { campo: "subclassificacao", label: "Sub-Classificação" },
    { campo: "eps", label: "PROP_Site" },
    { campo: "categoria", label: "Categoria de Encerramento" },
  ];

  let paretoSubModalIndex = 0;

  function atualizarParetoSubModalCarousel() {
    const track = $("pareto-sub-modal-track");
    const total = track.children.length;
    track.style.transform = `translateX(-${paretoSubModalIndex * 100}%)`;
    $("pareto-sub-modal-prev").disabled = paretoSubModalIndex === 0;
    $("pareto-sub-modal-next").disabled = paretoSubModalIndex >= total - 1;
    Array.from($("pareto-sub-modal-dots").children).forEach((dot, i) => {
      dot.classList.toggle("active", i === paretoSubModalIndex);
    });
  }

  $("pareto-sub-modal-prev").addEventListener("click", () => {
    if (paretoSubModalIndex > 0) {
      paretoSubModalIndex -= 1;
      atualizarParetoSubModalCarousel();
    }
  });
  $("pareto-sub-modal-next").addEventListener("click", () => {
    if (paretoSubModalIndex < $("pareto-sub-modal-track").children.length - 1) {
      paretoSubModalIndex += 1;
      atualizarParetoSubModalCarousel();
    }
  });

  async function abrirParetoSubModal(mesPayload, item) {
    const mes = mesPayload.mes;
    const classificacao = item.categoria;
    const track = $("pareto-sub-modal-track");
    const dotsEl = $("pareto-sub-modal-dots");
    const statusEl = $("pareto-sub-modal-status");

    $("pareto-sub-modal-title").textContent = `Classificação: ${classificacao} (${formatarMesAno(mes)})`;
    track.innerHTML = "";
    dotsEl.innerHTML = "";
    statusEl.textContent = "Carregando...";
    $("pareto-sub-modal").classList.remove("hidden");

    try {
      const respostas = await Promise.all(
        PARETO_SUB_MODAL_CAMPOS.map(({ campo }) => apiCall("/api/pareto-solar-subclassificacao", { mes, classificacao, campo }))
      );
      const dados = await Promise.all(respostas.map((resp) => resp.json()));

      const comErro = respostas.findIndex((resp) => !resp.ok);
      if (comErro !== -1) {
        statusEl.textContent = dados[comErro].error || "Erro ao carregar.";
        return;
      }
      statusEl.textContent = "";

      PARETO_SUB_MODAL_CAMPOS.forEach(({ label }, i) => {
        const data = dados[i];
        const slide = document.createElement("div");
        slide.className = "pareto-sub-modal-slide";

        const titulo = document.createElement("div");
        titulo.className = "pareto-titulo-destaque";
        titulo.textContent = label;
        slide.append(titulo);

        const info = document.createElement("div");
        info.className = "pareto-subtitulo-info";
        info.textContent = `${data.total_chamados} chamados (${data.total_categorizados} com ${label})`;
        slide.append(info, construirParetoChart(data.categorias));
        track.append(slide);

        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "pareto-sub-modal-dot";
        dot.setAttribute("aria-label", label);
        dot.addEventListener("click", () => {
          paretoSubModalIndex = i;
          atualizarParetoSubModalCarousel();
        });
        dotsEl.append(dot);
      });

      paretoSubModalIndex = 0;
      atualizarParetoSubModalCarousel();
    } catch (e) {
      statusEl.textContent = "Não foi possível conectar ao servidor.";
    }
  }

  function fecharParetoSubModal() {
    $("pareto-sub-modal").classList.add("hidden");
  }

  $("btn-pareto-sub-modal-fechar").addEventListener("click", fecharParetoSubModal);
  $("pareto-sub-modal").addEventListener("click", (e) => {
    if (e.target.id === "pareto-sub-modal") fecharParetoSubModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("pareto-sub-modal").classList.contains("hidden")) fecharParetoSubModal();
  });

  async function carregarParetoSolar() {
    const statusEl = $("pareto-solar-status");
    statusEl.textContent = "Carregando...";

    try {
      const resp = await apiCall("/api/pareto-solar", {});
      const data = await resp.json();
      if (!resp.ok) {
        statusEl.textContent = data.error || "Erro ao carregar.";
        return;
      }
      statusEl.textContent = "";
      paretoClassificacaoCarousel.renderizar(
        data.classificacao.meses,
        paretoTituloMes("classificados"),
        null,
        abrirParetoSubModal
      );
      paretoCategoriaCarousel.renderizar(data.categoria.meses, paretoTituloMes("categorizados"));
      paretoReabertoCarousel.renderizar(
        data.categoria_reaberto.meses,
        paretoTituloMes("categorizados"),
        construirParetoReabertoCards
      );
    } catch (e) {
      statusEl.textContent = "Não foi possível conectar ao servidor.";
    }
  }

  // Único dos 4 carrosséis que consulta o Jira na hora (precisa saber quem
  // está ATUALMENTE "Aguardando Fornecedor" — não dá pra reconstruir do
  // cache) — status/erro à parte dos outros 3, pra uma falha aqui (ou
  // demora) não travar/confundir com o restante, que é só cache local.
  async function carregarParetoSolarFornecedor() {
    const statusEl = $("pareto-fornecedor-status");
    statusEl.textContent = "Carregando...";

    try {
      const resp = await apiCall("/api/pareto-solar-fornecedor", {});
      const data = await resp.json();
      if (!resp.ok) {
        statusEl.textContent = data.error || "Erro ao carregar.";
        return;
      }
      statusEl.textContent = "";
      paretoFornecedorCarousel.renderizar(data.meses, paretoTituloMesFornecedor);
    } catch (e) {
      statusEl.textContent = "Não foi possível conectar ao servidor.";
    }
  }

  $("btn-pareto-solar").addEventListener("click", () => {
    closeAllDialogs();
    $("pareto-solar-results").classList.remove("hidden");
    carregarParetoSolar();
    carregarParetoSolarFornecedor();
  });

  $("btn-pareto-solar-recarregar").addEventListener("click", () => {
    carregarParetoSolar();
    carregarParetoSolarFornecedor();
  });

  // ------------------------------------------------------- Material ICG
  // FCA's (Fato/Causa/Ação) — pedido explícito do usuário: lista alternada
  // de "dias de apresentação"; abrindo um dia, adiciona-se 1 FCA por
  // indicador, e cada FCA é uma ÁRVORE (Fato -> Causas -> Ações). Tudo
  // salvo no SQLite local (ver MATERIAL_ICG_FCA_DB em api/index.py): criar
  // e excluir redesenham a lista com a resposta do servidor; o texto de
  // cada nó é salvo ao sair do campo, sem redesenhar (não perde o foco).
  const ICG_DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const ICG_FCA_TIPOS = {
    fato: { rotulo: "Fato", filho: "causa" },
    causa: { rotulo: "Causa", filho: "acao" },
    acao: { rotulo: "Ação", filho: null },
  };
  let icgFcaIndicadores = {};
  const icgFcaMesesAbertos = new Set();
  const icgFcaDiasAbertos = new Set();
  // Saves de texto em andamento — criar/excluir espera eles terminarem,
  // senão a lista redesenhada podia vir do servidor sem o texto recém-
  // digitado (blur dispara o save, o clique logo em seguida o redesenho).
  let icgFcaSalvamentosPendentes = Promise.resolve();

  async function icgFcaChamar(path, body) {
    const statusEl = $("material-icg-fca-status");
    try {
      const resp = await apiCall(path, body);
      const data = await resp.json();
      if (!resp.ok) {
        statusEl.textContent = data.error || "Erro ao salvar o FCA.";
        return null;
      }
      statusEl.textContent = "";
      return data;
    } catch (e) {
      statusEl.textContent = "Não foi possível conectar ao servidor.";
      return null;
    }
  }

  async function icgFcaMutar(path, body) {
    await icgFcaSalvamentosPendentes;
    const data = await icgFcaChamar(path, body);
    if (data) renderizarIcgFcas(data);
  }

  async function carregarIcgFcas() {
    const data = await icgFcaChamar("/api/material-icg/fca/listar", {});
    if (data) renderizarIcgFcas(data);
  }

  function icgFcaRotuloDia(dataIso) {
    const [ano, mes, dia] = dataIso.split("-").map(Number);
    return `${formatarDataBR(dataIso)} — ${ICG_DIAS_SEMANA[new Date(ano, mes - 1, dia).getDay()]}`;
  }

  function icgFcaBotao(texto, classe, titulo, aoClicar) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = classe;
    btn.textContent = texto;
    if (titulo) btn.title = titulo;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      aoClicar();
    });
    return btn;
  }

  function renderizarIcgFcas(dados) {
    icgFcaIndicadores = dados.indicadores || {};
    const lista = $("material-icg-fca-lista");
    lista.innerHTML = "";
    if (!dados.meses.length) {
      const vazio = document.createElement("p");
      vazio.className = "hint";
      vazio.textContent = "Nenhum mês ainda — escolha o mês acima e clique em \"Adicionar mês\".";
      lista.append(vazio);
      return;
    }
    dados.meses.forEach((mes) => lista.append(construirIcgFcaMes(mes)));
  }

  // Nível "Mês" (pedido explícito do usuário: Mês -> Dia -> FCA's). Abre
  // igual ao dia; dentro, "Dia da apresentação" (só datas desse mês) +
  // a lista alternada dos dias.
  function construirIcgFcaMes(mes) {
    const item = document.createElement("div");
    item.className = "icg-fca-dia icg-fca-mes";
    item.classList.toggle("aberto", icgFcaMesesAbertos.has(mes.id));

    const cabecalho = document.createElement("div");
    cabecalho.className = "icg-fca-dia-cabecalho";
    const titulo = document.createElement("span");
    titulo.className = "icg-fca-dia-titulo";
    titulo.textContent = formatarMesAno(mes.mes);
    const contagem = document.createElement("span");
    contagem.className = "icg-fca-dia-contagem";
    const qtd = mes.apresentacoes.length;
    contagem.textContent = qtd === 1 ? "1 dia" : `${qtd} dias`;
    const excluir = icgFcaBotao("Excluir mês", "icg-fca-btn-excluir", "Excluir o mês e tudo dentro dele", () => {
      if (!window.confirm(`Excluir ${formatarMesAno(mes.mes)} com todos os dias e FCA's dele?`)) return;
      icgFcaMesesAbertos.delete(mes.id);
      icgFcaMutar("/api/material-icg/fca/mes/excluir", { id: mes.id });
    });
    cabecalho.append(titulo, contagem, excluir);
    cabecalho.addEventListener("click", () => {
      const abrindo = !item.classList.contains("aberto");
      item.classList.toggle("aberto", abrindo);
      if (abrindo) icgFcaMesesAbertos.add(mes.id);
      else icgFcaMesesAbertos.delete(mes.id);
    });

    const corpo = document.createElement("div");
    corpo.className = "icg-fca-dia-corpo";

    const adicionar = document.createElement("div");
    adicionar.className = "icg-fca-adicionar";
    const rotuloData = document.createElement("label");
    rotuloData.className = "home-caixa-filtro-label";
    rotuloData.textContent = "Dia da apresentação";
    const inputData = document.createElement("input");
    inputData.type = "date";
    inputData.className = "icg-fca-input-data";
    const [ano, mesNum] = mes.mes.split("-").map(Number);
    inputData.min = `${mes.mes}-01`;
    inputData.max = `${mes.mes}-${String(new Date(ano, mesNum, 0).getDate()).padStart(2, "0")}`;
    const btnAdicionar = icgFcaBotao("Adicionar dia", "btn-secondary", null, async () => {
      if (!inputData.value) {
        $("material-icg-fca-status").textContent = "Escolha o dia da apresentação.";
        return;
      }
      await icgFcaSalvamentosPendentes;
      const data = await icgFcaChamar("/api/material-icg/fca/apresentacao/criar", { mes_id: mes.id, data: inputData.value });
      if (!data) return;
      // Já abre o dia recém-criado, pronto pra adicionar FCA.
      const mesAtualizado = data.meses.find((m) => m.id === mes.id);
      const criado = mesAtualizado && mesAtualizado.apresentacoes.find((a) => a.data === inputData.value);
      if (criado) icgFcaDiasAbertos.add(criado.id);
      renderizarIcgFcas(data);
    });
    adicionar.append(rotuloData, inputData, btnAdicionar);
    corpo.append(adicionar);

    if (mes.apresentacoes.length) {
      const dias = document.createElement("div");
      dias.className = "icg-fca-lista";
      mes.apresentacoes.forEach((apresentacao) => dias.append(construirIcgFcaDia(apresentacao)));
      corpo.append(dias);
    } else {
      const vazio = document.createElement("p");
      vazio.className = "hint icg-fca-vazio";
      vazio.textContent = "Nenhum dia nesse mês ainda.";
      corpo.append(vazio);
    }

    item.append(cabecalho, corpo);
    return item;
  }

  function construirIcgFcaDia(apresentacao) {
    const dia = document.createElement("div");
    dia.className = "icg-fca-dia";
    dia.classList.toggle("aberto", icgFcaDiasAbertos.has(apresentacao.id));

    const cabecalho = document.createElement("div");
    cabecalho.className = "icg-fca-dia-cabecalho";
    const titulo = document.createElement("span");
    titulo.className = "icg-fca-dia-titulo";
    titulo.textContent = icgFcaRotuloDia(apresentacao.data);
    const contagem = document.createElement("span");
    contagem.className = "icg-fca-dia-contagem";
    const qtd = apresentacao.fcas.length;
    contagem.textContent = qtd === 1 ? "1 FCA" : `${qtd} FCA's`;
    const excluir = icgFcaBotao("Excluir dia", "icg-fca-btn-excluir", "Excluir o dia e todos os FCA's dele", () => {
      if (!window.confirm(`Excluir o dia ${formatarDataBR(apresentacao.data)} e todos os FCA's dele?`)) return;
      icgFcaDiasAbertos.delete(apresentacao.id);
      icgFcaMutar("/api/material-icg/fca/apresentacao/excluir", { id: apresentacao.id });
    });
    cabecalho.append(titulo, contagem, excluir);
    cabecalho.addEventListener("click", () => {
      const abrindo = !dia.classList.contains("aberto");
      dia.classList.toggle("aberto", abrindo);
      if (abrindo) icgFcaDiasAbertos.add(apresentacao.id);
      else icgFcaDiasAbertos.delete(apresentacao.id);
    });

    const corpo = document.createElement("div");
    corpo.className = "icg-fca-dia-corpo";

    // "Adicionar FCA": só os indicadores que esse dia ainda não tem (o
    // backend também barra duplicado).
    const usados = new Set(apresentacao.fcas.map((f) => f.indicador));
    const livres = Object.entries(icgFcaIndicadores).filter(([chave]) => !usados.has(chave));
    const adicionar = document.createElement("div");
    adicionar.className = "icg-fca-adicionar";
    const select = document.createElement("select");
    select.className = "home-caixa-filtro-select";
    livres.forEach(([chave, rotulo]) => {
      const option = document.createElement("option");
      option.value = chave;
      option.textContent = rotulo;
      select.append(option);
    });
    const btnAdicionar = icgFcaBotao("Adicionar FCA", "btn-secondary", null, () => {
      icgFcaMutar("/api/material-icg/fca/criar", { apresentacao_id: apresentacao.id, indicador: select.value });
    });
    if (!livres.length) {
      select.disabled = true;
      btnAdicionar.disabled = true;
      const option = document.createElement("option");
      option.textContent = "Todos os indicadores já têm FCA";
      select.append(option);
    }
    adicionar.append(select, btnAdicionar);
    corpo.append(adicionar);

    apresentacao.fcas.forEach((fca) => corpo.append(construirIcgFcaBloco(fca)));

    dia.append(cabecalho, corpo);
    return dia;
  }

  function construirIcgFcaBloco(fca) {
    const bloco = document.createElement("div");
    bloco.className = "icg-fca-bloco";

    const cabecalho = document.createElement("div");
    cabecalho.className = "icg-fca-bloco-cabecalho";
    const titulo = document.createElement("span");
    titulo.className = "icg-fca-bloco-titulo";
    titulo.textContent = icgFcaIndicadores[fca.indicador] || fca.indicador;
    const addFato = icgFcaBotao("+ Fato", "icg-fca-btn-add", "Adicionar fato", () => {
      icgFcaMutar("/api/material-icg/fca/item/criar", { fca_id: fca.id, tipo: "fato" });
    });
    const excluir = icgFcaBotao("Excluir FCA", "icg-fca-btn-excluir", null, () => {
      if (!window.confirm(`Excluir o FCA "${titulo.textContent}" e tudo dentro dele?`)) return;
      icgFcaMutar("/api/material-icg/fca/excluir", { id: fca.id });
    });
    cabecalho.append(titulo, addFato, excluir);
    bloco.append(cabecalho);

    if (!fca.itens.length) {
      const vazio = document.createElement("p");
      vazio.className = "hint icg-fca-vazio";
      vazio.textContent = "Sem fatos ainda — clique em \"+ Fato\".";
      bloco.append(vazio);
    } else {
      const arvore = document.createElement("ul");
      arvore.className = "icg-fca-arvore";
      fca.itens.forEach((item) => arvore.append(construirIcgFcaNo(fca.id, item)));
      bloco.append(arvore);
    }
    return bloco;
  }

  function construirIcgFcaNo(fcaId, item) {
    const tipo = ICG_FCA_TIPOS[item.tipo];
    const no = document.createElement("li");
    no.className = `icg-fca-no icg-fca-no--${item.tipo}`;

    const linha = document.createElement("div");
    linha.className = "icg-fca-no-linha";
    const rotulo = document.createElement("span");
    rotulo.className = "icg-fca-no-rotulo";
    rotulo.textContent = tipo.rotulo;

    const texto = document.createElement("textarea");
    texto.className = "icg-fca-no-texto";
    texto.rows = 2;
    texto.value = item.texto;
    texto.placeholder = `Descreva ${tipo.rotulo.toLowerCase()}...`;
    let salvo = item.texto;
    texto.addEventListener("blur", () => {
      const valor = texto.value.trim();
      if (valor === salvo) return;
      salvo = valor;
      icgFcaSalvamentosPendentes = icgFcaSalvamentosPendentes.then(() =>
        icgFcaChamar("/api/material-icg/fca/item/atualizar", { id: item.id, texto: valor })
      );
    });

    linha.append(rotulo, texto);
    if (tipo.filho) {
      const rotuloFilho = ICG_FCA_TIPOS[tipo.filho].rotulo;
      linha.append(
        icgFcaBotao(`+ ${rotuloFilho}`, "icg-fca-btn-add", `Adicionar ${rotuloFilho.toLowerCase()}`, () => {
          icgFcaMutar("/api/material-icg/fca/item/criar", { fca_id: fcaId, tipo: tipo.filho, parent_id: item.id });
        })
      );
    }
    linha.append(
      icgFcaBotao("×", "icg-fca-btn-remover", `Excluir ${tipo.rotulo.toLowerCase()}`, () => {
        if (item.filhos.length && !window.confirm(`Excluir ${tipo.rotulo.toLowerCase()} e tudo abaixo dele?`)) return;
        icgFcaMutar("/api/material-icg/fca/item/excluir", { id: item.id });
      })
    );
    no.append(linha);

    if (item.filhos.length) {
      const filhos = document.createElement("ul");
      filhos.className = "icg-fca-arvore";
      item.filhos.forEach((filho) => filhos.append(construirIcgFcaNo(fcaId, filho)));
      no.append(filhos);
    }
    return no;
  }

  $("btn-material-icg-fca-add-mes").addEventListener("click", async () => {
    const mes = $("material-icg-fca-mes").value;
    if (!mes) {
      $("material-icg-fca-status").textContent = "Escolha o mês.";
      return;
    }
    await icgFcaSalvamentosPendentes;
    const data = await icgFcaChamar("/api/material-icg/fca/mes/criar", { mes });
    if (!data) return;
    // Já abre o mês recém-criado, pronto pra adicionar dia.
    const criado = data.meses.find((m) => m.mes === mes);
    if (criado) icgFcaMesesAbertos.add(criado.id);
    renderizarIcgFcas(data);
  });

  // Barra de SLA (verde/vermelha) pro card "SLA DO MÊS ATUAL" — pedido do
  // usuário: trocar o donut por uma barra, com o percentual em cima.
  // Função própria desta tela (não mexe em buildPrazoDonutEl, que
  // continua sendo o donut usado em Violados/Report Vini). % grande no
  // topo, barra cheia (100% da largura) dividida entre dentro/fora do
  // prazo com um respiro de 2px (cor do card) entre os 2 segmentos, e a
  // mesma legenda do donut grande (prazo-donut-legenda*), só em linha.
  // Meta de SLA (baseline marcado na barra, linha tracejada) — confirmada
  // com o usuário: 95%.
  const ICG_SLA_META_PERCENTUAL = 95;

  function construirIcgSlaBarra(dentro, fora, percentualDentro) {
    const total = dentro + fora;

    const wrap = document.createElement("div");
    wrap.className = "icg-sla-barra-wrap";

    const barra = document.createElement("div");
    barra.className = "icg-sla-barra";
    if (total > 0) {
      const pctDentro = (dentro / total) * 100;
      if (dentro > 0) {
        const seg = document.createElement("div");
        seg.className = "icg-sla-barra-seg icg-sla-barra-seg--dentro";
        seg.style.width = fora > 0 ? `${pctDentro}%` : "100%";
        barra.append(seg);
      }
      if (fora > 0) {
        const seg = document.createElement("div");
        seg.className = "icg-sla-barra-seg icg-sla-barra-seg--fora";
        seg.style.width = dentro > 0 ? `${100 - pctDentro}%` : "100%";
        barra.append(seg);
      }
    } else {
      barra.classList.add("icg-sla-barra--vazia");
    }

    // Pedido do usuário: o percentual deve aparecer DENTRO da barra (não
    // mais acima dela) — sobreposto aos segmentos verde/vermelho.
    const valorEl = document.createElement("div");
    valorEl.className = "icg-sla-barra-valor";
    valorEl.textContent = `${percentualDentro}%`;
    barra.append(valorEl);

    // Dentro/Fora do prazo também no hover da barra (pedido explícito do
    // usuário), além da legenda estática abaixo.
    const tooltipSla = [`Dentro do prazo: ${dentro}`, `Fora do prazo: ${fora}`];
    barra.addEventListener("mouseenter", () => {
      cancelHoverPopoverHide();
      showParetoPopover(barra, tooltipSla);
    });
    barra.addEventListener("mouseleave", scheduleHoverPopoverHide);

    // Trilha que envolve a barra (overflow visível, pro rótulo da meta
    // poder ficar acima sem ser cortado) — a barra em si continua com
    // overflow escondido, só pra manter o corte arredondado dos 2
    // segmentos dentro/fora (mesmo mecanismo do "icg-abertos-barra", ver
    // construirIcgAbertosBarra). Meta fixa (pedido do usuário: "marcar o
    // baseline no SLA como 95%").
    const trilha = document.createElement("div");
    trilha.className = "icg-sla-barra-trilha";
    trilha.append(barra);

    const marca = document.createElement("div");
    marca.className = "icg-sla-barra-marca";
    marca.style.left = `${ICG_SLA_META_PERCENTUAL}%`;
    const marcaLabel = document.createElement("span");
    marcaLabel.className = "icg-sla-barra-marca-label";
    marcaLabel.textContent = `Meta ${ICG_SLA_META_PERCENTUAL}%`;
    marca.append(marcaLabel);
    trilha.append(marca);

    wrap.append(trilha);

    return wrap;
  }

  // Baselines do "Índice de chamados abertos" — confirmado com o
  // usuário: é o volume de chamados CRIADOS no Solar no mês atual (não o
  // total hoje em aberto), mesmos valores de CRIADOS_RESOLVIDOS_BASELINES
  // (gráfico "Criados x Resolvidos" da home).
  const ICG_ABERTOS_BASELINE_MIN = 1530;
  const ICG_ABERTOS_BASELINE_MAX = 1870;

  // Escala fixa da barra (0 a 2000) — pedido explícito do usuário
  // ("quero manter o contorno da linha de 0 a 2000"): as marcações de
  // baseline ficam sempre na mesma posição mês a mês, em vez de escorregar
  // numa escala recalculada a cada "valor" (como era antes, com 15% de
  // folga sobre o maior entre valor/baselineMax). Só cresce além de 2000
  // se "valor" passar disso (pra nunca estourar 100% da barra).
  const ICG_ABERTOS_ESCALA_MAX = 2000;

  // Barra de "chamados abertos" (criados no mês), mesmo estilo visual da
  // barra de SLA acima (valor grande em cima + pílula cheia) — pedido do
  // usuário ("deixe nesse estilo"). Diferente da de SLA (2 segmentos
  // dentro/fora somando 100%), aqui é 1 valor só comparado a uma META em
  // FAIXA: a barra preenche até "valor" (verde se estiver dentro de
  // [baselineMin, baselineMax], vermelha se estiver fora, pra qualquer
  // lado) numa escala FIXA (ICG_ABERTOS_ESCALA_MAX), e as 2 marcações
  // verticais tracejadas mostram onde a faixa de meta fica nessa escala
  // ("mantendo o baseline demarcado na linha" — pedido explícito do
  // usuário).
  function construirIcgAbertosBarra(valor, baselineMin, baselineMax) {
    const maior = Math.max(valor, ICG_ABERTOS_ESCALA_MAX);
    const pct = (v) => Math.min(100, (v / maior) * 100);
    const dentroDaMeta = valor >= baselineMin && valor <= baselineMax;

    const wrap = document.createElement("div");
    wrap.className = "icg-sla-barra-wrap";

    const barra = document.createElement("div");
    barra.className = "icg-abertos-barra";

    const fill = document.createElement("div");
    fill.className = `icg-abertos-barra-fill ${dentroDaMeta ? "icg-abertos-barra-fill--dentro" : "icg-abertos-barra-fill--fora"}`;
    fill.style.width = `${pct(valor)}%`;
    barra.append(fill);

    [
      { v: baselineMin, rotulo: String(baselineMin) },
      { v: baselineMax, rotulo: String(baselineMax) },
    ].forEach(({ v, rotulo }) => {
      const marca = document.createElement("div");
      marca.className = "icg-abertos-barra-marca";
      marca.style.left = `${pct(v)}%`;
      const label = document.createElement("span");
      label.className = "icg-abertos-barra-marca-label";
      label.textContent = rotulo;
      marca.append(label);
      barra.append(marca);
    });

    // Pedido do usuário: o valor deve aparecer DENTRO da barra (não mais
    // acima dela), mesmo tratamento já aplicado à barra de SLA.
    const valorEl = document.createElement("div");
    valorEl.className = "icg-sla-barra-valor";
    valorEl.textContent = valor.toLocaleString("pt-BR");
    barra.append(valorEl);

    wrap.append(barra);

    return wrap;
  }

  // Barra comparativa (cinza esmaecido), abaixo da barra principal de SLA
  // e da de "chamados abertos" — período de mesma duração, imediatamente
  // anterior ao selecionado no filtro "De"/"até" (ver
  // _cache_material_icg_dados no backend). "pct" já vem calculado por
  // quem chama, na MESMA escala da barra principal acima dela, pra ficar
  // visualmente alinhada. "rotuloPeriodo" é o texto da legenda (datas do
  // período anterior, já formatado por quem chama). "marcas" (opcional):
  // mesmo baseline da barra principal acima dela (ver
  // construirIcgSlaBarra/construirIcgAbertosBarra), marcado também na
  // barra cinza — pedido explícito do usuário. "tooltip" (opcional): texto
  // mostrado no hover da barra (pedido explícito do usuário — "tanto
  // para o período atual quanto para o inferior"), mesmo mecanismo do
  // hover da barra principal.
  function construirIcgComparativoBarra(valorTexto, pct, rotuloPeriodo, marcas, tooltip) {
    const wrap = document.createElement("div");
    wrap.className = "icg-comparativo-wrap";

    // Legenda (sem o valor — ele agora vai dentro da barra, igual à
    // principal) — abaixo da barra, alinhada à esquerda (pedido explícito
    // do usuário).
    const legenda = document.createElement("div");
    legenda.className = "icg-comparativo-legenda";
    legenda.textContent = rotuloPeriodo;

    // Mesmo modelo visual da barra principal (valor centralizado dentro
    // dela) — só em cinza esmaecido em vez de verde/vermelho (pedido
    // explícito do usuário).
    const barra = document.createElement("div");
    barra.className = "icg-comparativo-barra";
    const fill = document.createElement("div");
    fill.className = "icg-comparativo-barra-fill";
    fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    barra.append(fill);

    const valorEl = document.createElement("div");
    valorEl.className = "icg-comparativo-barra-valor";
    valorEl.textContent = valorTexto;
    barra.append(valorEl);

    if (tooltip) {
      barra.addEventListener("mouseenter", () => {
        cancelHoverPopoverHide();
        showParetoPopover(barra, tooltip);
      });
      barra.addEventListener("mouseleave", scheduleHoverPopoverHide);
    }

    // Trilha com overflow visível, pro rótulo da marca poder ficar acima
    // sem ser cortado (mesmo mecanismo da barra principal) — a barra em
    // si continua com overflow escondido, só pro preenchimento.
    const trilha = document.createElement("div");
    trilha.className = "icg-comparativo-trilha";
    trilha.append(barra);

    (marcas || []).forEach(({ pct: marcaPct, rotulo }) => {
      const marca = document.createElement("div");
      marca.className = "icg-sla-barra-marca";
      marca.style.left = `${marcaPct}%`;
      const label = document.createElement("span");
      label.className = "icg-sla-barra-marca-label";
      label.textContent = rotulo;
      marca.append(label);
      trilha.append(marca);
    });

    wrap.append(trilha);
    wrap.append(legenda);

    return wrap;
  }

  // Tabela de variação (pedido explícito do usuário), ao lado da barra —
  // 1 linha por categoria: quadrado colorido (mesma cor já usada na
  // legenda/barra daquela categoria) + seta (verde pra cima quando o
  // valor atual é maior que o do período anterior/cinza, vermelha pra
  // baixo quando é menor) + percentual de variação com sinal + diferença
  // em contagem (atual - anterior, com sinal — pedido explícito do
  // usuário, coluna a mais). "linhas": [{cor, rotulo, atual, anterior}].
  // Sem "anterior" (0 ou ausente, ex.: sem comparativa ainda) a seta/%
  // saem neutras ("—") — não dá pra calcular variação percentual sobre
  // uma base zero; a diferença em contagem não tem essa limitação (é só
  // subtração), então continua aparecendo mesmo nesse caso.
  function construirIcgVariacaoTabela(linhas) {
    const tabela = document.createElement("div");
    tabela.className = "icg-variacao-tabela";

    linhas.forEach(({ cor, rotulo, atual, anterior }) => {
      const linha = document.createElement("div");
      linha.className = "icg-variacao-linha";

      const categoria = document.createElement("span");
      categoria.className = "icg-variacao-categoria";
      const dot = document.createElement("span");
      dot.className = "icg-variacao-dot";
      dot.style.background = cor;
      categoria.append(dot, document.createTextNode(rotulo));

      const seta = document.createElement("span");
      const pctEl = document.createElement("span");
      pctEl.className = "icg-variacao-pct";

      if (!anterior) {
        seta.className = "icg-variacao-seta icg-variacao-seta--neutro";
        seta.textContent = "—";
        pctEl.textContent = "—";
      } else {
        const variacao = Math.round(((atual - anterior) / anterior) * 1000) / 10;
        const subiu = variacao >= 0;
        seta.className = `icg-variacao-seta ${subiu ? "icg-variacao-seta--up" : "icg-variacao-seta--down"}`;
        seta.textContent = subiu ? "▲" : "▼";
        pctEl.textContent = `${subiu ? "+" : ""}${variacao}%`;
      }

      const diferenca = atual - (anterior || 0);
      const diferencaEl = document.createElement("span");
      diferencaEl.className = "icg-variacao-diferenca";
      diferencaEl.textContent = `${diferenca > 0 ? "+" : ""}${diferenca.toLocaleString("pt-BR")}`;

      // Hover com o comparativo (pedido explícito do usuário): Atual /
      // Passado / Diferença (em contagem e %).
      const diferencaPct = anterior ? `${Math.round(((atual - anterior) / anterior) * 1000) / 10}%` : "—";
      const tooltip = [
        `Atual: ${atual}`,
        `Passado: ${anterior || 0}`,
        `Diferença: ${diferenca > 0 ? "+" : ""}${diferenca} (${diferencaPct})`,
      ];
      linha.addEventListener("mouseenter", () => {
        cancelHoverPopoverHide();
        showParetoPopover(linha, tooltip);
      });
      linha.addEventListener("mouseleave", scheduleHoverPopoverHide);

      linha.append(categoria, seta, pctEl, diferencaEl);
      tabela.append(linha);
    });

    return tabela;
  }

  // Tabela da média dos últimos 3 meses (pedido explícito do usuário:
  // "quero que apareça abaixo [da tabela de variação] em uma tabela
  // nova") — mesmo contorno/bordas de ".icg-variacao-tabela", só que
  // sem seta/dot (não é uma comparação direta, é a média de 3 períodos).
  // "linhas": [{rotulo, valorTexto}].
  function construirIcgMediaTabela(linhas) {
    const tabela = document.createElement("div");
    tabela.className = "icg-variacao-tabela icg-media-tabela";

    linhas.forEach(({ rotulo, valorTexto }) => {
      const linha = document.createElement("div");
      linha.className = "icg-variacao-linha";

      const rotuloEl = document.createElement("span");
      rotuloEl.className = "icg-media-tabela-rotulo";
      rotuloEl.textContent = rotulo;

      const valorEl = document.createElement("span");
      valorEl.className = "icg-media-tabela-valor";
      valorEl.textContent = valorTexto;

      linha.append(rotuloEl, valorEl);
      tabela.append(linha);
    });

    return tabela;
  }

  const ICG_ATENDIMENTO_CORES = { criados: "#c23b43", resolvidos: "#1f9e73" };

  // Base comum dos 2 gráficos de atendimento (diário e mensal): checa o
  // Plotly e cria o elemento dentro de "container".
  function icgAtendimentoCriarGrafico(container) {
    container.innerHTML = "";
    if (typeof Plotly === "undefined") {
      const aviso = document.createElement("p");
      aviso.className = "hint";
      aviso.textContent = "Não foi possível carregar a biblioteca de gráficos (Plotly) — verifique a conexão.";
      container.append(aviso);
      return null;
    }
    const grafico = document.createElement("div");
    grafico.className = "icg-atendimento-plot";
    container.append(grafico);
    return grafico;
  }

  // Tema escuro + interação limitada (pedido do usuário: "o gráfico está
  // muito livre"): zoom/pan só no eixo X (Y fixo de 0 até o maior valor +
  // folga), sem sair do período dos dados, sem zoom pela roda do mouse
  // (não sequestra o scroll da página). "xaxisExtra" completa o eixo X de
  // cada gráfico (formato de data/rótulos).
  function icgAtendimentoLayout(maiorValor, xMin, xMax, xaxisExtra, annotations) {
    const corTexto = "#eef1f6";
    const corMuted = "#8993a6";
    const corGrade = "#262e3c";
    const eixoBase = {
      gridcolor: corGrade,
      linecolor: corMuted,
      mirror: true,
      showline: true,
      ticks: "outside",
      tickcolor: corMuted,
      tickfont: { color: corMuted },
    };
    return {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: corTexto, size: 12 },
      margin: { l: 56, r: 16, t: 10, b: 40 },
      height: 340,
      hovermode: "x unified",
      dragmode: "zoom",
      // Caixa do hover no tema escuro do app — o padrão (fundo branco com
      // o texto claro herdado de "font") ficava ilegível.
      hoverlabel: { bgcolor: "#1b212c", bordercolor: corGrade, font: { color: corTexto, size: 12 } },
      xaxis: { ...eixoBase, type: "date", range: [xMin, xMax], minallowed: xMin, maxallowed: xMax, ...xaxisExtra },
      yaxis: { ...eixoBase, range: [0, Math.max(1, maiorValor) * 1.1], fixedrange: true, zeroline: false },
      legend: { orientation: "h", x: 0.5, xanchor: "center", y: -0.18, font: { color: corTexto } },
      annotations: annotations || [],
    };
  }

  function icgAtendimentoConfig(nomeArquivo) {
    return {
      responsive: true,
      scrollZoom: false,
      displaylogo: false,
      modeBarButtons: [["zoom2d", "pan2d", "zoomIn2d", "zoomOut2d", "resetScale2d", "toImage"]],
      toImageButtonOptions: { filename: nomeArquivo, format: "png" },
    };
  }

  function icgAtendimentoSerie(chave, nome, x, y) {
    return {
      type: "scatter",
      mode: "lines+markers",
      name: nome,
      legendgroup: chave,
      x,
      y,
      line: { color: ICG_ATENDIMENTO_CORES[chave], width: 2 },
      marker: { color: ICG_ATENDIMENTO_CORES[chave], size: 5 },
      hovertemplate: `${nome}: %{y}<extra></extra>`,
    };
  }

  // "Atendimento diário" (pedido explícito do usuário) — 2ª página do
  // carrossel de Material ICG: gráfico de LINHA, 1 ponto por dia do
  // período selecionado ("dados.atendimento_diario.serie"), com 2 séries
  // (Criados/Resolvidos) + 1 baseline tracejado por série (média diária
  // dos últimos 3 meses, já calculada pro grupo selecionado no seletor
  // Tudo/N1/N2/PROD). Desenhado com Plotly (pedido: "estilo matplotlib,
  // que permita interação") — toolbar com zoom por caixa, pan, zoom +/-,
  // voltar ao início e salvar PNG (só no eixo X, dentro do período);
  // clicar na legenda liga/desliga a série e duplo clique isola (realce).
  function renderizarIcgAtendimentoDiarioChart(container, serieDiaria, baselineCriados, baselineResolvidos) {
    const grafico = icgAtendimentoCriarGrafico(container);
    if (!grafico) return;

    const datas = serieDiaria.map((d) => d.data);
    const primeiraData = datas[0];
    const ultimaData = datas[datas.length - 1];

    // Baseline como traço próprio (não "shape"), pra entrar na legenda e
    // ligar/desligar junto com a série dela (mesmo "legendgroup").
    function baseline(chave, nome, valor) {
      return {
        type: "scatter",
        mode: "lines",
        name: `Baseline ${nome} (${valor.toLocaleString("pt-BR")}/dia)`,
        legendgroup: chave,
        x: [primeiraData, ultimaData],
        y: [valor, valor],
        line: { color: ICG_ATENDIMENTO_CORES[chave], width: 1.5, dash: "dash" },
        opacity: 0.75,
        hoverinfo: "skip",
      };
    }

    const traces = [
      icgAtendimentoSerie("criados", "Criados", datas, serieDiaria.map((d) => d.criados)),
      icgAtendimentoSerie("resolvidos", "Resolvidos", datas, serieDiaria.map((d) => d.resolvidos)),
      baseline("criados", "criados", baselineCriados),
      baseline("resolvidos", "resolvidos", baselineResolvidos),
    ];

    // Valor do baseline à esquerda da linha tracejada (pedido explícito
    // do usuário), na cor da série.
    const anotacoesBaseline = [
      ["criados", baselineCriados],
      ["resolvidos", baselineResolvidos],
    ].map(([chave, valor]) => ({
      xref: "paper",
      x: 0,
      xanchor: "right",
      xshift: -4,
      y: valor,
      yref: "y",
      text: valor.toLocaleString("pt-BR"),
      showarrow: false,
      font: { color: ICG_ATENDIMENTO_CORES[chave], size: 11 },
    }));

    const maiorValor = Math.max(baselineCriados, baselineResolvidos, ...serieDiaria.flatMap((d) => [d.criados, d.resolvidos]));
    const layout = icgAtendimentoLayout(
      maiorValor,
      primeiraData,
      ultimaData,
      { tickformat: "%d/%m", hoverformat: "%d/%m/%Y" },
      anotacoesBaseline
    );

    Plotly.newPlot(grafico, traces, layout, icgAtendimentoConfig("atendimento-diario"));

    // Número do baseline (anotação à esquerda) acompanha o filtro da
    // legenda (pedido explícito do usuário): anotação não some sozinha
    // quando o traço é desligado/isolado, então espelha a visibilidade do
    // traço de baseline da mesma série (índices 2 e 3 em "traces", mesma
    // ordem das anotações).
    grafico.on("plotly_restyle", () => {
      const visivel = (indiceTrace) => {
        const v = grafico.data[indiceTrace].visible;
        return v === undefined || v === true;
      };
      Plotly.relayout(grafico, {
        "annotations[0].visible": visivel(2),
        "annotations[1].visible": visivel(3),
      });
    });
  }

  // "Atendimento mensal" — mesmo gráfico, quando o filtro da tela é "Ano"
  // (pedido explícito do usuário): 1 ponto por mês, e o baseline também
  // mês a mês (cada ponto = média dos 3 meses anteriores àquele mês, já
  // calculada no backend — "baseline_criados"/"baseline_resolvidos" de
  // cada item; null quando não há mês anterior no cache, e a linha
  // tracejada só começa onde há valor). Rótulos de mês montados aqui
  // ("Jan 2026"...) pra ficarem em pt-BR (o Plotly só tem inglês).
  function renderizarIcgAtendimentoMensalChart(container, serieMensal) {
    const grafico = icgAtendimentoCriarGrafico(container);
    if (!grafico) return;

    const meses = serieMensal.map((m) => m.data);
    const rotulos = meses.map((data) => formatarMesAno(data.slice(0, 7)));

    function baselineMensal(chave, nome) {
      return {
        type: "scatter",
        mode: "lines+markers",
        name: `Baseline ${nome} (média 3 meses anteriores)`,
        legendgroup: chave,
        x: meses,
        y: serieMensal.map((m) => m[`baseline_${chave}`]),
        line: { color: ICG_ATENDIMENTO_CORES[chave], width: 1.5, dash: "dash" },
        marker: { color: ICG_ATENDIMENTO_CORES[chave], size: 4, symbol: "circle-open" },
        opacity: 0.75,
        connectgaps: false,
        hovertemplate: `Baseline ${nome}: %{y}<extra></extra>`,
      };
    }

    const traces = [
      icgAtendimentoSerie("criados", "Criados", meses, serieMensal.map((m) => m.criados)),
      icgAtendimentoSerie("resolvidos", "Resolvidos", meses, serieMensal.map((m) => m.resolvidos)),
      baselineMensal("criados", "criados"),
      baselineMensal("resolvidos", "resolvidos"),
    ];

    const valores = serieMensal.flatMap((m) => [m.criados, m.resolvidos, m.baseline_criados || 0, m.baseline_resolvidos || 0]);
    // Folga de meio mês nas pontas, pros 1º/último pontos não ficarem
    // colados nas bordas do gráfico.
    const xMin = new Date(new Date(meses[0]).getTime() - 15 * 86400000).toISOString().slice(0, 10);
    const xMax = new Date(new Date(meses[meses.length - 1]).getTime() + 15 * 86400000).toISOString().slice(0, 10);
    const layout = icgAtendimentoLayout(Math.max(...valores), xMin, xMax, {
      tickmode: "array",
      tickvals: meses,
      ticktext: rotulos,
      hoverformat: "%m/%Y",
    });

    Plotly.newPlot(grafico, traces, layout, icgAtendimentoConfig("atendimento-mensal"));
  }

  // "Índice de reabertura" — pedido explícito do usuário: diferente das
  // 2 pílulas acima, aqui é um gráfico de BARRA VERTICAL (3 barras do mês
  // atual: Criados em vermelho, Encerrados em verde — Resolvido e
  // Encerrado juntos, CACHE_STATUS_RESOLVIDOS — e Reabertura em
  // amarelo). Reaproveita o eixo/grade/legenda do "Criados x Resolvidos"
  // (mesmas classes home-sla-chart-*), sem baseline (não faz sentido
  // pra essa combinação — a própria altura pequena da barra de
  // Reabertura, bem menor que as outras 2, já comunica visualmente o
  // índice baixo).
  // "comparativo" (opcional): {criados, resolvidos, reabertos} do
  // período anterior — pedido explícito do usuário: mesma barra cinza de
  // comparação das 2 pílulas acima, só que à DIREITA do gráfico existente
  // (2ª coluna de barras, não embaixo — aqui já é um gráfico de barras
  // verticais, embaixo não faz sentido).
  function construirIcgReaberturaChart(criados, resolvidos, reabertos, comparativo) {
    const valoresComparativo = comparativo ? [comparativo.criados, comparativo.resolvidos, comparativo.reabertos] : [];
    const maior = Math.max(1, criados, resolvidos, reabertos, ...valoresComparativo);
    // "--grande" (ver classe abaixo) aumenta a altura fixa de
    // ".home-sla-chart-bars"/".home-sla-chart-par" em style.css, então
    // esse alturaMax maior não corta mais o rótulo da barra mais alta
    // (era exatamente esse descompasso que cortava o "707" antes).
    const alturaMax = 200;

    const wrap = document.createElement("div");
    // "--grande": barras mais largas + fontes maiores (pedido do
    // usuário: "aumente o tamanho"); ".home-sla-chart-bars" também ganha
    // "justify-content: center" só nessa variante, pra centralizar a
    // única coluna de barras em vez dela ficar colada à esquerda com um
    // vão vazio sobrando (pedido: "centralize") — não mexe no gráfico
    // padrão de vários meses da home (que preenche/rola a largura toda).
    wrap.className = "home-sla-chart-inner home-sla-chart-inner--grande";

    const plot = document.createElement("div");
    plot.className = "home-sla-chart-plot";

    // Sem eixo (números/traços à esquerda) nem grade de fundo — pedido
    // explícito do usuário ("remover"): só as barras, com o valor direto
    // em cima de cada uma.
    const bars = document.createElement("div");
    bars.className = "home-sla-chart-bars";

    // Reaproveitado pra montar o grupo de 3 barras do mês atual (cores) e
    // o grupo comparativo (cinza) — "cinza" quando true troca a cor por
    // tipo por 3 tons de cinza diferentes (1 por tipo, pedido explícito
    // do usuário), em vez da mesma cor nas 3 barras.
    function construirTrio(valores, cinza, sufixoTooltip) {
      const trio = document.createElement("div");
      trio.className = "home-sla-chart-par";
      [
        ["criados", "Criados", valores[0]],
        ["resolvidos", "Encerrados", valores[1]],
        ["reabertos", "Reabertura", valores[2]],
      ].forEach(([tipo, rotuloTipo, valor]) => {
        const bar = document.createElement("div");
        bar.className = cinza
          ? `home-sla-chart-bar home-sla-chart-bar--comparativo-${tipo}`
          : `home-sla-chart-bar home-sla-chart-bar--${tipo}`;
        bar.style.height = `${Math.max((valor / maior) * alturaMax, valor ? 2 : 0)}px`;

        const rotuloValor = document.createElement("span");
        rotuloValor.className = "home-sla-chart-bar-valor";
        rotuloValor.textContent = valor.toLocaleString("pt-BR");
        bar.append(rotuloValor);

        const tooltip = `${rotuloTipo}${sufixoTooltip || ""}: ${valor}`;
        bar.addEventListener("mouseenter", () => {
          cancelHoverPopoverHide();
          showParetoPopover(bar, tooltip);
        });
        bar.addEventListener("mouseleave", scheduleHoverPopoverHide);

        trio.append(bar);
      });
      return trio;
    }

    const col = document.createElement("div");
    col.className = "home-sla-chart-col";
    col.append(construirTrio([criados, resolvidos, reabertos], false, ""));
    bars.append(col);

    if (comparativo) {
      const colComparativo = document.createElement("div");
      colComparativo.className = "home-sla-chart-col home-sla-chart-col--comparativo";
      colComparativo.append(
        construirTrio(
          [comparativo.criados, comparativo.resolvidos, comparativo.reabertos],
          true,
          " (mês anterior)"
        )
      );
      bars.append(colComparativo);
    }

    plot.append(bars);
    wrap.append(plot);
    return wrap;
  }

  // Modo "Mês" do filtro (pedido explícito do usuário, como alternativa
  // ao "Personalizado" De/até) — converte o mês escolhido num intervalo
  // De/até: dia 1 até o último dia do mês, ou até HOJE se o mês escolhido
  // for o corrente (ainda em andamento — o cache não tem dia futuro).
  function mesParaIntervalo(mesIso) {
    const [ano, mes] = mesIso.split("-").map(Number);
    const hoje = new Date();
    const ehMesCorrente = ano === hoje.getFullYear() && mes === hoje.getMonth() + 1;
    const inicio = `${mesIso}-01`;
    if (ehMesCorrente) {
      return { inicio, fim: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}` };
    }
    const ultimoDia = new Date(ano, mes, 0).getDate();
    return { inicio, fim: `${mesIso}-${String(ultimoDia).padStart(2, "0")}` };
  }

  // Modo "Ano" do filtro (pedido explícito do usuário): anos a partir de
  // 2026 (início do cache) até o ano atual; intervalo = ano inteiro, ou
  // até hoje se for o ano corrente. Nesse modo o gráfico da página 2 vira
  // 1 ponto por mês (granularidade "mes" no backend).
  const MATERIAL_ICG_ANO_INICIAL = 2026;

  function materialIcgAnosDisponiveis() {
    const anoAtual = new Date().getFullYear();
    const anos = [];
    for (let ano = MATERIAL_ICG_ANO_INICIAL; ano <= Math.max(anoAtual, MATERIAL_ICG_ANO_INICIAL); ano += 1) anos.push(ano);
    return anos;
  }

  function anoParaIntervalo(ano) {
    const hoje = new Date();
    if (Number(ano) === hoje.getFullYear()) {
      const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
      return { inicio: `${ano}-01-01`, fim: hojeIso };
    }
    return { inicio: `${ano}-01-01`, fim: `${ano}-12-31` };
  }

  function materialIcgAtualizarVisibilidadeFiltro() {
    const modo = $("material-icg-filtro-tipo").value;
    $("material-icg-filtro-mes-wrap").classList.toggle("hidden", modo !== "mes");
    $("material-icg-filtro-ano-wrap").classList.toggle("hidden", modo !== "ano");
    $("material-icg-filtro-personalizado-wrap").classList.toggle("hidden", modo !== "personalizado");
  }

  async function carregarMaterialIcg() {
    const statusEl = $("material-icg-status");
    statusEl.classList.add("is-loading");
    statusEl.textContent = "Carregando...";

    const hoje = new Date();
    const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
    const inicioMesIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
    const mesAtualReal = hojeIso.slice(0, 7);

    materialIcgAtualizarVisibilidadeFiltro();

    // Filtro "De"/"até" do modo Personalizado: só define o padrão (dia 1
    // do mês atual até hoje) na 1ª carga, nunca sobrescreve o que o
    // usuário já escolheu.
    const inicioEl = $("material-icg-input-inicio");
    const fimEl = $("material-icg-input-fim");
    if (!inicioEl.value) inicioEl.value = inicioMesIso;
    if (!fimEl.value) fimEl.value = hojeIso;

    // Intervalo efetivo da consulta: modo "Mês" converte o mês
    // selecionado (ou o mês atual real, na 1ª carga) num De/até; modo
    // "Personalizado" usa os inputs direto.
    const modoFiltro = $("material-icg-filtro-tipo").value;
    const mesSelectEl = $("material-icg-mes-select");

    const anoSelectEl = $("material-icg-ano-select");
    if (!anoSelectEl.options.length) {
      materialIcgAnosDisponiveis().forEach((ano) => {
        const option = document.createElement("option");
        option.value = String(ano);
        option.textContent = String(ano);
        anoSelectEl.append(option);
      });
      anoSelectEl.value = String(Math.max(MATERIAL_ICG_ANO_INICIAL, hoje.getFullYear()));
    }

    let intervalo;
    if (modoFiltro === "mes") intervalo = mesParaIntervalo(mesSelectEl.value || mesAtualReal);
    else if (modoFiltro === "ano") intervalo = anoParaIntervalo(anoSelectEl.value);
    else intervalo = { inicio: inicioEl.value, fim: fimEl.value };
    const granularidade = modoFiltro === "ano" ? "mes" : "dia";

    // FCA's (lista de dias de apresentação, SQLite) — independente dos
    // filtros de período/grupo dos gráficos acima.
    carregarIcgFcas();

    const erros = [];

    // Os 3 gráficos (SLA/Abertos/Reabertura) + a comparativa (mesma
    // duração, período imediatamente anterior) são 100% cache local (sem
    // Jira ao vivo — tag "Cacheado" na tela), e saem TODOS de 1 fetch só:
    // /api/material-icg/dados faz 1 único scan da pasta de cache (antes
    // eram 3 scans separados, 1 por endpoint).
    let dados = null;
    try {
      const resp = await apiCall("/api/material-icg/dados", {
        inicio: intervalo.inicio,
        fim: intervalo.fim,
        grupos_linha: materialIcgGruposLinha(),
        grupos_indicadores: materialIcgGruposIndicadores(),
        granularidade,
      });
      const data = await resp.json();
      if (resp.ok) dados = data;
      else erros.push(data.error || "Erro ao carregar o Material ICG.");
    } catch (e) {
      erros.push("Não foi possível conectar ao servidor (Material ICG).");
    }

    // Seletor "Mês": meses com dado no cache (vem de graça na resposta
    // acima, sem scan extra). Mantém a seleção anterior do usuário ao
    // recarregar. Se a 1ª consulta usou um mês diferente do que acaba
    // sendo selecionado aqui (ex.: 1ª carga, select ainda vazio, caiu no
    // mês atual real por padrão, mas o usuário tinha um mês diferente
    // selecionado antes de uma troca de modo), refaz só esse fetch.
    const mesesDisponiveis = dados?.meses_disponiveis || [];
    const mesSelecaoAnterior = mesSelectEl.value;
    mesSelectEl.innerHTML = "";
    mesesDisponiveis.forEach((mes) => {
      const option = document.createElement("option");
      option.value = mes;
      option.textContent = formatarMesAno(mes);
      mesSelectEl.append(option);
    });
    if (mesesDisponiveis.includes(mesSelecaoAnterior)) {
      mesSelectEl.value = mesSelecaoAnterior;
    } else if (mesesDisponiveis.includes(mesAtualReal)) {
      mesSelectEl.value = mesAtualReal;
    } else if (mesesDisponiveis.length) {
      mesSelectEl.value = mesesDisponiveis[mesesDisponiveis.length - 1];
    }
    if (modoFiltro === "mes" && mesSelectEl.value && mesSelectEl.value !== (mesSelecaoAnterior || mesAtualReal)) {
      intervalo = mesParaIntervalo(mesSelectEl.value);
      try {
        const resp = await apiCall("/api/material-icg/dados", {
          inicio: intervalo.inicio,
          fim: intervalo.fim,
          grupos_linha: materialIcgGruposLinha(),
          grupos_indicadores: materialIcgGruposIndicadores(),
          granularidade,
        });
        const data = await resp.json();
        if (resp.ok) dados = data;
      } catch (e) {
        // segue com os dados da 1ª consulta.
      }
    }

    const comparativo = dados?.comparativo || null;
    const media3Meses = dados?.media_3_meses || null;
    const rotuloPeriodoAnterior = dados
      ? `Período anterior (${formatarDataBR(dados.inicio_anterior)} a ${formatarDataBR(dados.fim_anterior)})`
      : "";

    if (dados) {
      $("material-icg-sla-titulo").textContent = `SLA de ${formatarDataBR(dados.inicio)} a ${formatarDataBR(dados.fim)}`;
      $("material-icg-abertos-titulo").textContent = `Índice de chamados abertos (criados de ${formatarDataBR(
        dados.inicio
      )} a ${formatarDataBR(dados.fim)})`;
    }

    const slaEl = $("material-icg-sla");
    if (dados) {
      slaEl.innerHTML = "";
      if (dados.sla.dentro_prazo + dados.sla.fora_prazo > 0) {
        const wrap = document.createElement("div");
        wrap.className = "icg-barra-com-comparativo";
        wrap.append(construirIcgSlaBarra(dados.sla.dentro_prazo, dados.sla.fora_prazo, dados.sla.percentual_dentro_prazo));
        if (comparativo) {
          wrap.append(
            construirIcgComparativoBarra(
              `${comparativo.sla.percentual_dentro_prazo}%`,
              comparativo.sla.percentual_dentro_prazo,
              rotuloPeriodoAnterior,
              [{ pct: ICG_SLA_META_PERCENTUAL, rotulo: `Meta ${ICG_SLA_META_PERCENTUAL}%` }],
              [`Dentro do prazo: ${comparativo.sla.dentro_prazo}`, `Fora do prazo: ${comparativo.sla.fora_prazo}`]
            )
          );
        }
        const linha = document.createElement("div");
        linha.className = "icg-secao-com-variacao";
        linha.append(wrap);

        // Tabela de variação e tabela de média, empilhadas (pedido
        // explícito do usuário: a média "aparece abaixo, em uma tabela
        // nova"), as duas à direita do gráfico.
        const tabelasDireita = document.createElement("div");
        tabelasDireita.className = "icg-tabelas-direita";
        if (comparativo) {
          tabelasDireita.append(
            construirIcgVariacaoTabela([
              {
                cor: "var(--success)",
                rotulo: "Dentro do prazo",
                atual: dados.sla.dentro_prazo,
                anterior: comparativo.sla.dentro_prazo,
              },
              {
                cor: "var(--danger)",
                rotulo: "Fora do prazo",
                atual: dados.sla.fora_prazo,
                anterior: comparativo.sla.fora_prazo,
              },
            ])
          );
        }
        if (media3Meses) {
          tabelasDireita.append(
            construirIcgMediaTabela([{ rotulo: "Média SLA (últimos 3 meses)", valorTexto: `${media3Meses.sla_percentual}%` }])
          );
        }
        if (tabelasDireita.childElementCount) {
          linha.append(tabelasDireita);
        }

        slaEl.append(linha);
      } else {
        const vazio = document.createElement("p");
        vazio.className = "hint";
        vazio.textContent = "Nenhum chamado resolvido nesse período no cache.";
        slaEl.append(vazio);
      }
    }

    const abertosEl = $("material-icg-abertos");
    const reaberturaEl = $("material-icg-reabertura");
    if (dados) {
      abertosEl.innerHTML = "";
      if (dados.abertos > 0 || (dados.reabertura && dados.reabertura.criados > 0)) {
        // Mesmo estilo visual da barra de SLA (pedido do usuário:
        // "deixe nesse estilo, mantendo o baseline demarcado na
        // linha") — ver construirIcgAbertosBarra.
        const wrap = document.createElement("div");
        wrap.className = "icg-barra-com-comparativo";
        wrap.append(construirIcgAbertosBarra(dados.abertos, ICG_ABERTOS_BASELINE_MIN, ICG_ABERTOS_BASELINE_MAX));
        if (comparativo) {
          // Mesma escala (0 a "maior") da barra principal acima dela
          // (ver construirIcgAbertosBarra), pra ficar visualmente
          // alinhada em vez de recalcular a própria escala.
          const maior = Math.max(dados.abertos, ICG_ABERTOS_ESCALA_MAX);
          const pctEscala = (v) => Math.min(100, (v / maior) * 100);
          wrap.append(
            construirIcgComparativoBarra(
              comparativo.abertos.toLocaleString("pt-BR"),
              pctEscala(comparativo.abertos),
              rotuloPeriodoAnterior,
              [
                { pct: pctEscala(ICG_ABERTOS_BASELINE_MIN), rotulo: String(ICG_ABERTOS_BASELINE_MIN) },
                { pct: pctEscala(ICG_ABERTOS_BASELINE_MAX), rotulo: String(ICG_ABERTOS_BASELINE_MAX) },
              ]
            )
          );
        }
        const linha = document.createElement("div");
        linha.className = "icg-secao-com-variacao";
        linha.append(wrap);

        const tabelasDireita = document.createElement("div");
        tabelasDireita.className = "icg-tabelas-direita";
        if (comparativo) {
          tabelasDireita.append(
            construirIcgVariacaoTabela([
              { cor: "var(--sla-chart-criados)", rotulo: "Abertos", atual: dados.abertos, anterior: comparativo.abertos },
            ])
          );
        }
        if (media3Meses) {
          tabelasDireita.append(
            construirIcgMediaTabela([
              { rotulo: "Média de abertos (últimos 3 meses)", valorTexto: media3Meses.abertos_media.toLocaleString("pt-BR") },
            ])
          );
        }
        if (tabelasDireita.childElementCount) {
          linha.append(tabelasDireita);
        }

        abertosEl.append(linha);
      } else {
        const vazio = document.createElement("p");
        vazio.className = "hint";
        vazio.textContent = "Nenhum chamado criado nesse período no cache.";
        abertosEl.append(vazio);
      }

      reaberturaEl.innerHTML = "";
      if (dados.reabertura.criados > 0 || dados.reabertura.resolvidos > 0 || dados.reabertura.reabertos > 0) {
        const wrap = document.createElement("div");
        wrap.className = "icg-reabertura-wrap";

        const linhaChart = document.createElement("div");
        linhaChart.className = "icg-secao-com-variacao";
        linhaChart.append(
          construirIcgReaberturaChart(
            dados.reabertura.criados,
            dados.reabertura.resolvidos,
            dados.reabertura.reabertos,
            comparativo?.reabertura
          )
        );
        const tabelasDireitaReabertura = document.createElement("div");
        tabelasDireitaReabertura.className = "icg-tabelas-direita";
        if (comparativo) {
          tabelasDireitaReabertura.append(
            construirIcgVariacaoTabela([
              {
                cor: "var(--sla-chart-criados)",
                rotulo: "Criados",
                atual: dados.reabertura.criados,
                anterior: comparativo.reabertura.criados,
              },
              {
                cor: "var(--sla-chart-resolvidos)",
                rotulo: "Encerrados",
                atual: dados.reabertura.resolvidos,
                anterior: comparativo.reabertura.resolvidos,
              },
              {
                cor: "var(--warning)",
                rotulo: "Reabertura",
                atual: dados.reabertura.reabertos,
                anterior: comparativo.reabertura.reabertos,
              },
            ])
          );
        }
        // Média do MESMO intervalo, nos últimos 3 meses (pedido explícito
        // do usuário) — diferente da tabela de "mês anterior" acima: 2ª
        // tabela, empilhada abaixo dela.
        if (media3Meses) {
          tabelasDireitaReabertura.append(
            construirIcgMediaTabela([
              {
                rotulo: "Percentual de reabertura (média 3 meses)",
                valorTexto: `${media3Meses.reabertura_percentual_media}%`,
              },
            ])
          );
        }
        if (tabelasDireitaReabertura.childElementCount) {
          linhaChart.append(tabelasDireitaReabertura);
        }
        wrap.append(linhaChart);

        // 1 card por grupo (pedido explícito do usuário): período
        // selecionado e, quando tem comparativa, o mesmo cálculo pro
        // período anterior (reabertos / criados), lado a lado.
        const cardsPercentual = document.createElement("div");
        cardsPercentual.className = "icg-reabertura-cards-percentual";
        const percentualAbertura = dados.reabertura.criados
          ? Math.round((dados.reabertura.reabertos / dados.reabertura.criados) * 1000) / 10
          : 0;
        cardsPercentual.append(summaryCard(`${percentualAbertura}%`, "Percentual de reabertura", "tone-warning"));
        if (comparativo) {
          const percentualAberturaAnterior = comparativo.reabertura.criados
            ? Math.round((comparativo.reabertura.reabertos / comparativo.reabertura.criados) * 1000) / 10
            : 0;
          cardsPercentual.append(
            summaryCard(`${percentualAberturaAnterior}%`, "Percentual de reabertura (mês anterior)", "tone-neutral")
          );
        }
        wrap.append(cardsPercentual);

        reaberturaEl.append(wrap);
      } else {
        const vazio = document.createElement("p");
        vazio.className = "hint";
        vazio.textContent = "Nenhum chamado criado nesse período no cache.";
        reaberturaEl.append(vazio);
      }
    }

    // 2ª página do carrossel (pedido explícito do usuário): gráfico de
    // linha, 1 ponto por dia do período selecionado, com baseline da
    // média diária dos últimos 3 meses.
    const atendimentoEl = $("material-icg-atendimento-diario");
    if (dados) {
      const atendimentoDiario = dados.atendimento_diario;
      const porMes = atendimentoDiario && atendimentoDiario.granularidade === "mes";
      $("material-icg-atendimento-titulo").textContent = `${porMes ? "Atendimento mensal" : "Atendimento diário"} — ${formatarDataBR(
        dados.inicio
      )} a ${formatarDataBR(dados.fim)}`;
      atendimentoEl.innerHTML = "";
      if (atendimentoDiario && atendimentoDiario.serie && atendimentoDiario.serie.length) {
        if (porMes) {
          renderizarIcgAtendimentoMensalChart(atendimentoEl, atendimentoDiario.serie);
        } else {
          renderizarIcgAtendimentoDiarioChart(
            atendimentoEl,
            atendimentoDiario.serie,
            atendimentoDiario.baseline_criados,
            atendimentoDiario.baseline_resolvidos
          );
        }
      } else {
        const vazio = document.createElement("p");
        vazio.className = "hint";
        vazio.textContent = "Nenhum chamado nesse período no cache.";
        atendimentoEl.append(vazio);
      }
    }

    statusEl.classList.remove("is-loading");
    statusEl.textContent = erros.join(" ");
  }

  $("material-icg-ano-select").addEventListener("change", () => {
    carregarMaterialIcg();
  });

  $("material-icg-filtro-tipo").addEventListener("change", () => {
    materialIcgAtualizarVisibilidadeFiltro();
    carregarMaterialIcg();
  });

  $("material-icg-mes-select").addEventListener("change", () => {
    carregarMaterialIcg();
  });

  $("material-icg-input-inicio").addEventListener("change", () => {
    carregarMaterialIcg();
  });

  $("material-icg-input-fim").addEventListener("change", () => {
    carregarMaterialIcg();
  });

  $("btn-material-icg").addEventListener("click", () => {
    closeAllDialogs();
    $("material-icg-results").classList.remove("hidden");
    carregarMaterialIcg();
  });

  $("btn-material-icg-recarregar").addEventListener("click", () => {
    carregarMaterialIcg();
  });

  // Carrossel de Material ICG (pedido explícito do usuário) — mesmo
  // mecanismo de atualizarParetoSubModalCarousel, instância própria.
  let materialIcgCarouselIndex = 0;

  function atualizarMaterialIcgCarousel() {
    const track = $("material-icg-carousel-track");
    const total = track.children.length;
    track.style.transform = `translateX(-${materialIcgCarouselIndex * 100}%)`;
    $("material-icg-carousel-prev").disabled = materialIcgCarouselIndex === 0;
    $("material-icg-carousel-next").disabled = materialIcgCarouselIndex >= total - 1;
    Array.from($("material-icg-carousel-dots").children).forEach((dot, i) => {
      dot.classList.toggle("active", i === materialIcgCarouselIndex);
    });
    // Plotly mede o container ao desenhar — reajusta ao entrar na página
    // do gráfico, caso a janela tenha mudado de tamanho nesse meio-tempo.
    const plotAtendimento = track.querySelector(".icg-atendimento-plot");
    if (plotAtendimento && typeof Plotly !== "undefined") Plotly.Plots.resize(plotAtendimento);
  }

  $("material-icg-carousel-prev").addEventListener("click", () => {
    if (materialIcgCarouselIndex > 0) {
      materialIcgCarouselIndex -= 1;
      atualizarMaterialIcgCarousel();
    }
  });
  $("material-icg-carousel-next").addEventListener("click", () => {
    if (materialIcgCarouselIndex < $("material-icg-carousel-track").children.length - 1) {
      materialIcgCarouselIndex += 1;
      atualizarMaterialIcgCarousel();
    }
  });
  Array.from($("material-icg-carousel-dots").children).forEach((dot, i) => {
    dot.addEventListener("click", () => {
      materialIcgCarouselIndex = i;
      atualizarMaterialIcgCarousel();
    });
  });

  // Seletor de grupo estilo Excel (pedido explícito do usuário) — usado
  // 2x em Material ICG: página 1 (SLA/Abertos/Reabertura, padrão N1+N2) e
  // "Atendimento diário" (padrão Tudo), cada um com estado próprio. Marca
  // as caixas no painel e só aplica (refaz o fetch) no "Confirmar";
  // "Cancelar" ou clicar fora descarta. "Tudo" é exclusivo com N1/N2/PROD
  // e o painel nunca fica sem nada marcado. Envia pro backend como lista
  // de chaves ("n1"/"n2"/"prod"/"tudo") — ver _resolver_grupos em
  // api/index.py. Devolve uma função que lê o estado JÁ CONFIRMADO.
  const MATERIAL_ICG_GRUPO_LABELS = { tudo: "Tudo", n1: "N1", n2: "N2", prod: "PROD" };

  function configurarFiltroGrupoExcel(raiz, estadoInicial, aoConfirmar) {
    let confirmado = [...estadoInicial];
    const btn = raiz.querySelector(".icg-filtro-grupo-btn");
    const label = raiz.querySelector(".icg-filtro-grupo-label");
    const painel = raiz.querySelector(".icg-filtro-grupo-painel");
    const checkboxes = Array.from(painel.querySelectorAll('input[type="checkbox"]'));
    const tudoEl = checkboxes.find((cb) => cb.value === "tudo");

    function normalizar(origem) {
      if (origem === "tudo" && tudoEl.checked) {
        checkboxes.forEach((cb) => {
          if (cb !== tudoEl) cb.checked = false;
        });
      } else if (origem !== "tudo") {
        tudoEl.checked = !checkboxes.some((cb) => cb.value !== "tudo" && cb.checked);
      }
      if (!checkboxes.some((cb) => cb.checked)) tudoEl.checked = true;
    }

    function abrir() {
      // Reseta pro estado JÁ CONFIRMADO (descarta marcação não confirmada).
      checkboxes.forEach((cb) => {
        cb.checked = confirmado.includes(cb.value);
      });
      painel.classList.remove("hidden");
    }

    function fechar() {
      painel.classList.add("hidden");
    }

    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (painel.classList.contains("hidden")) abrir();
      else fechar();
    });

    painel.addEventListener("click", (event) => {
      event.stopPropagation();
      const checkbox = event.target.closest('input[type="checkbox"]');
      if (checkbox) normalizar(checkbox.value);
    });

    raiz.querySelector(".icg-filtro-grupo-cancelar").addEventListener("click", fechar);

    raiz.querySelector(".icg-filtro-grupo-confirmar").addEventListener("click", () => {
      const marcados = checkboxes.filter((cb) => cb.checked).map((cb) => cb.value);
      confirmado = marcados.length ? marcados : ["tudo"];
      label.textContent = confirmado.map((g) => MATERIAL_ICG_GRUPO_LABELS[g]).join(", ");
      fechar();
      aoConfirmar();
    });

    document.addEventListener("click", (event) => {
      if (!painel.classList.contains("hidden") && !raiz.contains(event.target)) fechar();
    });

    return () => confirmado;
  }

  const materialIcgGruposIndicadores = configurarFiltroGrupoExcel(
    $("material-icg-filtro-grupo-indicadores"),
    ["n1", "n2"],
    () => carregarMaterialIcg()
  );
  const materialIcgGruposLinha = configurarFiltroGrupoExcel(
    $("material-icg-filtro-grupo-linha"),
    ["tudo"],
    () => carregarMaterialIcg()
  );

  // Mops Tv do Futuro separa "Categoria de Encerramento" em sub-blocos por
  // "APP"/"BOX" (tag no fim do nome da categoria, resolvida no backend —
  // ver _dividir_categorias_tv) em vez de uma lista só como Mops Solar;
  // "secao" chega como {app, box, outros?} nesse caso, em vez do formato
  // "chato" {categorias, total_chamados, total_categorizados}. Usado pelo
  // Report Vini (TOP 5 CATEGORIAS DE ENCERRAMENTO).
  function buildCategoriaTableEl(titulo, secao) {
    if (secao.categorias) {
      const holder = document.createElement("div");
      const h = document.createElement("div");
      h.className = "top-assignees-title";
      h.textContent = `${titulo} — ${secao.total_chamados} chamados (${secao.total_categorizados} categorizados)`;
      holder.append(h);

      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      const table = document.createElement("table");
      table.className = "data-table data-table--categorias";
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

    // Formato dividido (Tv do Futuro): Claro Tv + / Claro Streaming Box /
    // Outros (só se tiver algo)
    const holder = document.createElement("div");
    holder.append(buildCategoriaTableEl(`${titulo} — Claro Tv +`, secao.app));
    const boxEl = buildCategoriaTableEl(`${titulo} — Claro Streaming Box`, secao.box);
    boxEl.style.marginTop = "14px";
    holder.append(boxEl);
    if (secao.outros && secao.outros.categorias.length) {
      const outrosEl = buildCategoriaTableEl(`${titulo} — Outros (sem tag identificada)`, secao.outros);
      outrosEl.style.marginTop = "14px";
      holder.append(outrosEl);
    }
    return holder;
  }

  // Linhas "Categoria/Quantidade/%" pro PDF do Report Vini — recursivo
  // pelo mesmo motivo do buildCategoriaTableEl acima (formato dividido de
  // Mops Tv do Futuro).
  function categoriaSecoesPdf(tituloBase, secao) {
    if (secao.categorias) {
      return [
        {
          titulo: tituloBase,
          tabela: {
            fields: ["Categoria", "Quantidade", "%"],
            rows: secao.categorias.map((c) => ({ Categoria: c.categoria, Quantidade: c.quantidade, "%": c.percentual })),
          },
        },
      ];
    }
    const partes = [
      ...categoriaSecoesPdf(`${tituloBase} — Claro Tv +`, secao.app),
      ...categoriaSecoesPdf(`${tituloBase} — Claro Streaming Box`, secao.box),
    ];
    if (secao.outros && secao.outros.categorias.length) {
      partes.push(...categoriaSecoesPdf(`${tituloBase} — Outros`, secao.outros));
    }
    return partes;
  }


  // Home (#home-view): cada item de "O que cada ação faz" é um acordeão
  // próprio — clicar no botão abre só a query daquele item. Delegado no
  // container pra não precisar de um listener por item.
  $("home-view").addEventListener("click", (event) => {
    const toggle = event.target.closest(".query-dict-toggle");
    if (!toggle) return;
    const collapse = toggle.closest("dt").nextElementSibling.querySelector(".collapse");
    const abrindo = !collapse.classList.contains("open");
    collapse.classList.toggle("open", abrindo);
    toggle.setAttribute("aria-expanded", String(abrindo));
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
