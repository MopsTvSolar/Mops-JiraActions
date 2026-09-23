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
    $("btn-extracao-completa"),
    $("btn-extracao-query"),
    $("btn-a-violar"),
    $("btn-violar-hoje"),
    $("btn-violar-amanha"),
    $("btn-violar-semanal"),
    $("btn-violados"),
    $("btn-categorias-encerramento"),
    $("btn-criados-resolvidos"),
    $("btn-distribuicao"),
    $("btn-reabertos"),
    $("btn-criticos"),
    $("btn-analistas-encerramento"),
    $("btn-jornada"),
    $("btn-eps"),
    $("btn-report-vini"),
    $("btn-tv-resolvidos-reabertos"),
    $("btn-report-diario"),
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
    "extracao-dialog",
    "extracao-query-dialog",
    "violar-dialog",
    "categorias-dialog",
    "criados-resolvidos-dialog",
    "distribuicao-dialog",
    "reabertos-dialog",
    "colaboradores-dialog",
    "violados-dialog",
    "criticos-dialog",
    "analistas-dialog",
    "jornada-dialog",
    "eps-dialog",
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
    $("categorias-results").classList.add("hidden");
    $("criados-resolvidos-results").classList.add("hidden");
    $("distribuicao-results").classList.add("hidden");
    $("colaboradores-results").classList.add("hidden");
    $("criticos-results").classList.add("hidden");
    $("eps-results").classList.add("hidden");
    $("analista-detalhe").classList.add("hidden");
    $("heatmap-block").classList.add("hidden");
    $("report-vini-results").classList.add("hidden");
    $("report-diario-results").classList.add("hidden");
    hideHoverPopover();
  }

  // Home (#home-view) só aparece quando nada está selecionado: nenhum
  // diálogo de ação aberto e nenhum resultado visível. Em vez de espalhar
  // essa checagem em cada handler, observa as classes dos próprios
  // elementos e recalcula sozinho sempre que algum deles muda.
  const RESULT_BLOCK_IDS = [
    "results-card",
    "categorias-results",
    "criados-resolvidos-results",
    "distribuicao-results",
    "colaboradores-results",
    "criticos-results",
    "eps-results",
    "analista-detalhe",
    "heatmap-block",
    "report-vini-results",
    "report-diario-results",
  ];

  // Qual item do menu lateral corresponde a cada diálogo/resultado — usado só
  // pra destacar visualmente (.active) a ação atualmente aberta na tela,
  // igual um CRM marca a seção corrente no menu. "results-card" é
  // compartilhado por várias ações (Extração completa/por Query, A violar,
  // Violados, Reabertos, Jornada), então esse caso usa "lastAction" (já
  // existe mais abaixo, pro botão "Baixar arquivo") em vez do id do bloco.
  const DIALOG_TO_NAV = {
    "extracao-dialog": "btn-extracao-completa",
    "extracao-query-dialog": "btn-extracao-query",
    "violar-dialog": "btn-a-violar",
    "categorias-dialog": "btn-categorias-encerramento",
    "criados-resolvidos-dialog": "btn-criados-resolvidos",
    "distribuicao-dialog": "btn-distribuicao",
    "reabertos-dialog": "btn-reabertos",
    "colaboradores-dialog": "btn-colaboradores",
    "violados-dialog": "btn-violados",
    "criticos-dialog": "btn-criticos",
    "analistas-dialog": "btn-analistas-encerramento",
    "jornada-dialog": "btn-jornada",
    "eps-dialog": "btn-eps",
    "report-vini-dialog": "btn-report-vini",
    "tv-resolvidos-reabertos-dialog": "btn-tv-resolvidos-reabertos",
  };

  const RESULT_TO_NAV = {
    "categorias-results": "btn-categorias-encerramento",
    "criados-resolvidos-results": "btn-criados-resolvidos",
    "distribuicao-results": "btn-distribuicao",
    "colaboradores-results": "btn-colaboradores",
    "criticos-results": "btn-criticos",
    "eps-results": "btn-eps",
    "analista-detalhe": "btn-analistas-encerramento",
    "report-vini-results": "btn-report-vini",
    "report-diario-results": "btn-report-diario",
  };

  const LAST_ACTION_TO_NAV = {
    "extracao-completa": "btn-extracao-completa",
    "extracao-query": "btn-extracao-query",
    "violar-hoje": "btn-a-violar",
    "violar-amanha": "btn-a-violar",
    "violar-semanal": "btn-a-violar",
    violados: "btn-violados",
    reabertos: "btn-reabertos",
    jornada: "btn-jornada",
  };

  // "btn-report-diario" não tem diálogo próprio (ação direta, sempre "hoje")
  // — não aparece em DIALOG_TO_NAV, então entra à parte aqui.
  const NAV_ITEM_IDS = [...new Set([...Object.values(DIALOG_TO_NAV), "btn-report-diario"])];

  function updateNavActiveState() {
    const dialogAberto = ALL_DIALOG_IDS.find((id) => $(id).classList.contains("open"));
    let activeNavId = null;
    if (dialogAberto) {
      activeNavId = DIALOG_TO_NAV[dialogAberto];
    } else {
      const resultVisivel = RESULT_BLOCK_IDS.find(
        (id) => id !== "results-card" && id !== "heatmap-block" && !$(id).classList.contains("hidden")
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
    "extracao-completa": "Extração completa",
    "extracao-query": "Extração por Query",
    "violar-hoje": "Chamados a violar hoje",
    "violar-amanha": "Chamados a violar amanhã",
    "violar-semanal": "Plano semanal (próximos 7 dias)",
    violados: "Chamados violados",
    reabertos: "Chamados reabertos",
    jornada: "Análise de Jornada",
  };

  // Tom de cor do card de total, de acordo com o significado da ação
  // (mesma paleta de status usada no resto do app: informativo, alerta, crítico).
  const ACTION_TONE = {
    "extracao-completa": "tone-accent",
    "extracao-query": "tone-accent",
    "violar-hoje": "tone-warning",
    "violar-amanha": "tone-warning",
    "violar-semanal": "tone-warning",
    violados: "tone-danger",
    reabertos: "tone-warning",
    jornada: "tone-accent",
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
      $("btn-categorias-gerar"),
      $("btn-extracao-gerar"),
      $("btn-criados-resolvidos-gerar"),
      $("btn-reabertos-gerar"),
      $("btn-violados-gerar"),
      $("btn-criticos-gerar"),
      $("btn-vini-gerar"),
      $("btn-jornada-gerar"),
      $("btn-eps-gerar"),
      $("btn-extracao-query-gerar"),
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

  // Carrega os widgets da home todos de uma vez (em paralelo) — o login em
  // si não espera essa função (chamada sem await), só a home vai
  // preenchendo assim que cada chamada retorna.
  async function carregarHomeDashboardsGradual() {
    const loaders = [
      carregarHomeSlaMes,
      carregarHomeGrupoCriacao,
      carregarHomeFornecedorCriacao,
      carregarHomeCriadosMes,
      carregarHomeColaboradoresMes,
      carregarHomeClassificacaoFunil,
      carregarHomeViolarSemanal,
      carregarHomeViolados30Dias,
      carregarHomeCotiMes,
    ];
    await Promise.all(loaders.map((loader) => loader()));
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
    atualizarBotaoCriticos();
    atualizarBotaoReportVini();
    atualizarBotaoTvResolvidosReabertos();
  });

  // Segurança extra: se o navegador restaurar a página do cache (bfcache),
  // força novo login em vez de reaproveitar credenciais em memória.
  window.addEventListener("pagehide", () => {
    state.email = null;
    state.token = null;
  });

  // ------------------------------------------------------ caixa solucionadora
  // "Chamados Críticos" (COTI) é uma classificação específica da caixa Mops
  // Solar — não faz sentido pra Mops Tv do Futuro, então o botão some fora
  // dela.
  function atualizarBotaoCriticos() {
    $("btn-criticos").classList.toggle("hidden", state.caixa !== "solar");
  }

  // O roster de "Analistas de Encerramento" é uma lista fixa de nomes da
  // caixa Mops Solar — mesma lógica de Chamados Críticos: some fora dela.
  function atualizarBotaoAnalistas() {
    $("btn-analistas-encerramento").classList.toggle("hidden", state.caixa !== "solar");
  }

  // "Report Vini" é o espelho de Chamados Críticos/Analistas, mas pro outro
  // lado: só faz sentido em Mops Tv do Futuro (usa a tag Claro Tv +/Claro
  // Streaming Box de Categorias de Encerramento, que só existe nessa caixa).
  function atualizarBotaoReportVini() {
    $("btn-report-vini").classList.toggle("hidden", state.caixa !== "tv");
  }

  // "Resolvidos e Reabertos (Excel)" é específico da caixa Mops Tv do
  // Futuro — mesma lógica de Report Vini: some fora dela.
  function atualizarBotaoTvResolvidosReabertos() {
    $("btn-tv-resolvidos-reabertos").classList.toggle("hidden", state.caixa !== "tv");
  }

  // "Categorias de Encerramento" em Mops Tv do Futuro usa uma consulta fixa
  // (fetch_categoria_encerramento_tv_fixo, sem período/Top N/Encerrados-
  // Reabertos) — some os controles que não fazem mais efeito e mostra o
  // aviso da consulta fixa no lugar deles.
  function atualizarDialogCategorias() {
    const ehTv = state.caixa === "tv";
    $("categorias-controles-padrao").classList.toggle("hidden", ehTv);
    $("categorias-tv-fixo-hint").classList.toggle("hidden", !ehTv);
  }

  atualizarBotaoCriticos();
  atualizarBotaoAnalistas();
  atualizarBotaoReportVini();
  atualizarBotaoTvResolvidosReabertos();
  atualizarDialogCategorias();

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

  // Réplica de um gadget nativo do Jira (Grupo Solucionador × mês de
  // criação, entre os chamados abertos) — um sub-bloco por caixa, carrega
  // uma vez ao logar (não precisa recarregar ao trocar de caixa, já mostra
  // as duas).
  // "SLA — Mês atual": donut dentro/fora do prazo do começo do mês até
  // hoje, reaproveitando o mesmo componente visual (buildPrazoDonutEl) já
  // usado em Criados x Resolvidos/Report Vini. Um sub-bloco por caixa.
  async function carregarHomeSlaMes() {
    const container = $("home-sla-mes");
    const reabertosEl = $("home-reabertos-mes");
    homeCardErro(container, "Carregando...");
    reabertosEl.innerHTML = "";

    try {
      // Sem "projetos": os cards da home sempre consideram só "Central de
      // Incidentes", fixo no servidor — não seguem o painel "PROJETOS".
      const resp = await apiCall("/api/home-sla-mes", {});
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(container, data.error || "Erro ao carregar.");
        return;
      }

      container.innerHTML = "";
      const row = document.createElement("div");
      row.className = "home-sla-mes-row";
      data.caixas.forEach(({ caixa, dentro_prazo: dentro, fora_prazo: fora, percentual_dentro_prazo: percentual }) => {
        row.append(homeCaixaSubbloco(caixa, buildPrazoDonutEl(dentro, fora, percentual)));
      });
      container.append(row);

      data.caixas.forEach(({ caixa, percentual_reabertura: percentualReabertura, total_criados_periodo: totalCriadosPeriodo }) => {
        reabertosEl.append(
          summaryCard(
            `${percentualReabertura}% / ${totalCriadosPeriodo}`,
            HOME_CAIXA_LABEL[caixa] || caixa,
            "tone-warning"
          )
        );
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

  async function carregarHomeColaboradoresMes() {
    const container = $("home-colaboradores-mes");
    homeCardErro(container, "Carregando...");

    try {
      // Sem "projetos": ver nota em carregarHomeSlaMes.
      const resp = await apiCall("/api/home-colaboradores-mes", {});
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(container, data.error || "Erro ao carregar.");
        return;
      }

      container.innerHTML = "";
      data.caixas.forEach(({ caixa, colaboradores }) => {
        const wrap = document.createElement("div");
        wrap.className = "table-wrap";
        wrap.append(construirTabelaColaboradores(colaboradores));
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
      data.caixas.forEach(({ caixa, violados_abertos_por_grupo: porGrupo, dias }) => {
        const cardsEl = document.createElement("div");
        cardsEl.className = "summary-cards home-violados-abertos-cards";
        // Card "Total" só faz sentido na frente de um detalhamento de
        // verdade (2+ grupos) — no fallback sem Grupo Solucionador,
        // "porGrupo" já vem como um único item "Total" (grupo: null), e
        // repetir aqui na frente seria duplicado.
        if ((porGrupo || []).length > 1) {
          const totalCaixa = porGrupo.reduce((soma, g) => soma + g.total, 0);
          cardsEl.append(summaryCard(totalCaixa, "Total", "tone-danger"));
        }
        (porGrupo || []).forEach(({ grupo, total }) => {
          const label = grupo ? GRUPO_LABEL_CURTO[grupo] || grupo : "Total";
          cardsEl.append(summaryCard(total, label, "tone-danger"));
        });
        abertosEl.append(homeCaixaSubbloco(caixa, cardsEl));

        container.append(homeCaixaSubbloco(caixa, construirGruposViolar(caixa, dias)));
      });
    } catch (e) {
      homeCardErro(container, "Não foi possível conectar ao servidor.");
    }
  }

  // Popover customizado (mesmo elemento flutuante compartilhado de
  // getHoverPopover/hideHoverPopover, já usado em "Violados por dia") pra
  // mostrar o detalhe de um dia da lista de 30 dias — aqui é só texto
  // (resolvido/violado/previsto), sem lista de keys pra copiar.
  function showHomeBar30Popover(anchorEl, dia) {
    const popover = getHoverPopover();
    popover.innerHTML = "";

    const titulo = document.createElement("div");
    titulo.className = "hover-popover-title";
    titulo.textContent = formatarDataBR(dia.data);
    popover.append(titulo);

    const linhaResolvido = document.createElement("div");
    linhaResolvido.className = "home-bar30-popover-row";
    const dotResolvido = document.createElement("span");
    dotResolvido.className = "home-bar30-legend-dot home-bar30-legend-dot--resolvido";
    linhaResolvido.append(dotResolvido, document.createTextNode(`${dia.resolvido} resolvido${dia.resolvido === 1 ? "" : "s"} dentro do prazo`));
    popover.append(linhaResolvido);

    const linhaViolado = document.createElement("div");
    linhaViolado.className = "home-bar30-popover-row";
    const dotViolado = document.createElement("span");
    dotViolado.className = "home-bar30-legend-dot home-bar30-legend-dot--violado";
    linhaViolado.append(dotViolado, document.createTextNode(`${dia.violado} violado${dia.violado === 1 ? "" : "s"}`));
    popover.append(linhaViolado);

    const totalEl = document.createElement("div");
    totalEl.className = "hint";
    totalEl.style.marginTop = "6px";
    totalEl.textContent = `Previsto no dia: ${dia.previsto}`;
    popover.append(totalEl);

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

  // "Violados — Últimos 30 dias": uma linha por dia (data + barra horizontal
  // verde/vermelha), lista rolável — dias com previsto 0 não entram. Largura
  // da barra proporcional ao maior "previsto pra violar" visível no período
  // (não ao maior "violado" sozinho, senão um dia 100% verde ficaria do
  // mesmo tamanho que um dia 100% vermelho). Passar o mouse na barra mostra
  // o detalhe do dia num popover (mesmo componente de "Violados por dia").
  function construirListaBarras30Dias(dias) {
    // "dias" chega do servidor em ordem cronológica (mais antigo primeiro);
    // a lista mostra o mais recente no topo.
    const diasComPrevisto = dias.filter((d) => d.previsto > 0).reverse();

    const lista = document.createElement("div");
    lista.className = "home-bar30-list";

    if (!diasComPrevisto.length) {
      const vazio = document.createElement("p");
      vazio.className = "hint";
      vazio.textContent = "Nenhum chamado previsto pra violar no período.";
      lista.append(vazio);
      return lista;
    }

    const maxPrevisto = Math.max(...diasComPrevisto.map((d) => d.previsto));
    diasComPrevisto.forEach((dia) => {
      const row = document.createElement("div");
      row.className = "home-bar30-row";

      const dataEl = document.createElement("span");
      dataEl.className = "home-bar30-row-date";
      dataEl.textContent = formatarDataBR(dia.data).slice(0, 5);

      const track = document.createElement("div");
      track.className = "home-bar30-row-track";

      const bar = document.createElement("div");
      bar.className = "home-bar30-row-bar";
      bar.style.width = `${(dia.previsto / maxPrevisto) * 100}%`;

      const segResolvido = document.createElement("div");
      segResolvido.className = "home-bar30-row-seg--resolvido";
      segResolvido.style.width = `${(dia.resolvido / dia.previsto) * 100}%`;

      const segViolado = document.createElement("div");
      segViolado.className = "home-bar30-row-seg--violado";
      segViolado.style.width = `${(dia.violado / dia.previsto) * 100}%`;

      bar.append(segResolvido, segViolado);
      track.append(bar);
      track.addEventListener("mouseenter", () => {
        cancelHoverPopoverHide();
        showHomeBar30Popover(track, dia);
      });
      track.addEventListener("mouseleave", scheduleHoverPopoverHide);

      const valorEl = document.createElement("span");
      valorEl.className = "home-bar30-row-value";
      valorEl.textContent = dia.previsto;

      row.append(dataEl, track, valorEl);
      lista.append(row);
    });

    return lista;
  }

  async function carregarHomeViolados30Dias() {
    const container = $("home-violados-30dias");
    homeCardErro(container, "Carregando...");

    try {
      // Sem "projetos": ver nota em carregarHomeSlaMes.
      const resp = await apiCall("/api/home-violados-30dias", {});
      const data = await resp.json();
      if (!resp.ok) {
        homeCardErro(container, data.error || "Erro ao carregar.");
        return;
      }

      container.innerHTML = "";
      data.caixas.forEach(({ caixa, dias }) => {
        container.append(homeCaixaSubbloco(caixa, construirListaBarras30Dias(dias)));
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
      atualizarBotaoCriticos();
      atualizarBotaoAnalistas();
      atualizarBotaoReportVini();
      atualizarBotaoTvResolvidosReabertos();
      atualizarDialogCategorias();
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
    "extracao-completa": "/api/extracao-completa",
    "extracao-query": "/api/extracao-query",
    "violar-hoje": "/api/violar-hoje",
    "violar-amanha": "/api/violar-amanha",
    "violar-semanal": "/api/violar-semanal",
    violados: "/api/violados",
    reabertos: "/api/reabertos",
    jornada: "/api/analise-jornada",
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

  // ------------------------------------------------------- extração completa
  // Diferente das outras 3 ações: abre um painel de opções (mesmo efeito do
  // botão Categorias de Encerramento) em vez de buscar na hora — deixa
  // escolher caixas/status/período antes de rodar.
  $("btn-extracao-completa").addEventListener("click", () => {
    const dialog = $("extracao-dialog");
    const jaAberto = dialog.classList.contains("open");
    closeAllDialogs("extracao-dialog");
    if (!jaAberto) {
      buildCheckboxes($("extracao-grupos-checkboxes"), CAIXA_GRUPOS[state.caixa] || [], "extracao-grupo");
      buildCheckboxes($("extracao-status-checkboxes"), STATUS_OPTIONS, "extracao-status");
    }
    dialog.classList.add("open");
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

  // --------------------------------------------------------- extração por query
  // Diferente de Extração completa: não parte de nenhuma JQL pré-montada
  // (grupo/projeto/caixa/período) — o usuário digita a JQL inteira, o
  // servidor só valida direto no Jira. Sempre devolve as mesmas 6 colunas
  // fixas (ver fetch_chamados_por_query em jira_extractor.py).
  $("btn-extracao-query").addEventListener("click", () => {
    const dialog = $("extracao-query-dialog");
    closeAllDialogs("extracao-query-dialog");
    dialog.classList.add("open");
  });

  $("btn-extracao-query-cancelar").addEventListener("click", () => {
    $("extracao-query-dialog").classList.remove("open");
  });

  $("btn-extracao-query-gerar").addEventListener("click", async () => {
    const jql = $("extracao-query-input-jql").value.trim();
    if (!jql) {
      setBanner("Informe a JQL.", "error");
      return;
    }

    const extraBody = { jql };

    $("extracao-query-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Buscando chamados no Jira...", "info");
    hideAllResults();
    try {
      const resp = await apiCall("/api/extracao-query", extraBody);
      const data = await resp.json();

      if (!resp.ok) {
        setBanner(data.error || "Erro ao executar a ação.", "error");
        return;
      }

      lastAction = "extracao-query";
      lastCaixa = state.caixa;
      lastExtraBody = extraBody;
      renderResults("extracao-query", data);
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
    closeAllDialogs("violar-dialog");
    dialog.classList.add("open");
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
    renderSummary(action, data.summary, data.por_grupo, data.por_turno);
    renderPorDiaViolados(data.por_dia, data.rows);
    renderJornadaResumo(data);
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

  // Tabela genérica de 2 colunas (rótulo + quantidade) a partir de uma
  // lista [rotulo, total] — usada pelas duas tabelas de Análise de Jornada
  // (Status e Top Analistas), que têm exatamente esse formato.
  function preencherTabela2Col(tableId, colunas, linhas) {
    const thead = document.querySelector(`#${tableId} thead`);
    const tbody = document.querySelector(`#${tableId} tbody`);
    thead.innerHTML = "";
    tbody.innerHTML = "";
    if (!linhas || !linhas.length) return;

    const trHead = document.createElement("tr");
    colunas.forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      trHead.append(th);
    });
    thead.append(trHead);

    linhas.forEach(([rotulo, total]) => {
      const tr = document.createElement("tr");
      const tdRotulo = document.createElement("td");
      tdRotulo.textContent = rotulo;
      const tdTotal = document.createElement("td");
      tdTotal.textContent = total;
      tr.append(tdRotulo, tdTotal);
      tbody.append(tr);
    });
  }

  function isoLocal(date) {
    const ano = date.getFullYear();
    const mes = String(date.getMonth() + 1).padStart(2, "0");
    const dia = String(date.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }

  // Um dia por data entre início/fim (mesmo padrão do "calendario" que o
  // backend devolve pra Analistas — todo dia entra, com 0 pros sem chamado
  // criado), a partir das linhas já buscadas (sem consulta extra ao Jira).
  function diasCriadosPorPeriodo(rows, inicio, fim) {
    if (!inicio || !fim) return [];
    const porDia = new Map();
    (rows || []).forEach((row) => {
      if (!row.created) return;
      const dia = row.created.slice(0, 10);
      porDia.set(dia, (porDia.get(dia) || 0) + 1);
    });

    const [anoIni, mesIni, diaIni] = inicio.split("-").map(Number);
    const [anoFim, mesFim, diaFim] = fim.split("-").map(Number);
    const dataAtual = new Date(anoIni, mesIni - 1, diaIni);
    const dataFim = new Date(anoFim, mesFim - 1, diaFim);

    const dias = [];
    while (dataAtual <= dataFim) {
      const chave = isoLocal(dataAtual);
      dias.push({ data: chave, criados: porDia.get(chave) || 0 });
      dataAtual.setDate(dataAtual.getDate() + 1);
    }
    return dias;
  }

  const CALENDARIO_CAMPOS_CRIADOS = [{ campo: "criados", prefixo: "C", classe: "calendario-dia-criados" }];

  // Gráfico de barras horizontal, sem biblioteca externa — largura de cada
  // barra proporcional ao maior valor da lista. "dados" é [rótulo, total]
  // (mesmo formato de por_status/top_assignees), já ordenado do maior pro
  // menor; "limite" corta em quantas barras mostrar (evita um gráfico
  // ilegível quando a Sub-Classificação tem muitos valores distintos).
  function construirGraficoBarras(dados, limite = 10) {
    const container = document.createElement("div");
    container.className = "bar-chart";

    const itens = dados.slice(0, limite);
    const maxValor = Math.max(...itens.map(([, total]) => total), 1);

    itens.forEach(([rotulo, total]) => {
      const row = document.createElement("div");
      row.className = "bar-chart-row";

      const label = document.createElement("span");
      label.className = "bar-chart-label";
      label.textContent = rotulo;
      label.title = rotulo;

      const track = document.createElement("div");
      track.className = "bar-chart-track";
      const fill = document.createElement("div");
      fill.className = "bar-chart-fill";
      fill.style.width = `${(total / maxValor) * 100}%`;
      track.append(fill);

      const value = document.createElement("span");
      value.className = "bar-chart-value";
      value.textContent = total;

      row.append(label, track, value);
      container.append(row);
    });

    return container;
  }

  // Sub-tabela de 2 colunas (Sub-Classificação | Quantidade) usada dentro
  // da linha de detalhe de cada Classificação — mesma forma [rótulo, total]
  // das outras tabelas simples do app.
  function construirSubtabela(colunas, linhas) {
    const table = document.createElement("table");
    table.className = "data-table jornada-ranking-subtable";

    const thead = document.createElement("thead");
    const trHead = document.createElement("tr");
    colunas.forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      trHead.append(th);
    });
    thead.append(trHead);
    table.append(thead);

    const tbody = document.createElement("tbody");
    linhas.forEach(([rotulo, total]) => {
      const tr = document.createElement("tr");
      const tdRotulo = document.createElement("td");
      tdRotulo.textContent = rotulo;
      const tdTotal = document.createElement("td");
      tdTotal.textContent = total;
      tr.append(tdRotulo, tdTotal);
      tbody.append(tr);
    });
    table.append(tbody);

    return table;
  }

  // Ranking por Classificação (Análise de Jornada, modo "Geral") — cada
  // linha expande (clique) uma linha de detalhe com o ranking por
  // Sub-Classificação daquela Classificação (já vem pronto do backend, sem
  // busca nova nenhuma — ver ranking_classificacao/ por_subclassificacao).
  function construirTabelaRankingClassificacao(ranking) {
    const table = document.createElement("table");
    table.className = "data-table";

    const thead = document.createElement("thead");
    const trHead = document.createElement("tr");
    ["Classificação", "Quantidade"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      trHead.append(th);
    });
    thead.append(trHead);
    table.append(thead);

    const tbody = document.createElement("tbody");
    ranking.forEach(({ classificacao, total, por_subclassificacao: porSub }) => {
      const trMain = document.createElement("tr");
      trMain.className = "jornada-ranking-row";

      const tdLabel = document.createElement("td");
      const arrow = document.createElement("span");
      arrow.className = "jornada-ranking-arrow";
      arrow.textContent = "▸";
      tdLabel.append(arrow, document.createTextNode(` ${classificacao}`));

      const tdTotal = document.createElement("td");
      tdTotal.textContent = total;

      trMain.append(tdLabel, tdTotal);
      tbody.append(trMain);

      const trDetail = document.createElement("tr");
      trDetail.className = "jornada-ranking-detail hidden";
      const tdDetail = document.createElement("td");
      tdDetail.colSpan = 2;

      if (porSub && porSub.length) {
        tdDetail.append(construirSubtabela(["Sub-Classificação", "Quantidade"], porSub));
      } else {
        const semDados = document.createElement("span");
        semDados.className = "hint";
        semDados.textContent = "Sem Sub-Classificação preenchida nesses chamados.";
        tdDetail.append(semDados);
      }

      trDetail.append(tdDetail);
      tbody.append(trDetail);

      trMain.addEventListener("click", () => {
        const abrindo = trDetail.classList.contains("hidden");
        trDetail.classList.toggle("hidden", !abrindo);
        trMain.classList.toggle("open", abrindo);
      });
    });
    table.append(tbody);

    return table;
  }

  // Só aparece em Análise de Jornada: cards "Total de chamados"/"Chamados
  // abertos" empilhados à esquerda + tabela por status e tabela de top
  // analistas à direita, as três colunas alinhadas na mesma linha (mesmo
  // grupo de dados que antes ia pro #summary-cards/#top-assignees
  // genéricos — aqui esconde os dois e monta um layout próprio); e, no
  // lugar da tabela de linhas (#results-table), um calendário de "Chamados
  // criados" por dia — mesmo layout/componente do calendário de Analistas
  // de Encerramento (construirCalendario), só com outro campo de contagem.
  // "por_status" e "summary.top_assignees" vêm do backend como lista
  // [rótulo, total] (Counter.most_common), já ordenadas do mais pro menos
  // frequente. "data.inicio"/"data.fim" são injetados pelo handler do
  // botão "Gerar" antes de chamar renderResults — o calendário precisa das
  // duas pontas do período pra preencher todos os dias, não só os com
  // chamado criado.
  function renderJornadaResumo(data) {
    const block = $("jornada-resumo-block");
    const cardsEl = $("jornada-cards");
    cardsEl.innerHTML = "";

    const temDados = data.summary && typeof data.criados === "number" && data.por_status;
    preencherTabela2Col("jornada-status-table", ["Status", "Quantidade"], temDados ? data.por_status : null);
    preencherTabela2Col(
      "jornada-analistas-table",
      ["Analista", "Quantidade"],
      temDados ? data.summary.top_assignees : null
    );

    const calendarioBlock = $("jornada-calendario-block");
    const calendarioEl = $("jornada-calendario");
    const resultsTableWrap = $("results-table-wrap");
    const subclassBlock = $("jornada-subclassificacao-block");
    const rankingBlock = $("jornada-ranking-block");

    if (!temDados) {
      block.classList.add("hidden");
      calendarioBlock.classList.add("hidden");
      subclassBlock.classList.add("hidden");
      rankingBlock.classList.add("hidden");
      // #top-assignees e a tabela genérica não têm lógica própria de
      // mostrar/esconder (só preenchem o innerHTML) — sem restaurar aqui,
      // ficariam escondidos pra sempre nas ações seguintes.
      $("top-assignees").classList.remove("hidden");
      resultsTableWrap.classList.remove("hidden");
      $("table-note").classList.remove("hidden");
      return;
    }

    // Essa ação mostra os totais no layout próprio abaixo — o card genérico
    // "Total de chamados" e o bloco "Top responsáveis" (ambos já
    // preenchidos por renderSummary) ficam redundantes aqui.
    $("summary-cards").classList.add("hidden");
    $("top-assignees").classList.add("hidden");

    // Mesmos rótulos/tons já usados em Criados x Resolvidos (Report Vini) —
    // "criados" é o total já buscado (a busca principal já é escopada a
    // "created no período"); "resolvidos" vem de uma consulta à parte
    // (status IN Resolvido/Encerrado AND resolutiondate no período).
    cardsEl.append(summaryCard(data.criados, "Criados no período", "tone-accent"));
    cardsEl.append(summaryCard(data.resolvidos, "Resolvidos (Encerrado/Resolvido)", "tone-warning"));
    cardsEl.append(summaryCard(data.saldo, "Saldo (criados − resolvidos)", data.saldo > 0 ? "tone-danger" : ""));

    // Acima do calendário: no modo "Geral", o ranking por Classificação (com
    // detalhamento por Sub-Classificação embutido, expansível por linha) —
    // nos demais casos, o gráfico de barras achatado de Sub-Classificação
    // de sempre. Só um dos dois aparece por vez.
    const subclassEl = $("jornada-subclassificacao-chart");
    const rankingEl = $("jornada-ranking");
    subclassEl.innerHTML = "";
    rankingEl.innerHTML = "";
    if (data.ranking_classificacao && data.ranking_classificacao.length) {
      rankingEl.append(construirTabelaRankingClassificacao(data.ranking_classificacao));
      rankingBlock.classList.remove("hidden");
      subclassBlock.classList.add("hidden");
    } else if (data.por_subclassificacao && data.por_subclassificacao.length) {
      subclassEl.append(construirGraficoBarras(data.por_subclassificacao));
      subclassBlock.classList.remove("hidden");
      rankingBlock.classList.add("hidden");
    } else {
      subclassBlock.classList.add("hidden");
      rankingBlock.classList.add("hidden");
    }

    // Calendário no lugar da tabela de linhas.
    resultsTableWrap.classList.add("hidden");
    $("table-note").classList.add("hidden");
    calendarioEl.innerHTML = "";
    const dias = diasCriadosPorPeriodo(data.rows, data.inicio, data.fim);
    if (dias.length) {
      calendarioEl.append(construirCalendario(dias, CALENDARIO_CAMPOS_CRIADOS));
      calendarioBlock.classList.remove("hidden");
    } else {
      calendarioBlock.classList.add("hidden");
    }

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
      // Total desce para a mesma linha dos cards por grupo, como primeiro card.
      porGrupoCardsEl.append(totalCard);
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

  // -------------------------------------------- categorias de encerramento
  $("btn-categorias-encerramento").addEventListener("click", () => {
    const dialog = $("categorias-dialog");
    const jaAberto = dialog.classList.contains("open");
    closeAllDialogs("categorias-dialog");
    if (!jaAberto) {
      const hoje = new Date().toISOString().slice(0, 10);
      $("cat-input-inicio").value = hoje;
      $("cat-input-fim").value = hoje;
    }
    dialog.classList.add("open");
  });

  $("btn-categorias-cancelar").addEventListener("click", () => {
    $("categorias-dialog").classList.remove("open");
  });

  // Busca Ofensor e Extração Geral compartilham o mesmo molde: tabela
  // paginada, checkboxes Ativo/Inativo, "Categoria Ativa?" checada em
  // lotes pequenos enquanto carrega (a API do Jira Assets é uma chamada
  // por chamado — pra uma Funcionalidade grande, tipo "PME" com 424, ou
  // pro projeto inteiro na Extração Geral, com mais de 7 mil, verificar
  // tudo de uma vez trava a tela). criarBuscaPaginadaChamados(prefixo)
  // monta esse comportamento uma vez só, reaproveitado pelas duas telas —
  // cada uma só entra com a chamada de API específica (por Funcionalidade
  // ou pelo projeto inteiro).
  const CHAMADOS_LOTE_TAMANHO = 25;
  const CHAMADOS_PAGINA_TAMANHO = 20;

  function criarBuscaPaginadaChamados(prefixo) {
    // buscaId invalida lotes de uma busca anterior ainda em voo quando o
    // usuário dispara uma busca nova no meio do carregamento — mesma
    // lógica da race condition já corrigida em Analistas de Encerramento
    // (buscarDetalheAnalista terminando depois de "Fechar").
    let buscaId = 0;
    let chamadosBrutos = [];
    let indiceProximoLote = 0;
    let statusCache = {};
    let atreladosCache = {};
    let chamadosFiltrados = [];
    let paginaAtual = 0;

    function filtroPassa(categoriaStatus) {
      if (categoriaStatus === "Ativo") return $(`${prefixo}-check-ativo`).checked;
      if (categoriaStatus === "Inativo") return $(`${prefixo}-check-inativo`).checked;
      return false;
    }

    function recomputarFiltrados() {
      const processados = chamadosBrutos.slice(0, indiceProximoLote);
      chamadosFiltrados = processados.filter((c) => filtroPassa(c.categoria_status));
    }

    function renderPaginaAtual() {
      const wrap = $(`${prefixo}-chamados-wrap`);
      const tbody = document.querySelector(`#${prefixo}-chamados-table tbody`);
      tbody.innerHTML = "";

      const inicio = paginaAtual * CHAMADOS_PAGINA_TAMANHO;
      const pagina = chamadosFiltrados.slice(inicio, inicio + CHAMADOS_PAGINA_TAMANHO);

      pagina.forEach((chamado) => {
        const tr = document.createElement("tr");
        [
          chamado.key,
          chamado.summary,
          chamado.status,
          chamado.created ? chamado.created.slice(0, 10).split("-").reverse().join("/") : "",
          chamado.assignee,
          chamado.categoria_status || "—",
          typeof chamado.chamados_atrelados === "number" ? chamado.chamados_atrelados : "—",
        ].forEach((valor) => {
          const td = document.createElement("td");
          td.textContent = escapeText(valor);
          tr.append(td);
        });
        tbody.append(tr);
      });
      wrap.classList.toggle("hidden", chamadosFiltrados.length === 0);

      const totalPaginas = Math.max(1, Math.ceil(chamadosFiltrados.length / CHAMADOS_PAGINA_TAMANHO));
      $(`${prefixo}-pagina-label`).textContent =
        `Página ${paginaAtual + 1} de ${totalPaginas} (${chamadosFiltrados.length} no filtro)`;
      $(`${prefixo}-pagina-anterior`).disabled = paginaAtual === 0;
      $(`${prefixo}-pagina-proxima`).disabled = inicio + CHAMADOS_PAGINA_TAMANHO >= chamadosFiltrados.length;
      $(`${prefixo}-paginacao`).classList.toggle("hidden", chamadosFiltrados.length === 0);
    }

    function atualizarProgresso(concluido) {
      const el = $(`${prefixo}-progresso`);
      const totalBruto = chamadosBrutos.length;
      if (!totalBruto) {
        el.classList.add("hidden");
        return;
      }
      el.classList.remove("hidden");
      el.classList.toggle("is-loading", !concluido);
      el.textContent = concluido
        ? `Categoria verificada em ${totalBruto} chamado${totalBruto === 1 ? "" : "s"} — ${chamadosFiltrados.length} no filtro atual.`
        : `Verificando categorias... ${indiceProximoLote} de ${totalBruto} chamados (${chamadosFiltrados.length} no filtro até agora).`;
    }

    async function processarProximoLote(id) {
      if (id !== buscaId) return;
      if (indiceProximoLote >= chamadosBrutos.length) {
        atualizarProgresso(true);
        return;
      }

      const lote = chamadosBrutos.slice(indiceProximoLote, indiceProximoLote + CHAMADOS_LOTE_TAMANHO);
      const nomesParaBuscar = [...new Set(lote.map((c) => c.summary).filter((n) => n && !(n in statusCache)))];

      if (nomesParaBuscar.length) {
        try {
          const resp = await apiCall("/api/categoria-status-lote", { nomes: nomesParaBuscar });
          if (id !== buscaId) return;
          const data = await resp.json();
          if (resp.ok) {
            Object.assign(statusCache, data.status);
            Object.assign(atreladosCache, data.atrelados);
          }
        } catch (e) {
          if (id !== buscaId) return;
        }
      }

      if (id !== buscaId) return;

      lote.forEach((chamado) => {
        chamado.categoria_status = Object.prototype.hasOwnProperty.call(statusCache, chamado.summary)
          ? statusCache[chamado.summary]
          : null;
        chamado.chamados_atrelados = Object.prototype.hasOwnProperty.call(atreladosCache, chamado.summary)
          ? atreladosCache[chamado.summary]
          : null;
      });
      indiceProximoLote += lote.length;

      recomputarFiltrados();
      renderPaginaAtual();
      atualizarProgresso(false);

      processarProximoLote(id);
    }

    function reiniciarFiltroEExibir() {
      paginaAtual = 0;
      recomputarFiltrados();
      renderPaginaAtual();
    }

    $(`${prefixo}-check-ativo`).addEventListener("change", reiniciarFiltroEExibir);
    $(`${prefixo}-check-inativo`).addEventListener("change", reiniciarFiltroEExibir);

    $(`${prefixo}-pagina-anterior`).addEventListener("click", () => {
      if (paginaAtual > 0) {
        paginaAtual -= 1;
        renderPaginaAtual();
      }
    });
    $(`${prefixo}-pagina-proxima`).addEventListener("click", () => {
      const inicio = (paginaAtual + 1) * CHAMADOS_PAGINA_TAMANHO;
      if (inicio < chamadosFiltrados.length) {
        paginaAtual += 1;
        renderPaginaAtual();
      }
    });

    // "carregar" faz a validação + chamada de API específica de cada tela
    // e devolve { resp, data, mensagemTotal(total) } — ou null se decidiu
    // abortar (ex.: nenhuma Funcionalidade escolhida), já deixando a
    // mensagem certa no status.
    async function buscar(carregar) {
      buscaId += 1;
      const id = buscaId;

      chamadosBrutos = [];
      indiceProximoLote = 0;
      statusCache = {};
      atreladosCache = {};
      chamadosFiltrados = [];
      paginaAtual = 0;
      $(`${prefixo}-progresso`).classList.add("hidden");
      $(`${prefixo}-paginacao`).classList.add("hidden");
      $(`${prefixo}-filtro-status`).classList.add("hidden");
      $(`${prefixo}-chamados-wrap`).classList.add("hidden");

      const resultado = await carregar();
      if (id !== buscaId) return;
      if (!resultado) return;

      const { resp, data, mensagemTotal } = resultado;
      const statusEl = $(`${prefixo}-status`);
      if (!resp.ok) {
        statusEl.textContent = data.error || "Erro ao buscar chamados.";
        return;
      }
      const total = data.chamados.length;
      statusEl.textContent = mensagemTotal(total);

      chamadosBrutos = data.chamados;
      if (total) {
        $(`${prefixo}-filtro-status`).classList.remove("hidden");
        processarProximoLote(id);
      }
    }

    return { buscar };
  }

  // Busca Ofensor: não usa Data início/fim nem os checkboxes da ação
  // principal. Escolher uma opção no dropdown "Funcionalidade Ofensores"
  // (mesmo campo/opções nativas do Jira, customfield_26645) já dispara a
  // busca nos chamados de "Gestão de Problemas" (base de chamados normal,
  // não o catálogo do Jira Assets) filtrando por esse campo.
  $("btn-ofensor").addEventListener("click", () => {
    const painel = $("ofensor-panel");
    const abrindo = !painel.classList.contains("open");
    painel.classList.toggle("open", abrindo);
    if (abrindo) {
      $("ofensor-funcionalidade").focus();
    }
  });

  const buscaOfensor = criarBuscaPaginadaChamados("ofensor");

  function ofensorCampoBuscaSelecionado() {
    return document.querySelector('input[name="ofensor-campo-busca"]:checked').value;
  }

  function dispararBuscaOfensor() {
    const funcionalidade = $("ofensor-funcionalidade").value;
    const campoBusca = ofensorCampoBuscaSelecionado();
    const termo = $("ofensor-termo-busca").value.trim();

    buscaOfensor.buscar(async () => {
      if (!funcionalidade) {
        $("ofensor-status").textContent = "Selecione uma Funcionalidade Ofensores pra buscar.";
        $("ofensor-filtro-extra").classList.add("hidden");
        return null;
      }
      $("ofensor-filtro-extra").classList.remove("hidden");
      const rotulo = termo ? `${funcionalidade} + ${campoBusca === "alm" ? "ALM" : "Nome"} "${termo}"` : funcionalidade;
      $("ofensor-status").textContent = `Buscando chamados de "${rotulo}" em Gestão de Problemas...`;
      try {
        const resp = await apiCall("/api/chamados-ofensor", { funcionalidade, campo_busca: campoBusca, termo });
        const data = await resp.json();
        return {
          resp,
          data,
          mensagemTotal: (total) =>
            total
              ? `${total} chamado${total === 1 ? "" : "s"} de "${rotulo}" em Gestão de Problemas.`
              : `Nenhum chamado de "${rotulo}" em Gestão de Problemas.`,
        };
      } catch (e) {
        $("ofensor-status").textContent = "Não foi possível conectar ao servidor.";
        return null;
      }
    });
  }

  $("ofensor-funcionalidade").addEventListener("change", () => {
    $("ofensor-termo-busca").value = "";
    dispararBuscaOfensor();
  });

  let ofensorTermoTimer = null;
  $("ofensor-termo-busca").addEventListener("input", () => {
    clearTimeout(ofensorTermoTimer);
    ofensorTermoTimer = setTimeout(dispararBuscaOfensor, 300);
  });

  document.querySelectorAll('input[name="ofensor-campo-busca"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if ($("ofensor-termo-busca").value.trim()) {
        dispararBuscaOfensor();
      }
    });
  });

  // Extração Geral: NÃO mostra tabela em tela — baixa direto um Excel com
  // os chamados da Funcionalidade Ofensores escolhida (exige Funcionalidade,
  // não deixa exportar "Gestão de Problemas" inteiro sem filtro nenhum),
  // cada linha já com "Categoria Ativa?" checada. Só dispara quando o
  // usuário clica em "Gerar Excel" (nunca sozinho ao trocar a Funcionalidade
  // ou ao abrir o painel) — e como a checagem roda inteira antes de
  // responder, pode demorar bastante numa Funcionalidade grande.
  $("btn-ofgeral").addEventListener("click", () => {
    const painel = $("ofgeral-panel");
    const abrindo = !painel.classList.contains("open");
    painel.classList.toggle("open", abrindo);
    if (abrindo) {
      $("ofgeral-funcionalidade").focus();
    }
  });

  function ofgeralCampoBuscaSelecionado() {
    return document.querySelector('input[name="ofgeral-campo-busca"]:checked').value;
  }

  $("btn-ofgeral-buscar").addEventListener("click", async () => {
    const funcionalidade = $("ofgeral-funcionalidade").value;
    const campoBusca = ofgeralCampoBuscaSelecionado();
    const termo = $("ofgeral-termo-busca").value.trim();
    const statusEl = $("ofgeral-status");

    if (!funcionalidade) {
      statusEl.textContent = "Selecione uma Funcionalidade Ofensores pra gerar o Excel.";
      return;
    }

    const rotulo = termo ? `${funcionalidade} + ${campoBusca === "alm" ? "ALM" : "Nome"} "${termo}"` : funcionalidade;
    const botao = $("btn-ofgeral-buscar");

    statusEl.textContent = `Gerando Excel de "${rotulo}" em Gestão de Problemas...`;
    statusEl.classList.add("is-loading");
    botao.disabled = true;

    try {
      const resp = await apiCall("/api/chamados-geral", { funcionalidade, campo_busca: campoBusca, termo });
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
      const filename = filenameFromDisposition(resp.headers.get("Content-Disposition"), "extracao_geral_gestao_problemas.xlsx");
      triggerDownload(blob, filename);
      statusEl.textContent = `Excel gerado: ${filename}`;
    } catch (e) {
      statusEl.textContent = "Não foi possível conectar ao servidor.";
    } finally {
      statusEl.classList.remove("is-loading");
      botao.disabled = false;
    }
  });

  // "secao" pode vir no formato "chato" (Mops Solar: {categorias,
  // total_chamados, total_categorizados}) ou dividido por APP/BOX (Mops Tv
  // do Futuro: {app, box, outros?}) — buildCategoriaTableEl trata os dois
  // (é a mesma função usada pelo Report Vini).
  function renderCategoriaTable(prefixo, secao, titulo) {
    const bloco = $(`categorias-${prefixo}-block`);
    bloco.innerHTML = "";

    if (!secao) {
      bloco.classList.add("hidden");
      return;
    }

    bloco.append(buildCategoriaTableEl(titulo, secao));
    bloco.classList.remove("hidden");
  }

  // Mops Tv do Futuro: tabela única "Categoria / Issues (Chamados) / %" +
  // gráfico de barras (mesmo componente de Sub-Classificação em Análise de
  // Jornada) — dados vêm da consulta fixa fetch_categoria_encerramento_tv_fixo,
  // sem período/Top N (mostra TODAS as categorias encontradas).
  function renderCategoriaTvFixo(secao) {
    const bloco = $("categorias-tv-fixo-block");
    bloco.innerHTML = "";

    if (!secao) {
      bloco.classList.add("hidden");
      return;
    }

    const holder = document.createElement("div");

    const headerRow = document.createElement("div");
    headerRow.style.display = "flex";
    headerRow.style.alignItems = "center";
    headerRow.style.justifyContent = "space-between";
    headerRow.style.gap = "10px";

    const h = document.createElement("div");
    h.className = "top-assignees-title";
    h.textContent = `Categorias de Encerramento — ${secao.total_chamados} chamados`;
    headerRow.append(h);

    if (secao.categorias.length) {
      const botoesEl = document.createElement("div");
      botoesEl.style.display = "flex";
      botoesEl.style.gap = "8px";

      const btnExcel = document.createElement("button");
      btnExcel.type = "button";
      btnExcel.className = "btn-secondary";
      btnExcel.textContent = "📥 Baixar Excel";
      btnExcel.addEventListener("click", () => baixarCategoriasTvExcel(false));

      const btnAnalitico = document.createElement("button");
      btnAnalitico.type = "button";
      btnAnalitico.className = "btn-secondary";
      btnAnalitico.textContent = "📄 Baixar Analítico";
      btnAnalitico.title = "Uma linha por chamado: Número do Chamado, Data Criação, Classificação e Categoria de Encerramento";
      btnAnalitico.addEventListener("click", () => baixarCategoriasTvExcel(true));

      botoesEl.append(btnExcel, btnAnalitico);
      headerRow.append(botoesEl);
    }

    holder.append(headerRow);

    if (secao.categorias.length) {
      const chart = construirGraficoBarras(
        secao.categorias.map((c) => [c.categoria, c.quantidade]),
        secao.categorias.length
      );
      chart.style.margin = "10px 0 14px";
      holder.append(chart);
    }

    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const table = document.createElement("table");
    table.className = "data-table data-table--categorias";
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");

    const trHead = document.createElement("tr");
    ["Categoria", "Issues (Chamados)", "%"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      trHead.append(th);
    });
    thead.append(trHead);

    if (!secao.categorias.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = "Nenhum chamado encontrado.";
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

    bloco.append(holder);
    bloco.classList.remove("hidden");
  }

  // Excel de Mops Tv do Futuro — mesmo endpoint da busca em tela, só que
  // com "format: excel" (o servidor devolve o arquivo pronto em vez do
  // JSON — ver _is_download/_send_rows em api/index.py). "analitico"
  // troca a tabela "Categoria / Issues (Chamados) / %" agregada por uma
  // linha por chamado (Número do Chamado/Data Criação/Categoria/Categoria
  // de Encerramento — ver fetch_categoria_encerramento_tv_fixo_analitico).
  async function baixarCategoriasTvExcel(analitico) {
    setBusy(true);
    setBanner("Gerando arquivo...", "info");
    try {
      const resp = await apiCall("/api/categorias-encerramento", {
        caixa: state.caixa,
        format: "excel",
        analitico: !!analitico,
      });
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
      const nomePadrao = analitico ? "categorias_encerramento_tv_analitico.xlsx" : "categorias_encerramento_tv.xlsx";
      const filename = filenameFromDisposition(resp.headers.get("Content-Disposition"), nomePadrao);
      triggerDownload(blob, filename);
      setBanner(`Arquivo gerado: ${filename}`, "success");
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  }

  $("btn-categorias-gerar").addEventListener("click", async () => {
    if (state.caixa === "tv") {
      $("categorias-dialog").classList.remove("open");
      setBusy(true);
      setBanner("Buscando categorias de encerramento...", "info");
      try {
        const resp = await apiCall("/api/categorias-encerramento", { caixa: state.caixa });
        const data = await resp.json();
        if (!resp.ok) {
          setBanner(data.error || "Erro ao buscar categorias de encerramento.", "error");
          return;
        }
        renderCategoriaTable("encerrados", null, "Encerrados");
        renderCategoriaTable("reabertos", null, "Reabertos");
        renderCategoriaTvFixo(data.tv_fixo);
        $("categorias-date").textContent = dataVigente();
        $("categorias-results").classList.remove("hidden");
        clearBanner();
      } catch (e) {
        setBanner("Não foi possível conectar ao servidor.", "error");
      } finally {
        setBusy(false);
      }
      return;
    }

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
      renderCategoriaTable("encerrados", data.encerrados, "Encerrados");
      renderCategoriaTable("reabertos", data.reabertos, "Reabertos");
      renderCategoriaTvFixo(null);
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
    const jaAberto = dialog.classList.contains("open");
    closeAllDialogs("criados-resolvidos-dialog");
    if (!jaAberto) {
      const hoje = new Date().toISOString().slice(0, 10);
      $("cr-input-inicio").value = hoje;
      $("cr-input-fim").value = hoje;
    }
    dialog.classList.add("open");
  });

  $("btn-criados-resolvidos-cancelar").addEventListener("click", () => {
    $("criados-resolvidos-dialog").classList.remove("open");
  });

  // Seta de tendência do dia: resolvidos > criados (backlog encolhendo) sobe,
  // resolvidos < criados (backlog crescendo) desce.
  function setaTendencia(criados, resolvidos) {
    if (resolvidos > criados) return "▲";
    if (resolvidos < criados) return "▼";
    return "–";
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

  // Card por grupo (N1/N2/PROD) de "Criados x Resolvidos": contador de
  // encerrados no período + média diária (total ÷ dias do período
  // selecionado) + TMA aproximado (16h de expediente ÷ média diária — não é
  // o tempo real em "Em atendimento", é só uma estimativa a partir do volume).
  // Valor principal em formato "criados/resolvidos" (ex.: "20/10") — pedido
  // explícito do usuário pra ver os dois números do grupo num relance só,
  // em vez de só o total resolvido.
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
      data.por_grupo.forEach(({ grupo, criados, total, media_diaria, tma_horas }) => {
        porGrupoCardsEl.append(criadosResolvidosGrupoCard(grupo, criados, total, media_diaria, tma_horas));
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

  // ------------------------------------------------------------ distribuição
  // Uma barra EMPILHADA por dia do período: dentro de cada barra, a
  // repartição do dia entre Convencional/Priorizado/COTI (resolvidos) +
  // PDST (criados) — mesma ideia de um gráfico de barras 100% empilhadas,
  // só que em contagem absoluta (a altura total da barra já é o total do
  // dia, não sempre 100%). Escala (altura máxima) é o maior TOTAL entre os
  // dias do período, pra dar pra comparar dias entre si.
  const DISTRIBUICAO_CATEGORIAS = [
    { chave: "convencional", classe: "convencional", label: "Convencional" },
    { chave: "priorizado", classe: "priorizado", label: "Priorizado" },
    { chave: "coti", classe: "coti", label: "COTI" },
    { chave: "pdst_criados", classe: "pdst", label: "PDST (criados no dia)" },
  ];

  function totalDiaDistribuicao(dia) {
    return DISTRIBUICAO_CATEGORIAS.reduce((soma, cat) => soma + (dia[cat.chave] || 0), 0);
  }

  const DISTRIBUICAO_BAR_MAX_PX = 170;
  const DISTRIBUICAO_BAR_MIN_PX = 4;
  const DISTRIBUICAO_SEGMENT_MIN_PX = 6;

  // Reparte "alturaAlvoPx" entre as categorias com valor > 0, dando um piso
  // mínimo (minPx) pra cada fatia — sem isso, uma fatia pequena ao lado de
  // uma bem maior (ex.: 2 de um total de 80) sai com menos de 1px, invisível.
  // Categorias abaixo do mínimo são "fixadas" nele e o restante da altura é
  // reproporcionalizado só entre as que sobram, repetindo até estabilizar
  // (no máximo 4 categorias, então poucas iterações). Se nem os mínimos
  // couberem na altura alvo, a barra final cresce pra caber todo mundo (ver
  // "alturaFinal" no chamador) — prioriza visibilidade sobre a escala exata.
  function distribuirAlturasSegmentos(categorias, alturaAlvoPx, minPx) {
    let pendentes = categorias.slice();
    let alturaDisponivel = alturaAlvoPx;
    const alturas = {};

    let mudou = true;
    while (mudou && pendentes.length) {
      mudou = false;
      const totalPendente = pendentes.reduce((s, c) => s + c.valor, 0);
      const proximaPendente = [];
      pendentes.forEach((cat) => {
        const alturaProporcional = (cat.valor / totalPendente) * alturaDisponivel;
        if (alturaProporcional < minPx) {
          alturas[cat.chave] = minPx;
          alturaDisponivel = Math.max(0, alturaDisponivel - minPx);
          mudou = true;
        } else {
          proximaPendente.push(cat);
        }
      });
      pendentes = proximaPendente;
    }

    const totalRestante = pendentes.reduce((s, c) => s + c.valor, 0);
    pendentes.forEach((cat) => {
      alturas[cat.chave] = (cat.valor / totalRestante) * alturaDisponivel;
    });

    return alturas;
  }

  // Popover customizado (mesmo elemento flutuante compartilhado de
  // getHoverPopover/hideHoverPopover, já usado em "Violados — Últimos 30
  // dias") pra mostrar a repartição exata do dia no mouseover da barra.
  function showDistribuicaoPopover(anchorEl, dia) {
    const popover = getHoverPopover();
    popover.innerHTML = "";

    const titulo = document.createElement("div");
    titulo.className = "hover-popover-title";
    titulo.textContent = formatarDataBR(dia.data);
    popover.append(titulo);

    DISTRIBUICAO_CATEGORIAS.forEach((cat) => {
      const linha = document.createElement("div");
      linha.className = "home-funil-popover-row";
      const nomeEl = document.createElement("span");
      const dot = document.createElement("span");
      dot.className = `distribuicao-legend-dot ${cat.classe}`;
      nomeEl.append(dot, document.createTextNode(` ${cat.label}`));
      const valorEl = document.createElement("span");
      valorEl.textContent = dia[cat.chave] || 0;
      linha.append(nomeEl, valorEl);
      popover.append(linha);
    });

    const totalEl = document.createElement("div");
    totalEl.className = "hint";
    totalEl.style.marginTop = "6px";
    totalEl.textContent = `Total do dia: ${totalDiaDistribuicao(dia)}`;
    popover.append(totalEl);

    popover.classList.remove("hidden");

    const anchorRect = anchorEl.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    let top = anchorRect.top - popoverRect.height - 8;
    let left = anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2;
    if (top < 8) top = anchorRect.bottom + 8;
    if (left + popoverRect.width > window.innerWidth - 8) left = window.innerWidth - popoverRect.width - 8;
    popover.style.top = `${Math.max(8, top)}px`;
    popover.style.left = `${Math.max(8, left)}px`;
  }

  function construirGraficoDistribuicao(dias) {
    const wrap = document.createElement("div");

    const maxTotal = Math.max(1, ...dias.map(totalDiaDistribuicao));

    const chart = document.createElement("div");
    chart.className = "distribuicao-chart";

    dias.forEach((dia) => {
      const totalDia = totalDiaDistribuicao(dia);
      const categoriasComValor = DISTRIBUICAO_CATEGORIAS.filter((cat) => (dia[cat.chave] || 0) > 0).map((cat) => ({
        ...cat,
        valor: dia[cat.chave] || 0,
      }));

      const group = document.createElement("div");
      group.className = "distribuicao-chart-group";

      const bars = document.createElement("div");
      bars.className = "distribuicao-chart-bars";

      const stack = document.createElement("div");
      stack.className = "distribuicao-bar-stack";

      if (totalDia > 0) {
        const alturaAlvo = Math.max((totalDia / maxTotal) * DISTRIBUICAO_BAR_MAX_PX, DISTRIBUICAO_BAR_MIN_PX);
        const alturas = distribuirAlturasSegmentos(categoriasComValor, alturaAlvo, DISTRIBUICAO_SEGMENT_MIN_PX);

        categoriasComValor.forEach((cat) => {
          const segment = document.createElement("div");
          segment.className = `distribuicao-bar-segment ${cat.classe}`;
          segment.style.height = `${alturas[cat.chave]}px`;
          stack.append(segment);
        });

        const alturaFinal = Object.values(alturas).reduce((a, b) => a + b, 0);
        stack.style.height = `${alturaFinal}px`;

        stack.addEventListener("mouseenter", () => {
          cancelHoverPopoverHide();
          showDistribuicaoPopover(stack, dia);
        });
        stack.addEventListener("mouseleave", scheduleHoverPopoverHide);
      } else {
        stack.style.height = "2px";
      }

      const valueEl = document.createElement("span");
      valueEl.className = "distribuicao-bar-value";
      valueEl.textContent = totalDia;
      stack.append(valueEl);

      bars.append(stack);

      const label = document.createElement("div");
      label.className = "distribuicao-chart-group-label";
      label.textContent = formatarDataBR(dia.data).slice(0, 5);

      group.append(bars, label);
      chart.append(group);
    });

    const legend = document.createElement("div");
    legend.className = "distribuicao-legend";
    DISTRIBUICAO_CATEGORIAS.forEach((cat) => {
      const item = document.createElement("span");
      item.className = "distribuicao-legend-item";
      const dot = document.createElement("span");
      dot.className = `distribuicao-legend-dot ${cat.classe}`;
      item.append(dot, document.createTextNode(cat.label));
      legend.append(item);
    });

    wrap.append(chart, legend);
    return wrap;
  }

  // Pré-análise textual (não cards) do período — pensada pra ajudar a
  // justificar violação de SLA: mostra a composição dos tratados
  // (Convencional/Priorizado/COTI) e o TMA comparativo, deixando claro
  // quanto do período fugiu do fluxo padrão e se isso demorou mais.
  function distribuicaoPct(parte, total) {
    return total > 0 ? Math.round((parte / total) * 1000) / 10 : 0;
  }

  function distribuicaoFormatarHoras(horas) {
    return typeof horas === "number" ? `${horas}h` : "sem dado suficiente";
  }

  function distribuicaoVariacaoTexto(valor, base) {
    if (typeof valor !== "number" || typeof base !== "number" || !base) return "";
    const variacao = Math.round(((valor - base) / base) * 1000) / 10;
    const sinal = variacao > 0 ? "+" : "";
    return ` (${sinal}${variacao}% vs. Convencional)`;
  }

  function construirAnaliseDistribuicao(data) {
    const wrap = document.createElement("div");

    const totais = data.totais || {};
    const tma = data.tma_horas || {};
    const convencional = totais.convencional || 0;
    const priorizado = totais.priorizado || 0;
    const coti = totais.coti || 0;
    const pdstCriados = totais.pdst_criados || 0;
    const totalResolvido = convencional + priorizado + coti;
    // "Fora do fluxo padrão" = tudo que não é Convencional: Priorizado/COTI
    // (dentre os tratados de Central de Incidentes) + PDST (Abertura de
    // Chamados é, por si só, um fluxo à parte do atendimento convencional).
    const foraPadrao = priorizado + coti + pdstCriados;

    if (!totalResolvido && !pdstCriados) {
      const vazio = document.createElement("p");
      vazio.className = "hint";
      vazio.textContent = "Nenhum chamado tratado no período selecionado.";
      wrap.append(vazio);
      return wrap;
    }

    if (totalResolvido > 0) {
      const p1 = document.createElement("p");
      p1.innerHTML =
        `No período, foram tratados <strong>${totalResolvido}</strong> chamados (Central de Incidentes): ` +
        `<strong>${convencional}</strong> convencionais (${distribuicaoPct(convencional, totalResolvido)}%), ` +
        `<strong>${priorizado}</strong> priorizados (${distribuicaoPct(priorizado, totalResolvido)}%) e ` +
        `<strong>${coti}</strong> COTI (${distribuicaoPct(coti, totalResolvido)}%).`;
      wrap.append(p1);
    } else {
      const p1 = document.createElement("p");
      p1.textContent = "Nenhum chamado Convencional/Priorizado/COTI resolvido no período.";
      wrap.append(p1);
    }

    const p2 = document.createElement("p");
    p2.innerHTML =
      `Somando Priorizado + COTI (Central de Incidentes) com PDST (Abertura de Chamados) — um fluxo à parte do ` +
      `atendimento convencional —, o período teve <strong>${foraPadrao}</strong> chamados fora do fluxo padrão: ` +
      `<strong>${priorizado}</strong> priorizados, <strong>${coti}</strong> COTI e <strong>${pdstCriados}</strong> ` +
      `PDST (criado${pdstCriados === 1 ? "" : "s"} no período).`;
    wrap.append(p2);

    const p3 = document.createElement("p");
    p3.innerHTML =
      `<strong>Tempo médio de atendimento</strong> — Convencional: ${distribuicaoFormatarHoras(tma.convencional)} · ` +
      `Priorizado: ${distribuicaoFormatarHoras(tma.priorizado)}${distribuicaoVariacaoTexto(tma.priorizado, tma.convencional)} · ` +
      `COTI: ${distribuicaoFormatarHoras(tma.coti)}${distribuicaoVariacaoTexto(tma.coti, tma.convencional)} · ` +
      `PDST: ${distribuicaoFormatarHoras(tma.pdst)}${distribuicaoVariacaoTexto(tma.pdst, tma.convencional)}.`;
    wrap.append(p3);

    return wrap;
  }

  function renderDistribuicao(data, inicio, fim) {
    $("distribuicao-date").textContent = `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;

    const chartWrap = $("distribuicao-chart-wrap");
    chartWrap.innerHTML = "";
    if (data.dias && data.dias.length) {
      chartWrap.append(construirGraficoDistribuicao(data.dias));
    } else {
      chartWrap.textContent = "Nenhum dia no período selecionado.";
    }

    const analiseEl = $("distribuicao-analise");
    analiseEl.innerHTML = "";
    analiseEl.append(construirAnaliseDistribuicao(data));

    $("distribuicao-results").classList.remove("hidden");
  }

  $("btn-distribuicao").addEventListener("click", () => {
    const dialog = $("distribuicao-dialog");
    const jaAberto = dialog.classList.contains("open");
    closeAllDialogs("distribuicao-dialog");
    if (!jaAberto) {
      buildCheckboxes($("distribuicao-grupos-checkboxes"), CAIXA_GRUPOS[state.caixa] || [], "distribuicao-grupo");
      if (!$("distribuicao-input-inicio").value || !$("distribuicao-input-fim").value) {
        const hoje = new Date().toISOString().slice(0, 10);
        $("distribuicao-input-inicio").value = hoje;
        $("distribuicao-input-fim").value = hoje;
      }
    }
    dialog.classList.add("open");
  });

  $("btn-distribuicao-cancelar").addEventListener("click", () => {
    $("distribuicao-dialog").classList.remove("open");
  });

  $("btn-distribuicao-gerar").addEventListener("click", async () => {
    const grupos = checkedValues($("distribuicao-grupos-checkboxes"));
    if (!grupos.length) {
      setBanner("Selecione ao menos uma caixa.", "error");
      return;
    }
    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }
    const inicio = $("distribuicao-input-inicio").value;
    const fim = $("distribuicao-input-fim").value;
    if (!inicio || !fim) {
      setBanner("Informe as duas datas (início e fim).", "error");
      return;
    }

    $("distribuicao-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Buscando distribuição de chamados tratados...", "info");
    hideAllResults();
    try {
      const resp = await apiCall("/api/distribuicao", { caixa: state.caixa, grupos, inicio, fim, projetos });
      const data = await resp.json();
      if (!resp.ok) {
        setBanner(data.error || "Erro ao buscar distribuição.", "error");
        return;
      }
      renderDistribuicao(data, inicio, fim);
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
    const jaAberto = dialog.classList.contains("open");
    closeAllDialogs("reabertos-dialog");
    if (!jaAberto) {
      const hoje = new Date().toISOString().slice(0, 10);
      $("reabertos-input-inicio").value = hoje;
      $("reabertos-input-fim").value = hoje;
    }
    dialog.classList.add("open");
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

  // ------------------------------------------------------------ colaboradores
  // Mesma tabela do widget "Colaboradores" da home (construirTabelaColaboradores),
  // mas só da caixa/projetos selecionados no momento (não as duas caixas
  // juntas) e com período escolhido pelo usuário em vez do mês atual fixo.
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

  // ------------------------------------------------------ análise de jornada
  // Mesmo esquema de busca de Analistas de Encerramento (data início/fim +
  // um parâmetro categórico), mas com um dropdown simples em vez de
  // combobox de texto — e disponível nas duas caixas, não só Solar. A lista
  // de opções do dropdown é reconstruída a cada abertura do painel, porque
  // muda conforme a caixa selecionada (CLASSIFICACAO_OPCOES).
  $("btn-jornada").addEventListener("click", () => {
    const dialog = $("jornada-dialog");
    const jaAberto = dialog.classList.contains("open");
    closeAllDialogs("jornada-dialog");
    if (!jaAberto) {
      const hoje = new Date().toISOString().slice(0, 10);
      if (!$("jornada-input-inicio").value) $("jornada-input-inicio").value = hoje;
      if (!$("jornada-input-fim").value) $("jornada-input-fim").value = hoje;

      const select = $("jornada-classificacao");
      const valorAtual = select.value;
      const opcoes = CLASSIFICACAO_OPCOES[state.caixa] || [];
      select.innerHTML = `<option value="">Selecione...</option><option value="${JORNADA_GERAL}">Geral (todas as classificações)</option>`;
      opcoes.forEach((valor) => {
        const option = document.createElement("option");
        option.value = valor;
        option.textContent = valor;
        select.append(option);
      });
      if (valorAtual === JORNADA_GERAL || opcoes.includes(valorAtual)) select.value = valorAtual;
    }
    dialog.classList.add("open");
  });

  $("btn-jornada-cancelar").addEventListener("click", () => {
    $("jornada-dialog").classList.remove("open");
  });

  $("btn-jornada-gerar").addEventListener("click", async () => {
    const inicio = $("jornada-input-inicio").value;
    const fim = $("jornada-input-fim").value;
    if (!inicio || !fim) {
      setBanner("Informe as duas datas.", "error");
      return;
    }

    const classificacao = $("jornada-classificacao").value;
    if (!classificacao) {
      setBanner("Selecione uma Classificação.", "error");
      return;
    }

    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    const extraBody = { inicio, fim, classificacao, projetos };

    $("jornada-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Buscando chamados no Jira...", "info");
    hideAllResults();
    try {
      const resp = await apiCall("/api/analise-jornada", { caixa: state.caixa, ...extraBody });
      const data = await resp.json();

      if (!resp.ok) {
        setBanner(data.error || "Erro ao executar a ação.", "error");
        return;
      }

      lastAction = "jornada";
      lastCaixa = state.caixa;
      lastExtraBody = extraBody;
      // Usados por renderJornadaResumo pra preencher todos os dias do
      // calendário (não só os com chamado criado).
      data.inicio = inicio;
      data.fim = fim;
      renderResults("jornada", data);
      $("results-date").textContent = `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;
      clearBanner();
    } catch (e) {
      setBanner("Não foi possível conectar ao servidor.", "error");
    } finally {
      setBusy(false);
    }
  });

  // -------------------------------------------------------- análise de eps
  $("btn-eps").addEventListener("click", () => {
    const dialog = $("eps-dialog");
    const jaAberto = dialog.classList.contains("open");
    closeAllDialogs("eps-dialog");
    if (!jaAberto) {
      const hoje = new Date().toISOString().slice(0, 10);
      if (!$("eps-input-inicio").value) $("eps-input-inicio").value = hoje;
      if (!$("eps-input-fim").value) $("eps-input-fim").value = hoje;
    }
    dialog.classList.add("open");
  });

  $("btn-eps-cancelar").addEventListener("click", () => {
    $("eps-dialog").classList.remove("open");
  });

  function renderAnaliseEps(data, inicio, fim) {
    $("eps-date").textContent = `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;
    $("eps-top-abertos").replaceChildren(construirFunilEps(data.top_abertos));
    $("eps-top-resolvidos").replaceChildren(construirFunilEps(data.top_resolvidos));
    $("eps-top-reabertos").replaceChildren(construirFunilEps(data.top_reabertos));
    $("eps-results").classList.remove("hidden");
  }

  $("btn-eps-gerar").addEventListener("click", async () => {
    const inicio = $("eps-input-inicio").value;
    const fim = $("eps-input-fim").value;
    if (!inicio || !fim) {
      setBanner("Informe as duas datas.", "error");
      return;
    }

    const projetos = projetosSelecionados();
    if (!projetos.length) {
      setBanner("Selecione ao menos um projeto.", "error");
      return;
    }

    $("eps-dialog").classList.remove("open");
    setBusy(true);
    setBanner("Buscando chamados por EPS...", "info");
    hideAllResults();
    try {
      const resp = await apiCall("/api/analise-eps", { inicio, fim, caixa: state.caixa, projetos });
      const data = await resp.json();
      if (!resp.ok) {
        setBanner(data.error || "Erro ao buscar Análise de EPS.", "error");
        return;
      }
      renderAnaliseEps(data, inicio, fim);
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
    const jaAberto = dialog.classList.contains("open");
    closeAllDialogs("criticos-dialog");
    if (!jaAberto) {
      const hoje = new Date().toISOString().slice(0, 10);
      if (!$("criticos-input-inicio").value) $("criticos-input-inicio").value = hoje;
      if (!$("criticos-input-fim").value) $("criticos-input-fim").value = hoje;
    }
    dialog.classList.add("open");
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

  // Config padrão (Analistas de Encerramento): "E n" (encerrados/resolvidos)
  // + "R n" (reabertos) dentro do quadrado do dia.
  const CALENDARIO_CAMPOS_PADRAO = [
    { campo: "encerrados_resolvidos", prefixo: "E", classe: "calendario-dia-encerrados" },
    { campo: "reabertos", prefixo: "R", classe: "calendario-dia-reabertos" },
  ];

  // Um mini-calendário por mês tocado pelo período — dias fora do período
  // (mas dentro do mesmo mês) aparecem esmaecidos; os "buracos" de
  // alinhamento antes do dia 1 ficam totalmente em branco. "camposInfo"
  // controla quais contadores aparecem dentro de cada quadrado (label +
  // classe de cor) — outros usos (Análise de Jornada) passam sua própria
  // config em vez do padrão E/R de Analistas.
  function construirCalendario(dias, camposInfo = CALENDARIO_CAMPOS_PADRAO) {
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

          const camposComValor = info ? camposInfo.filter((c) => info[c.campo]) : [];
          if (camposComValor.length) {
            const infoEl = document.createElement("div");
            infoEl.className = "calendario-dia-info";
            camposComValor.forEach(({ campo, prefixo, classe }) => {
              const linha = document.createElement("span");
              linha.className = classe;
              linha.textContent = `${prefixo} ${info[campo]}`;
              infoEl.append(linha);
            });
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
    const jaAberto = dialog.classList.contains("open");
    closeAllDialogs("analistas-dialog");
    dialog.classList.add("open");
    if (!jaAberto) {
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

  // Mops Tv do Futuro separa "Categoria de Encerramento" em sub-blocos por
  // "APP"/"BOX" (tag no fim do nome da categoria, resolvida no backend —
  // ver _dividir_categorias_tv) em vez de uma lista só como Mops Solar;
  // "secao" chega como {app, box, outros?} nesse caso, em vez do formato
  // "chato" {categorias, total_chamados, total_categorizados}. Usado tanto
  // pela ação "Categorias de Encerramento" quanto pelo Report Vini.
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
