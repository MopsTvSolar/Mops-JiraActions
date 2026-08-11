"""
Extração de chamados do Jira Cloud via REST API.

Uso básico:
    python jira_extractor.py
    python jira_extractor.py --jql "project = ABC AND status = Done" --format both
    python jira_extractor.py --output relatorio_agosto --fields key,summary,status,assignee

Credenciais e JQL padrão são lidos do arquivo .env (veja .env.example).
"""

import argparse
import logging
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer

# Quando empacotado como executável "windowed" (sem console), sys.stderr é
# None e um StreamHandler padrão quebraria no primeiro log. Nesse caso não
# há terminal para mostrar nada mesmo, então cai para NullHandler — a GUI
# tem seu próprio handler (QueueLogHandler) para exibir o log na tela.
_log_handlers = [logging.StreamHandler()] if sys.stderr is not None else [logging.NullHandler()]
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    handlers=_log_handlers,
)
log = logging.getLogger("jira_extractor")

# Diretório do executável (frozen) ou do script — usado como base para o
# .env e a pasta "output", para que funcionem independente do diretório de
# onde o app foi iniciado (ex.: atalho na área de trabalho).
APP_DIR = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
os.chdir(APP_DIR)

# Carregado aqui (nível de módulo) para que constantes fixas lidas do .env
# logo abaixo (ex.: PROJETO_INC) já peguem o valor certo mesmo quando este
# módulo é importado antes de qualquer build_config()/load_fixed_config().
load_dotenv()


class JiraExtractorError(Exception):
    """Erro conhecido (autenticação, JQL inválida, configuração ausente).

    Usado para permitir que a GUI (jira_gui.py) trate o erro sem encerrar
    o processo, ao contrário de sys.exit() usado pela CLI.
    """


SEARCH_ENDPOINT = "/rest/api/3/search/jql"

# Campos padrão extraídos de cada chamado.
# Podem ser sobrescritos via --fields (lista separada por vírgula).
DEFAULT_FIELDS = [
    "summary",
    "status",
    "issuetype",
    "priority",
    "assignee",
    "reporter",
    "project",
    "created",
    "updated",
    "resolutiondate",
]

# Fuso horário do SLA (Brasil, sem horário de verão desde 2019).
BRAZIL_TZ = timezone(timedelta(hours=-3))

# Janela em que o SLA corre (definida pelo usuário: 07:00 às 23:59).
SLA_WINDOW_START = (7, 0, 0)
SLA_WINDOW_END = (23, 59, 59)

# Campos de SLA "Tempo de Resolução" identificados neste Jira: o ID varia por
# esquema de projeto (PDST usa customfield_10419, INC usa customfield_10629).
# Para cada chamado, usa-se o primeiro destes campos que estiver preenchido.
SLA_RESOLUTION_FIELDS = ["customfield_10419", "customfield_10629"]

# Apenas chamados nestes status entram no cálculo de "chamados a violar no dia".
VIOLAR_STATUSES = ["Aguardando Suporte", "Encaminhado", "Em atendimento", "Reaberto"]

# Campo "Fornecedor Responsável": customfield_31880 é o usado no projeto "Central
# de Incidentes"; customfield_16762 fica como alternativa para outros esquemas.
FORNECEDOR_RESPONSAVEL_FIELDS = ["customfield_31880", "customfield_16762"]

# Projeto principal, configurável via .env (JIRA_PROJETO) — usado tanto na JQL
# geral de "A violar"/"Violados"/Extração completa quanto no report diário.
PROJETO_INC = os.getenv("JIRA_PROJETO", "Central de Incidentes")
# Segundo projeto considerado apenas no report diário (independente dos checkboxes da GUI).
PROJETO_PDST = "Abertura de Chamados"

# Grupos fixos considerados no Relatório Consolidado.
GRUPO_N1 = "CLBR-TI-OPS-OGS SOLAR SALESFORCE"
GRUPO_N2 = "CLBR-TI-OPS-OGS-SOLAR-SALESFORCE-N2"
GRUPO_PROD = "CLBR-TI-OPS-PROD SOLAR SALESFORCE"

# Grupos padrão (caixa Solar) do Relatório Consolidado: cada um tem um
# "label" curto usado nas linhas do report e indica se entra no ranking
# "Top Analistas" (Prod nunca entrou nesse ranking). Outras "caixas
# solucionadoras" (ex.: Mops Tv do Futuro, na versão web) passam sua
# própria lista para build_consolidated_report(..., grupos=...).
CONSOLIDADO_GRUPOS_PADRAO = [
    {"label": "N1", "nome": GRUPO_N1, "top_analistas": True},
    {"label": "N2", "nome": GRUPO_N2, "top_analistas": True},
    {"label": "Prod", "nome": GRUPO_PROD, "top_analistas": False},
]


def load_config():
    load_dotenv()

    url = os.getenv("JIRA_URL", "").rstrip("/")
    email = os.getenv("JIRA_EMAIL", "")
    token = os.getenv("JIRA_API_TOKEN", "")
    jql = os.getenv("JIRA_JQL", "")
    page_size = int(os.getenv("JIRA_PAGE_SIZE", "100"))

    missing = [name for name, value in
               [("JIRA_URL", url), ("JIRA_EMAIL", email), ("JIRA_API_TOKEN", token)]
               if not value]
    if missing:
        log.error(
            "Variáveis ausentes no .env: %s. Copie .env.example para .env e preencha os valores.",
            ", ".join(missing),
        )
        sys.exit(1)

    return {
        "url": url,
        "email": email,
        "token": token,
        "jql": jql,
        "page_size": max(1, min(page_size, 100)),
    }


def load_fixed_config():
    """Carrega apenas as variáveis fixas do servidor (URL, JQL, page size).

    Usado pela versão web (api/index.py): e-mail e token não vêm do
    ambiente, são fornecidos pelo usuário a cada requisição e nunca
    persistidos. Ao contrário de load_config(), levanta JiraExtractorError
    em vez de sys.exit(), para não derrubar o processo do servidor.
    """
    load_dotenv()

    url = os.getenv("JIRA_URL", "").rstrip("/")
    jql = os.getenv("JIRA_JQL", "")
    page_size = int(os.getenv("JIRA_PAGE_SIZE", "100"))

    if not url:
        raise JiraExtractorError("JIRA_URL não configurada no ambiente do servidor.")

    return {
        "url": url,
        "jql": jql,
        "page_size": max(1, min(page_size, 100)),
    }


def fetch_issues(config, jql, fields):
    """Busca todos os chamados que satisfazem a JQL, paginando via nextPageToken.

    Usa o endpoint /rest/api/3/search/jql (o antigo /rest/api/3/search foi
    descontinuado pela Atlassian e retorna 410 Gone).
    """
    session = requests.Session()
    session.auth = (config["email"], config["token"])
    session.headers.update({"Accept": "application/json", "Content-Type": "application/json"})

    issues = []
    page_size = config["page_size"]
    next_page_token = None
    page = 1

    while True:
        body = {
            "jql": jql,
            "maxResults": page_size,
            "fields": fields,
        }
        if next_page_token:
            body["nextPageToken"] = next_page_token

        response = session.post(f"{config['url']}{SEARCH_ENDPOINT}", json=body, timeout=30)

        if response.status_code == 401:
            raise JiraExtractorError("Falha de autenticação (401). Verifique o e-mail e o API Token.")
        if response.status_code == 400:
            raise JiraExtractorError(f"JQL inválida ou requisição incorreta (400): {response.text}")
        if response.status_code >= 500:
            log.warning("Erro do servidor Jira (%s). Tentando novamente em 5s...", response.status_code)
            time.sleep(5)
            continue

        response.raise_for_status()
        data = response.json()

        page_issues = data.get("issues", [])
        issues.extend(page_issues)
        log.info("Página %d: +%d chamados (total acumulado: %d)", page, len(page_issues), len(issues))

        next_page_token = data.get("nextPageToken")
        if not next_page_token or not page_issues:
            break
        page += 1

    return issues


def _extract(field_value, key="displayName"):
    """Extrai um valor legível de campos aninhados (assignee, status, etc.)."""
    if isinstance(field_value, dict):
        return field_value.get(key) or field_value.get("name") or field_value.get("value")
    return field_value


def _extract_values(field_value, key="value"):
    """Extrai uma lista de valores legíveis de um campo, tratando tanto um
    objeto único quanto uma lista de objetos — vários campos do Jira (Select
    List, Group Picker etc.) podem vir como lista mesmo quando configurados
    como seleção única, dependendo do esquema do projeto. Usado para
    contagens (cada valor encontrado soma 1), onde um chamado com múltiplos
    valores reais deve contar em cada um, não travar como tipo não-hashável
    nem virar uma string combinada.
    """
    if isinstance(field_value, list):
        return [v for v in (_extract(item, key) for item in field_value) if v]
    valor = _extract(field_value, key)
    return [valor] if valor else []


# Cache em memória de processo: (workspace_id, object_id) -> label resolvido
# via API de Assets. Assim como os outros caches deste módulo, guarda só
# metadado (nome de um objeto do catálogo), não credencial nem dado de
# chamado — sobrevive enquanto o processo do servidor estiver de pé.
_asset_label_cache = {}


def _extract_asset_refs(field_value):
    """Se o valor for uma referência a objeto do Jira Assets/Insight
    (formato {"workspaceId": ..., "objectId": ...}, único ou em lista —
    é como campos desse tipo aparecem na REST API, mesmo em campos
    configurados como seleção única), devolve uma lista de (workspace_id,
    object_id). Devolve None se não for esse formato, para quem chamar
    tentar a extração de texto normal (Select List, Group Picker etc.)."""
    itens = field_value if isinstance(field_value, list) else [field_value]
    refs = [
        (item["workspaceId"], item["objectId"])
        for item in itens
        if isinstance(item, dict) and item.get("workspaceId") and item.get("objectId")
    ]
    return refs or None


def _resolve_asset_label(config, workspace_id, object_id):
    """Busca o nome legível (label) de um objeto do catálogo Jira Assets.
    Usa a mesma autenticação (e-mail + API Token) das demais chamadas —
    a API de Assets aceita Basic Auth igual ao restante da REST API do
    Jira Cloud, só que por um domínio diferente (api.atlassian.com)."""
    cache_key = (workspace_id, object_id)
    cached = _asset_label_cache.get(cache_key)
    if cached:
        return cached

    url = f"https://api.atlassian.com/jsm/assets/workspace/{workspace_id}/v1/object/{object_id}"
    response = requests.get(
        url,
        auth=(config["email"], config["token"]),
        headers={"Accept": "application/json"},
        timeout=15,
    )
    response.raise_for_status()
    data = response.json()
    label = data.get("label") or data.get("name") or object_id

    _asset_label_cache[cache_key] = label
    return label


def _extract_categoria_values(config, field_value):
    """Extrai os valores de um campo de categoria, cobrindo os dois formatos
    possíveis: referência a objeto do Jira Assets (resolve o nome via API,
    com fallback pro próprio ID se a resolução falhar) ou texto/seleção
    simples (Select List etc., via _extract_values)."""
    asset_refs = _extract_asset_refs(field_value)
    if asset_refs is None:
        return _extract_values(field_value)

    valores = []
    for workspace_id, object_id in asset_refs:
        try:
            valores.append(_resolve_asset_label(config, workspace_id, object_id))
        except Exception as e:
            log.warning(
                "Falha ao resolver objeto do Jira Assets (workspace=%s, object=%s): %s. "
                "Usando o ID bruto como nome.",
                workspace_id,
                object_id,
                e,
            )
            valores.append(object_id)
    return valores


def _extract_grupo_solucionador(field_value):
    """Extrai o nome do grupo do campo 'Grupo Solucionador' (Group Picker).

    O esperado é um único objeto ({"name": "..."}), mas alguns esquemas do
    Jira retornam uma lista mesmo para campos configurados como grupo único
    — sem tratar isso, o valor bruto (dict/lista) vazava para a tela como
    "[object Object]" em vez do nome do grupo.
    """
    if isinstance(field_value, list):
        nomes = [n for n in (_extract(v, "name") for v in field_value) if n]
        return ", ".join(nomes) if nomes else None
    return _extract(field_value, "name")


def flatten_issue(issue, fields):
    row = {"key": issue.get("key")}
    issue_fields = issue.get("fields", {})

    for field in fields:
        value = issue_fields.get(field)

        if field == "assignee" or field == "reporter":
            row[field] = _extract(value, "displayName")
        elif field == "status":
            row[field] = _extract(value, "name")
        elif field == "priority":
            row[field] = _extract(value, "name")
        elif field == "issuetype":
            row[field] = _extract(value, "name")
        elif field == "project":
            row[field] = _extract(value, "key")
        else:
            row[field] = value

    return row


def extract_sla_breach(issue_fields):
    """Lê o campo de SLA 'Tempo de Resolução' de um chamado.

    O ciclo de SLA fica em 'ongoingCycle' enquanto está ativo/pausado, e é
    movido para 'completedCycles' quando o Jira finaliza o SLA (de forma
    assíncrona, às vezes só depois do chamado já estar resolvido há um
    tempo) — por isso é preciso checar os dois, usando o ciclo concluído
    mais recente quando não há ciclo em andamento.

    Retorna (campo_sla, breach_dt, breached) ou (None, None, None) se o
    chamado não tiver nenhum dos campos de SLA preenchidos.
    """
    for field_id in SLA_RESOLUTION_FIELDS:
        sla_value = issue_fields.get(field_id)
        if not sla_value:
            continue

        cycle = sla_value.get("ongoingCycle")
        if not cycle:
            completed = sla_value.get("completedCycles") or []
            if completed:
                cycle = completed[-1]
        if not cycle:
            continue

        breach_time = cycle.get("breachTime", {}).get("iso8601")
        if not breach_time:
            continue

        breach_dt = datetime.strptime(breach_time, "%Y-%m-%dT%H:%M:%S%z")
        return sla_value.get("name", field_id), breach_dt, cycle.get("breached", False)

    return None, None, None


def extract_fornecedor(issue_fields):
    """Lê o campo 'Fornecedor Responsável' de um chamado (campo de seleção única)."""
    for field_id in FORNECEDOR_RESPONSAVEL_FIELDS:
        value = issue_fields.get(field_id)
        if value:
            return _extract(value, "value")
    return None


def fetch_chamados_a_violar(config, days_ahead=0, incluir_fornecedor=False, grupo_field_id=None):
    """Busca chamados cujo prazo de SLA (Tempo de Resolução) estoura no dia-alvo
    (hoje se days_ahead=0, amanhã se days_ahead=1), dentro da janela de
    atendimento configurada (07:00 às 23:59).

    "grupo_field_id" é opcional: quando informado (ID do campo customizado
    "Grupo Solucionador"), o valor do grupo é lido em uma única busca e
    incluído em cada linha como "grupo_solucionador" — evita ter que repetir
    a busca uma vez por grupo só para contar quantos chamados cada um tem.
    """
    base_jql = config["jql"]
    if not base_jql:
        raise JiraExtractorError("Nenhuma JQL base definida.")

    # Remove eventual "ORDER BY" da JQL base: a ordenação final é feita
    # pelo horário de estouro do SLA, calculado depois de buscar os dados.
    base_jql = re.sub(r"\s+ORDER\s+BY\s+.*$", "", base_jql, flags=re.IGNORECASE)

    status_list = ", ".join(f'"{status}"' for status in VIOLAR_STATUSES)
    jql = f'({base_jql}) AND status IN ({status_list})'

    fields = ["summary", "status", "assignee", "reporter", "project", "issuetype"] + SLA_RESOLUTION_FIELDS
    if incluir_fornecedor:
        fields = fields + FORNECEDOR_RESPONSAVEL_FIELDS
    if grupo_field_id:
        fields = fields + [grupo_field_id]

    log.info("Buscando chamados com JQL: %s", jql)
    issues = fetch_issues(config, jql, fields)

    now = datetime.now(BRAZIL_TZ)
    target_day = now.date() + timedelta(days=days_ahead)
    window_start = datetime.combine(target_day, datetime.min.time(), tzinfo=BRAZIL_TZ).replace(
        hour=SLA_WINDOW_START[0], minute=SLA_WINDOW_START[1], second=SLA_WINDOW_START[2]
    )
    window_end = datetime.combine(target_day, datetime.min.time(), tzinfo=BRAZIL_TZ).replace(
        hour=SLA_WINDOW_END[0], minute=SLA_WINDOW_END[1], second=SLA_WINDOW_END[2]
    )

    rows = []
    for issue in issues:
        issue_fields = issue.get("fields", {})
        sla_campo, breach_dt, breached = extract_sla_breach(issue_fields)

        if breach_dt is None:
            continue
        if breached:
            continue  # já estourou em ciclo anterior, não é "a violar"
        if not (window_start <= breach_dt <= window_end):
            continue

        horas_restantes = round((breach_dt - now).total_seconds() / 3600, 1)

        row = {
            "key": issue.get("key"),
            "summary": issue_fields.get("summary"),
            "status": _extract(issue_fields.get("status"), "name"),
            "assignee": _extract(issue_fields.get("assignee"), "displayName"),
            "reporter": _extract(issue_fields.get("reporter"), "displayName"),
            "project": _extract(issue_fields.get("project"), "key"),
            "issuetype": _extract(issue_fields.get("issuetype"), "name"),
            "sla_campo": sla_campo,
            "sla_estoura_em": breach_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "hora_violacao": breach_dt.strftime("%H:%M"),
            "horas_restantes": horas_restantes,
        }
        if incluir_fornecedor:
            row["fornecedor_responsavel"] = extract_fornecedor(issue_fields)
        if grupo_field_id:
            row["grupo_solucionador"] = _extract_grupo_solucionador(issue_fields.get(grupo_field_id))
        rows.append(row)

    rows.sort(key=lambda r: r["sla_estoura_em"])
    return rows


def fetch_chamados_violados(config, incluir_fornecedor=False):
    """Busca chamados cujo SLA de resolução já estourou (tempo negativo),
    reaproveitando os filtros base (grupo/projeto/status) da JQL configurada.
    """
    base_jql = config["jql"]
    if not base_jql:
        raise JiraExtractorError("Nenhuma JQL base definida.")

    base_jql = re.sub(r"\s+ORDER\s+BY\s+.*$", "", base_jql, flags=re.IGNORECASE)
    jql = f'({base_jql}) AND ("Tempo de Resolução" < 0h OR "Tempo de resolução" < 0h)'

    fields = ["summary", "status", "assignee", "reporter", "project", "issuetype"] + SLA_RESOLUTION_FIELDS
    if incluir_fornecedor:
        fields = fields + FORNECEDOR_RESPONSAVEL_FIELDS

    log.info("Buscando chamados violados com JQL: %s", jql)
    issues = fetch_issues(config, jql, fields)

    now = datetime.now(BRAZIL_TZ)
    rows = []
    for issue in issues:
        issue_fields = issue.get("fields", {})
        sla_campo, breach_dt, _breached = extract_sla_breach(issue_fields)

        row = {
            "key": issue.get("key"),
            "summary": issue_fields.get("summary"),
            "status": _extract(issue_fields.get("status"), "name"),
            "assignee": _extract(issue_fields.get("assignee"), "displayName"),
            "reporter": _extract(issue_fields.get("reporter"), "displayName"),
            "project": _extract(issue_fields.get("project"), "key"),
            "issuetype": _extract(issue_fields.get("issuetype"), "name"),
            "sla_campo": sla_campo,
            "sla_estourou_em": breach_dt.strftime("%Y-%m-%d %H:%M:%S") if breach_dt else None,
            "horas_em_atraso": round((now - breach_dt).total_seconds() / 3600, 1) if breach_dt else None,
        }
        if incluir_fornecedor:
            row["fornecedor_responsavel"] = extract_fornecedor(issue_fields)
        rows.append(row)

    rows.sort(key=lambda r: r["horas_em_atraso"] or 0, reverse=True)
    return rows


def _grupo_clause(grupos):
    grupos_str = ", ".join(f'"{g}"' for g in grupos)
    return f'"Grupo Solucionador[Group Picker (single group)]" IN ({grupos_str})'


def _compute_grupo_metrics(config, grupos, window_start_dt, window_end_dt, window_start_str, window_end_str):
    """Calcula as 6 métricas do report diário para os grupos solucionadores
    informados (um único grupo, ou vários para o resumo geral), sempre
    combinando os projetos "Central de Incidentes" e "Abertura de Chamados".
    """
    grupo_clause = _grupo_clause(grupos)
    ambos_projetos = f'project IN ("{PROJETO_INC}", "{PROJETO_PDST}")'

    resolvidos_por_projeto = {}
    todos_resolvidos = []
    for projeto in (PROJETO_INC, PROJETO_PDST):
        jql = (
            f'{grupo_clause} AND project = "{projeto}" AND status = "Resolvido" '
            f'AND resolutiondate >= "{window_start_str}" AND resolutiondate <= "{window_end_str}"'
        )
        issues = fetch_issues(config, jql, ["assignee"])
        resolvidos_por_projeto[projeto] = len(issues)
        todos_resolvidos.extend(issues)

    contagem_analistas = {}
    for issue in todos_resolvidos:
        nome = _extract(issue.get("fields", {}).get("assignee"), "displayName")
        if nome:
            contagem_analistas[nome] = contagem_analistas.get(nome, 0) + 1

    if contagem_analistas:
        top_analista, top_qtd = max(contagem_analistas.items(), key=lambda kv: kv[1])
    else:
        top_analista, top_qtd = "Nenhum", 0

    violar_config = dict(config, jql=f"{grupo_clause} AND {ambos_projetos}")
    a_violar_rows = fetch_chamados_a_violar(violar_config, days_ahead=0)

    fornecedor_jql = f'{grupo_clause} AND {ambos_projetos} AND status = "Aguardando Fornecedor"'
    fornecedor_issues = fetch_issues(config, fornecedor_jql, ["status"])

    # Filtra no lado do Jira quem já estourou (tempo negativo) antes de buscar,
    # em vez de varrer todo o histórico de chamados dos dois projetos.
    violados_jql = (
        f'{grupo_clause} AND {ambos_projetos} '
        f'AND ("Tempo de Resolução" < 0h OR "Tempo de resolução" < 0h)'
    )
    issues_ja_violados = fetch_issues(config, violados_jql, SLA_RESOLUTION_FIELDS)
    violados_hoje = 0
    for issue in issues_ja_violados:
        _campo, breach_dt, breached = extract_sla_breach(issue.get("fields", {}))
        if breach_dt and breached and window_start_dt <= breach_dt <= window_end_dt:
            violados_hoje += 1

    return {
        "resolvido_inc": resolvidos_por_projeto[PROJETO_INC],
        "resolvido_pdst": resolvidos_por_projeto[PROJETO_PDST],
        "a_violar": len(a_violar_rows),
        "fornecedores": len(fornecedor_issues),
        "top_analista": top_analista,
        "top_qtd": top_qtd,
        "violados_hoje": violados_hoje,
    }


def build_daily_report(config, grupos):
    """Monta o texto do report diário ("Bom dia Solar"), com as métricas
    calculadas separadamente para cada Grupo Solucionador (sempre combinando
    os projetos "Central de Incidentes" e "Abertura de Chamados").
    """
    now = datetime.now(BRAZIL_TZ)
    today = now.date()
    window_start_dt = datetime.combine(today, datetime.min.time(), tzinfo=BRAZIL_TZ).replace(
        hour=SLA_WINDOW_START[0], minute=SLA_WINDOW_START[1], second=SLA_WINDOW_START[2]
    )
    window_end_dt = datetime.combine(today, datetime.min.time(), tzinfo=BRAZIL_TZ).replace(
        hour=SLA_WINDOW_END[0], minute=SLA_WINDOW_END[1], second=SLA_WINDOW_END[2]
    )
    window_start_str = window_start_dt.strftime("%Y-%m-%d %H:%M")
    window_end_str = window_end_dt.strftime("%Y-%m-%d %H:%M")

    log.info("Gerando report diário...")

    def _formatar_bloco(titulo, m):
        sufixo = "s" if m["top_qtd"] != 1 else ""
        return [
            f"# {titulo} #",
            f'🔸 Incidentes resolvidos: {m["resolvido_inc"]}',
            f'🔸 Solicitações resolvidas: {m["resolvido_pdst"]}',
            f'🔸 Chamados a violar no dia atual: {m["a_violar"]}',
            f'🔸 Quantidade atual de fornecedores: {m["fornecedores"]}',
            f'🔸 Top analista do dia: {m["top_analista"]} ({m["top_qtd"]} resolvido{sufixo})',
            f'🔸 Quantidade de violados no dia: {m["violados_hoje"]}',
        ]

    data_str = now.strftime("%d/%m %H:%M")
    blocos = [f"⏰RELATÓRIO MOPS OPERACIONAL - {data_str}"]

    for grupo in grupos:
        m = _compute_grupo_metrics(config, [grupo], window_start_dt, window_end_dt, window_start_str, window_end_str)
        blocos.append("")
        blocos.extend(_formatar_bloco(grupo, m))

    resumo = _compute_grupo_metrics(config, grupos, window_start_dt, window_end_dt, window_start_str, window_end_str)
    blocos.append("")
    blocos.extend(_formatar_bloco("Resumo Geral", resumo))

    return "\n".join(blocos) + "\n"


def _top_analistas(config, grupo, ambos_projetos, start_str, end_str, n=3):
    """Ranking dos N analistas com mais chamados encerrados (Resolvido/Encerrado)
    no período, para um único Grupo Solucionador."""
    jql = (
        f'{_grupo_clause([grupo])} AND {ambos_projetos} AND status IN ("Resolvido", "Encerrado") '
        f'AND resolutiondate >= "{start_str}" AND resolutiondate <= "{end_str}"'
    )
    issues = fetch_issues(config, jql, ["assignee"])

    contagem = {}
    for issue in issues:
        nome = _extract(issue.get("fields", {}).get("assignee"), "displayName")
        if nome:
            contagem[nome] = contagem.get(nome, 0) + 1

    ranking = sorted(contagem.items(), key=lambda kv: kv[1], reverse=True)
    return ranking[:n]


CATEGORIA_ENCERRAMENTO_TOP_N = 10


def _linhas_top_categorias(titulo, counts, limite=CATEGORIA_ENCERRAMENTO_TOP_N):
    """Monta as linhas de uma seção "# titulo #" com as top N categorias de
    encerramento (contagem + percentual sobre o total categorizado, mesma
    lógica das demais seções do Relatório Consolidado). Devolve [] quando
    não há contagens (campo não resolvido ou nenhum chamado categorizado)
    — nesse caso a seção inteira não aparece no report."""
    if not counts:
        return []

    total_categorizados = sum(counts.values())
    linhas = ["", f"# {titulo} #", ""]
    for categoria, qtd in counts.most_common(limite):
        percentual = round(qtd / total_categorizados * 100, 1) if total_categorizados else 0.0
        linhas.append(f"🔸 {categoria}: {qtd} ({percentual}%)")
    return linhas


def fetch_categoria_encerrados(config, grupos, start_date, end_date, categoria_field_id, projetos=None):
    """Busca a contagem por 'Categoria de Encerramento' entre os chamados
    encerrados (resolutiondate) no período — mesma população de 'Total
    geral de chamados encerrados' no Relatório Consolidado.

    "grupos" aceita tanto uma lista de strings quanto a lista de dicts
    {"nome": ...} usada no Relatório Consolidado. "projetos" (opcional)
    restringe os projetos considerados; por padrão só "Central de
    Incidentes" (mesmo comportamento de sempre). Devolve (Counter, total
    de chamados encerrados no período, categorizados ou não).
    """
    nomes_grupos = [g["nome"] if isinstance(g, dict) else g for g in grupos]
    grupo_clause_all = _grupo_clause(nomes_grupos)
    projetos_str = ", ".join(f'"{p}"' for p in (projetos or [PROJETO_INC]))
    projeto_clause = f"project IN ({projetos_str})"
    start_str = f"{start_date.strftime('%Y-%m-%d')} 00:00"
    end_str = f"{end_date.strftime('%Y-%m-%d')} 23:59"

    jql = (
        f'{grupo_clause_all} AND {projeto_clause} '
        f'AND resolutiondate >= "{start_str}" AND resolutiondate <= "{end_str}"'
    )
    issues = fetch_issues(config, jql, ["key", categoria_field_id])

    counts = Counter()
    for issue in issues:
        valores = _extract_categoria_values(config, issue.get("fields", {}).get(categoria_field_id))
        counts.update(valores)
    return counts, len(issues)


def fetch_categoria_reabertos(config, grupos, start_date, end_date, categoria_field_id, projetos=None):
    """Busca a contagem por 'Categoria de Encerramento' entre os chamados que
    passaram por 'Reaberto' no período — mesma população de 'Soma total de
    reabertura' no Relatório Consolidado (uma busca por grupo, somadas).
    "projetos" (opcional) restringe os projetos considerados; por padrão só
    "Central de Incidentes" (mesmo comportamento de sempre)."""
    projetos_str = ", ".join(f'"{p}"' for p in (projetos or [PROJETO_INC]))
    projeto_clause = f"project IN ({projetos_str})"
    start_str = f"{start_date.strftime('%Y-%m-%d')} 00:00"
    end_str = f"{end_date.strftime('%Y-%m-%d')} 23:59"

    counts = Counter()
    total = 0
    for g in grupos:
        nome = g["nome"] if isinstance(g, dict) else g
        jql = (
            f'{_grupo_clause([nome])} AND {projeto_clause} AND status WAS "Reaberto" '
            f'AND created >= "{start_str}" AND created <= "{end_str}"'
        )
        issues = fetch_issues(config, jql, ["key", categoria_field_id])
        total += len(issues)
        for issue in issues:
            valores = _extract_categoria_values(config, issue.get("fields", {}).get(categoria_field_id))
            counts.update(valores)
    return counts, total


def build_consolidated_report(config, start_date, end_date, grupos=None, categoria_encerramento_field_id=None):
    """Monta o "Relatório Consolidado" (SLA, taxas de reabertura e top
    analistas por caixa) para o período informado (datas, dia inteiro
    00:00–23:59). SLA e Reaberturas consideram só o projeto "Central de
    Incidentes"; Top Analistas combina "Central de Incidentes" + "Abertura
    de Chamados".

    "grupos" (opcional) é uma lista de dicts {"label", "nome", "top_analistas"}
    — por padrão, os 3 Grupos Solucionador da caixa Solar (N1/N2/Prod, sem
    Prod no ranking de Top Analistas, como sempre foi). Outras "caixas
    solucionadoras" (ex.: Mops Tv do Futuro) passam sua própria lista.

    "categoria_encerramento_field_id" (opcional): ID do campo customizado
    "Categoria de Encerramento". Quando informado, adiciona uma seção com a
    contagem por categoria, reaproveitando os mesmos chamados já buscados
    para "Total geral de chamados encerrados" (nenhuma consulta extra).
    """
    if grupos is None:
        grupos = CONSOLIDADO_GRUPOS_PADRAO

    start_str = f"{start_date.strftime('%Y-%m-%d')} 00:00"
    end_str = f"{end_date.strftime('%Y-%m-%d')} 23:59"

    nomes_grupos = [g["nome"] for g in grupos]
    grupo_clause_all = _grupo_clause(nomes_grupos)
    apenas_inc = f'project IN ("{PROJETO_INC}")'
    ambos_projetos = f'project IN ("{PROJETO_INC}", "{PROJETO_PDST}")'

    log.info("Gerando relatório consolidado (%s a %s)...", start_str, end_str)

    abertos_jql = f'{grupo_clause_all} AND {apenas_inc} AND created >= "{start_str}" AND created <= "{end_str}"'
    total_abertos = len(fetch_issues(config, abertos_jql, ["key"]))

    # "Total geral de chamados encerrados" usa só resolutiondate (sem exigir
    # status atual = Resolvido/Encerrado): confirmado contra o gadget nativo
    # do Jira que chamados resolvidos no período e depois movidos para outro
    # status (ex: reaberto) ainda contam aqui.
    encerrados_jql = (
        f'{grupo_clause_all} AND {apenas_inc} '
        f'AND resolutiondate >= "{start_str}" AND resolutiondate <= "{end_str}"'
    )
    encerrados_fields = ["key"]
    if categoria_encerramento_field_id:
        encerrados_fields.append(categoria_encerramento_field_id)
    encerrados_issues = fetch_issues(config, encerrados_jql, encerrados_fields)
    total_encerrados = len(encerrados_issues)

    categoria_encerramento_counts = None
    if categoria_encerramento_field_id:
        categoria_encerramento_counts = Counter()
        for issue in encerrados_issues:
            valores = _extract_categoria_values(config, issue.get("fields", {}).get(categoria_encerramento_field_id))
            categoria_encerramento_counts.update(valores)

        if encerrados_issues and not categoria_encerramento_counts:
            # Campo foi resolvido (tem ID), mas nenhum dos chamados encerrados
            # trouxe valor nele — ajuda a diferenciar "campo errado/vazio" de
            # "não achei o campo" (que já loga um warning em outro lugar).
            exemplo = encerrados_issues[0].get("fields", {}).get(categoria_encerramento_field_id)
            log.warning(
                'Campo de categoria de encerramento (%s) resolvido, mas nenhum dos %d chamados '
                "encerrados no período trouxe valor nele. Valor bruto de exemplo (1º chamado): %r",
                categoria_encerramento_field_id,
                len(encerrados_issues),
                exemplo,
            )

    # Já "dentro do prazo" x "violados" exige status atual Resolvido/Encerrado.
    status_resolvido_clause = 'status IN ("Resolvido", "Encerrado")'
    encerrados_status_jql = (
        f'{grupo_clause_all} AND {apenas_inc} AND {status_resolvido_clause} '
        f'AND resolutiondate >= "{start_str}" AND resolutiondate <= "{end_str}"'
    )
    encerrados_status_issues = fetch_issues(config, encerrados_status_jql, SLA_RESOLUTION_FIELDS)

    encerrados_dentro_prazo = 0
    encerrados_violados = 0
    for issue in encerrados_status_issues:
        _campo, breach_dt, breached = extract_sla_breach(issue.get("fields", {}))
        if breach_dt is None:
            continue  # sem dado de SLA preenchido: não entra em nenhuma das duas
        if breached:
            encerrados_violados += 1
        else:
            encerrados_dentro_prazo += 1

    total_dentro_violados = encerrados_dentro_prazo + encerrados_violados
    sla_percentual = (
        round(encerrados_dentro_prazo / total_dentro_violados * 100, 1) if total_dentro_violados else 0.0
    )
    percentual_dentro_prazo = sla_percentual
    percentual_violados = (
        round(encerrados_violados / total_dentro_violados * 100, 1) if total_dentro_violados else 0.0
    )

    reabertos_fields = ["key"]
    if categoria_encerramento_field_id:
        reabertos_fields.append(categoria_encerramento_field_id)

    reabertos_por_grupo = {}
    reabertos_categoria_counts = Counter() if categoria_encerramento_field_id else None
    for g in grupos:
        jql = (
            f'{_grupo_clause([g["nome"]])} AND {apenas_inc} AND status WAS "Reaberto" '
            f'AND created >= "{start_str}" AND created <= "{end_str}"'
        )
        issues = fetch_issues(config, jql, reabertos_fields)
        reabertos_por_grupo[g["label"]] = len(issues)
        if categoria_encerramento_field_id:
            for issue in issues:
                valores = _extract_categoria_values(config, issue.get("fields", {}).get(categoria_encerramento_field_id))
                reabertos_categoria_counts.update(valores)

    total_reabertos = sum(reabertos_por_grupo.values())
    percentual_reabertos_grupo = {
        label: (round(qtd / total_reabertos * 100, 1) if total_reabertos else 0.0)
        for label, qtd in reabertos_por_grupo.items()
    }
    percentual_reabertos_geral = round(total_reabertos / total_abertos * 100, 1) if total_abertos else 0.0

    periodo_clause = f'created >= "{start_str}" AND created <= "{end_str}"'

    clarinha_jql = f'{grupo_clause_all} AND {apenas_inc} AND {periodo_clause} AND "Nivel de Escalonamento" is not EMPTY'
    total_clarinha = len(fetch_issues(config, clarinha_jql, ["key"]))

    escalonamentos_lj_jql = f'{grupo_clause_all} AND {apenas_inc} AND {periodo_clause} AND "Tipo Incidente MOPS" is not EMPTY'
    total_escalonamentos_lj = len(fetch_issues(config, escalonamentos_lj_jql, ["key"]))

    criticos_jql = f'{grupo_clause_all} AND {apenas_inc} AND {periodo_clause} AND priority WAS IN (P0, P1, P2)'
    total_criticos = len(fetch_issues(config, criticos_jql, ["key"]))

    pontuais_jql = (
        f'{grupo_clause_all} AND {apenas_inc} AND {periodo_clause} '
        f'AND priority WAS IN (P0, P1, P2) AND priority NOT IN (P0, P1, P2)'
    )
    total_pontuais = len(fetch_issues(config, pontuais_jql, ["key"]))

    percentual_criticos = round(total_criticos / total_abertos * 100, 1) if total_abertos else 0.0
    percentual_pontuais = round(total_pontuais / total_criticos * 100, 1) if total_criticos else 0.0

    tops = {
        g["label"]: _top_analistas(config, g["nome"], ambos_projetos, start_str, end_str)
        for g in grupos
        if g.get("top_analistas")
    }

    def _linha_top(rotulo, ranking, posicao):
        if len(ranking) > posicao:
            nome, qtd = ranking[posicao]
            sufixo = "s" if qtd != 1 else ""
            return f"🔸 {rotulo}: {nome} ({qtd} encerrado{sufixo})"
        return f"🔸 {rotulo}: Nenhum"

    periodo_str = f"{start_date.strftime('%d/%m/%Y')} a {end_date.strftime('%d/%m/%Y')}"
    qtd_caixas = len(grupos)

    linhas = [
        f"📊 RELATÓRIO CONSOLIDADO - {periodo_str}",
        "",
        "# SLA - CAIXAS GERAIS #",
        "",
        f"🔸 Total geral de chamados abertos (considere as {qtd_caixas} caixas): {total_abertos}",
        f"🔸 Total geral de chamados encerrados (considere as {qtd_caixas} caixas): {total_encerrados}",
        f"🔸 Encerrados dentro do prazo: {encerrados_dentro_prazo} ({percentual_dentro_prazo}%)",
        f"🔸 Encerrados violados: {encerrados_violados} ({percentual_violados}%)",
        f"🔸 SLA percentual (dentro do prazo x violados): {sla_percentual}%",
        "",
        "# TAXAS DE REABERTURA - CAIXAS GERAIS #",
        "",
    ]
    for g in grupos:
        label = g["label"]
        linhas.append(
            f'🔸 Reabertos {label} ({g["nome"]}): {reabertos_por_grupo[label]} ({percentual_reabertos_grupo[label]}%)'
        )
    linhas.append(f"🔸 Soma total de reabertura: {total_reabertos} ({percentual_reabertos_geral}%)")
    linhas.append("")
    linhas.append("# TOP ANALISTAS #")
    linhas.append("")
    for label, ranking in tops.items():
        for posicao in range(3):
            linhas.append(_linha_top(f"Top {posicao + 1} analista {label}", ranking, posicao))
    linhas.extend(
        [
            "",
            "# ESCALONAMENTOS E PRIORIDADES #",
            "",
            f"🔸 Chamados Clarinha: {total_clarinha}",
            f"🔸 Escalonamentos LJ: {total_escalonamentos_lj}",
            f"🔸 Chamados Críticos totais: {total_criticos} ({percentual_criticos}%)",
            f"🔸 Chamados Pontuais: {total_pontuais} ({percentual_pontuais}%)",
        ]
    )

    linhas.extend(_linhas_top_categorias("CATEGORIA DE ENCERRAMENTO", categoria_encerramento_counts))
    linhas.extend(
        _linhas_top_categorias("CATEGORIA DE ENCERRAMENTO - CHAMADOS REABERTOS", reabertos_categoria_counts)
    )

    return "\n".join(linhas) + "\n"


def save_output(rows, output_base, fmt):
    if not rows:
        log.warning("Nenhum chamado encontrado para a JQL informada. Nada será salvo.")
        return

    # Import local (não no topo do módulo): só a GUI/CLI usam pandas para
    # salvar CSV/Excel em disco. A versão web (api/index.py) não chama esta
    # função e assim não precisa de pandas instalado no deploy.
    import pandas as pd

    df = pd.DataFrame(rows)

    os.makedirs("output", exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_path = os.path.join("output", f"{output_base}_{timestamp}")

    if fmt in ("csv", "both"):
        csv_path = f"{base_path}.csv"
        df.to_csv(csv_path, index=False, encoding="utf-8-sig")
        log.info("CSV salvo em: %s", csv_path)

    if fmt in ("excel", "both"):
        xlsx_path = f"{base_path}.xlsx"
        df.to_excel(xlsx_path, index=False, engine="openpyxl")
        log.info("Excel salvo em: %s", xlsx_path)


# Paleta usada no PDF, igual à da interface gráfica (jira_gui.py).
_PDF_HEADER_BG = colors.HexColor("#1d4ed8")
_PDF_HEADER_SUB = colors.HexColor("#dbeafe")
_PDF_ACCENT = colors.HexColor("#2563eb")
_PDF_TEXT = colors.HexColor("#0f172a")
_PDF_MUTED = colors.HexColor("#64748b")
_PDF_RULE = colors.HexColor("#e2e8f0")

_TITULO_EMOJIS = ("📄", "⏰", "📊")


def _escapar_xml(texto):
    return texto.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _limpar_titulo(linha):
    for emoji in _TITULO_EMOJIS:
        linha = linha.replace(emoji, "")
    return linha.strip()


class _PdfCanvasComCabecalho:
    """Desenha a faixa colorida do cabeçalho e o rodapé (data + nº de página)
    em toda página do PDF."""

    def __init__(self, titulo, subtitulo):
        self.titulo = titulo
        self.subtitulo = subtitulo

    def __call__(self, canvas_obj, doc):
        largura, altura = A4
        canvas_obj.saveState()

        canvas_obj.setFillColor(_PDF_HEADER_BG)
        canvas_obj.rect(0, altura - 2.4 * cm, largura, 2.4 * cm, stroke=0, fill=1)

        canvas_obj.setFillColor(colors.white)
        canvas_obj.setFont("Helvetica-Bold", 15)
        canvas_obj.drawString(2 * cm, altura - 1.35 * cm, self.titulo)

        canvas_obj.setFillColor(_PDF_HEADER_SUB)
        canvas_obj.setFont("Helvetica", 9)
        canvas_obj.drawString(2 * cm, altura - 1.95 * cm, self.subtitulo)

        canvas_obj.setStrokeColor(_PDF_RULE)
        canvas_obj.line(2 * cm, 1.6 * cm, largura - 2 * cm, 1.6 * cm)

        canvas_obj.setFillColor(_PDF_MUTED)
        canvas_obj.setFont("Helvetica", 8)
        gerado_em = datetime.now().strftime("Gerado em %d/%m/%Y às %H:%M")
        canvas_obj.drawString(2 * cm, 1.15 * cm, gerado_em)
        canvas_obj.drawRightString(largura - 2 * cm, 1.15 * cm, f"Página {doc.page}")

        canvas_obj.restoreState()


def export_report_pdf(texto, caminho, titulo="Relatório", subtitulo="Central de Incidentes · Monitoramento de SLA"):
    """Gera um PDF estilizado a partir do texto de um report (Report Diário
    ou Relatório Consolidado): cabeçalho colorido, seções destacadas e
    marcadores tratados (a fonte padrão do PDF não tem glifos de emoji).

    "caminho" aceita tanto um caminho de arquivo (str, usado pela GUI/CLI)
    quanto um buffer em memória como io.BytesIO (usado pela versão web,
    que não grava nada em disco no servidor).
    """
    if isinstance(caminho, str):
        os.makedirs(os.path.dirname(caminho), exist_ok=True)

    linhas = texto.strip("\n").split("\n")
    # A primeira linha é o título do report (já vira o cabeçalho colorido);
    # não é repetida no corpo do PDF.
    if linhas and any(e in linhas[0] for e in _TITULO_EMOJIS):
        titulo_pdf = _limpar_titulo(linhas[0])
        linhas = linhas[1:]
    else:
        titulo_pdf = titulo

    secao_style = ParagraphStyle(
        "Secao", fontName="Helvetica-Bold", fontSize=12, leading=15,
        textColor=_PDF_ACCENT, spaceBefore=14, spaceAfter=6,
    )
    bullet_style = ParagraphStyle(
        "Bullet", fontName="Helvetica", fontSize=10, leading=14,
        textColor=_PDF_TEXT, leftIndent=10, spaceAfter=2,
    )
    texto_style = ParagraphStyle(
        "Texto", fontName="Helvetica", fontSize=10, leading=14, textColor=_PDF_TEXT,
    )

    conteudo = []
    for linha in linhas:
        linha_limpa = linha.strip()

        if not linha_limpa:
            conteudo.append(Spacer(1, 4))
            continue

        secao = re.match(r"^#\s*(.+?)\s*#?$", linha_limpa)
        if secao:
            conteudo.append(Paragraph(_escapar_xml(secao.group(1)), secao_style))
            conteudo.append(HRFlowable(width="100%", thickness=0.75, color=_PDF_RULE, spaceAfter=6))
            continue

        if linha_limpa.startswith("🔸"):
            item = _escapar_xml(linha_limpa.lstrip("🔸").strip())
            if ":" in item:
                rotulo, valor = item.split(":", 1)
                item = f"{rotulo}:<b>{valor}</b>"
            conteudo.append(Paragraph(f'<font color="#2563eb">•</font>&nbsp;&nbsp;{item}', bullet_style))
            continue

        conteudo.append(Paragraph(_escapar_xml(linha_limpa), texto_style))

    doc = SimpleDocTemplate(
        caminho, pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm, topMargin=3.2 * cm, bottomMargin=2 * cm,
    )
    on_page = _PdfCanvasComCabecalho(titulo_pdf, subtitulo)
    doc.build(conteudo, onFirstPage=on_page, onLaterPages=on_page)


def parse_args():
    parser = argparse.ArgumentParser(description="Extrai chamados do Jira via REST API e exporta para CSV/Excel.")
    parser.add_argument(
        "--mode",
        choices=["completa", "violar", "violar_amanha", "violados"],
        help="Executa direto sem menu: 'completa', 'violar' (a violar hoje), 'violar_amanha' ou 'violados'.",
    )
    parser.add_argument("--jql", help="Query JQL a ser usada na extração completa (sobrescreve JIRA_JQL do .env).")
    parser.add_argument(
        "--fields",
        help="Lista de campos separados por vírgula (sobrescreve os campos padrão, apenas no modo 'completa').",
    )
    parser.add_argument(
        "--format",
        choices=["csv", "excel", "both"],
        default="both",
        help="Formato de saída (padrão: both).",
    )
    parser.add_argument(
        "--output",
        help="Nome base do arquivo de saída, sem extensão.",
    )
    return parser.parse_args()


def run_extracao_completa(config, jql=None, fields=None, output=None, fmt="both", incluir_fornecedor=False):
    jql = jql or config["jql"]
    if not jql:
        raise JiraExtractorError("Nenhuma JQL informada.")

    fields = fields or DEFAULT_FIELDS
    fetch_fields = fields + FORNECEDOR_RESPONSAVEL_FIELDS if incluir_fornecedor else fields

    log.info("Extraindo chamados com JQL: %s", jql)
    issues = fetch_issues(config, jql, fetch_fields)

    rows = []
    for issue in issues:
        row = flatten_issue(issue, fields)
        if incluir_fornecedor:
            row["fornecedor_responsavel"] = extract_fornecedor(issue.get("fields", {}))
        rows.append(row)

    save_output(rows, output or "chamados_jira", fmt)

    log.info("Concluído. Total de chamados extraídos: %d", len(rows))


def run_chamados_a_violar(config, days_ahead=0, output=None, fmt="both", incluir_fornecedor=False):
    label = "hoje" if days_ahead == 0 else "amanhã"
    rows = fetch_chamados_a_violar(config, days_ahead=days_ahead, incluir_fornecedor=incluir_fornecedor)

    if not rows:
        log.info("Nenhum chamado com SLA a estourar %s (dentro da janela 07:00-23:59).", label)
        return

    default_output = "chamados_a_violar_hoje" if days_ahead == 0 else "chamados_a_violar_amanha"
    save_output(rows, output or default_output, fmt)
    log.info("Concluído. Total de chamados a violar %s: %d", label, len(rows))


def run_chamados_violados(config, output=None, fmt="both", incluir_fornecedor=False):
    rows = fetch_chamados_violados(config, incluir_fornecedor=incluir_fornecedor)

    if not rows:
        log.info("Nenhum chamado com SLA já violado encontrado.")
        return

    save_output(rows, output or "chamados_violados", fmt)
    log.info("Concluído. Total de chamados violados: %d", len(rows))


def show_menu():
    print()
    print("===== Extração de Chamados Jira =====")
    print("1 - Extração completa")
    print("2 - Chamados a violar no dia (SLA 07:00 às 23:59)")
    print("3 - Chamados a violar amanhã (SLA 07:00 às 23:59)")
    print("4 - Chamados violados")
    print("0 - Sair")
    return input("Escolha uma opção: ").strip()


def run_menu(config):
    while True:
        choice = show_menu()

        try:
            if choice == "1":
                run_extracao_completa(config)
            elif choice == "2":
                run_chamados_a_violar(config, days_ahead=0)
            elif choice == "3":
                run_chamados_a_violar(config, days_ahead=1)
            elif choice == "4":
                run_chamados_violados(config)
            elif choice == "0":
                break
            else:
                print("Opção inválida. Tente novamente.")
        except JiraExtractorError as e:
            log.error(str(e))


def main():
    args = parse_args()
    config = load_config()

    fields = [f.strip() for f in args.fields.split(",")] if args.fields else None

    try:
        if args.mode == "completa":
            run_extracao_completa(config, jql=args.jql, fields=fields, output=args.output, fmt=args.format)
        elif args.mode == "violar":
            run_chamados_a_violar(config, days_ahead=0, output=args.output, fmt=args.format)
        elif args.mode == "violar_amanha":
            run_chamados_a_violar(config, days_ahead=1, output=args.output, fmt=args.format)
        elif args.mode == "violados":
            run_chamados_violados(config, output=args.output, fmt=args.format)
        else:
            run_menu(config)
    except JiraExtractorError as e:
        log.error(str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
