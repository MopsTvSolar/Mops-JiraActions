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

  const otherActionButtons = [
    $("btn-gml"),
    $("btn-report-vini"),
    $("btn-tv-resolvidos-reabertos"),
    $("btn-cache"),
    $("btn-pareto-solar"),
    $("btn-om-mapa-calor"),
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

  buildCheckboxes($("vini-pdf-secoes-checkboxes"), VINI_PDF_SECOES, "vini-pdf-secao");

  // Seletor de PROJETOS removido do menu (pedido explícito do usuário) —
  // toda ação passa a considerar sempre os dois (INC+PDST), sem opção de
  // desmarcar um deles.
  function projetosSelecionados() {
    return PROJETOS_DISPONIVEIS.map((p) => p.value);
  }

  // Só um painel de opções fica aberto por vez: ao clicar em qualquer botão
  // (abra ele um painel próprio ou dispare uma ação na hora), os outros que
  // estavam abertos retraem primeiro.
  const ALL_DIALOG_IDS = [
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
    $("report-vini-results").classList.add("hidden");
    $("cache-results").classList.add("hidden");
    $("pareto-solar-results").classList.add("hidden");
    $("om-mapa-calor-results").classList.add("hidden");
    $("extracao-lote-results").classList.add("hidden");
    $("gml-lote-results").classList.add("hidden");
    $("extrato-categoria-results").classList.add("hidden");
    $("material-icg-results").classList.add("hidden");
    $("jornada-results").classList.add("hidden");
    $("colaboradores-det-results").classList.add("hidden");
    $("pareto-sub-modal").classList.add("hidden");
    hideHoverPopover();
  }

  // Home (#home-view) só aparece quando nada está selecionado: nenhum
  // diálogo de ação aberto e nenhum resultado visível. Em vez de espalhar
  // essa checagem em cada handler, observa as classes dos próprios
  // elementos e recalcula sozinho sempre que algum deles muda.
  const RESULT_BLOCK_IDS = [
    "report-vini-results",
    "cache-results",
    "pareto-solar-results",
    "om-mapa-calor-results",
    "extracao-lote-results",
    "gml-lote-results",
    "extrato-categoria-results",
    "material-icg-results",
    "jornada-results",
    "colaboradores-det-results",
  ];

  // Qual item do menu lateral corresponde a cada diálogo/resultado — usado só
  // pra destacar visualmente (.active) a ação atualmente aberta na tela,
  // igual um CRM marca a seção corrente no menu.
  const DIALOG_TO_NAV = {
    "report-vini-dialog": "btn-report-vini",
    "tv-resolvidos-reabertos-dialog": "btn-tv-resolvidos-reabertos",
  };

  const RESULT_TO_NAV = {
    "report-vini-results": "btn-report-vini",
    "cache-results": "btn-cache",
    "pareto-solar-results": "btn-pareto-solar",
    "om-mapa-calor-results": "btn-om-mapa-calor",
    "extracao-lote-results": "btn-extracao-lote",
    "gml-lote-results": "btn-gml",
    "extrato-categoria-results": "btn-extrato-categoria",
    "material-icg-results": "btn-material-icg",
    "jornada-results": "btn-jornada",
    "colaboradores-det-results": "btn-colaboradores-det",
  };

  const NAV_ITEM_IDS = [
    ...new Set([
      ...Object.values(DIALOG_TO_NAV),
      "btn-cache",
      "btn-pareto-solar",
      "btn-om-mapa-calor",
      "btn-extracao-lote",
      "btn-gml",
      "btn-extrato-categoria",
      "btn-material-icg",
      "btn-jornada",
      "btn-colaboradores-det",
    ]),
  ];

  function updateNavActiveState() {
    const dialogAberto = ALL_DIALOG_IDS.find((id) => $(id).classList.contains("open"));
    let activeNavId = null;
    if (dialogAberto) {
      activeNavId = DIALOG_TO_NAV[dialogAberto];
    } else {
      const resultVisivel = RESULT_BLOCK_IDS.find((id) => !$(id).classList.contains("hidden"));
      if (resultVisivel) {
        activeNavId = RESULT_TO_NAV[resultVisivel] || null;
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
    // Gráfico Plotly que estava escondido (display: none) foi medido com
    // largura 0 — o resize faz o "responsive" dele recalcular.
    window.dispatchEvent(new Event("resize"));
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
    if (!homeJaCarregada) {
      homeJaCarregada = true;
      $("home-iniciar-wrap").style.display = "none";
      $("home-dashboards").classList.remove("hidden");
      $("home-colaboradores-card").classList.remove("hidden");
    }
    carregarHomeDashboardsGradual();
  });

  // Tooltip nativo (title) com o nome da ação em cada item do menu — só é
  // visível de fato com o menu recolhido (ícone sozinho, sem rótulo), mas
  // não atrapalha em nada com o menu expandido.
  document.querySelectorAll(".nav-item").forEach((item) => {
    const label = item.querySelector(".nav-label");
    if (label && !item.title) item.title = label.textContent.trim();
  });

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
    [...otherActionButtons, $("btn-vini-gerar")].forEach((btn) => (btn.disabled = busy));
  }

  // Converte "aaaa-mm-dd" (valor de <input type="date"> e do campo "data" dos
  // dias de Criados x Resolvidos) para "dd/mm/aaaa".
  function formatarDataBR(isoDate) {
    const [ano, mes, dia] = isoDate.split("-");
    return `${dia}/${mes}/${ano}`;
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
      carregarHomeColaboradoresCache,
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
    ["home-cr-kpi", carregarHomeCriadosResolvidosCache],
    ["home-cr-tabela", carregarHomeCriadosResolvidosCache],
    ["home-grupo-criacao", carregarHomeGrupoCriacao],
    ["home-fornecedor-criacao", carregarHomeFornecedorCriacao],
    ["home-forn-ranking", carregarHomeFornecedorCriacao],
    ["home-forn-kpi", carregarHomeFornecedorCriacao],
    ["home-reabertos-mes", carregarHomeReabertosMes],
    ["home-colaboradores-mes", carregarHomeColaboradoresCache],
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

  // "Fila dinâmica": carrossel de 3 páginas da home. A altura do viewport
  // acompanha o slide ativo (senão a página mais baixa fica com o vão da
  // mais alta) e é reajustada quando o conteúdo dos loaders chega.
  function iniciarHomeFilaCarrossel() {
    const raiz = $("home-fila");
    const viewport = raiz.querySelector(".pareto-sub-modal-viewport");
    const track = raiz.querySelector(".home-fila-track");
    const slides = Array.from(track.children);
    const tabs = Array.from(raiz.querySelectorAll(".home-fila-tab"));
    const dots = Array.from(raiz.querySelectorAll(".home-fila-dots .pareto-sub-modal-dot"));
    const prev = raiz.querySelector(".home-fila-prev");
    const next = raiz.querySelector(".home-fila-next");
    let atual = 0;

    function ajustarAltura() {
      const h = slides[atual].offsetHeight;
      if (h) viewport.style.height = `${h}px`;
    }

    function irPara(i) {
      atual = Math.max(0, Math.min(slides.length - 1, i));
      track.style.transform = `translateX(-${atual * 100}%)`;
      tabs.forEach((t, k) => t.classList.toggle("active", k === atual));
      dots.forEach((d, k) => d.classList.toggle("active", k === atual));
      prev.disabled = atual === 0;
      next.disabled = atual === slides.length - 1;
      ajustarAltura();
      // Plotly dentro de slide recém-exibido recalcula a largura.
      window.dispatchEvent(new Event("resize"));
    }

    tabs.forEach((t) => t.addEventListener("click", () => irPara(Number(t.dataset.slide))));
    dots.forEach((d) => d.addEventListener("click", () => irPara(Number(d.dataset.slide))));
    prev.addEventListener("click", () => irPara(atual - 1));
    next.addEventListener("click", () => irPara(atual + 1));
    const obs = new ResizeObserver(ajustarAltura);
    slides.forEach((s) => obs.observe(s));
    irPara(0);
  }
  iniciarHomeFilaCarrossel();

  // ------------------------------------------------------------ conexão
  let homeJaCarregada = false;

  function entrarNoApp(displayName, email) {
    $("status-identity").textContent = `Conectado como ${displayName} (${email})`;
    loginCard.classList.add("hidden");
    appView.classList.remove("hidden");
    if (!homeJaCarregada) carregarHomeCacheStatus();
  }

  // Tela de largada: frescor de cada partição do cache (selo pela idade da
  // última sincronização). Clicar num card abre a tela de Cache.
  const HOME_CACHE_FRESCOR = [
    { ateHoras: 24, tom: "success", texto: "Atualizado" },
    { ateHoras: 72, tom: "warning", texto: "Desatualizando" },
    { ateHoras: Infinity, tom: "danger", texto: "Desatualizado" },
  ];

  function homeTempoRelativo(horas) {
    if (horas < 1) return "há menos de 1 h";
    if (horas < 24) return `há ${Math.floor(horas)} h`;
    const dias = Math.floor(horas / 24);
    return `há ${dias} dia${dias === 1 ? "" : "s"}`;
  }

  async function carregarHomeCacheStatus() {
    const grid = $("home-cache-status");
    homeCardErro(grid, "Carregando...");
    try {
      // Mesmas seções da tela de Cache (localStorage) — removida lá, some aqui.
      const secoes = cacheSecoes.map(({ id, label, caixa, pasta }) => ({ id, label, caixa, pasta }));
      const resp = await apiCall("/api/home-cache-status", { secoes });
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(grid, data.error || "Erro ao carregar.");
        return;
      }
      grid.innerHTML = "";
      const agora = new Date(data.agora);
      data.particoes.forEach((p) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "home-cache-card";
        card.dataset.secaoId = p.id;
        card.addEventListener("click", () => $("btn-cache").click());

        let selo = { tom: "neutro", texto: p.existe ? "Sem planilhas" : "Pasta não encontrada" };
        let quando = "—";
        if (p.ultima_sync) {
          const sync = new Date(p.ultima_sync);
          const horas = (agora - sync) / 3600000;
          selo = HOME_CACHE_FRESCOR.find((f) => horas <= f.ateHoras);
          quando = `${sync.toLocaleDateString("pt-BR")} ${sync.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · ${homeTempoRelativo(horas)}`;
        }
        card.classList.add(`home-cache-card--${selo.tom}`);

        const topo = document.createElement("div");
        topo.className = "home-cache-card-topo";
        const nome = document.createElement("strong");
        nome.textContent = p.label;
        const tag = document.createElement("span");
        tag.className = "home-cache-selo";
        tag.textContent = selo.texto;
        topo.append(nome, tag);

        const linhaSync = document.createElement("div");
        linhaSync.className = "home-cache-card-sync";
        linhaSync.textContent = quando;

        const linhaInfo = document.createElement("div");
        linhaInfo.className = "home-cache-card-info";
        linhaInfo.textContent = `${p.planilhas} planilha${p.planilhas === 1 ? "" : "s"} · ${(p.tamanho_bytes / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

        card.append(topo, linhaSync, linhaInfo);
        grid.append(card);
      });
      // A sincronização re-renderiza os cards no meio (salvarSecoesCache) —
      // reaplica a barra no card que está rodando.
      aplicarBarraSyncHome();
    } catch (e) {
      homeCardErro(grid, "Não foi possível conectar ao servidor.");
    }
  }

  // Barra de progresso no rodapé do card da seção sincronizando agora
  // ({id, pct} enquanto roda, null fora disso).
  let homeCacheSyncAtivo = null;

  function aplicarBarraSyncHome() {
    if (!homeCacheSyncAtivo) return;
    const card = Array.from(document.querySelectorAll("#home-cache-status .home-cache-card")).find(
      (c) => c.dataset.secaoId === homeCacheSyncAtivo.id
    );
    if (!card) return;
    card.classList.add("home-cache-card--rodando");
    let barra = card.querySelector(".home-cache-card-barra");
    if (!barra) {
      barra = document.createElement("span");
      barra.className = "home-cache-card-barra";
      barra.append(document.createElement("span"));
      card.append(barra);
    }
    const pct = Math.round(homeCacheSyncAtivo.pct * 100);
    barra.firstElementChild.style.width = `${Math.max(3, pct)}%`;
    const selo = card.querySelector(".home-cache-selo");
    if (selo) selo.textContent = `Sincronizando ${pct}%`;
  }

  // Progresso da seção a partir dos textos que o "Sincronizar tudo" já
  // atualiza: botão da seção ("Sincronizando 2/10...") = arquivo atual/total;
  // status ("lote 03/10", "buscando chamados novos") = fração dentro do arquivo.
  function progressoSyncSecao(secao) {
    const arq = /(\d+)\s*\/\s*(\d+)/.exec(secao.el.btnSincronizarTudo.textContent || "");
    if (!arq) return 0;
    const atual = Number(arq[1]);
    const total = Number(arq[2]) || 1;
    const status = secao.el.statusEl.textContent || "";
    const lote = /lote\s+(\d+)\s*\/\s*(\d+)/i.exec(status);
    let frac = 0;
    if (lote) frac = (Number(lote[1]) - 1) / (Number(lote[2]) || 1);
    else if (/chamados novos/i.test(status)) frac = 0.95;
    return Math.min(1, (atual - 1 + frac) / total);
  }

  // ↻ da tela de largada: sincroniza TODAS as seções da tela de Cache, na
  // ordem dela, uma de cada vez — cada seção pelo mesmo "Sincronizar tudo"
  // da tela de Cache (sincronizarTudoSecao: um arquivo por vez, lotes de
  // CACHE_SYNC_LOTE chamados), nunca em paralelo, pra não pesar a API.
  // Seção ainda não aberta na tela de Cache ganha o DOM dela fora da tela
  // (construirSecaoCache); o texto de status de cada uma é espelhado aqui.
  let cacheSyncGeralRodando = false;

  async function sincronizarTodosCaches() {
    if (cacheSyncGeralRodando) return;
    if (!window.confirm("Sincronizar todos os caches agora? Roda seção por seção, em lotes, e pode levar alguns minutos.")) return;
    cacheSyncGeralRodando = true;
    const btn = $("btn-home-cache-status");
    const statusEl = $("home-cache-sync-status");
    btn.disabled = true;
    btn.classList.add("home-reload-btn--girando");
    const secoes = [...cacheSecoes];
    try {
      for (let i = 0; i < secoes.length; i++) {
        const secao = secoes[i];
        const prefixo = `${i + 1}/${secoes.length} · ${secao.label}`;
        statusEl.textContent = `${prefixo}: listando planilhas...`;
        if (!secao.el) construirSecaoCache(secao);
        homeCacheSyncAtivo = { id: secao.id, pct: 0 };
        aplicarBarraSyncHome();
        const espelho = new MutationObserver(() => {
          const t = secao.el.statusEl.textContent;
          if (t) statusEl.textContent = `${prefixo}: ${t}`;
          homeCacheSyncAtivo.pct = Math.max(homeCacheSyncAtivo.pct, progressoSyncSecao(secao));
          aplicarBarraSyncHome();
        });
        const opcoes = { childList: true, characterData: true, subtree: true };
        espelho.observe(secao.el.statusEl, opcoes);
        espelho.observe(secao.el.btnSincronizarTudo, opcoes);
        try {
          await carregarSecaoCache(secao);
          await sincronizarTudoSecao(secao);
        } finally {
          espelho.disconnect();
          homeCacheSyncAtivo = null;
        }
        await carregarHomeCacheStatus();
      }
      statusEl.textContent = `Sincronização concluída (${secoes.length} seç${secoes.length === 1 ? "ão" : "ões"}).`;
    } catch (e) {
      statusEl.textContent = "Sincronização interrompida: não foi possível conectar ao servidor.";
    } finally {
      cacheSyncGeralRodando = false;
      btn.disabled = false;
      btn.classList.remove("home-reload-btn--girando");
    }
  }

  $("btn-home-cache-status").addEventListener("click", sincronizarTodosCaches);

  document.querySelectorAll(".home-atalho").forEach((btn) => {
    btn.addEventListener("click", () => $(btn.dataset.alvo).click());
  });

  $("btn-home-iniciar").addEventListener("click", () => {
    if (homeJaCarregada) return;
    homeJaCarregada = true;
    $("home-iniciar-wrap").style.display = "none";
    $("home-dashboards").classList.remove("hidden");
    $("home-colaboradores-card").classList.remove("hidden");
    carregarHomeDashboardsGradual();
  });

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
      entrarNoApp(data.displayName, email);
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

  // KPI "hero" da Fila dinâmica: número grande + rótulo, barra de proporção
  // (segmentos sobre "total") e legenda com os valores — cada cor sempre
  // com o mesmo significado (tom: danger/warning/accent/success/neutro).
  function construirHomeKpi({ valor, tom, rotulo, segmentos = [], total = 0, legenda = [], rodape }) {
    const kpi = document.createElement("div");
    kpi.className = "home-kpi";

    const valorEl = document.createElement("div");
    valorEl.className = `home-kpi-valor home-kpi--${tom}`;
    valorEl.textContent = valor;
    const rotuloEl = document.createElement("div");
    rotuloEl.className = "home-kpi-rotulo";
    rotuloEl.textContent = rotulo;
    kpi.append(valorEl, rotuloEl);

    if (segmentos.length) {
      const barra = document.createElement("div");
      barra.className = "home-kpi-barra";
      segmentos.forEach((s) => {
        const seg = document.createElement("span");
        seg.className = `home-kpi-seg home-kpi--${s.tom}`;
        seg.style.width = `${total > 0 ? Math.min(100, (s.valor / total) * 100) : 0}%`;
        barra.append(seg);
      });
      kpi.append(barra);
    }

    if (legenda.length) {
      const lista = document.createElement("ul");
      lista.className = "home-kpi-legenda";
      legenda.forEach((item) => {
        const li = document.createElement("li");
        const dot = document.createElement("span");
        dot.className = `home-kpi-dot home-kpi--${item.tom}`;
        const texto = document.createElement("span");
        texto.className = "home-kpi-legenda-texto";
        texto.textContent = item.texto;
        const v = document.createElement("strong");
        v.textContent = item.valor;
        li.append(dot, texto, v);
        lista.append(li);
      });
      kpi.append(lista);
    }

    if (rodape) {
      const r = document.createElement("div");
      r.className = "home-kpi-rodape";
      r.textContent = rodape;
      kpi.append(r);
    }
    return kpi;
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

    // Mapa de calor: intensidade da célula proporcional ao maior valor da
    // tabela (sem contar totais) — destaca na hora onde está o acúmulo.
    const maxCelula = Math.max(0, ...dados.linhas.flatMap((l) => l.por_mes));

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
        if (valor > 0 && maxCelula > 0) {
          td.className = "home-heat-cell";
          td.style.setProperty("--heat", (valor / maxCelula).toFixed(3));
        }
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

      data.caixas.forEach(({ caixa, percentual_reabertura: pct, total_criados_periodo: criados, total_reabertos: reabertos }) => {
        const kpi = construirHomeKpi({
          valor: `${pct.toLocaleString("pt-BR")}%`,
          tom: "warning",
          rotulo: `Reabertura — ${HOME_CAIXA_LABEL[caixa] || caixa}`,
          segmentos: [{ valor: reabertos, tom: "warning" }],
          total: criados,
          legenda: [
            { tom: "warning", texto: "Reabertos", valor: reabertos.toLocaleString("pt-BR") },
            { tom: "neutro", texto: "Criados no mês", valor: criados.toLocaleString("pt-BR") },
          ],
        });
        kpi.dataset.caixa = caixa;
        reabertosEl.append(kpi);
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

  const HOME_CR_COR_BASELINE = "#f5a524";

  function homeMesCurto(mes) {
    return `${formatarMesAno(mes).split(" ")[0]}/${mes.slice(2, 4)}`;
  }

  function homeDeltaTexto(atual, anterior) {
    if (!anterior) return "—";
    const pct = ((atual - anterior) / anterior) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1).replace(".", ",")}%`;
  }

  // Gráfico "Criados x Resolvidos por mês" (Plotly, largura fluida): barras
  // agrupadas com o número em cima + baselines fixas tracejadas
  // (CRIADOS_RESOLVIDOS_BASELINES) com o valor à esquerda do eixo. "alvo"
  // já precisa estar no DOM (o Plotly mede a largura dele).
  function desenharCriadosResolvidosChart(alvo, meses, linhasPorMes) {
    const grafico = icgAtendimentoCriarGrafico(alvo);
    if (!grafico) return;
    const porMes = Object.fromEntries(linhasPorMes.map((item) => [item.mes, item]));
    const x = meses.map(homeMesCurto);
    const criados = meses.map((m) => (porMes[m] || {}).criados || 0);
    const resolvidos = meses.map((m) => (porMes[m] || {}).resolvidos || 0);
    const maior = Math.max(1, ...criados, ...resolvidos, ...CRIADOS_RESOLVIDOS_BASELINES);

    const barra = (nome, ys, cor) => ({
      type: "bar",
      name: nome,
      x,
      y: ys,
      marker: { color: cor },
      text: ys.map((v) => v.toLocaleString("pt-BR")),
      textposition: "outside",
      textfont: { size: 11, color: "#eef1f6" },
      cliponaxis: false,
      hovertemplate: `${nome}: %{y}<extra></extra>`,
    });

    const layout = icgAtendimentoLayout(maior * 1.08, null, null, {}, []);
    layout.xaxis = { ...layout.xaxis, type: "category" };
    delete layout.xaxis.range;
    delete layout.xaxis.minallowed;
    delete layout.xaxis.maxallowed;
    layout.height = 360;
    layout.barmode = "group";
    layout.bargap = 0.28;
    layout.bargroupgap = 0.08;
    layout.margin = { l: 56, r: 16, t: 24, b: 40 };
    layout.legend = { ...layout.legend, y: -0.14 };
    layout.shapes = CRIADOS_RESOLVIDOS_BASELINES.map((v) => ({
      type: "line",
      xref: "paper",
      x0: 0,
      x1: 1,
      yref: "y",
      y0: v,
      y1: v,
      line: { color: HOME_CR_COR_BASELINE, width: 1.5, dash: "dash" },
    }));
    layout.annotations = CRIADOS_RESOLVIDOS_BASELINES.map((v) => ({
      xref: "paper",
      x: 0,
      xanchor: "right",
      xshift: -6,
      y: v,
      yref: "y",
      text: `<b>${v.toLocaleString("pt-BR")}</b>`,
      showarrow: false,
      font: { color: HOME_CR_COR_BASELINE, size: 11 },
    }));

    Plotly.newPlot(
      grafico,
      [barra("Criados", criados, ICG_ATENDIMENTO_CORES.criados), barra("Resolvidos", resolvidos, ICG_ATENDIMENTO_CORES.resolvidos)],
      layout,
      icgAtendimentoConfig("criados-x-resolvidos")
    );
  }

  // KPIs do mês atual (parcial, até hoje): Criados e Resolvidos com
  // comparação contra o mês anterior e a média dos 3 meses anteriores.
  function construirCriadosResolvidosKpis(meses, linhasPorMes) {
    const porMes = Object.fromEntries(linhasPorMes.map((item) => [item.mes, item]));
    const hoje = new Date();
    const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
    const idx = meses.includes(mesAtual) ? meses.indexOf(mesAtual) : meses.length - 1;
    const mes = meses[idx];
    const vazio = { criados: 0, resolvidos: 0 };
    const atual = porMes[mes] || vazio;
    const anterior = porMes[meses[idx - 1]] || vazio;
    const ultimos3 = meses.slice(Math.max(0, idx - 3), idx).map((m) => porMes[m] || vazio);
    const media = (campo) => (ultimos3.length ? Math.round(ultimos3.reduce((s, m) => s + m[campo], 0) / ultimos3.length) : 0);
    const fmt = (n) => n.toLocaleString("pt-BR");
    const saldo = atual.resolvidos - atual.criados;
    const taxa = atual.criados ? `${((atual.resolvidos / atual.criados) * 100).toFixed(1).replace(".", ",")}%` : "—";

    const frag = document.createDocumentFragment();
    frag.append(
      construirHomeKpi({
        valor: fmt(atual.criados),
        tom: "danger",
        rotulo: `Criados — ${formatarMesAno(mes)}`,
        legenda: [
          { tom: "neutro", texto: `Vs. mês anterior (${fmt(anterior.criados)})`, valor: homeDeltaTexto(atual.criados, anterior.criados) },
          { tom: "neutro", texto: "Média 3 meses anteriores", valor: fmt(media("criados")) },
        ],
      }),
      construirHomeKpi({
        valor: fmt(atual.resolvidos),
        tom: "success",
        rotulo: `Resolvidos — ${formatarMesAno(mes)}`,
        segmentos: [{ valor: atual.resolvidos, tom: "success" }],
        total: Math.max(atual.criados, atual.resolvidos),
        legenda: [
          { tom: "success", texto: "Taxa de resolução (resolvidos ÷ criados)", valor: taxa },
          { tom: saldo >= 0 ? "success" : "danger", texto: "Saldo (resolvidos − criados)", valor: `${saldo > 0 ? "+" : ""}${fmt(saldo)}` },
          { tom: "neutro", texto: "Média 3 meses anteriores", valor: fmt(media("resolvidos")) },
        ],
      })
    );
    return frag;
  }

  // Tabela mês a mês (mais recente primeiro): saldo colorido pelo sinal e
  // % de reabertura (reabertos ÷ criados, mesmo bucket por criação).
  function construirCriadosResolvidosTabela(meses, linhasPorMes) {
    const porMes = Object.fromEntries(linhasPorMes.map((item) => [item.mes, item]));
    const fmt = (n) => n.toLocaleString("pt-BR");
    const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1).replace(".", ",")}%` : "—");

    const table = document.createElement("table");
    table.className = "data-table home-dashboard-table";
    const thead = document.createElement("thead");
    const trH = document.createElement("tr");
    ["Mês", "Criados", "Resolvidos", "Saldo", "% Resolução", "Reabertos", "% Reabertura"].forEach((t) => {
      const th = document.createElement("th");
      th.textContent = t;
      trH.append(th);
    });
    thead.append(trH);

    const tbody = document.createElement("tbody");
    const tot = { criados: 0, resolvidos: 0, reabertos: 0 };
    const linha = (rotulo, m, classe) => {
      const tr = document.createElement("tr");
      if (classe) tr.className = classe;
      const saldo = m.resolvidos - m.criados;
      [
        rotulo,
        fmt(m.criados),
        fmt(m.resolvidos),
        `${saldo > 0 ? "+" : ""}${fmt(saldo)}`,
        pct(m.resolvidos, m.criados),
        fmt(m.reabertos),
        pct(m.reabertos, m.criados),
      ].forEach((txt, i) => {
        const td = document.createElement("td");
        td.textContent = txt;
        if (i === 3 && saldo !== 0) td.className = saldo > 0 ? "home-num-bom" : "home-num-ruim";
        tr.append(td);
      });
      return tr;
    };
    [...meses].reverse().forEach((mes) => {
      const m = { criados: 0, resolvidos: 0, reabertos: 0, ...(porMes[mes] || {}) };
      tot.criados += m.criados;
      tot.resolvidos += m.resolvidos;
      tot.reabertos += m.reabertos;
      tbody.append(linha(formatarMesAno(mes), m));
    });
    tbody.append(linha("Total", tot, "data-table-total-row"));
    table.append(thead, tbody);

    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    wrap.append(table);
    return wrap;
  }

  // "Criados x Resolvidos por mês" (tag "Cacheado"): histórico de todos os
  // meses do cache, por caixa (Solar: N1+N2+Prod juntos; Claro Tv: N1+N2
  // juntos — ver _cache_criados_resolvidos_historico em api/index.py). Uma
  // única chamada alimenta os 3 tiles da página 2 da Fila dinâmica
  // (gráfico, KPIs do mês, tabela); cada bloco marcado com data-caixa — o
  // seletor global do painel (aplicarHomeCaixaFiltro) esconde o que não
  // está selecionado via CSS, igual aos outros widgets da home.
  async function carregarHomeCriadosResolvidosCache() {
    const alvos = ["home-criados-resolvidos-mes", "home-cr-kpi", "home-cr-tabela"].map((id) => $(id));
    alvos.forEach((el) => homeCardErro(el, "Carregando..."));

    try {
      const resp = await apiCall("/api/home-criados-resolvidos-cache", {});
      const data = await resp.json();
      if (!resp.ok) {
        alvos.forEach((el) => homeCardErro(el, data.error || "Erro ao carregar."));
        return;
      }
      if (!data.meses.length) {
        alvos.forEach((el) => homeCardErro(el, "Nenhum chamado nas planilhas de cache."));
        return;
      }

      const [chartEl, kpiEl, tabelaEl] = alvos;
      alvos.forEach((el) => {
        el.innerHTML = "";
      });
      Object.entries(data.caixas).forEach(([caixaId, linhas]) => {
        const blocoChart = document.createElement("div");
        blocoChart.dataset.caixa = caixaId;
        chartEl.append(blocoChart);
        desenharCriadosResolvidosChart(blocoChart, data.meses, linhas);

        const blocoKpi = document.createElement("div");
        blocoKpi.className = "home-kpi-lista";
        blocoKpi.dataset.caixa = caixaId;
        blocoKpi.append(construirCriadosResolvidosKpis(data.meses, linhas));
        kpiEl.append(blocoKpi);

        const blocoTabela = document.createElement("div");
        blocoTabela.dataset.caixa = caixaId;
        blocoTabela.append(construirCriadosResolvidosTabela(data.meses, linhas));
        tabelaEl.append(blocoTabela);
      });
    } catch (e) {
      alvos.forEach((el) => homeCardErro(el, "Não foi possível conectar ao servidor."));
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
        // Clicar na tabela abre o popup com os chamados abertos por status
        // e semana.
        tornarClicavelPorSemana(wrap, {
          caixa,
          dados,
          titulo: "Chamados abertos por status e semana",
          montarSlides: () => {
            const chamados = (dados.chamados || []).map((c) => ({ ...c, grupoCurto: GRUPO_LABEL_CURTO[c.grupo] || c.grupo }));
            if (!chamados.length) return [];
            const grupos = ["N1", "N2", "PROD"].filter((g) => chamados.some((c) => c.grupoCurto === g));
            return [
              // 1) Status × semana, com filtro de caixa (N1/N2/PROD) dinâmico.
              ...construirSlidesSemanas(chamados, "status", "Status", {
                rotulo: "Status por semana",
                filtro: { campo: "grupoCurto", titulo: "Caixa", opcoes: grupos },
              }),
              // 2) Grupo Solucionador × semana.
              ...construirSlidesSemanas(chamados, "grupoCurto", "Grupo Solucionador", { rotulo: "Grupo por semana" }),
              // 3) Pareto de Classificação.
              construirSlideParetoClassificacao(chamados, {
                filtro: { campo: "grupoCurto", titulo: "Caixa", opcoes: grupos },
              }),
            ];
          },
        });
        container.append(homeCaixaSubbloco(caixa, wrap));
      });
    } catch (e) {
      homeCardErro(container, "Não foi possível conectar ao servidor.");
    }
  }

  // ------------------------------------------- popup carrossel dos gráficos da home
  // Clicar num gráfico da home abre este popup (mesmo visual do drill-down
  // do Pareto). "slides" = [{rotulo, el}] — cada gráfico monta os seus; o
  // popup só cuida de título, navegação (setas/pontos/Esc) e fechar.
  let homeCarrosselIndex = 0;

  function atualizarHomeCarrossel() {
    const track = $("home-carrossel-track");
    track.style.transform = `translateX(-${homeCarrosselIndex * 100}%)`;
    $("home-carrossel-prev").disabled = homeCarrosselIndex === 0;
    $("home-carrossel-next").disabled = homeCarrosselIndex >= track.children.length - 1;
    Array.from($("home-carrossel-dots").children).forEach((dot, i) => {
      dot.classList.toggle("active", i === homeCarrosselIndex);
    });
  }

  function abrirHomeCarrossel(titulo, slides) {
    const track = $("home-carrossel-track");
    const dotsEl = $("home-carrossel-dots");
    $("home-carrossel-titulo").textContent = titulo;
    track.innerHTML = "";
    dotsEl.innerHTML = "";

    slides.forEach(({ rotulo, el }, i) => {
      const slide = document.createElement("div");
      slide.className = "pareto-sub-modal-slide";
      slide.append(el);
      track.append(slide);

      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "pareto-sub-modal-dot";
      dot.setAttribute("aria-label", rotulo);
      dot.title = rotulo;
      dot.addEventListener("click", () => {
        homeCarrosselIndex = i;
        atualizarHomeCarrossel();
      });
      dotsEl.append(dot);
    });

    homeCarrosselIndex = 0;
    atualizarHomeCarrossel();
    // Um slide só: sem setas nem pontos.
    const navegavel = slides.length > 1;
    $("home-carrossel-prev").classList.toggle("hidden", !navegavel);
    $("home-carrossel-next").classList.toggle("hidden", !navegavel);
    dotsEl.classList.toggle("hidden", !navegavel);
    $("home-carrossel-modal").classList.remove("hidden");
    // Slides que só podem desenhar com o popup visível (ex.: Plotly).
    slides.forEach(({ aoAbrir }) => aoAbrir && aoAbrir());
  }

  function fecharHomeCarrossel() {
    $("home-carrossel-modal").classList.add("hidden");
  }

  $("home-carrossel-prev").addEventListener("click", () => {
    if (homeCarrosselIndex > 0) {
      homeCarrosselIndex -= 1;
      atualizarHomeCarrossel();
    }
  });
  $("home-carrossel-next").addEventListener("click", () => {
    if (homeCarrosselIndex < $("home-carrossel-track").children.length - 1) {
      homeCarrosselIndex += 1;
      atualizarHomeCarrossel();
    }
  });
  $("btn-home-carrossel-fechar").addEventListener("click", fecharHomeCarrossel);
  $("home-carrossel-modal").addEventListener("click", (e) => {
    if (e.target.id === "home-carrossel-modal") fecharHomeCarrossel();
  });
  document.addEventListener("keydown", (e) => {
    if ($("home-carrossel-modal").classList.contains("hidden")) return;
    if (e.key === "Escape") fecharHomeCarrossel();
    else if (e.key === "ArrowLeft") $("home-carrossel-prev").click();
    else if (e.key === "ArrowRight") $("home-carrossel-next").click();
  });

  // "Fornecedor Responsável × Mês de Criação": os mesmos chamados (em
  // "Aguardando Fornecedor") abertos por SEMANA, tudo numa tabela só: 1
  // coluna por conjunto de 7 dias seguidos contados a partir de hoje (o
  // último conjunto = últimos 7 dias, o anterior = 7 dias antes, e assim
  // por diante), do mais antigo ao mais recente. Itens zerados ficam
  // ocultos: conjunto sem nenhum chamado não vira coluna e linha sem
  // chamado não existe. "campo" = propriedade de cada chamado que vira linha
  // (ex.: "fornecedor", "status"), "rotuloLinha" = título da 1ª coluna.
  // Devolve o conteúdo (info + tabela + soma) como um <div>.
  function construirCorpoSemanas(chamados, campo, rotuloLinha) {
    if (!chamados.length) {
      const vazio = document.createElement("div");
      vazio.className = "hint";
      vazio.textContent = "Nenhum chamado para o filtro selecionado.";
      return vazio;
    }
    const hoje = new Date();
    hoje.setHours(12, 0, 0, 0);
    const dd = (n) => String(n).padStart(2, "0");
    const iso = (data) => `${data.getFullYear()}-${dd(data.getMonth() + 1)}-${dd(data.getDate())}`;
    const curto = (data) => `${dd(data.getDate())}/${dd(data.getMonth() + 1)}`;

    // conjunto (0 = últimos 7 dias) -> fornecedor -> keys
    const porConjunto = new Map();
    const totalPorFornecedor = new Map();
    chamados.forEach((chamado) => {
      const fornecedor = chamado[campo] || "(vazio)";
      const { criado, key } = chamado;
      const diasAtras = Math.max(0, Math.round((hoje - new Date(`${criado}T12:00:00`)) / 86400000));
      const conjunto = Math.floor(diasAtras / 7);
      if (!porConjunto.has(conjunto)) porConjunto.set(conjunto, new Map());
      const doConjunto = porConjunto.get(conjunto);
      if (!doConjunto.has(fornecedor)) doConjunto.set(fornecedor, []);
      doConjunto.get(fornecedor).push(key);
      totalPorFornecedor.set(fornecedor, (totalPorFornecedor.get(fornecedor) || 0) + 1);
    });

    // Mais antigo à esquerda, mais recente à direita.
    const conjuntos = [...porConjunto.keys()].sort((a, b) => b - a);
    const fornecedores = [...totalPorFornecedor.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([fornecedor]) => fornecedor);
    const periodoDe = (c) => {
      const fim = new Date(hoje);
      fim.setDate(hoje.getDate() - c * 7);
      const inicio = new Date(fim);
      inicio.setDate(fim.getDate() - 6);
      return { inicio, fim };
    };

    const el = document.createElement("div");
    const info = document.createElement("div");
    info.className = "pareto-subtitulo-info";
    info.textContent = `${chamados.length} chamado${chamados.length === 1 ? "" : "s"} · cada coluna = conjunto de 7 dias (a última = últimos 7 dias, até hoje) · verde = dentro de 1 semana, vermelho = mais de 1 semana`;

    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const table = document.createElement("table");
    table.className = "data-table home-dashboard-table home-semana-tabela";

    const trHead = document.createElement("tr");
    const thNome = document.createElement("th");
    thNome.textContent = rotuloLinha;
    trHead.append(thNome);
    conjuntos.forEach((c) => {
      const { inicio, fim } = periodoDe(c);
      const th = document.createElement("th");
      th.className = "home-semana-col-data";
      // Texto na vertical (span próprio: o th em si fica como célula normal).
      const rotulo = document.createElement("span");
      rotulo.className = "home-semana-vertical";
      rotulo.textContent = `${curto(inicio)} a ${curto(fim)}`;
      th.append(rotulo);
      th.title = `${formatarDataBR(iso(inicio))} a ${formatarDataBR(iso(fim))}`;
      trHead.append(th);
    });
    const thTotal = document.createElement("th");
    thTotal.textContent = "Total";
    trHead.append(thTotal);
    const thead = document.createElement("thead");
    thead.append(trHead);

    const tbody = document.createElement("tbody");
    fornecedores.forEach((fornecedor) => {
      const tr = document.createElement("tr");
      const tdNome = document.createElement("td");
      tdNome.textContent = fornecedor;
      tr.append(tdNome);
      conjuntos.forEach((c) => {
        const keys = porConjunto.get(c).get(fornecedor) || [];
        const td = document.createElement("td");
        td.textContent = keys.length || "-";
        if (keys.length) {
          td.title = keys.join(", ");
          td.classList.add(c === 0 ? "home-semana-no-prazo" : "home-semana-atrasado");
        }
        tr.append(td);
      });
      const tdTotal = document.createElement("td");
      tdTotal.textContent = totalPorFornecedor.get(fornecedor);
      tr.append(tdTotal);
      tbody.append(tr);
    });

    const trTotal = document.createElement("tr");
    trTotal.className = "data-table-total-row";
    const tdLabel = document.createElement("td");
    tdLabel.textContent = "Total (issues)";
    trTotal.append(tdLabel);
    [...conjuntos.map((c) => [...porConjunto.get(c).values()].reduce((soma, k) => soma + k.length, 0)), chamados.length].forEach(
      (valor, indice) => {
        const td = document.createElement("td");
        td.textContent = valor;
        // Colunas de semana (todas menos a última, o Total): mesma cor das células.
        if (indice < conjuntos.length) td.classList.add(conjuntos[indice] === 0 ? "home-semana-no-prazo" : "home-semana-atrasado");
        trTotal.append(td);
      }
    );
    tbody.append(trTotal);

    table.append(thead, tbody);
    wrap.append(table);

    // Soma estilo Excel na linha "Total (issues)": clicar numa célula
    // seleciona (clicar de novo desmarca), arrastrar seleciona um
    // intervalo, Ctrl/Shift+clique soma com a seleção atual. A soma das
    // células selecionadas aparece abaixo da tabela.
    const somaEl = document.createElement("div");
    somaEl.className = "home-semana-soma hint";
    const SOMA_DICA = "Selecione valores na linha Total (issues) (clique ou arraste) para ver a soma.";
    somaEl.textContent = SOMA_DICA;

    const celulasTotal = [...trTotal.children].slice(1);
    const selecionadas = new Set();
    function atualizarSoma() {
      celulasTotal.forEach((td) => td.classList.toggle("home-semana-selecionada", selecionadas.has(td)));
      if (!selecionadas.size) {
        somaEl.textContent = SOMA_DICA;
        somaEl.classList.remove("home-semana-soma--ativa");
        return;
      }
      const soma = [...selecionadas].reduce((acc, td) => acc + (Number(td.textContent) || 0), 0);
      somaEl.textContent = `Soma: ${soma} · ${selecionadas.size} célula${selecionadas.size === 1 ? "" : "s"} selecionada${selecionadas.size === 1 ? "" : "s"}`;
      somaEl.classList.add("home-semana-soma--ativa");
    }

    let ancora = null;
    let arrastando = false;
    let selecaoAntes = null;
    trTotal.addEventListener("mousedown", (e) => {
      const td = e.target.closest("td");
      const indice = celulasTotal.indexOf(td);
      if (indice === -1) return;
      e.preventDefault(); // sem seleção nativa de texto
      const acumula = e.ctrlKey || e.metaKey || e.shiftKey;
      selecaoAntes = acumula ? new Set(selecionadas) : new Set();
      // Clique simples numa célula já selecionada (e sozinha) desmarca.
      const desmarcar = !acumula && selecionadas.size === 1 && selecionadas.has(td);
      ancora = indice;
      arrastando = true;
      selecionadas.clear();
      selecaoAntes.forEach((c) => selecionadas.add(c));
      if (desmarcar) {
        selecionadas.clear();
        arrastando = false;
      } else {
        selecionadas.add(td);
      }
      atualizarSoma();
    });
    trTotal.addEventListener("mouseover", (e) => {
      if (!arrastando) return;
      const indice = celulasTotal.indexOf(e.target.closest("td"));
      if (indice === -1) return;
      selecionadas.clear();
      selecaoAntes.forEach((c) => selecionadas.add(c));
      const [de, ate] = indice < ancora ? [indice, ancora] : [ancora, indice];
      celulasTotal.slice(de, ate + 1).forEach((c) => selecionadas.add(c));
      atualizarSoma();
    });
    document.addEventListener("mouseup", () => {
      arrastando = false;
    });

    el.append(info, wrap, somaEl);
    return el;
  }

  // Barra de checkboxes (ex.: Caixa: N1 N2 PROD) do popup — marcar/desmarcar
  // altera o Set "ativos" e chama "aoMudar" na hora.
  function construirBarraFiltro(filtro, ativos, aoMudar) {
    const barra = document.createElement("div");
    barra.className = "home-semana-filtro";
    const titulo = document.createElement("span");
    titulo.className = "home-semana-filtro-titulo";
    titulo.textContent = `${filtro.titulo}:`;
    barra.append(titulo);
    filtro.opcoes.forEach((opcao) => {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = ativos.has(opcao);
      cb.addEventListener("change", () => {
        if (cb.checked) ativos.add(opcao);
        else ativos.delete(opcao);
        aoMudar();
      });
      label.append(cb, ` ${opcao}`);
      barra.append(label);
    });
    return barra;
  }

  // Slide do popup por semana. "filtro" (opcional) = {campo, opcoes}: barra
  // de checkboxes (ex.: N1/N2/PROD) que refiltra a tabela na hora — só
  // entram os chamados cujo chamado[campo] está marcado.
  function construirSlidesSemanas(chamados, campo, rotuloLinha, { rotulo = "Por semana", filtro = null } = {}) {
    if (!chamados.length) return [];
    const el = document.createElement("div");
    const corpo = document.createElement("div");
    const ativos = filtro ? new Set(filtro.opcoes) : null;

    function renderizar() {
      const lista = ativos ? chamados.filter((c) => ativos.has(c[filtro.campo])) : chamados;
      corpo.replaceChildren(construirCorpoSemanas(lista, campo, rotuloLinha));
    }

    if (filtro) el.append(construirBarraFiltro(filtro, ativos, renderizar));

    el.append(corpo);
    renderizar();
    return [{ rotulo, el }];
  }

  // Top N barras do Pareto de Classificação (mesmo valor de
  // PARETO_SOLAR_TOP_N["classificacao"] em api/index.py).
  const HOME_PARETO_TOP_N = 15;

  // Mesma conta de _pareto_payload (api/index.py): barras = top N
  // classificações, % e % acumulado relativos ao total de chamados COM
  // classificação (não só à soma das top N).
  function montarParetoClassificacao(chamados) {
    const contagem = new Map();
    chamados.forEach((c) => {
      if (c.classificacao) contagem.set(c.classificacao, (contagem.get(c.classificacao) || 0) + 1);
    });
    const ordenadas = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
    const totalCategorizados = ordenadas.reduce((soma, [, qtd]) => soma + qtd, 0);
    let acumulado = 0;
    const categorias = ordenadas.slice(0, HOME_PARETO_TOP_N).map(([categoria, quantidade]) => {
      const percentual = totalCategorizados ? Math.round((quantidade / totalCategorizados) * 1000) / 10 : 0;
      acumulado += percentual;
      return { categoria, quantidade, percentual, percentual_acumulado: Math.round(acumulado * 10) / 10 };
    });
    return { total_chamados: chamados.length, total_categorizados: totalCategorizados, categorias };
  }

  // Ranking (maior primeiro) de um campo dos chamados — linhas com posição,
  // nome, barra proporcional ao maior, quantidade e % do total com valor.
  // Rola dentro do bloco quando for muito longo.
  function construirRanking(titulo, chamados, campo) {
    const contagem = new Map();
    chamados.forEach((c) => {
      if (c[campo]) contagem.set(c[campo], (contagem.get(c[campo]) || 0) + 1);
    });
    const ordenados = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
    const total = ordenados.reduce((soma, [, qtd]) => soma + qtd, 0);

    const bloco = document.createElement("div");
    bloco.className = "home-ranking";
    const tituloEl = document.createElement("div");
    tituloEl.className = "pareto-titulo-destaque";
    tituloEl.textContent = titulo;
    const info = document.createElement("div");
    info.className = "pareto-subtitulo-info";
    info.textContent = `${chamados.length} chamados (${total} com ${titulo.split(" — ")[0]})`;
    bloco.append(tituloEl, info);

    if (!ordenados.length) {
      const vazio = document.createElement("div");
      vazio.className = "hint";
      vazio.textContent = "Nenhum chamado com esse campo preenchido.";
      bloco.append(vazio);
      return bloco;
    }

    const lista = document.createElement("div");
    lista.className = "home-ranking-lista";
    const maximo = ordenados[0][1];
    ordenados.forEach(([nome, qtd], i) => {
      const linha = document.createElement("div");
      linha.className = "home-ranking-linha";
      const pos = document.createElement("span");
      pos.className = "home-ranking-pos";
      pos.textContent = `${i + 1}º`;
      const nomeEl = document.createElement("span");
      nomeEl.className = "home-ranking-nome";
      nomeEl.textContent = nome;
      nomeEl.title = nome;
      const trilha = document.createElement("span");
      trilha.className = "home-ranking-trilha";
      const barra = document.createElement("span");
      barra.className = "home-ranking-barra";
      barra.style.width = `${(qtd / maximo) * 100}%`;
      trilha.append(barra);
      const qtdEl = document.createElement("span");
      qtdEl.className = "home-ranking-qtd";
      qtdEl.textContent = `${qtd} (${Math.round((qtd / total) * 1000) / 10}%)`;
      linha.append(pos, nomeEl, trilha, qtdEl);
      lista.append(linha);
    });
    bloco.append(lista);
    return bloco;
  }

  // Slide com o Pareto de "Classificação" dos chamados do gráfico (mesmo
  // desenho do Pareto Solar, ver construirParetoChart). "filtro" (opcional,
  // mesmo formato de construirSlidesSemanas) refiltra o Pareto na hora.
  // Clicar numa barra seleciona a Classificação (clicar de novo desmarca) e
  // abre, abaixo do gráfico, o ranking de Sub-Classificações e, embaixo, o
  // de localidades (PROP_Site) só dos chamados dessa Classificação (e das
  // caixas marcadas no filtro).
  function construirSlideParetoClassificacao(chamados, { filtro = null } = {}) {
    const el = document.createElement("div");
    const titulo = document.createElement("div");
    titulo.className = "pareto-titulo-destaque";
    titulo.textContent = "Pareto — Classificação";
    const corpo = document.createElement("div");
    const ativos = filtro ? new Set(filtro.opcoes) : null;
    let selecionada = null;

    function renderizar() {
      const lista = ativos ? chamados.filter((c) => ativos.has(c[filtro.campo])) : chamados;
      const pareto = montarParetoClassificacao(lista);
      // Seleção que saiu do Pareto (filtro de caixa mudou) é descartada.
      if (selecionada && !pareto.categorias.some((c) => c.categoria === selecionada)) selecionada = null;

      const info = document.createElement("div");
      info.className = "pareto-subtitulo-info";
      info.textContent = `${pareto.total_chamados} chamados (${pareto.total_categorizados} com Classificação)`;
      const grafico = construirParetoChart(pareto.categorias, (item) => {
        selecionada = selecionada === item.categoria ? null : item.categoria;
        renderizar();
      });
      const indice = pareto.categorias.findIndex((c) => c.categoria === selecionada);
      if (indice !== -1) grafico.querySelectorAll(".pareto-bar")[indice]?.classList.add("pareto-bar-selecionada");

      const detalhe = document.createElement("div");
      detalhe.className = "home-ranking-detalhe";
      if (selecionada) {
        const dessa = lista.filter((c) => c.classificacao === selecionada);
        detalhe.append(
          construirRanking(`Sub-Classificação — ${selecionada}`, dessa, "subclassificacao"),
          construirRanking(`Localidade — ${selecionada}`, dessa, "eps")
        );
      } else if (pareto.categorias.length) {
        const dica = document.createElement("div");
        dica.className = "hint";
        dica.textContent = "Clique numa barra para ver o ranking de Sub-Classificações e de localidades daquela Classificação.";
        detalhe.append(dica);
      }
      corpo.replaceChildren(info, grafico, detalhe);
    }

    el.append(titulo);
    if (filtro) el.append(construirBarraFiltro(filtro, ativos, renderizar));
    el.append(corpo);
    renderizar();
    return { rotulo: "Pareto por classificação", el };
  }

  // Torna a tabela de um widget da home clicável: o clique abre o popup por
  // semana (construirSlidesSemanas) com "campo" como linha.
  function tornarClicavelPorSemana(wrap, { caixa, dados, titulo, montarSlides }) {
    wrap.classList.add("home-clicavel");
    wrap.title = "Clique para ver os chamados por semana";
    wrap.addEventListener("click", () => {
      const slides = montarSlides();
      if (!slides.length) return;
      abrirHomeCarrossel(`${titulo} — ${HOME_CAIXA_LABEL[caixa] || caixa} (${dados.total_geral} chamados)`, slides);
    });
  }

  // Idade (dias corridos até hoje) de um chamado pela data de criação
  // "AAAA-MM-DD".
  function homeIdadeDias(criadoIso) {
    const [a, m, d] = criadoIso.split("-").map(Number);
    const hoje = new Date();
    const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    return Math.max(0, Math.round((inicioHoje - new Date(a, m - 1, d)) / 86400000));
  }

  const HOME_FORN_FAIXAS_IDADE = [
    { rotulo: "Até 7 dias", tom: "success", ate: 7 },
    { rotulo: "8 a 30 dias", tom: "warning", ate: 30 },
    { rotulo: "Mais de 30 dias", tom: "danger", ate: Infinity },
  ];

  // Ranking (top 10) de fornecedores com mais chamados aguardando; clicar
  // numa linha expande os chamados dela (chave, criação, idade).
  function construirFornecedorRanking(dados) {
    const total = dados.total_geral || 0;
    const itens = (dados.linhas || []).slice(0, 10).map((l) => ({
      categoria: l.fornecedor,
      quantidade: l.total,
      percentual: total ? Math.round((l.total / total) * 1000) / 10 : 0,
    }));
    const bloco = construirJornadaRanking("", itens, {
      expandir: (item) => {
        const chamados = (dados.chamados || [])
          .filter((c) => c.fornecedor === item.categoria)
          .sort((x, y) => x.criado.localeCompare(y.criado));
        if (!chamados.length) return null;
        const table = document.createElement("table");
        table.className = "data-table home-dashboard-table";
        const thead = document.createElement("thead");
        thead.innerHTML = "<tr><th>Chamado</th><th>Criado em</th><th>Aguardando há</th></tr>";
        const tbody = document.createElement("tbody");
        chamados.forEach((c) => {
          const tr = document.createElement("tr");
          const idade = homeIdadeDias(c.criado);
          [c.key, formatarDataBR(c.criado), `${idade} dia${idade === 1 ? "" : "s"}`].forEach((txt, i) => {
            const td = document.createElement("td");
            td.textContent = txt;
            if (i === 2 && idade > 30) td.className = "home-num-ruim";
            tr.append(td);
          });
          tbody.append(tr);
        });
        table.append(thead, tbody);
        return table;
      },
    });
    bloco.firstElementChild.remove();
    return bloco;
  }

  // KPIs: total aguardando (barra por faixa de idade) + idade média, mais
  // antigo e principal fornecedor.
  function construirFornecedorKpis(dados) {
    const chamados = dados.chamados || [];
    const total = dados.total_geral || chamados.length;
    const fmt = (n) => n.toLocaleString("pt-BR");
    const idades = chamados.map((c) => ({ ...c, idade: homeIdadeDias(c.criado) }));
    const faixas = HOME_FORN_FAIXAS_IDADE.map((f, i) => {
      const min = i === 0 ? -1 : HOME_FORN_FAIXAS_IDADE[i - 1].ate;
      return { ...f, valor: idades.filter((c) => c.idade > min && c.idade <= f.ate).length };
    });
    const media = idades.length ? Math.round(idades.reduce((s, c) => s + c.idade, 0) / idades.length) : 0;
    const maisAntigo = idades.reduce((m, c) => (!m || c.idade > m.idade ? c : m), null);
    const principal = (dados.linhas || [])[0];

    const frag = document.createDocumentFragment();
    frag.append(
      construirHomeKpi({
        valor: fmt(total),
        tom: "warning",
        rotulo: "Chamados aguardando fornecedor",
        segmentos: faixas.map((f) => ({ valor: f.valor, tom: f.tom })),
        total,
        legenda: faixas.map((f) => ({ tom: f.tom, texto: f.rotulo, valor: fmt(f.valor) })),
      }),
      construirHomeKpi({
        valor: `${fmt(media)} dias`,
        tom: "accent",
        rotulo: "Idade média aguardando",
        legenda: [
          maisAntigo && {
            tom: "danger",
            texto: `Mais antigo — ${maisAntigo.key} (${maisAntigo.fornecedor})`,
            valor: `${fmt(maisAntigo.idade)} dias`,
          },
          principal && {
            tom: "neutro",
            texto: `Principal — ${principal.fornecedor}`,
            valor: `${fmt(principal.total)} · ${total ? Math.round((principal.total / total) * 100) : 0}%`,
          },
        ].filter(Boolean),
      })
    );
    return frag;
  }

  // "Fornecedor Responsável × Mês de Criação" (ao vivo, Jira — o cache não
  // tem o Fornecedor Responsável): uma única chamada alimenta os 3 tiles da
  // página 3 da Fila dinâmica (ranking, KPIs, tabela), cada bloco marcado
  // com data-caixa pro seletor global do painel.
  async function carregarHomeFornecedorCriacao() {
    const alvos = ["home-forn-ranking", "home-forn-kpi", "home-fornecedor-criacao"].map((id) => $(id));
    alvos.forEach((el) => homeCardErro(el, "Carregando..."));

    try {
      const resp = await apiCall("/api/home-fornecedor-criacao", {});
      const data = await resp.json();
      if (!resp.ok) {
        alvos.forEach((el) => homeCardErro(el, data.error || "Erro ao carregar."));
        return;
      }

      const [rankingEl, kpiEl, container] = alvos;
      alvos.forEach((el) => {
        el.innerHTML = "";
      });
      data.caixas.forEach(({ caixa, ...dados }) => {
        const blocoRanking = document.createElement("div");
        blocoRanking.dataset.caixa = caixa;
        if ((dados.linhas || []).length) {
          blocoRanking.append(construirFornecedorRanking(dados));
        } else {
          homeCardErro(blocoRanking, "Nenhum chamado aguardando fornecedor.");
        }
        rankingEl.append(blocoRanking);

        const blocoKpi = document.createElement("div");
        blocoKpi.className = "home-kpi-lista";
        blocoKpi.dataset.caixa = caixa;
        blocoKpi.append(construirFornecedorKpis(dados));
        kpiEl.append(blocoKpi);

        const wrap = document.createElement("div");
        wrap.className = "table-wrap";
        wrap.append(construirTabelaFornecedorCriacao(dados));
        // Clicar na tabela abre o popup com os chamados por semana.
        tornarClicavelPorSemana(wrap, {
          caixa,
          dados,
          titulo: "Aguardando Fornecedor por semana",
          montarSlides: () => construirSlidesSemanas(dados.chamados || [], "fornecedor", "Fornecedor Responsável"),
        });
        container.append(homeCaixaSubbloco(caixa, wrap));
      });
    } catch (e) {
      alvos.forEach((el) => homeCardErro(el, "Não foi possível conectar ao servidor."));
    }
  }

  // GMLs Concluído/Revisão Pós-Implementação por dia do "Planned end"
  // (mês atual), do cache GML local — ver /api/home-gml-planned-end em
  // api/index.py. Se o cache GML não existir neste ambiente (ex.: Vercel)
  // ou der erro, devolve {} e o calendário aparece sem as marcações.
  async function carregarHomeGmlPlannedEnd(periodo) {
    try {
      const resp = await apiCall("/api/home-gml-planned-end", periodo || {});
      if (!resp.ok) return {};
      return (await resp.json()).por_dia || {};
    } catch (e) {
      return {};
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

  // "A violar" dos próximos 7 dias — uma linha por GRUPO (não por caixa):
  // Solar sai em 3 linhas (N1/N2/Prod), Claro Tv em 2 (N1/N2, sem "Prod" —
  // CAIXA_GRUPOS["tv"] não tem esse grupo). Cada linha usa o próprio pico
  // da semana pra colorir (heatTone), já que os grupos têm volumes bem
  // diferentes entre si.
  function construirTilesGrupoViolar(dias, grupo) {
    const valores = dias.map((dia) => {
      const entrada = (dia.por_grupo || []).find((g) => g.grupo === grupo);
      return {
        total: entrada ? entrada.total : 0,
        semResponsavel: entrada ? entrada.sem_responsavel : 0,
        porStatus: entrada ? entrada.por_status || [] : [],
      };
    });

    const max = valores.reduce((m, v) => Math.max(m, v.total), 0);
    return valores.map((v, i) => {
      const tile = document.createElement("div");
      const tom = heatTone(v.total, max);
      tile.className = "home-violar-tile" + (tom ? ` ${tom}` : "") + (v.total ? "" : " home-violar-tile--zero") + (i === 0 ? " home-violar-tile--hoje" : "");

      const valor = document.createElement("span");
      valor.className = "home-violar-tile-value";
      valor.textContent = v.total;
      tile.append(valor);

      // Hover: detalhamento por status daquele dia (ex.: "Em atendimento: 3").
      tile.title = v.porStatus.length
        ? v.porStatus.map(([status, qtd]) => `${status}: ${qtd}`).join("\n")
        : "Nenhum chamado a violar";

      if (v.semResponsavel > 0) {
        const semResp = document.createElement("span");
        semResp.className = "home-violar-tile-sem-responsavel";
        semResp.textContent = `${v.semResponsavel} sem resp.`;
        semResp.title = `${v.semResponsavel} chamado${v.semResponsavel === 1 ? "" : "s"} sem responsável`;
        tile.append(semResp);
      }
      return tile;
    });
  }

  // Heatmap: cabeçalho de dias uma vez só (hoje destacado), 1 linha por
  // grupo; cor de cada célula pelo pico da própria linha (heatTone).
  function construirGruposViolar(caixa, dias) {
    const grid = document.createElement("div");
    grid.className = "home-violar-heat";

    grid.append(document.createElement("span"));
    dias.forEach((dia, i) => {
      const th = document.createElement("div");
      th.className = "home-violar-heat-dia" + (i === 0 ? " home-violar-heat-dia--hoje" : "");
      const sem = document.createElement("span");
      sem.textContent = i === 0 ? "Hoje" : dia.dia_semana;
      const data = document.createElement("small");
      data.textContent = dia.data ? `${dia.data.slice(8, 10)}/${dia.data.slice(5, 7)}` : "";
      th.append(sem, data);
      grid.append(th);
    });

    (CAIXA_GRUPOS[caixa] || []).forEach((grupo) => {
      const label = document.createElement("span");
      label.className = "home-violar-group-label";
      label.textContent = GRUPO_LABEL_CURTO[grupo] || grupo;
      grid.append(label, ...construirTilesGrupoViolar(dias, grupo));
    });

    return grid;
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

  const HOME_VIOLADOS_METRICAS = [
    ["a_violar", "A violar"],
    ["violados", "Violados"],
    ["aguardando_fornecedor", "Fornecedor"],
    ["pdst", "PDST"],
  ];

  function construirVioladosPorGrupo(extraPorGrupo) {
    const labelDe = (grupo) => (grupo ? GRUPO_LABEL_CURTO[grupo] || grupo : "Total");
    const linhas = (extraPorGrupo.violados || []).map((item, index) => ({
      label: labelDe(item.grupo),
      valores: HOME_VIOLADOS_METRICAS.map(([m]) => (extraPorGrupo[m] || [])[index]?.total ?? 0),
    }));
    linhas.sort((a, b) => HOME_VIOLADOS_ORDEM_LABEL.indexOf(a.label) - HOME_VIOLADOS_ORDEM_LABEL.indexOf(b.label));
    let total = linhas.find((l) => l.label === "Total");
    const grupos = linhas.filter((l) => l.label !== "Total");
    if (!total) {
      total = { label: "Total", valores: HOME_VIOLADOS_METRICAS.map((_, i) => grupos.reduce((s, l) => s + l.valores[i], 0)) };
    }

    const table = document.createElement("table");
    table.className = "data-table home-dashboard-table";
    const thead = document.createElement("thead");
    const trHead = document.createElement("tr");
    ["Grupo", ...HOME_VIOLADOS_METRICAS.map(([, rotulo]) => rotulo)].forEach((txt, i) => {
      const th = document.createElement("th");
      th.textContent = txt;
      if (i > 0) th.style.textAlign = "right";
      trHead.append(th);
    });
    thead.append(trHead);

    const tbody = document.createElement("tbody");
    [...grupos, total].forEach((linha) => {
      const tr = document.createElement("tr");
      if (linha === total) tr.className = "data-table-total-row";
      const tdLabel = document.createElement("td");
      tdLabel.textContent = linha.label;
      tr.append(tdLabel);
      linha.valores.forEach((v) => {
        const td = document.createElement("td");
        td.style.textAlign = "right";
        td.textContent = v.toLocaleString("pt-BR");
        tr.append(td);
      });
      tbody.append(tr);
    });

    table.append(thead, tbody);
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    wrap.append(table);
    return wrap;
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
      const fmt = (n) => Number(n).toLocaleString("pt-BR");
      container.append(
        construirHomeKpi({
          valor: fmt(data.total_criticos_abertos),
          tom: "accent",
          rotulo: "COTI abertos no mês (já foi P0/P1/P2)",
          segmentos: [
            { valor: data.total_criticos_atual, tom: "danger" },
            { valor: data.total_pontuais, tom: "warning" },
          ],
          total: data.total_criticos_abertos,
          legenda: [
            { tom: "danger", texto: "Real — em P0/P1/P2 agora", valor: fmt(data.total_criticos_atual) },
            { tom: "warning", texto: "Pontuais (abertos − atual)", valor: `${fmt(data.total_pontuais)} · ${data.percentual_pontuais}%` },
          ],
          rodape: `${data.percentual_criticos}% dos ${fmt(data.total_criados)} chamados criados no mês`,
        })
      );
      // Planilha do mês ainda sem as colunas de prioridade (anterior a elas):
      // os números acima não contam esses chamados até sincronizar o cache.
      if (data.sem_prioridade) {
        const aviso = document.createElement("div");
        aviso.className = "hint";
        aviso.style.flexBasis = "100%";
        aviso.textContent = `${data.sem_prioridade} chamado(s) do mês ainda sem Prioridade no cache — sincronize o Cache Solar para atualizar.`;
        container.append(aviso);
      }
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
      closeAllDialogs();
      clearBanner();
      atualizarBotaoReportVini();
      atualizarBotaoTvResolvidosReabertos();
      atualizarBotaoParetoSolar();
      atualizarBotaoMaterialIcg();
    });
  });

  // Menus da barra lateral (EXTRAÇÕES/PREPARADOR DE REUNIÕES/SETTINGS)
  // expandem/recolhem a lista de botões — mesmo padrão .collapse/.open já
  // usado em todos os outros painéis do app, 1 listener por grupo.
  [
    { toggle: "btn-acoes-toggle", grid: "acoes-grid", icon: "acoes-toggle-icon" },
    { toggle: "btn-preparador-toggle", grid: "preparador-grid", icon: "preparador-toggle-icon" },
    { toggle: "btn-detalhamento-toggle", grid: "detalhamento-grid", icon: "detalhamento-toggle-icon" },
    { toggle: "btn-settings-toggle", grid: "settings-grid", icon: "settings-toggle-icon" },
  ].forEach(({ toggle, grid, icon }) => {
    $(toggle).addEventListener("click", () => {
      const gridEl = $(grid);
      const abrindo = !gridEl.classList.contains("open");
      gridEl.classList.toggle("open", abrindo);
      $(icon).textContent = abrindo ? "▾" : "▸";
    });
  });

  // --------------------------------------------------------- extração em lote
  // Tela de lote (usada por "Extração em Lote" e "Extrair GML"): lista de
  // queries (JQL + nome do arquivo), roda 1 de cada vez, em ordem, e grava
  // cada uma num arquivo na pasta de destino (/api/extracao-lote/salvar,
  // com o "modelo" de colunas da tela) antes de seguir pra próxima.
  // "buscarLinhas(jql, setStatus)" é o que muda entre as telas: devolve
  // as linhas prontas de 1 query ou lança Error com a mensagem pra linha.
  function configurarTelaLote({ prefixo, botaoId, pastaPadrao, modelo, placeholderJql, buscarLinhas }) {
    const el = (sufixo) => $(`${prefixo}-${sufixo}`);
    const btnIniciar = $(`btn-${prefixo}-iniciar`);
    const btnAdd = $(`btn-${prefixo}-add`);
    let linhasTela = [];
    let rodando = false;

    function renumerar() {
      linhasTela.forEach(({ tdNum }, index) => {
        tdNum.textContent = index + 1;
      });
    }

    function atualizarRemover() {
      const podeRemover = linhasTela.length > 1;
      linhasTela.forEach(({ btnRemover }) => {
        btnRemover.disabled = !podeRemover || rodando;
      });
    }

    function criarLinha() {
      const tr = document.createElement("tr");

      const tdNum = document.createElement("td");
      tdNum.className = "extracao-lote-col-num";
      tr.append(tdNum);

      const tdJql = document.createElement("td");
      const jqlEl = document.createElement("textarea");
      jqlEl.className = "extracao-lote-input-jql";
      jqlEl.rows = 2;
      jqlEl.placeholder = placeholderJql;
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
        linhasTela = linhasTela.filter((l) => l.tr !== tr);
        tr.remove();
        atualizarRemover();
        renumerar();
      });
      tdBtn.append(btnRemover);
      tr.append(tdBtn);

      const linha = { tr, tdNum, jqlEl, nomeEl, tdStatus, btnRemover };
      linhasTela.push(linha);
      el("table").querySelector("tbody").append(tr);
      atualizarRemover();
      renumerar();
      return linha;
    }

    // "tipo": idle (aguardando, antes de iniciar) | rodando (passo atual) |
    // ok (salvo com sucesso) | erro (parou nessa linha). Texto nunca é
    // cortado (ver CSS, sem nowrap/ellipsis) — mensagem de erro pode ser
    // longa (ex.: caminho do arquivo, erro do Jira) e precisa aparecer
    // inteira, mesmo que quebre em várias linhas dentro da célula.
    function setStatus(linha, texto, tipo) {
      linha.tdStatus.textContent = texto;
      linha.tdStatus.className = `extracao-lote-col-status extracao-lote-status--${tipo}`;
    }

    function travar(travado) {
      btnIniciar.disabled = travado;
      btnAdd.disabled = travado;
      el("formato").disabled = travado;
      el("pasta").disabled = travado;
      linhasTela.forEach(({ jqlEl, nomeEl }) => {
        jqlEl.disabled = travado;
        nomeEl.disabled = travado;
      });
      atualizarRemover();
    }

    $(botaoId).addEventListener("click", () => {
      closeAllDialogs();
      el("results").classList.remove("hidden");
      if (!el("pasta").value) el("pasta").value = pastaPadrao;
      if (!linhasTela.length) criarLinha();
    });

    btnAdd.addEventListener("click", () => criarLinha());

    btnIniciar.addEventListener("click", async () => {
      if (rodando) return;

      const pasta = el("pasta").value.trim() || pastaPadrao;
      const formato = el("formato").value || "xlsx";
      const fila = linhasTela.filter((l) => l.jqlEl.value.trim() && l.nomeEl.value.trim());
      if (!fila.length) {
        setBanner("Preencha ao menos 1 linha com query e nome do arquivo.", "error");
        return;
      }

      rodando = true;
      linhasTela.forEach((linha) => setStatus(linha, "Aguardando", "idle"));
      travar(true);
      const statusEl = el("status");

      for (let i = 0; i < fila.length; i++) {
        const linha = fila[i];
        statusEl.textContent = `Executando ${i + 1}/${fila.length}...`;
        try {
          setStatus(linha, "Executando a query...", "rodando");
          const linhas = await buscarLinhas(linha.jqlEl.value.trim(), (texto) => setStatus(linha, texto, "rodando"));

          setStatus(linha, "Salvando o arquivo...", "rodando");
          const salvarResp = await apiCall("/api/extracao-lote/salvar", {
            pasta,
            nome_arquivo: linha.nomeEl.value.trim(),
            linhas,
            formato,
            modelo,
          });
          const salvarData = await salvarResp.json();
          if (!salvarResp.ok) throw new Error(salvarData.error || "Erro ao salvar o arquivo.");
          setStatus(linha, `${salvarData.total} chamado(s) salvos em "${salvarData.caminho}".`, "ok");
        } catch (e) {
          setStatus(linha, e instanceof TypeError ? "Não foi possível conectar ao servidor." : e.message, "erro");
        }
      }

      statusEl.textContent = "Concluído.";
      rodando = false;
      travar(false);
    });
  }

  // Chamada à API que devolve o JSON ou lança Error com a mensagem do
  // servidor (usado pelos "buscarLinhas" das telas de lote).
  async function apiJsonOuErro(path, body, mensagemPadrao) {
    const resp = await apiCall(path, body);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || mensagemPadrao);
    return data;
  }

  // "Extração em Lote": 3 passos por query (preparar/lote/salvar, mesmo
  // padrão de sincronizarCache em Cache de Chamados): preparar roda a JQL e
  // traz as colunas base; lote preenche as 5 colunas calculadas aos poucos
  // (até EXTRACAO_LOTE_TAMANHO chaves por vez, pra não pesar a API —
  // pedido explícito do usuário); salvar grava o arquivo com as colunas do
  // cache.
  const EXTRACAO_LOTE_COL_CHAVE = "Número do Chamado";
  configurarTelaLote({
    prefixo: "extracao-lote",
    botaoId: "btn-extracao-lote",
    pastaPadrao: "C:\\Users\\edufe\\OneDrive\\Área de Trabalho\\Cache\\TV",
    modelo: "cache",
    placeholderJql:
      'Ex.: "Grupo Solucionador[...]" IN (...) AND created >= "2026-01-01 00:00" AND created <= "2026-01-31 23:59"',
    async buscarLinhas(jql, setStatus) {
      const prep = await apiJsonOuErro("/api/extracao-lote/preparar", { jql }, "Erro ao executar a query.");
      const linhas = prep.linhas || [];
      const porChave = Object.fromEntries(linhas.map((l) => [l[EXTRACAO_LOTE_COL_CHAVE], l]));
      const lotes = dividirEmLotes(Object.keys(porChave), prep.lote || CACHE_SYNC_LOTE);
      for (let b = 0; b < lotes.length; b++) {
        setStatus(`Lote ${b + 1}/${lotes.length}...`);
        const loteData = await apiJsonOuErro("/api/extracao-lote/lote", { chaves: lotes[b] }, "Erro num lote.");
        Object.entries(loteData.resultados).forEach(([chave, campos]) => {
          if (porChave[chave]) Object.assign(porChave[chave], campos);
        });
      }
      return linhas;
    },
  });

  // "Extrair GML": mesma tela, 1 passo de busca (/api/gml já traz as
  // colunas fixas do GML prontas, sem colunas calculadas) + salvar.
  configurarTelaLote({
    prefixo: "gml-lote",
    botaoId: "btn-gml",
    pastaPadrao: "C:\\Users\\edufe\\OneDrive\\Área de Trabalho\\Cache\\GML",
    modelo: "gml",
    placeholderJql: 'Ex.: project = "XYZ" AND created >= "2026-01-01 00:00" AND created <= "2026-01-31 23:59"',
    async buscarLinhas(jql) {
      const data = await apiJsonOuErro("/api/gml", { jql }, "Erro ao executar a query.");
      return data.linhas || [];
    },
  });

  // "Extrato por Categoria": mesmo visual/fluxo de configurarTelaLote
  // (lista de linhas, roda 1 de cada vez, salva na pasta de destino), mas
  // cada linha é Categoria de Encerramento + período em vez de JQL livre —
  // precisa de 3 inputs por linha (categoria/início/fim), então é uma
  // função própria em vez de forçar esses 3 campos dentro de
  // configurarTelaLote (que assume 1 textarea de JQL só).
  function configurarTelaExtratoCategoria() {
    const prefixo = "extrato-categoria";
    const el = (sufixo) => $(`${prefixo}-${sufixo}`);
    const btnIniciar = $(`btn-${prefixo}-iniciar`);
    const btnAdd = $(`btn-${prefixo}-add`);
    const pastaPadrao = "C:\\Users\\edufe\\OneDrive\\Área de Trabalho\\Cache\\Categoria";
    let linhasTela = [];
    let rodando = false;
    let sugestoesOfensor = [];

    function renumerar() {
      linhasTela.forEach(({ tdNum }, index) => {
        tdNum.textContent = index + 1;
      });
    }

    function atualizarRemover() {
      const podeRemover = linhasTela.length > 1;
      linhasTela.forEach(({ btnRemover }) => {
        btnRemover.disabled = !podeRemover || rodando;
      });
    }

    function criarLinha() {
      const tr = document.createElement("tr");

      const tdNum = document.createElement("td");
      tdNum.className = "extracao-lote-col-num";
      tr.append(tdNum);

      // Coluna de ofensores: 1 box de texto por ofensor (em vez de 1 campo
      // só com separador — o nome da categoria pode ter vírgula, então
      // juntar tudo num campo só sempre arrisca um separador errado). O
      // "+" ao lado de cada box adiciona outra logo abaixo; o "✕" remove
      // (desabilitado quando só sobra 1 box).
      const tdCategoria = document.createElement("td");
      tdCategoria.className = "extrato-categoria-col-ofensores";
      const ofensoresEl = document.createElement("div");
      ofensoresEl.className = "extrato-categoria-ofensores";
      tdCategoria.append(ofensoresEl);
      tr.append(tdCategoria);

      function atualizarRemoverOfensor() {
        const boxes = Array.from(ofensoresEl.children);
        boxes.forEach((box) => {
          box.querySelector(".extrato-categoria-ofensor-remover").disabled = boxes.length <= 1;
        });
      }

      function criarOfensorBox() {
        const box = document.createElement("div");
        box.className = "extrato-categoria-ofensor-box";

        // Textarea (não input) pra permitir quebra de linha visual — nome
        // de categoria costuma ser uma frase longa; cresce sozinha
        // conforme digita (redimensionar). "list"/<datalist> não funciona
        // em textarea (só em <input>), então o autocomplete aqui é um
        // dropdown próprio (sugestoesEl), filtrando sugestoesOfensor.
        const campo = document.createElement("div");
        campo.className = "extrato-categoria-ofensor-campo";

        const textarea = document.createElement("textarea");
        textarea.rows = 1;
        textarea.placeholder = "Categoria de Encerramento (ofensor)";
        textarea.className = "extrato-categoria-ofensor-input";

        // Fica fora da tabela, direto no <body>, com "position: fixed" —
        // dentro de ".table-wrap" (overflow: auto) uma lista "absolute"
        // comum fica cortada pelo scroll; "fixed" + reposicionar na mão
        // (seguindoCampo) deixa esticar a largura da TELA toda, não só a
        // do box, pro nome de categoria (frase longa) caber sem quebrar
        // palavra por palavra.
        const sugestoesEl = document.createElement("ul");
        sugestoesEl.className = "extrato-categoria-ofensor-sugestoes hidden";
        document.body.append(sugestoesEl);

        function redimensionar() {
          textarea.style.height = "auto";
          textarea.style.height = `${textarea.scrollHeight}px`;
        }

        function seguirCampo() {
          const rect = textarea.getBoundingClientRect();
          const gutter = 16;
          sugestoesEl.style.left = `${gutter}px`;
          sugestoesEl.style.top = `${rect.bottom + 4}px`;
          sugestoesEl.style.width = `${window.innerWidth - gutter * 2}px`;
        }

        function fecharSugestoes() {
          sugestoesEl.classList.add("hidden");
          sugestoesEl.innerHTML = "";
        }

        function mostrarSugestoes() {
          const termo = textarea.value.trim().toLowerCase();
          // Ofensor já escolhido em OUTRO box desta mesma linha some da
          // lista — evita selecionar a mesma categoria 2x na mesma busca.
          const jaEscolhidos = new Set(
            Array.from(ofensoresEl.querySelectorAll("textarea"))
              .filter((t) => t !== textarea)
              .map((t) => t.value.trim())
              .filter(Boolean)
          );
          const disponiveis = sugestoesOfensor.filter((c) => !jaEscolhidos.has(c));
          const opcoes = (
            termo ? disponiveis.filter((c) => c.toLowerCase().includes(termo)) : disponiveis
          ).slice(0, 20);
          if (!opcoes.length) {
            fecharSugestoes();
            return;
          }
          sugestoesEl.innerHTML = "";
          opcoes.forEach((categoria) => {
            const li = document.createElement("li");
            li.textContent = categoria;
            li.addEventListener("mousedown", (e) => {
              e.preventDefault();
              textarea.value = categoria;
              redimensionar();
              fecharSugestoes();
            });
            sugestoesEl.append(li);
          });
          seguirCampo();
          sugestoesEl.classList.remove("hidden");
        }

        textarea.addEventListener("input", () => {
          redimensionar();
          mostrarSugestoes();
        });
        textarea.addEventListener("focus", mostrarSugestoes);
        textarea.addEventListener("blur", () => setTimeout(fecharSugestoes, 150));
        window.addEventListener("scroll", fecharSugestoes, true);
        window.addEventListener("resize", fecharSugestoes);

        campo.append(textarea);
        box.append(campo);

        const btnMais = document.createElement("button");
        btnMais.type = "button";
        btnMais.className = "btn-secondary extrato-categoria-ofensor-add";
        btnMais.textContent = "+";
        btnMais.title = "Adicionar outro ofensor";
        btnMais.addEventListener("click", () => {
          box.after(criarOfensorBox());
          atualizarRemoverOfensor();
        });
        box.append(btnMais);

        const btnMenos = document.createElement("button");
        btnMenos.type = "button";
        btnMenos.className = "btn-secondary extrato-categoria-ofensor-remover";
        btnMenos.textContent = "✕";
        btnMenos.title = "Remover este ofensor";
        btnMenos.addEventListener("click", () => {
          box.remove();
          sugestoesEl.remove();
          atualizarRemoverOfensor();
        });
        box.append(btnMenos);

        ofensoresEl.append(box);
        redimensionar();
        return box;
      }

      criarOfensorBox();
      atualizarRemoverOfensor();

      const tdInicio = document.createElement("td");
      const inicioEl = document.createElement("input");
      inicioEl.type = "date";
      tdInicio.append(inicioEl);
      tr.append(tdInicio);

      const tdFim = document.createElement("td");
      const fimEl = document.createElement("input");
      fimEl.type = "date";
      tdFim.append(fimEl);
      tr.append(tdFim);

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
        linhasTela = linhasTela.filter((l) => l.tr !== tr);
        ofensoresEl.querySelectorAll(".extrato-categoria-ofensor-sugestoes").forEach((n) => n.remove());
        tr.remove();
        atualizarRemover();
        renumerar();
      });
      tdBtn.append(btnRemover);
      tr.append(tdBtn);

      const linha = { tr, tdNum, ofensoresEl, atualizarRemoverOfensor, inicioEl, fimEl, nomeEl, tdStatus, btnRemover };
      linhasTela.push(linha);
      el("table").querySelector("tbody").append(tr);
      atualizarRemover();
      renumerar();
      return linha;
    }

    function setStatus(linha, texto, tipo) {
      linha.tdStatus.textContent = texto;
      linha.tdStatus.className = `extracao-lote-col-status extracao-lote-status--${tipo}`;
    }

    function ofensoresDe(linha) {
      return Array.from(linha.ofensoresEl.querySelectorAll("textarea"))
        .map((textarea) => textarea.value.trim())
        .filter(Boolean);
    }

    function travar(travado) {
      btnIniciar.disabled = travado;
      btnAdd.disabled = travado;
      el("formato").disabled = travado;
      el("pasta").disabled = travado;
      linhasTela.forEach(({ ofensoresEl, atualizarRemoverOfensor, inicioEl, fimEl, nomeEl }) => {
        ofensoresEl.querySelectorAll("textarea, button").forEach((campo) => {
          campo.disabled = travado;
        });
        if (!travado) atualizarRemoverOfensor();
        inicioEl.disabled = travado;
        fimEl.disabled = travado;
        nomeEl.disabled = travado;
      });
      atualizarRemover();
    }

    async function carregarSugestoesOfensor() {
      try {
        const resp = await apiCall("/api/extrato-categoria/categorias", { caixa: state.caixa });
        const data = await resp.json();
        if (!resp.ok) return;
        sugestoesOfensor = data.categorias || [];
      } catch (e) {
        // Autocomplete é só uma ajuda — sem sugestões, a tela continua
        // funcionando normal (campo de texto livre).
      }
    }

    $("btn-extrato-categoria").addEventListener("click", () => {
      closeAllDialogs();
      el("results").classList.remove("hidden");
      if (!el("pasta").value) el("pasta").value = pastaPadrao;
      if (!linhasTela.length) criarLinha();
      carregarSugestoesOfensor();
    });

    btnAdd.addEventListener("click", () => criarLinha());

    btnIniciar.addEventListener("click", async () => {
      if (rodando) return;

      const pasta = el("pasta").value.trim() || pastaPadrao;
      const formato = el("formato").value || "xlsx";
      const fila = linhasTela.filter(
        (l) => ofensoresDe(l).length && l.inicioEl.value && l.fimEl.value && l.nomeEl.value.trim()
      );
      if (!fila.length) {
        setBanner("Preencha ao menos 1 linha com categoria, período e nome do arquivo.", "error");
        return;
      }

      rodando = true;
      linhasTela.forEach((linha) => setStatus(linha, "Aguardando", "idle"));
      travar(true);
      const statusEl = el("status");

      for (let i = 0; i < fila.length; i++) {
        const linha = fila[i];
        statusEl.textContent = `Executando ${i + 1}/${fila.length}...`;
        try {
          setStatus(linha, "Buscando chamados do cache local...", "rodando");
          const categorias = ofensoresDe(linha);
          const inicio = linha.inicioEl.value;
          const fim = linha.fimEl.value;
          const prep = await apiJsonOuErro(
            "/api/extrato-categoria/preparar",
            { categorias, inicio, fim, caixa: state.caixa },
            "Erro ao buscar a categoria."
          );
          const linhas = prep.linhas || [];

          setStatus(linha, "Salvando o arquivo...", "rodando");
          const salvarResp = await apiCall("/api/extracao-lote/salvar", {
            pasta,
            nome_arquivo: linha.nomeEl.value.trim(),
            linhas,
            formato,
            modelo: "cache",
          });
          const salvarData = await salvarResp.json();
          if (!salvarResp.ok) throw new Error(salvarData.error || "Erro ao salvar o arquivo.");
          setStatus(linha, `${salvarData.total} chamado(s) salvos em "${salvarData.caminho}".`, "ok");
        } catch (e) {
          setStatus(linha, e instanceof TypeError ? "Não foi possível conectar ao servidor." : e.message, "erro");
        }
      }

      statusEl.textContent = "Concluído.";
      rodando = false;
      travar(false);
    });
  }

  configurarTelaExtratoCategoria();

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

  // ------------------------------------------------ popover de hover (copiar)
  // Um único elemento flutuante reaproveitado pelo Pareto Solar (ver
  // showParetoPopover) — passar o mouse mostra o conteúdo, clicar fora/sair
  // fecha. Some com um pequeno atraso (não no mouseleave direto) pra dar
  // tempo do cursor entrar no próprio popover sem ele fechar no meio do
  // caminho.
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

  // Popover flutuante do Pareto Solar — só o nome por inteiro da categoria
  // (rótulo do eixo X vem truncado) + quantidade/%, sem reservar espaço
  // fixo na tela: aparece ancorado na barra só enquanto o mouse está em
  // cima.
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

  // -------------------------------------------------------- cache de chamados
  // Lista as planilhas .xlsx da pasta de cache local (uma por mês, ver
  // CACHE_DIR em api/index.py) — ação direta, sem diálogo. A planilha do
  // mês corrente é criada sozinha (sem botão, sem
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
  const CACHE_CAIXA_TITULOS = { solar: "Solar", prod: "Prod", tv: "Claro Tv", outros: "Outros" };

  // Colunas de contagem de cada seção: Solar não tem Claro Tv, Tv não tem
  // Solar/Prod, e OM/GML (origem fora do Jira, sem Grupo Solucionador) não
  // têm nenhuma.
  function colunasCaixaDaSecao(secao) {
    if (secao.origem && secao.origem !== "jira") return [];
    if (secao.caixa === "tv") return ["tv", "outros"];
    return ["solar", "prod", "outros"];
  }

  // Preenche as células de caixa de uma linha (só as que existem em "tds")
  // — "abertosPorCaixa" vem do servidor já sem chaves zeradas
  // (CACHE_GRUPO_PARA_CAIXA só soma quem tem pelo menos 1 aberto), então
  // toda caixa ausente vira 0 aqui.
  function preencherCelulasCaixas(tds, abertosPorCaixa) {
    Object.keys(tds).forEach((caixaId) => {
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
    { id: "om", label: "Cache OM", caixa: "om", pasta: "" },
    { id: "gml", label: "Cache GML", caixa: "gml", pasta: "" },
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
        JSON.stringify(secoes.map(({ id, label, caixa, pasta, aberta }) => ({ id, label, caixa, pasta, aberta })))
      );
    } catch (e) {
      // segue sem lembrar entre recarregamentos.
    }
    // Cards de estado do cache da tela de largada acompanham as seções.
    if (!homeJaCarregada) carregarHomeCacheStatus();
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

    // Lista alternada (mesmo padrão dos dias de Material ICG): seta pra
    // abrir/fechar a seção; clicar no fundo do cabeçalho também alterna.
    const btnToggle = document.createElement("button");
    btnToggle.type = "button";
    btnToggle.className = "cache-secao-toggle";
    btnToggle.setAttribute("aria-label", "Abrir/fechar seção");

    header.append(btnToggle, labelInput, btnRemover);

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
      { id: "om", nome: "OM (Salesforce)" },
      { id: "gml", nome: "GML" },
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
    const tbody = document.createElement("tbody");
    table.append(thead, tbody);
    tableWrap.append(table);

    const corpo = document.createElement("div");
    corpo.className = "cache-secao-corpo";
    corpo.append(toolbar, statusEl, tableWrap);
    card.append(header, corpo);

    function alternarSecao() {
      secao.aberta = !card.classList.contains("aberto");
      card.classList.toggle("aberto", secao.aberta);
      btnToggle.setAttribute("aria-expanded", String(secao.aberta));
      salvarSecoesCache(cacheSecoes);
    }
    btnToggle.addEventListener("click", alternarSecao);
    header.addEventListener("click", (event) => {
      if (event.target === header) alternarSecao();
    });
    // Sem preferência salva, só a primeira seção começa aberta.
    const aberta = secao.aberta ?? cacheSecoes.indexOf(secao) === 0;
    card.classList.toggle("aberto", aberta);
    btnToggle.setAttribute("aria-expanded", String(aberta));

    secao.el = { card, labelInput, caixaSelect, pastaInput, btnEscolherPasta, btnSincronizarTudo, btnRecarregar, statusEl, tbody, thead };
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

  function atualizarValoresAtualizacao(td, valor) {
    td.textContent = valor === null || valor === undefined ? "—" : valor;
    td.classList.toggle("cache-valor-positivo", Boolean(valor));
  }

  function renderCacheTableSecao(secao, arquivos) {
    const { tbody } = secao.el;
    tbody.innerHTML = "";
    secao.linhas = [];
    // OM (salesforce) e GML: colunas próprias, sem Grupo Solucionador
    // (sem contagem por caixa), sincronizados por rota própria de 1
    // chamada por planilha (sincronizarSecaoArquivo).
    const semCaixas = Boolean(secao.origem) && secao.origem !== "jira";
    const colunasCaixa = colunasCaixaDaSecao(secao);

    // Cabeçalho refeito a cada render: as colunas dependem da caixa/origem
    // da seção, que pode mudar no seletor de Caixa.
    const headRow = document.createElement("tr");
    const titulos = ["Planilha", "Status", ...colunasCaixa.map((c) => CACHE_CAIXA_TITULOS[c])];
    if (semCaixas) titulos.push("Valores atualização");
    titulos.push("");
    titulos.forEach((titulo) => {
      const th = document.createElement("th");
      th.textContent = titulo;
      headRow.append(th);
    });
    secao.el.thead.innerHTML = "";
    secao.el.thead.append(headRow);

    if (!arquivos.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3 + colunasCaixa.length;
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
      colunasCaixa.forEach((caixaId) => {
        tdsCaixas[caixaId] = document.createElement("td");
      });
      preencherCelulasCaixas(
        tdsCaixas,
        arquivo.abertos === null || arquivo.abertos === undefined ? null : arquivo.abertos_por_caixa
      );

      // OM/GML: nº de linhas que a próxima sincronização ainda reconsulta
      // (OM sem DefectNumber, GML fora de Concluído/Encerrado/Cancelado).
      const tdValores = semCaixas ? document.createElement("td") : null;
      if (tdValores) atualizarValoresAtualizacao(tdValores, arquivo.valores_atualizacao);

      const tdAcao = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary";
      btn.textContent = "Sincronizar";
      btn.addEventListener("click", () =>
        semCaixas
          ? sincronizarSecaoArquivo(secao, arquivo.nome, tdStatus, btn, tdValores)
          : sincronizarSecaoCache(secao, arquivo.nome, tdStatus, tdsCaixas, btn)
      );
      tdAcao.append(btn);

      tr.append(tdNome, tdStatus, ...colunasCaixa.map((c) => tdsCaixas[c]), ...(tdValores ? [tdValores] : []), tdAcao);
      tbody.append(tr);

      secao.linhas.push({ nome: arquivo.nome, tdStatus, tdsCaixas, tdValores, btn });
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
      secao.origem = data.origem;
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
  // OM (origem "salesforce") e GML (origem "gml"): 1 chamada só por
  // planilha — o servidor faz a sincronização incremental inteira (OM:
  // Salesforce CLI, atualiza quem está sem DefectNumber; GML: Jira,
  // atualiza quem não está Concluído/Encerrado) e acrescenta os novos a
  // partir da data mais recente da planilha (ver /api/cache/om-sincronizar
  // e /api/cache/gml-sincronizar em api/index.py). "nome" vazio = mês
  // corrente (cria se não existir).
  const CACHE_SYNC_ARQUIVO_ROTA = {
    salesforce: "/api/cache/om-sincronizar",
    gml: "/api/cache/gml-sincronizar",
  };

  async function sincronizarSecaoArquivo(secao, nome, tdStatus, btn, tdValores) {
    const statusEl = secao.el.statusEl;
    const textoOriginal = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Consultando...";
    }
    statusEl.textContent = `Sincronizando${nome ? ` "${nome}"` : " o mês atual"}...`;
    try {
      const resp = await apiCall(CACHE_SYNC_ARQUIVO_ROTA[secao.origem], {
        nome,
        pasta: secao.el.pastaInput.value.trim(),
      });
      const data = await resp.json();
      if (!resp.ok) {
        statusEl.textContent = data.error || `Erro ao sincronizar "${nome}".`;
        return false;
      }
      if (tdStatus) tdStatus.textContent = cacheStatusTexto(data.sincronizado_em);
      if (tdValores) atualizarValoresAtualizacao(tdValores, data.valores_atualizacao);
      const criterio = secao.origem === "gml" ? "em aberto" : "sem defeito";
      statusEl.textContent = `"${data.nome}": ${data.verificados} ${criterio} verificado(s), ${data.atualizados} atualizado(s), ${data.novos} novo(s).`;
      return true;
    } catch (e) {
      statusEl.textContent = "Não foi possível conectar ao servidor.";
      return false;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = textoOriginal;
      }
    }
  }

  // "Sincronizar tudo" do OM/GML: cria/atualiza o mês corrente se ainda
  // não tiver planilha e depois refaz cada planilha listada, uma de cada vez.
  async function sincronizarTudoArquivo(secao) {
    const btnTudo = secao.el.btnSincronizarTudo;
    const textoOriginal = btnTudo.textContent;
    const linhas = secao.linhas;
    const hoje = new Date();
    // OM: mês em UTC, igual ao servidor (as planilhas do OM são por mês
    // UTC); GML: mês local, igual ao cache de chamados.
    const utc = secao.origem === "salesforce";
    const mesAtual = utc ? hoje.getUTCMonth() : hoje.getMonth();
    const anoAtual = utc ? hoje.getUTCFullYear() : hoje.getFullYear();
    const nomeMesAtual = `${OM_MESES_ABREV[mesAtual]}-${anoAtual}.xlsx`;
    const criarMesAtual = !linhas.some((l) => l.nome === nomeMesAtual);
    const total = linhas.length + (criarMesAtual ? 1 : 0);

    btnTudo.disabled = true;
    linhas.forEach(({ btn }) => {
      btn.disabled = true;
    });

    let passo = 0;
    if (criarMesAtual) {
      btnTudo.textContent = `Sincronizando ${++passo}/${total}...`;
      if (!(await sincronizarSecaoArquivo(secao, "", null, null))) {
        btnTudo.disabled = false;
        btnTudo.textContent = textoOriginal;
        linhas.forEach(({ btn }) => {
          btn.disabled = false;
        });
        return;
      }
    }
    for (const { nome, tdStatus, tdValores, btn } of linhas) {
      btnTudo.textContent = `Sincronizando ${++passo}/${total}...`;
      if (!(await sincronizarSecaoArquivo(secao, nome, tdStatus, btn, tdValores))) break;
    }

    btnTudo.disabled = false;
    btnTudo.textContent = textoOriginal;
    linhas.forEach(({ btn }) => {
      btn.disabled = false;
    });
    if (criarMesAtual) carregarSecaoCache(secao);
  }

  async function sincronizarTudoSecao(secao) {
    if (secao.origem === "salesforce" || secao.origem === "gml") {
      await sincronizarTudoArquivo(secao);
      return;
    }
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

  // ---------------------------------------------------- Mapa de calor OM
  // Tipo de erro (linha) x dia (coluna) dos meses escolhidos no filtro
  // (padrão: últimos 3) — cada célula é o nº de pedidos distintos com
  // aquele erro naquele dia (ver /api/om-mapa-calor em api/index.py). As
  // linhas já vêm ordenadas pelo total nos meses escolhidos (maior em
  // cima). Intensidade da cor proporcional ao maior valor da tabela
  // inteira (não por linha), pra dar pra comparar erros entre si.
  const OM_MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  // Meses ("AAAA-MM") confirmados no filtro; null = deixa o servidor usar o
  // padrão (últimos 3) e adota o que ele devolver.
  let omMesesSelecionados = null;

  function rotuloMesOm(chave) {
    const [ano, mes] = chave.split("-");
    return `${OM_MESES_ABREV[Number(mes) - 1]}/${ano}`;
  }

  // Intensidade (0..1) -> % de --danger misturado ao fundo da célula vazia.
  // Piso de 22% pra 1 pedido já se destacar de uma célula vazia.
  function intensidadeOm(valor, maximo) {
    return Math.round(22 + (valor / maximo) * 78);
  }

  function construirLegendaOm(maximo) {
    const legenda = $("om-mapa-calor-legenda");
    legenda.innerHTML = "";
    legenda.append("Menos");
    [0, 0.25, 0.5, 0.75, 1].forEach((fracao) => {
      const quadrado = document.createElement("span");
      quadrado.className = "om-legenda-quadrado";
      if (fracao > 0) quadrado.style.setProperty("--intensidade", `${intensidadeOm(fracao * maximo, maximo)}%`);
      else quadrado.classList.add("om-legenda-vazio");
      legenda.append(quadrado);
    });
    legenda.append(`Mais (máx. ${maximo} pedidos/dia)`);
    legenda.classList.remove("hidden");
  }

  function construirMapaCalorOm(dias, linhas) {
    const table = document.createElement("table");
    table.className = "data-table om-mapa-calor";

    if (!linhas.length) {
      $("om-mapa-calor-legenda").classList.add("hidden");
      const tbody = document.createElement("tbody");
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.className = "hint";
      td.textContent = "Nenhum pedido com erro nos meses escolhidos.";
      tr.append(td);
      tbody.append(tr);
      table.append(tbody);
      return table;
    }

    const maximo = Math.max(1, ...linhas.flatMap((l) => l.por_dia));
    construirLegendaOm(maximo);
    const datas = dias.map((d) => new Date(`${d}T00:00:00`));
    const mesmoMes = (a, b) => a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
    const inicioMes = datas.map((data, i) => i > 0 && !mesmoMes(data, datas[i - 1]));

    // Cabeçalho em 2 linhas: mês (colspan dos dias dele) e dia do mês.
    const thead = document.createElement("thead");
    const trMes = document.createElement("tr");
    const thErro = document.createElement("th");
    thErro.textContent = "Error Handle";
    thErro.rowSpan = 2;
    thErro.className = "om-col-erro";
    const thTotal = document.createElement("th");
    thTotal.textContent = "Total";
    thTotal.rowSpan = 2;
    thTotal.className = "om-col-total";
    const thDefeito = document.createElement("th");
    thDefeito.textContent = "Defeito";
    thDefeito.rowSpan = 2;
    thDefeito.className = "om-col-defeito";
    trMes.append(thErro, thDefeito, thTotal);
    datas.forEach((data, i) => {
      if (i > 0 && mesmoMes(data, datas[i - 1])) return;
      const th = document.createElement("th");
      th.colSpan = datas.filter((d) => mesmoMes(d, data)).length;
      th.textContent = `${OM_MESES_ABREV[data.getMonth()]}/${data.getFullYear()}`;
      th.className = "om-mes";
      trMes.append(th);
    });
    const trDia = document.createElement("tr");
    datas.forEach((data, i) => {
      const th = document.createElement("th");
      th.textContent = data.getDate();
      th.className = "om-dia";
      if (data.getDay() === 0 || data.getDay() === 6) th.classList.add("om-fim-semana");
      if (inicioMes[i]) th.classList.add("om-inicio-mes");
      trDia.append(th);
    });
    thead.append(trMes, trDia);
    table.append(thead);

    const tbody = document.createElement("tbody");
    linhas.forEach(({ erro, total, defeitos, por_dia: porDia }) => {
      const tr = document.createElement("tr");
      const tdErro = document.createElement("td");
      tdErro.className = "om-col-erro";
      tdErro.title = erro;
      const erroTexto = document.createElement("div");
      erroTexto.className = "om-erro-texto";
      erroTexto.textContent = erro;
      tdErro.append(erroTexto);
      const tdTotal = document.createElement("td");
      tdTotal.className = "om-col-total";
      tdTotal.textContent = total;
      // Defeitos relacionados (DefectNumber__c), mais frequente primeiro,
      // com o nº de pedidos de cada um.
      const tdDefeito = document.createElement("td");
      tdDefeito.className = "om-col-defeito";
      (defeitos || []).forEach(({ defeito, pedidos }) => {
        const item = document.createElement("div");
        item.className = "om-defeito";
        item.title = `${defeito} — ${pedidos} pedido(s)`;
        const nome = document.createElement("span");
        nome.className = "om-defeito-nome";
        nome.textContent = defeito;
        const qtd = document.createElement("span");
        qtd.className = "om-defeito-qtd";
        qtd.textContent = pedidos;
        item.append(nome, qtd);
        tdDefeito.append(item);
      });
      tr.append(tdErro, tdDefeito, tdTotal);

      porDia.forEach((valor, i) => {
        const td = document.createElement("td");
        td.className = "om-celula";
        if (inicioMes[i]) td.classList.add("om-inicio-mes");
        // Quadrado interno de tamanho fixo: a linha pode ficar mais alta
        // (Error Handle quebra em até 3 linhas) sem esticar o quadrado.
        const quadrado = document.createElement("span");
        quadrado.className = "om-quadrado";
        if (valor) {
          const intensidade = intensidadeOm(valor, maximo);
          quadrado.textContent = valor;
          quadrado.style.setProperty("--intensidade", `${intensidade}%`);
          quadrado.classList.add("om-celula-ativa");
          if (intensidade >= 55) quadrado.classList.add("om-celula-forte");
        }
        td.append(quadrado);
        td.title = `${formatarDataBR(dias[i])} — ${valor} pedido(s)\n${erro}`;
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(tbody);
    return table;
  }

  // Filtro de meses estilo Excel: "(Selecionar tudo)" + 1 checkbox por mês
  // disponível; só aplica (refaz o fetch) no "Confirmar", "Cancelar" ou
  // clicar fora descarta. Confirmar fica desabilitado sem nenhum mês.
  const omFiltroRaiz = $("om-filtro-meses");
  const omFiltroPainel = omFiltroRaiz.querySelector(".icg-filtro-grupo-painel");
  const omFiltroLista = omFiltroRaiz.querySelector(".om-filtro-meses-lista");
  const omFiltroTudo = omFiltroRaiz.querySelector('.om-filtro-meses-tudo input');
  const omFiltroConfirmar = omFiltroRaiz.querySelector(".icg-filtro-grupo-confirmar");
  let omMesesDisponiveis = [];

  function omFiltroCheckboxes() {
    return Array.from(omFiltroLista.querySelectorAll('input[type="checkbox"]'));
  }

  function omFiltroAtualizarTudo() {
    const caixas = omFiltroCheckboxes();
    const marcados = caixas.filter((cb) => cb.checked).length;
    omFiltroTudo.checked = marcados === caixas.length && marcados > 0;
    omFiltroTudo.indeterminate = marcados > 0 && marcados < caixas.length;
    omFiltroConfirmar.disabled = marcados === 0;
  }

  function omFiltroAtualizarRotulo() {
    const label = omFiltroRaiz.querySelector(".icg-filtro-grupo-label");
    const meses = omMesesSelecionados || [];
    if (meses.length && meses.length === omMesesDisponiveis.length) label.textContent = "Todos";
    else if (meses.length <= 3) label.textContent = meses.map(rotuloMesOm).join(", ") || "—";
    else label.textContent = `${meses.length} meses`;
  }

  function omFiltroAbrir() {
    omFiltroLista.innerHTML = "";
    omMesesDisponiveis.forEach((chave) => {
      const opcao = document.createElement("label");
      opcao.className = "icg-filtro-grupo-opcao";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = chave;
      cb.checked = (omMesesSelecionados || []).includes(chave);
      opcao.append(cb, ` ${rotuloMesOm(chave)}`);
      omFiltroLista.append(opcao);
    });
    omFiltroAtualizarTudo();
    omFiltroPainel.classList.remove("hidden");
  }

  function omFiltroFechar() {
    omFiltroPainel.classList.add("hidden");
  }

  omFiltroRaiz.querySelector(".icg-filtro-grupo-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    if (omFiltroPainel.classList.contains("hidden")) omFiltroAbrir();
    else omFiltroFechar();
  });

  omFiltroPainel.addEventListener("click", (event) => event.stopPropagation());

  omFiltroPainel.addEventListener("change", (event) => {
    if (event.target === omFiltroTudo) {
      omFiltroCheckboxes().forEach((cb) => {
        cb.checked = omFiltroTudo.checked;
      });
    }
    omFiltroAtualizarTudo();
  });

  omFiltroRaiz.querySelector(".icg-filtro-grupo-cancelar").addEventListener("click", omFiltroFechar);

  omFiltroConfirmar.addEventListener("click", () => {
    const marcados = omFiltroCheckboxes()
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
    if (!marcados.length) return;
    omMesesSelecionados = marcados;
    omFiltroAtualizarRotulo();
    omFiltroFechar();
    carregarMapaCalorOm();
  });

  document.addEventListener("click", (event) => {
    if (!omFiltroPainel.classList.contains("hidden") && !omFiltroRaiz.contains(event.target)) omFiltroFechar();
  });

  async function carregarMapaCalorOm() {
    const statusEl = $("om-mapa-calor-status");
    const wrap = $("om-mapa-calor-wrap");
    statusEl.textContent = "Carregando...";
    try {
      const resp = await apiCall("/api/om-mapa-calor", omMesesSelecionados ? { meses: omMesesSelecionados } : {});
      const data = await resp.json();
      if (!resp.ok) {
        statusEl.textContent = data.error || "Erro ao carregar.";
        wrap.innerHTML = "";
        $("om-mapa-calor-legenda").classList.add("hidden");
        return;
      }
      omMesesDisponiveis = data.meses_disponiveis || [];
      omMesesSelecionados = data.meses;
      omFiltroAtualizarRotulo();
      wrap.innerHTML = "";
      wrap.append(construirMapaCalorOm(data.dias, data.linhas));
      statusEl.textContent = "";
    } catch (e) {
      statusEl.textContent = "Não foi possível conectar ao servidor.";
    }
  }

  $("btn-om-mapa-calor").addEventListener("click", () => {
    closeAllDialogs();
    $("om-mapa-calor-results").classList.remove("hidden");
    carregarMapaCalorOm();
  });

  $("btn-om-mapa-calor-recarregar").addEventListener("click", carregarMapaCalorOm);

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
  // GMLs Concluído/Revisão Pós-Implementação marcadas com um * vermelho
  // no dia do "Planned end" (linha fixa perto do topo do gráfico, pra não
  // cobrir as séries); o hover do dia lista as GMLs. Vêm do cache GML
  // local (/api/home-gml-planned-end) depois que o gráfico já está na
  // tela — sem cache GML/erro, o gráfico fica como estava.
  async function adicionarGmlsAoAtendimento(grafico, inicio, fim, maiorValor) {
    const porDia = await carregarHomeGmlPlannedEnd({ inicio, fim });
    const dias = Object.keys(porDia).sort();
    if (!dias.length || !grafico.isConnected || !grafico.data) return;
    Plotly.addTraces(grafico, {
      type: "scatter",
      mode: "markers",
      name: "GMLs (Planned end)",
      legendgroup: "gml",
      x: dias,
      y: dias.map(() => Math.max(1, maiorValor) * 1.04),
      marker: { symbol: "asterisk", size: 14, color: "#f2555c", line: { color: "#f2555c", width: 2 } },
      text: dias.map((dia) => {
        const gmls = porDia[dia];
        return [`${gmls.length} GML${gmls.length === 1 ? "" : "s"} (Planned end)`]
          .concat(gmls.map(({ ticket, status, relator }) => [ticket, status, relator].filter(Boolean).join(" · ")))
          .join("<br>");
      }),
      hovertemplate: "%{text}<extra></extra>",
    });
  }

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
    adicionarGmlsAoAtendimento(grafico, primeiraData, ultimaData, maiorValor);

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

  function configurarFiltroGrupoExcel(raiz, estadoInicial, aoConfirmar, labels = MATERIAL_ICG_GRUPO_LABELS) {
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
      label.textContent = confirmado.map((g) => labels[g]).join(", ");
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

  // ------------------------------------------- credenciais do .env (local)
  // Rodando localmente ("python api/index.py"), o servidor usa JIRA_EMAIL/
  // JIRA_API_TOKEN do .env direto (pedido explícito do usuário): a tela
  // entra sozinha, sem login, e o token nunca passa pelo navegador — as
  // requisições vão sem e-mail/token e o servidor completa com o .env.
  // "/api/credenciais-env" não existe em produção (Vercel): lá falha em
  // -------------------------------------------- Jornada
  function jornadaAtualizarVisibilidadeFiltro() {
    const modo = $("jornada-filtro-tipo").value;
    $("jornada-filtro-mes-wrap").classList.toggle("hidden", modo !== "mes");
    $("jornada-filtro-ano-wrap").classList.toggle("hidden", modo !== "ano");
    $("jornada-filtro-periodo-wrap").classList.toggle("hidden", modo !== "periodo");
  }

  function jornadaGetIntervalo() {
    const modo = $("jornada-filtro-tipo").value;
    if (modo === "mes") {
      const v = $("jornada-mes-input").value;
      if (!v) return { inicio: null, fim: null };
      return mesParaIntervalo(v);
    }
    if (modo === "ano") {
      const v = $("jornada-ano-select").value;
      if (!v) return { inicio: null, fim: null };
      return anoParaIntervalo(v);
    }
    return {
      inicio: $("jornada-input-inicio").value || null,
      fim: $("jornada-input-fim").value || null,
    };
  }

  function construirJornadaRanking(titulo, itens, opts) {
    const bloco = document.createElement("div");
    bloco.className = "home-ranking";
    const tituloEl = document.createElement("div");
    tituloEl.className = "pareto-titulo-destaque";
    tituloEl.textContent = titulo;
    bloco.append(tituloEl);
    if (!itens || !itens.length) {
      const vazio = document.createElement("div");
      vazio.className = "hint";
      vazio.textContent = "Sem dados.";
      bloco.append(vazio);
      return bloco;
    }
    const lista = document.createElement("div");
    lista.className = "home-ranking-lista";
    const maximo = itens[0].quantidade;
    itens.forEach((item, i) => {
      const linha = document.createElement("div");
      linha.className = "home-ranking-linha";
      if (opts && opts.onToggle) {
        linha.style.cursor = "pointer";
        if (opts.selected && opts.selected.has(item.categoria)) {
          linha.style.background = "rgba(253,224,71,.14)";
          linha.style.borderRadius = "4px";
        }
        linha.addEventListener("click", () => opts.onToggle(item.categoria));
      }
      const pos = document.createElement("span");
      pos.className = "home-ranking-pos";
      pos.textContent = `${i + 1}º`;
      const nomeEl = document.createElement("span");
      nomeEl.className = "home-ranking-nome";
      nomeEl.textContent = item.categoria;
      nomeEl.title = item.categoria;
      const trilha = document.createElement("span");
      trilha.className = "home-ranking-trilha";
      const barra = document.createElement("span");
      barra.className = "home-ranking-barra";
      barra.style.width = `${(item.quantidade / maximo) * 100}%`;
      trilha.append(barra);
      const qtdEl = document.createElement("span");
      qtdEl.className = "home-ranking-qtd";
      qtdEl.textContent = `${item.quantidade} (${item.percentual}%)`;
      linha.append(pos, nomeEl, trilha, qtdEl);
      lista.append(linha);

      if (opts && opts.expandir) {
        linha.style.cursor = "pointer";
        const seta = document.createElement("span");
        seta.textContent = "▶";
        seta.style.cssText = "font-size:.6rem;opacity:.5;margin-left:6px;transition:transform .2s";
        nomeEl.append(seta);
        const detalhe = document.createElement("div");
        detalhe.style.cssText = "display:none;padding:6px 8px 8px 34px;background:rgba(253,224,71,.14);border-radius:4px";
        let carregado = false;
        linha.addEventListener("click", () => {
          if (!carregado) {
            const node = opts.expandir(item);
            if (node) detalhe.append(node);
            carregado = true;
          }
          const aberto = detalhe.style.display !== "none";
          detalhe.style.display = aberto ? "none" : "block";
          seta.style.transform = aberto ? "" : "rotate(90deg)";
          linha.style.background = aberto ? "" : "rgba(253,224,71,.14)";
          linha.style.borderRadius = aberto ? "" : "4px";
        });
        lista.append(detalhe);
      }
    });
    bloco.append(lista);
    return bloco;
  }

  const JORNADA_TIPO_BITS = { conv: 1, crit: 2, reab: 4, apoio: 8 };
  const JORNADA_TIPO_LABELS = { tudo: "Todos", conv: "Convencionais", crit: "Críticos", reab: "Reabertos", apoio: "Apoio" };
  // Getter da seleção de tipo (estilo Excel). "tudo" => sem filtro.
  const jornadaTipoChamado = configurarFiltroGrupoExcel(
    $("jornada-filtro-tipo-chamado"),
    ["tudo"],
    () => { if (jornadaRerender) jornadaRerender(); },
    JORNADA_TIPO_LABELS,
  );
  // Re-render só do cliente (sem refetch) ao trocar o tipo; setado por carregarJornada.
  let jornadaRerender = null;

  function jornadaTipoMask() {
    const sel = jornadaTipoChamado();
    if (!sel || sel.includes("tudo")) return 0;
    let m = 0;
    sel.forEach((t) => { m |= (JORNADA_TIPO_BITS[t] || 0); });
    return m;
  }

  async function carregarJornada() {
    const statusEl = $("jornada-status");
    statusEl.classList.add("is-loading");
    statusEl.textContent = "Carregando...";
    const paretoCard = $("jornada-pareto-card");
    const drilldownCard = $("jornada-drilldown-card");
    const criadosCard = $("jornada-criados-dia-card");
    paretoCard.replaceChildren();
    drilldownCard.classList.add("hidden");
    drilldownCard.replaceChildren();
    criadosCard.replaceChildren();
    $("jornada-gmls-card").replaceChildren();
    $("jornada-categorias-card").replaceChildren();

    const { inicio, fim } = jornadaGetIntervalo();
    if (!inicio || !fim) {
      statusEl.classList.remove("is-loading");
      statusEl.textContent = "Preencha o período.";
      return;
    }

    try {
      const [respJornada, gmlPorDia, respGmls] = await Promise.all([
        apiCall("/api/jornada", { inicio, fim }),
        carregarHomeGmlPlannedEnd({ inicio, fim }),
        apiCall("/api/jornada-gmls", { inicio, fim }),
      ]);
      const dados = await respJornada.json();
      if (!respJornada.ok) throw new Error(dados.error || "Erro desconhecido");
      const dadosGmls = respGmls.ok ? await respGmls.json() : { gmls: [] };
      renderGmlTable(dadosGmls.gmls || []);

      statusEl.classList.remove("is-loading");
      statusEl.textContent = `${dados.total} chamados (${dados.total_com_class} com Classificação)`;

      const gmlShapes = Object.keys(gmlPorDia).map((dia) => ({
        type: "line",
        x0: dia, x1: dia,
        y0: 0, y1: 1, yref: "paper",
        line: { color: "#9b59b6", width: 1.5, dash: "dot" },
      }));

      let selecionada = null;
      let subsSel = new Set();
      let locsSel = new Set();

      const todosDias = (dados.criados_por_dia_total || []).map((d) => d.data);
      const numDias = todosDias.length || 1;
      const regCriados = dados.registros_criados || [];
      const regResolvidos = dados.registros_resolvidos || [];
      const RANK_TOP_N = 10;

      // Máscara de tipo (0 = sem filtro); recalculada no início de cada renderJornada.
      let tipoMask = 0;
      const tipoOk = (r) => tipoMask === 0 || (r.t & tipoMask) !== 0;
      const clsOk = (r) => !selecionada || r.c === selecionada;
      const subOk = (r) => subsSel.size === 0 || subsSel.has(r.s);
      const locOk = (r) => locsSel.size === 0 || locsSel.has(r.l);

      // Pareto de Classificação recomputado no cliente (respeita o filtro de
      // tipo). Mesma regra do backend _pareto_payload: top 15, sem "Outros",
      // percentual relativo ao total classificado, acumulado somando os %.
      function paretoFrom(records) {
        const cnt = new Map();
        for (const r of records) {
          if (!tipoOk(r)) continue;
          if (!r.c) continue;
          cnt.set(r.c, (cnt.get(r.c) || 0) + 1);
        }
        const ordenado = [...cnt.entries()].sort((a, b) => b[1] - a[1]);
        const totalCat = ordenado.reduce((s, [, q]) => s + q, 0);
        let acc = 0;
        return ordenado.slice(0, 15).map(([categoria, quantidade]) => {
          const pct = totalCat ? Math.round((quantidade / totalCat) * 1000) / 10 : 0;
          acc += pct;
          return { categoria, quantidade, percentual: pct, percentual_acumulado: Math.round(acc * 10) / 10 };
        });
      }

      function rankFrom(records, chave, extraOk) {
        const cnt = new Map();
        let tot = 0;
        for (const r of records) {
          if (!tipoOk(r)) continue;
          if (!clsOk(r)) continue;
          if (extraOk && !extraOk(r)) continue;
          const k = r[chave];
          if (!k) continue;
          cnt.set(k, (cnt.get(k) || 0) + 1);
          tot++;
        }
        return [...cnt.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, RANK_TOP_N)
          .map(([categoria, quantidade]) => ({
            categoria,
            quantidade,
            percentual: tot ? Math.round((quantidade / tot) * 1000) / 10 : 0,
          }));
      }

      function serieFrom(records, ok) {
        const cnt = new Map();
        for (const r of records) {
          if (!tipoOk(r)) continue;
          if (!clsOk(r)) continue;
          if (ok && !ok(r)) continue;
          cnt.set(r.d, (cnt.get(r.d) || 0) + 1);
        }
        return todosDias.map((d) => ({ data: d, quantidade: cnt.get(d) || 0 }));
      }

      function renderLinha() {
        criadosCard.replaceChildren();
        const bothOk = (r) => subOk(r) && locOk(r);
        const serie = serieFrom(regCriados, bothOk);
        const serieRes = serieFrom(regResolvidos, bothOk);
        const somaC = serie.reduce((s, d) => s + d.quantidade, 0);
        const somaR = serieRes.reduce((s, d) => s + d.quantidade, 0);
        const baseline = Math.round((somaC / numDias) * 10) / 10;
        const baselineRes = Math.round((somaR / numDias) * 10) / 10;

        const filtros = [];
        if (subsSel.size) filtros.push(`${subsSel.size} sub`);
        if (locsSel.size) filtros.push(`${locsSel.size} local`);
        const ctx = selecionada || "GERAL";
        const label = `${ctx} — criados por dia — Solar${filtros.length ? ` (filtro: ${filtros.join(" + ")})` : ""}`;

        const tituloLinha = document.createElement("div");
        tituloLinha.className = "pareto-titulo-destaque";
        tituloLinha.style.marginBottom = "8px";
        tituloLinha.textContent = label;
        criadosCard.append(tituloLinha);

        if (subsSel.size || locsSel.size) {
          const chips = document.createElement("div");
          chips.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px";
          const addChip = (texto, cor, onDel) => {
            const chip = document.createElement("span");
            chip.style.cssText = `display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:12px;font-size:11px;background:${cor}22;border:1px solid ${cor};color:${cor}`;
            chip.textContent = texto;
            const x = document.createElement("span");
            x.textContent = "✕";
            x.style.cssText = "cursor:pointer;font-size:10px";
            x.addEventListener("click", onDel);
            chip.append(x);
            chips.append(chip);
          };
          subsSel.forEach((s) => addChip(`sub: ${s}`, "#3a8eff", () => { subsSel.delete(s); renderDrill(); }));
          locsSel.forEach((l) => addChip(`local: ${l}`, "#2ecc71", () => { locsSel.delete(l); renderDrill(); }));
          criadosCard.append(chips);
        }

        const areaPlot = document.createElement("div");
        criadosCard.append(areaPlot);

        const grafico = icgAtendimentoCriarGrafico(areaPlot);
        if (!grafico) return;
        const datas = serie.map((d) => d.data);
        const valores = serie.map((d) => d.quantidade);
        const valoresRes = serieRes.map((d) => d.quantidade);

        const traceBaselineCriados = {
          type: "scatter", mode: "lines",
          name: `Baseline criados (${baseline.toLocaleString("pt-BR")}/dia)`,
          legendgroup: "baseline-criados",
          x: [datas[0], datas[datas.length - 1]],
          y: [baseline, baseline],
          line: { color: ICG_ATENDIMENTO_CORES.criados, width: 1.5, dash: "dash" },
          opacity: 0.75, hoverinfo: "skip",
        };
        const traceBaselineRes = {
          type: "scatter", mode: "lines",
          name: `Baseline resolvidos (${baselineRes.toLocaleString("pt-BR")}/dia)`,
          legendgroup: "baseline-res",
          x: [datas[0], datas[datas.length - 1]],
          y: [baselineRes, baselineRes],
          line: { color: ICG_ATENDIMENTO_CORES.resolvidos, width: 1.5, dash: "dash" },
          opacity: 0.75, hoverinfo: "skip",
        };
        const anotacoes = [
          {
            xref: "paper", x: 0, xanchor: "right", xshift: -4,
            y: baseline, yref: "y",
            text: baseline.toLocaleString("pt-BR"),
            showarrow: false,
            font: { color: ICG_ATENDIMENTO_CORES.criados, size: 11 },
          },
          {
            xref: "paper", x: 0, xanchor: "right", xshift: -4,
            y: baselineRes, yref: "y",
            text: baselineRes.toLocaleString("pt-BR"),
            showarrow: false,
            font: { color: ICG_ATENDIMENTO_CORES.resolvidos, size: 11 },
          },
        ];
        const layout = {
          ...icgAtendimentoLayout(
            Math.max(...valores, ...valoresRes, baseline, baselineRes, 1),
            datas[0], datas[datas.length - 1],
            { tickformat: "%d/%m", hoverformat: "%d/%m/%Y" },
            anotacoes
          ),
          shapes: gmlShapes,
        };
        Plotly.newPlot(
          grafico,
          [
            icgAtendimentoSerie("criados", `Criados (${somaC.toLocaleString("pt-BR")})`, datas, valores),
            traceBaselineCriados,
            icgAtendimentoSerie("resolvidos", `Resolvidos e Encerrados (${somaR.toLocaleString("pt-BR")})`, datas, valoresRes),
            traceBaselineRes,
          ],
          layout,
          icgAtendimentoConfig("jornada-criados-dia")
        );
        grafico.on("plotly_click", (ev) => {
          const pt = ev.points[0];
          if (pt) {
            const dia = String(pt.x).slice(0, 10);
            abrirJornadaDiaModal(dia, gmlPorDia, selecionada);
          }
        });
      }

      function renderDrill() {
        const subRank = rankFrom(regCriados, "s", locOk);
        const locRank = rankFrom(regCriados, "l", subOk);
        const ctx = selecionada || "GERAL";

        drilldownCard.replaceChildren();
        drilldownCard.classList.remove("hidden");
        const partes = [];
        const barra = document.createElement("div");
        barra.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:12px";
        if (selecionada) {
          const tituloEl = document.createElement("div");
          tituloEl.className = "pareto-titulo-destaque";
          tituloEl.style.margin = "0";
          tituloEl.textContent = `Classificação: ${selecionada}`;
          barra.append(tituloEl);
        }
        if (subsSel.size || locsSel.size) {
          const btnReset = document.createElement("button");
          btnReset.type = "button";
          btnReset.textContent = `✕ Limpar filtros (${subsSel.size + locsSel.size})`;
          btnReset.style.cssText = "padding:3px 10px;border-radius:12px;border:1px solid #f0c040;background:transparent;color:#f0c040;cursor:pointer;font-size:12px";
          btnReset.addEventListener("click", () => { subsSel.clear(); locsSel.clear(); renderDrill(); });
          barra.append(btnReset);
        }
        if (barra.childElementCount) partes.push(barra);
        const grid = document.createElement("div");
        grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:16px";
        grid.append(
          construirJornadaRanking(`SUB-CLASSIFICAÇÃO — ${ctx}`, subRank, {
            selected: subsSel,
            onToggle: (cat) => { subsSel.has(cat) ? subsSel.delete(cat) : subsSel.add(cat); renderDrill(); },
          }),
          construirJornadaRanking(`LOCALIDADE — ${ctx}`, locRank, {
            selected: locsSel,
            onToggle: (cat) => { locsSel.has(cat) ? locsSel.delete(cat) : locsSel.add(cat); renderDrill(); },
          }),
        );
        partes.push(grid);
        drilldownCard.append(...partes);

        renderLinha();
      }

      function renderJornada() {
        tipoMask = jornadaTipoMask();
        const classificacoes = paretoFrom(regCriados);
        const grafico = construirParetoChart(classificacoes, (item) => {
          selecionada = selecionada === item.categoria ? null : item.categoria;
          subsSel = new Set();
          locsSel = new Set();
          renderJornada();
        });
        if (selecionada) {
          const idx = classificacoes.findIndex((c) => c.categoria === selecionada);
          if (idx !== -1) grafico.querySelectorAll(".pareto-bar")[idx]?.classList.add("pareto-bar-selecionada");
        }
        paretoCard.replaceChildren(grafico);

        renderDrill();

        // Top 10 Categorias de Encerramento (ofensores) — record-driven,
        // acompanha tipo + classificação + toggle INC/PDST.
        const catCard = $("jornada-categorias-card");
        catCard.replaceChildren();
        const catContexto = selecionada ? ` — ${selecionada}` : "";

        function catFrom(prefixSet) {
          const cnt = new Map();
          let tot = 0;
          for (const r of regResolvidos) {
            if (!tipoOk(r)) continue;
            if (!clsOk(r)) continue;
            if (prefixSet && prefixSet.size && !prefixSet.has(r.pfx)) continue;
            if (!r.cat) continue;
            cnt.set(r.cat, (cnt.get(r.cat) || 0) + 1);
            tot++;
          }
          return [...cnt.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([categoria, quantidade]) => ({
              categoria,
              quantidade,
              percentual: tot ? Math.round((quantidade / tot) * 1000) / 10 : 0,
            }));
        }

        if (catFrom(new Set()).length) {
          const catFiltros = new Set();
          const catRankingWrap = document.createElement("div");

          const catToggleWrap = document.createElement("div");
          catToggleWrap.style.cssText = "display:flex;gap:6px;flex-shrink:0";

          ["INC", "PDST"].forEach(prefix => {
            const btn = document.createElement("button");
            btn.textContent = prefix;
            btn.type = "button";
            btn.style.cssText = "padding:2px 8px;border-radius:12px;border:1px solid var(--accent,#3a8eff);background:transparent;color:var(--accent,#3a8eff);cursor:pointer;font-size:11px;transition:background .15s,color .15s";
            btn.dataset.prefix = prefix;
            btn.addEventListener("click", () => {
              if (catFiltros.has(prefix)) {
                catFiltros.delete(prefix);
                btn.style.background = "transparent";
                btn.style.color = "var(--accent,#3a8eff)";
              } else {
                catFiltros.add(prefix);
                btn.style.background = "var(--accent,#3a8eff)";
                btn.style.color = "#fff";
              }
              renderCatRanking();
            });
            catToggleWrap.append(btn);
          });

          function renderCatRanking() {
            const filtradas = catFrom(catFiltros);
            const top10 = filtradas.slice(0, 10);
            const sufixo = catFiltros.size ? ` — ${[...catFiltros].join(" | ")}` : " (TOP 10)";
            const bloco = construirJornadaRanking(`CATEGORIAS DE ENCERRAMENTO${catContexto}${sufixo}`, top10, {
              expandir: (item) => {
                const chamados = regResolvidos.filter((r) =>
                  tipoOk(r) && clsOk(r) && (catFiltros.size === 0 || catFiltros.has(r.pfx)) && r.cat === item.categoria
                );
                if (!chamados.length) return null;
                const table = document.createElement("table");
                table.style.cssText = "width:100%;border-collapse:collapse;font-size:.78rem";
                const thead = document.createElement("thead");
                thead.innerHTML = '<tr style="opacity:.45;text-align:left"><th style="padding:4px 6px;font-weight:500">Chamado</th><th style="padding:4px 6px;font-weight:500">Localidade</th><th style="padding:4px 6px;font-weight:500;text-align:right">Resolvido</th></tr>';
                const tbody = document.createElement("tbody");
                chamados.sort((a, b) => String(a.k).localeCompare(String(b.k))).forEach((c, ri) => {
                  const tr = document.createElement("tr");
                  tr.style.cssText = `background:${ri % 2 === 0 ? "rgba(255,255,255,.03)" : "transparent"}`;
                  const td = (txt, extra = "") => `<td style="padding:4px 6px;${extra}">${txt}</td>`;
                  tr.innerHTML = td(c.k || "—", "font-weight:500") + td(c.l || "", "opacity:.7") + td(formatarDataBR(c.d) || "", "opacity:.7;text-align:right");
                  tbody.append(tr);
                });
                table.append(thead, tbody);
                return table;
              },
            });
            // inline toggle buttons next to title
            const tituloEl = bloco.firstElementChild;
            tituloEl.style.cssText = "display:flex;align-items:center;gap:8px;";
            tituloEl.prepend(catToggleWrap);
            catRankingWrap.replaceChildren(bloco);
          }

          renderCatRanking();
          catCard.append(catRankingWrap);
        }
      }

      jornadaRerender = renderJornada;
      renderJornada();
    } catch (e) {
      statusEl.classList.remove("is-loading");
      statusEl.textContent = `Erro: ${e.message}`;
    }
  }

  // Popula select de ano
  {
    const anoAtual = new Date().getFullYear();
    const sel = $("jornada-ano-select");
    for (let ano = anoAtual - 2; ano <= anoAtual + 1; ano++) {
      const opt = document.createElement("option");
      opt.value = String(ano);
      opt.textContent = String(ano);
      if (ano === anoAtual) opt.selected = true;
      sel.append(opt);
    }
  }

  // Init mês com mês atual
  $("jornada-mes-input").value = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  $("jornada-filtro-tipo").addEventListener("change", jornadaAtualizarVisibilidadeFiltro);
  jornadaAtualizarVisibilidadeFiltro();

  $("btn-jornada").addEventListener("click", () => {
    closeAllDialogs();
    $("jornada-results").classList.remove("hidden");
    carregarJornada();
  });

  $("btn-jornada-recarregar").addEventListener("click", carregarJornada);

  // -------------------------------------------- Colaboradores (Detalhamento)
  async function carregarColaboradoresDet() {
    const statusEl = $("colaboradores-det-status");
    const conteudo = $("colaboradores-det-conteudo");
    statusEl.classList.add("is-loading");
    statusEl.textContent = "Carregando...";
    conteudo.replaceChildren();
    try {
      const resp = await apiCall("/api/home-colaboradores-cache", {});
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Erro desconhecido");
      statusEl.classList.remove("is-loading");
      statusEl.textContent = "";
      data.caixas.forEach(({ caixa, colaboradores }) => {
        const wrap = document.createElement("div");
        wrap.className = "table-wrap";
        wrap.append(construirTabelaColaboradoresMensal(data.meses, colaboradores));
        conteudo.append(homeCaixaSubbloco(caixa, wrap));
      });
    } catch (e) {
      statusEl.classList.remove("is-loading");
      statusEl.textContent = `Erro: ${e.message}`;
    }
  }

  $("btn-colaboradores-det").addEventListener("click", () => {
    closeAllDialogs();
    $("colaboradores-det-results").classList.remove("hidden");
    carregarColaboradoresDet();
  });

  $("btn-colaboradores-det-recarregar").addEventListener("click", carregarColaboradoresDet);

  // -------------------------------------------- GML modal
  function _fmtDtBR(iso) {
    if (!iso) return "—";
    // iso = "YYYY-MM-DDTHH:MM"
    const [datePart, timePart] = iso.split("T");
    if (!datePart) return iso;
    const [y, m, d] = datePart.split("-");
    return `${d}/${m}/${y}${timePart ? " " + timePart : ""}`;
  }

  function abrirGmlModal(gml) {
    $("jornada-gml-modal-ticket").textContent = gml.ticket || "";
    const statusEl = $("jornada-gml-modal-status");
    statusEl.textContent = gml.status || "";
    statusEl.style.display = gml.status ? "" : "none";
    const resolEl = $("jornada-gml-modal-resolucao");
    resolEl.textContent = gml.resolucao || "";
    resolEl.style.display = gml.resolucao ? "" : "none";
    const resvEl = $("jornada-gml-modal-resolvido");
    resvEl.textContent = gml.resolvido || "";
    resvEl.style.display = gml.resolvido ? "" : "none";
    $("jornada-gml-modal-descricao").textContent = gml.descricao || "(sem descrição)";
    $("jornada-gml-modal").classList.remove("hidden");
  }

  async function abrirJornadaDiaModal(dia, gmlPorDia, classificacao) {
    const modal = $("jornada-dia-modal");
    const [d, m, y] = dia.split("-").reverse().map(Number);
    $("jornada-dia-modal-titulo").textContent = `${String(d).padStart(2,"0")}/${String(m).padStart(2,"0")}/${y}`;
    const gmlsEl = $("jornada-dia-modal-gmls");
    const chamadosEl = $("jornada-dia-modal-chamados");
    gmlsEl.replaceChildren();
    chamadosEl.replaceChildren();
    modal.classList.remove("hidden");

    // GMLs do dia
    const gmls = (gmlPorDia || {})[dia] || [];
    if (gmls.length) {
      const h = document.createElement("div");
      h.className = "pareto-titulo-destaque";
      h.style.marginBottom = "8px";
      h.textContent = `GMLs (${gmls.length})`;
      gmlsEl.append(h);
      const pastelColors = [
        { bg: "rgba(147,197,253,.13)", border: "#93c5fd" },
        { bg: "rgba(167,243,208,.13)", border: "#6ee7b7" },
        { bg: "rgba(216,180,254,.13)", border: "#c4b5fd" },
        { bg: "rgba(253,186,116,.13)", border: "#fdba74" },
        { bg: "rgba(249,168,212,.13)", border: "#f9a8d4" },
      ];
      gmls.forEach((g, i) => {
        const { bg, border } = pastelColors[i % pastelColors.length];
        const row = document.createElement("div");
        row.style.cssText = `display:flex;gap:8px;align-items:center;padding:6px 10px;border-radius:6px;margin-bottom:4px;background:${bg};border-left:3px solid ${border}`;
        const tk = document.createElement("span");
        tk.style.cssText = `font-weight:600;min-width:90px;color:${border}`;
        tk.textContent = g.ticket || "—";
        const st = document.createElement("span");
        st.className = "home-dashboard-tag";
        st.textContent = g.status || "";
        const rel = document.createElement("span");
        rel.style.cssText = "font-size:.82rem;opacity:.75;margin-left:auto";
        rel.textContent = g.relator || "";
        row.append(tk, st, rel);
        gmlsEl.append(row);
      });
    }

    // Chamados por sub-classificação
    try {
      const body = { dia };
      if (classificacao) body.classificacao = classificacao;
      const tiposSel = jornadaTipoChamado().filter((t) => t !== "tudo");
      if (tiposSel.length) body.tipos = tiposSel;
      const resp = await apiCall("/api/jornada-dia", body);
      const data = await resp.json();
      const subs = data.subclassificacoes || [];
      if (!subs.length) {
        const vazio = document.createElement("div");
        vazio.style.cssText = "margin-top:12px;opacity:.6;font-size:.85rem";
        vazio.textContent = "Sem chamados criados neste dia.";
        const dbg = document.createElement("pre");
        dbg.style.cssText = "font-size:.75rem;color:#f0c040;margin-top:8px;white-space:pre-wrap;word-break:break-all;background:#1a1f2b;padding:8px;border-radius:4px";
        dbg.textContent = data._debug
          ? JSON.stringify(data._debug, null, 2)
          : "SEM _debug — servidor ainda com código antigo (reiniciar)";
        chamadosEl.append(vazio, dbg);
      } else {
        const h = document.createElement("div");
        h.className = "pareto-titulo-destaque";
        h.style.cssText = "margin-top:14px;margin-bottom:6px";
        h.textContent = `Chamados por Sub-Classificação (${data.total})`;
        chamadosEl.append(h);
        subs.forEach((sub) => {
          const bloco = document.createElement("div");
          bloco.style.cssText = "margin-bottom:2px;border-radius:6px;overflow:hidden;background:rgba(255,255,255,.04)";
          const subTitulo = document.createElement("div");
          subTitulo.style.cssText = "font-size:.82rem;font-weight:600;opacity:.8;padding:7px 10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none;border-bottom:1px solid transparent";
          const arrow = document.createElement("span");
          arrow.textContent = "▶";
          arrow.style.cssText = "font-size:.6rem;transition:transform .2s;opacity:.5";
          subTitulo.append(document.createTextNode(`[${sub.chamados.length}] ${sub.subclassificacao}`), arrow);
          const corpo = document.createElement("div");
          corpo.style.cssText = "display:none;padding:0 6px 8px";
          const table = document.createElement("table");
          table.style.cssText = "width:100%;border-collapse:collapse;font-size:.78rem";
          const thead = document.createElement("thead");
          thead.innerHTML = `<tr style="opacity:.45;text-align:left"><th style="padding:4px 6px;font-weight:500">Chamado</th><th style="padding:4px 6px;font-weight:500">EPS</th><th style="padding:4px 6px;font-weight:500;text-align:right">Status</th></tr>`;
          const tbody = document.createElement("tbody");
          sub.chamados.forEach((c, ri) => {
            const tr = document.createElement("tr");
            tr.style.cssText = `background:${ri % 2 === 0 ? "rgba(255,255,255,.03)" : "transparent"}`;
            tr.innerHTML = `<td style="padding:4px 6px;font-weight:500">${c.chave || "—"}</td><td style="padding:4px 6px;opacity:.7">${c.eps || ""}</td><td style="padding:4px 6px;opacity:.7;text-align:right">${c.status || ""}</td>`;
            tbody.append(tr);
          });
          table.append(thead, tbody);
          corpo.append(table);
          subTitulo.addEventListener("click", () => {
            const open = corpo.style.display !== "none";
            corpo.style.display = open ? "none" : "block";
            arrow.style.transform = open ? "" : "rotate(90deg)";
            subTitulo.style.borderBottomColor = open ? "transparent" : "rgba(255,255,255,.07)";
            bloco.style.background = open ? "rgba(255,255,255,.04)" : "rgba(253,224,71,.07)";
            subTitulo.style.color = open ? "" : "#fde047";
          });
          bloco.append(subTitulo, corpo);
          chamadosEl.append(bloco);
        });
      }
    } catch(e) {
      const err = document.createElement("div");
      err.style.cssText = "color:#e74c3c;margin-top:8px;font-size:.85rem";
      err.textContent = `Erro ao carregar chamados: ${e.message}`;
      chamadosEl.append(err);
    }
  }

  $("btn-jornada-gml-modal-fechar").addEventListener("click", () => {
    $("jornada-gml-modal").classList.add("hidden");
  });
  $("jornada-gml-modal").addEventListener("click", (e) => {
    if (e.target === $("jornada-gml-modal")) $("jornada-gml-modal").classList.add("hidden");
  });

  $("btn-jornada-dia-modal-fechar").addEventListener("click", () => {
    $("jornada-dia-modal").classList.add("hidden");
  });
  $("jornada-dia-modal").addEventListener("click", (e) => {
    if (e.target === $("jornada-dia-modal")) $("jornada-dia-modal").classList.add("hidden");
  });

  function renderGmlTable(gmls) {
    const card = $("jornada-gmls-card");
    card.replaceChildren();
    if (!gmls || !gmls.length) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = "Nenhuma GML no período.";
      card.append(hint);
      return;
    }

    const styleGml = document.createElement("style");
    styleGml.textContent = [
      "#jornada-gmls-card table th,#jornada-gmls-card table td{border:1px solid #2e3849;padding:5px 8px}",
      "#jornada-gmls-card table thead th{background:#1b212c;position:sticky;top:0}",
      "#jornada-gmls-card table tbody tr:hover{background:#1e2738;cursor:pointer}",
      "#jornada-gmls-pag{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:.85rem}",
    ].join("");
    card.append(styleGml);

    const GML_POR_PAGINA = 5;
    let pagina = 0;
    let filtro = "";

    const cabecalhos = ["Ticket", "Relator", "Status", "RequestType", "Gestor", "Criado", "Gerente Requisitante", "Ativo Ops TI", "Planned start", "Planned end"];

    // Cabeçalho com título + busca
    const topo = document.createElement("div");
    topo.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap";
    const titulo = document.createElement("div");
    titulo.className = "pareto-titulo-destaque";
    titulo.style.margin = "0";
    titulo.textContent = `GMLs no período (${gmls.length})`;
    const busca = document.createElement("input");
    busca.type = "text";
    busca.placeholder = "Buscar ticket...";
    busca.style.cssText = "padding:4px 8px;border-radius:4px;border:1px solid #2e3849;background:#11161f;color:#eef1f6;font-size:.85rem;width:160px";
    topo.append(titulo, busca);
    card.append(topo);

    // Tabela
    const wrap = document.createElement("div");
    wrap.style.overflowX = "auto";
    const tabela = document.createElement("table");
    tabela.className = "cache-table";
    tabela.style.cssText = "font-size:.82rem;border-collapse:collapse;width:100%";
    const thead = document.createElement("thead");
    const trH = document.createElement("tr");
    cabecalhos.forEach((h) => {
      const th = document.createElement("th");
      th.textContent = h;
      trH.append(th);
    });
    thead.append(trH);
    tabela.append(thead);
    const tbody = document.createElement("tbody");
    tabela.append(tbody);
    wrap.append(tabela);
    card.append(wrap);

    // Paginação
    const pagBar = document.createElement("div");
    pagBar.id = "jornada-gmls-pag";
    const btnAntes = document.createElement("button");
    btnAntes.className = "btn-secondary";
    btnAntes.textContent = "‹";
    btnAntes.type = "button";
    const infoPage = document.createElement("span");
    infoPage.className = "hint";
    const btnDepois = document.createElement("button");
    btnDepois.className = "btn-secondary";
    btnDepois.textContent = "›";
    btnDepois.type = "button";
    pagBar.append(btnAntes, infoPage, btnDepois);
    card.append(pagBar);

    function renderPagina() {
      const filtrados = filtro
        ? gmls.filter((g) => (g.ticket || "").toLowerCase().includes(filtro))
        : gmls;
      const total = filtrados.length;
      const totalPags = Math.max(1, Math.ceil(total / GML_POR_PAGINA));
      if (pagina >= totalPags) pagina = totalPags - 1;
      const fatia = filtrados.slice(pagina * GML_POR_PAGINA, (pagina + 1) * GML_POR_PAGINA);

      tbody.replaceChildren();
      fatia.forEach((gml) => {
        const tr = document.createElement("tr");
        tr.title = "Clique para ver descrição";
        [
          gml.ticket,
          gml.relator,
          gml.status,
          gml.request_type,
          gml.gestor,
          gml.criado ? _fmtDtBR(gml.criado.slice(0, 10)) : "—",
          gml.gerente_requisitante,
          gml.ativo_operacoes_ti,
          _fmtDtBR(gml.planned_start),
          _fmtDtBR(gml.planned_end),
        ].forEach((val) => {
          const td = document.createElement("td");
          td.textContent = val || "—";
          tr.append(td);
        });
        tr.addEventListener("click", () => abrirGmlModal(gml));
        tbody.append(tr);
      });

      infoPage.textContent = `${pagina + 1} / ${totalPags} (${total} itens)`;
      btnAntes.disabled = pagina === 0;
      btnDepois.disabled = pagina >= totalPags - 1;
    }

    btnAntes.addEventListener("click", () => { pagina--; renderPagina(); });
    btnDepois.addEventListener("click", () => { pagina++; renderPagina(); });
    busca.addEventListener("input", () => { filtro = busca.value.trim().toLowerCase(); pagina = 0; renderPagina(); });

    renderPagina();
  }

  // silêncio e segue o login normal.
  (async () => {
    try {
      const resp = await fetch("/api/credenciais-env", { cache: "no-store" });
      if (!resp.ok) return;
      const env = await resp.json();
      if (!env.disponivel) return;
      const respConnect = await apiCall("/api/connect", {});
      const data = await respConnect.json();
      if (!respConnect.ok) {
        loginError.textContent = `Credenciais do .env recusadas: ${data.error || "falha ao conectar."}`;
        loginError.style.display = "block";
        return;
      }
      entrarNoApp(data.displayName, env.email);
    } catch (e) {
      // sem /api/credenciais-env (produção) — segue pro login normal.
    }
  })();
})();
