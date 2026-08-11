"""
API web (Flask) para extração de chamados Jira, pensada para rodar na Vercel.

Diferenças em relação à GUI/CLI (jira_extractor.py / jira_gui.py):

- JIRA_URL, JIRA_JQL e JIRA_PAGE_SIZE são fixos no servidor (variáveis de
  ambiente) — não aparecem nem são editáveis na tela.
- JIRA_EMAIL e JIRA_API_TOKEN são informados pelo usuário a cada sessão no
  navegador e enviados em toda requisição; o servidor só os usa para
  autenticar na API do Jira dentro daquela requisição e nunca os grava em
  disco, banco, log, cookie ou sessão. Não há estado entre requisições.
- Não é gerado nenhum arquivo em disco no servidor: CSV/Excel/PDF são
  montados em memória e devolvidos como download direto.
"""

import csv
import io
import os
import sys
import zipfile
from collections import Counter
from datetime import datetime, timedelta

from flask import Flask, jsonify, request, send_file
import requests
from openpyxl import Workbook
from werkzeug.exceptions import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from jira_extractor import (  # noqa: E402
    BRAZIL_TZ,
    DEFAULT_FIELDS,
    JiraExtractorError,
    PROJETO_INC,
    PROJETO_PDST,
    build_consolidated_report,
    build_daily_report,
    export_report_pdf,
    extract_fornecedor,
    fetch_categoria_encerrados,
    fetch_categoria_reabertos,
    fetch_chamados_a_violar,
    fetch_chamados_violados,
    fetch_issues,
    flatten_issue,
    load_fixed_config,
)

# Seg=0 ... Dom=6, casando com date.weekday().
DIAS_SEMANA_ABREV = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
VIOLAR_SEMANAL_DIAS = 7

# Status disponíveis pra seleção nos painéis de opções (mesma lista de
# STATUS_OPTIONS do jira_gui.py).
STATUS_OPTIONS = [
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
]

# Grupos Solucionador fixos (mesmos da GUI) — usados no Report Diário e no
# detalhamento "por grupo" dos cards de "a violar hoje/amanhã".
GRUPOS_SOLUCIONADOR = [
    "CLBR-TI-OPS-OGS-SOLAR-SALESFORCE-N2",
    "CLBR-TI-OPS-OGS SOLAR SALESFORCE",
    "CLBR-TI-OPS-PROD SOLAR SALESFORCE",
]

CAIXA_SOLAR = "solar"
CAIXA_TV = "tv"
CAIXA_PADRAO = CAIXA_SOLAR

GRUPOS_TV = [
    "CLBR-TI-OPS-MOPS TV DO FUTURO",
    "CLBR-TI-OPS-MOPS-TV DO FUTURO N2",
]

# Cada "caixa solucionadora" tem sua lista de grupos, usada tanto para
# montar a JQL geral (grupo + projeto, ver _build_base_jql) quanto no
# detalhamento "por grupo" e no Report Diário/Relatório Consolidado.
CAIXAS = {
    CAIXA_SOLAR: {
        "label": "Mops Solar",
        "grupos": GRUPOS_SOLUCIONADOR,
        "grupos_consolidado": None,  # usa o padrão (N1/N2/Prod) de jira_extractor.py
    },
    CAIXA_TV: {
        "label": "Mops Tv do Futuro",
        "grupos": GRUPOS_TV,
        "grupos_consolidado": [
            {"label": "N1", "nome": GRUPOS_TV[0], "top_analistas": True},
            {"label": "N2", "nome": GRUPOS_TV[1], "top_analistas": True},
        ],
    },
}

app = Flask(__name__)

try:
    FIXED_CONFIG = load_fixed_config()
    FIXED_CONFIG_ERROR = None
except JiraExtractorError as e:
    FIXED_CONFIG = None
    FIXED_CONFIG_ERROR = str(e)


@app.after_request
def _no_store(response):
    # Nada aqui pode ser guardado pelo navegador/proxy — nem credenciais,
    # nem os dados exportados.
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return response


def _config_from_request(body):
    if FIXED_CONFIG is None:
        raise JiraExtractorError(FIXED_CONFIG_ERROR)

    email = (body or {}).get("email", "").strip()
    token = (body or {}).get("token", "")
    if not email or not token:
        raise JiraExtractorError("Informe e-mail e API Token.")

    return dict(FIXED_CONFIG, email=email, token=token)


def _resolve_caixa(body):
    caixa_id = (body or {}).get("caixa") or CAIXA_PADRAO
    if caixa_id not in CAIXAS:
        raise JiraExtractorError(f'Caixa solucionadora "{caixa_id}" desconhecida.')
    return caixa_id


# Projetos que o usuário pode marcar/desmarcar no painel "PROJETOS" — vale
# para A violar, Violados, Extração completa e Categorias de Encerramento.
# Report Diário e Relatório Consolidado não usam isso (têm lógica própria,
# com contagens específicas por projeto).
PROJETOS_DISPONIVEIS = [PROJETO_INC, PROJETO_PDST]


def _build_base_jql(caixa_id, projetos=None):
    """JQL 'geral' de uma caixa: só grupo + projetos, sem status/período pré-
    definidos — não depende de nenhuma variável de ambiente com JQL pronta.
    "projetos" (opcional) restringe os projetos considerados; por padrão os
    dois (PROJETO_INC + PROJETO_PDST). Quem usa isso (fetch_chamados_a_violar,
    fetch_chamados_violados) já aplica por cima a própria condição de
    status/SLA internamente (mesmo tratamento Python de sempre, ex.:
    VIOLAR_STATUSES), então não precisa repetir status aqui."""
    grupos = CAIXAS[caixa_id]["grupos"]
    grupos_str = ", ".join(f'"{g}"' for g in grupos)
    projetos_str = ", ".join(f'"{p}"' for p in (projetos or PROJETOS_DISPONIVEIS))
    return f'"Grupo Solucionador[Group Picker (single group)]" IN ({grupos_str}) AND project IN ({projetos_str})'


def _grupos_selecionados(body, caixa_id):
    """Lista de grupos marcados no painel de opções, restrita aos grupos que
    realmente pertencem à caixa selecionada (evita injeção de grupo
    arbitrário via corpo da requisição). Sem 'grupos' no corpo, usa todos os
    da caixa (equivalente a vir tudo marcado)."""
    disponiveis = CAIXAS[caixa_id]["grupos"]
    enviados = body.get("grupos")
    if enviados is None:
        return list(disponiveis)
    selecionados = [g for g in enviados if g in disponiveis]
    if not selecionados:
        raise JiraExtractorError("Selecione ao menos uma caixa.")
    return selecionados


def _status_selecionados(body):
    enviados = body.get("status")
    if enviados is None:
        return list(STATUS_OPTIONS)
    selecionados = [s for s in enviados if s in STATUS_OPTIONS]
    if not selecionados:
        raise JiraExtractorError("Selecione ao menos um status.")
    return selecionados


def _projetos_selecionados(body):
    """Lista de projetos marcados no painel "PROJETOS". Sem 'projetos' no
    corpo, usa todos os disponíveis (equivalente a vir tudo marcado)."""
    enviados = body.get("projetos")
    if enviados is None:
        return list(PROJETOS_DISPONIVEIS)
    selecionados = [p for p in enviados if p in PROJETOS_DISPONIVEIS]
    if not selecionados:
        raise JiraExtractorError("Selecione ao menos um projeto.")
    return selecionados


def _build_jql_dinamica(grupos, status, inicio, fim, projetos=None, order_by="cf[10419] ASC"):
    """Monta uma JQL a partir de grupos/status/período escolhidos na tela —
    mesmo espírito do `_build_jql()` do jira_gui.py (checkboxes viram
    JQL), considerando os dois projetos (Central de Incidentes + Abertura
    de Chamados) por padrão."""
    if bool(inicio) != bool(fim):
        raise JiraExtractorError("Informe as duas datas (início e fim) ou nenhuma.")
    if inicio and fim and inicio > fim:
        raise JiraExtractorError("A data início não pode ser depois da data fim.")

    grupos_str = ", ".join(f'"{g}"' for g in grupos)
    status_str = ", ".join(f'"{s}"' for s in status)
    projetos_str = ", ".join(f'"{p}"' for p in (projetos or PROJETOS_DISPONIVEIS))
    partes = [
        f'"Grupo Solucionador[Group Picker (single group)]" IN ({grupos_str})',
        f'project IN ({projetos_str})',
        f"status IN ({status_str})",
    ]
    if inicio and fim:
        partes.append(f'created >= "{inicio} 00:00" AND created <= "{fim} 23:59"')
    return " AND ".join(partes) + f" ORDER BY {order_by}"


def _error_response(message, status):
    return jsonify({"error": message}), status


@app.errorhandler(JiraExtractorError)
def _handle_known_error(e):
    return _error_response(str(e), 400)


@app.errorhandler(requests.exceptions.RequestException)
def _handle_request_error(e):
    return _error_response("Não foi possível conectar ao Jira.", 502)


@app.errorhandler(Exception)
def _handle_unexpected_error(e):
    if isinstance(e, (JiraExtractorError, requests.exceptions.RequestException)):
        raise e
    if isinstance(e, HTTPException):
        # 404, 405 etc. (ex.: favicon.ico, sondagens do navegador em rotas
        # estáticas só usadas no dev local) — deixa o Flask/Werkzeug
        # responder normalmente, não é um erro inesperado do servidor.
        return e
    app.logger.exception("Erro inesperado")
    return _error_response("Erro interno inesperado.", 500)


def _rows_to_csv_bytes(rows):
    fieldnames = list(rows[0].keys())
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return ("﻿" + buf.getvalue()).encode("utf-8")


def _rows_to_excel_bytes(rows):
    fieldnames = list(rows[0].keys())
    wb = Workbook()
    ws = wb.active
    ws.append(fieldnames)
    for row in rows:
        ws.append([row.get(f) for f in fieldnames])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


TOP_ASSIGNEES_LIMIT = 8


def _build_summary(rows):
    """Contagens usadas pelos cards/KPIs da tela de resultados (não pelo arquivo
    exportado, que continua com as linhas completas)."""
    assignee_counts = Counter(r.get("assignee") for r in rows if r.get("assignee"))

    return {
        "total": len(rows),
        "top_assignees": assignee_counts.most_common(TOP_ASSIGNEES_LIMIT),
    }


def _is_download(body):
    return (body or {}).get("format") in ("csv", "excel", "both")


def _respond(rows, base_name, body, extra=None):
    """Sem 'format' no corpo: devolve JSON (linhas + resumo, + "extra" quando
    houver) para exibir na tela. Com 'format': devolve o arquivo pronto para
    download (comportamento antigo, "extra" é ignorado)."""
    if _is_download(body):
        return _send_rows(rows, base_name, body.get("format"))

    payload = {
        "fields": list(rows[0].keys()) if rows else [],
        "rows": rows,
        "summary": _build_summary(rows),
    }
    if extra:
        payload.update(extra)
    return jsonify(payload)


GRUPO_FIELD_NAME = "Grupo Solucionador"
CATEGORIA_ENCERRAMENTO_FIELD_NAME = "Categoria de Encerramento"

# ID de campos customizados resolvidos por nome (Grupo Solucionador,
# Categoria de Encerramento etc.), um cache por (URL da instância, nome do
# campo) — evita repetir a busca em /rest/api/3/field a cada requisição. Só
# guarda o ID do campo (não é credencial nem dado de chamado), então não
# conflita com a política de "nada é persistido" do app: sobrevive apenas
# enquanto o processo do servidor estiver de pé, como qualquer cache em
# memória de processo.
_field_id_cache = {}


def _resolve_field_id(config, field_name):
    cache_key = (config["url"], field_name)
    cached = _field_id_cache.get(cache_key)
    if cached:
        return cached

    resp = requests.get(
        f"{config['url']}/rest/api/3/field",
        auth=(config["email"], config["token"]),
        headers={"Accept": "application/json"},
        timeout=15,
    )
    resp.raise_for_status()
    campos = resp.json()

    alvo = field_name.strip().casefold()
    encontrados = [f for f in campos if (f.get("name") or "").strip().casefold() == alvo]
    if encontrados:
        if len(encontrados) > 1:
            app.logger.warning(
                'Mais de um campo chamado "%s" no Jira (%s) — usando o primeiro: %s. '
                "Se for o campo errado, me diga o ID correto.",
                field_name,
                [f["id"] for f in encontrados],
                encontrados[0]["id"],
            )
        field_id = encontrados[0]["id"]
        app.logger.info('Campo "%s" resolvido como %s.', field_name, field_id)
        _field_id_cache[cache_key] = field_id
        return field_id

    nomes_disponiveis = sorted({field.get("name") for field in campos if field.get("name")})
    palavras_alvo = [w.casefold() for w in field_name.split() if len(w) > 3]
    app.logger.warning(
        'Campo "%s" não encontrado no Jira (%d campos retornados por /rest/api/3/field). '
        "Nomes parecidos: %s",
        field_name,
        len(campos),
        [n for n in nomes_disponiveis if any(w in n.casefold() for w in palavras_alvo)] or "nenhum",
    )
    return None


def _resolve_grupo_field_id(config):
    return _resolve_field_id(config, GRUPO_FIELD_NAME)


def _resolve_categoria_encerramento_field_id(config):
    return _resolve_field_id(config, CATEGORIA_ENCERRAMENTO_FIELD_NAME)


def _por_grupo_a_violar(rows, grupos):
    """Conta, para cada grupo da caixa selecionada, quantos chamados do
    resultado de 'a violar' pertencem àquele grupo. Não faz nenhuma busca
    extra no Jira: só agrupa as linhas já retornadas pela busca principal
    (que já vêm com "grupo_solucionador" quando o campo foi resolvido)."""
    contagem = Counter(r.get("grupo_solucionador") for r in rows if r.get("grupo_solucionador"))
    return [{"grupo": grupo, "total": contagem.get(grupo, 0)} for grupo in grupos]


def _send_rows(rows, base_name, fmt):
    if not rows:
        return jsonify({"empty": True, "message": "Nenhum chamado encontrado para os critérios atuais."})

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    stem = f"{base_name}_{timestamp}"

    if fmt == "csv":
        data = _rows_to_csv_bytes(rows)
        return send_file(
            io.BytesIO(data), mimetype="text/csv", as_attachment=True, download_name=f"{stem}.csv"
        )

    if fmt == "excel":
        data = _rows_to_excel_bytes(rows)
        return send_file(
            io.BytesIO(data),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=f"{stem}.xlsx",
        )

    # both -> zip com os dois arquivos
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{stem}.csv", _rows_to_csv_bytes(rows))
        zf.writestr(f"{stem}.xlsx", _rows_to_excel_bytes(rows))
    buf.seek(0)
    return send_file(buf, mimetype="application/zip", as_attachment=True, download_name=f"{stem}.zip")


@app.route("/api/connect", methods=["POST"])
def connect():
    body = request.get_json(silent=True) or {}
    config = _config_from_request(body)

    resp = requests.get(
        f"{config['url']}/rest/api/3/myself",
        auth=(config["email"], config["token"]),
        headers={"Accept": "application/json"},
        timeout=15,
    )

    if resp.status_code == 200:
        return jsonify({"displayName": resp.json().get("displayName", config["email"])})
    if resp.status_code == 401:
        return _error_response("E-mail ou API Token inválidos.", 401)
    return _error_response(f"Erro inesperado do Jira ({resp.status_code}).", 502)


@app.route("/api/jql-atual", methods=["POST"])
def jql_atual():
    """Devolve a JQL geral (grupo + projeto, sem status/período pré-fixados)
    da caixa selecionada — só leitura de config, não chama o Jira, não
    precisa de e-mail/token (a JQL em si não é segredo)."""
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    projetos = _projetos_selecionados(body)
    return jsonify(
        {"caixa": caixa_id, "label": CAIXAS[caixa_id]["label"], "jql": _build_base_jql(caixa_id, projetos)}
    )


@app.route("/api/extracao-completa", methods=["POST"])
def extracao_completa():
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    config = _config_from_request(body)

    grupos = _grupos_selecionados(body, caixa_id)
    status = _status_selecionados(body)
    projetos = _projetos_selecionados(body)
    inicio = (body.get("inicio") or "").strip()
    fim = (body.get("fim") or "").strip()
    jql = _build_jql_dinamica(grupos, status, inicio, fim, projetos=projetos)
    config = dict(config, jql=jql)

    fields = DEFAULT_FIELDS
    fetch_fields = fields + ["customfield_31880", "customfield_16762"]
    issues = fetch_issues(config, jql, fetch_fields)

    rows = []
    for issue in issues:
        row = flatten_issue(issue, fields)
        row["fornecedor_responsavel"] = extract_fornecedor(issue.get("fields", {}))
        rows.append(row)

    return _respond(rows, "chamados_jira", body)


def _fetch_violar_com_grupo(config, days_ahead, incluir_grupo, grupos):
    """Busca 'a violar' incluindo o campo Grupo Solucionador quando possível.
    Se a resolução do campo falhar por qualquer motivo (permissão, campo
    renomeado etc.), degrada com elegância: segue sem o detalhamento por
    grupo em vez de derrubar a extração inteira."""
    grupo_field_id = None
    if incluir_grupo:
        try:
            grupo_field_id = _resolve_grupo_field_id(config)
        except Exception:
            # Best-effort: qualquer falha aqui (rede, JSON inesperado, campo
            # ausente etc.) não pode derrubar a extração principal.
            app.logger.exception("Falha ao resolver o campo Grupo Solucionador")
            grupo_field_id = None

    rows = fetch_chamados_a_violar(
        config, days_ahead=days_ahead, incluir_fornecedor=True, grupo_field_id=grupo_field_id
    )

    extra = None
    if grupo_field_id:
        try:
            extra = {"por_grupo": _por_grupo_a_violar(rows, grupos)}
        except Exception:
            app.logger.exception("Falha ao agregar chamados por grupo")
            extra = None

    return rows, extra


@app.route("/api/violar-hoje", methods=["POST"])
def violar_hoje():
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    projetos = _projetos_selecionados(body)
    config = dict(_config_from_request(body), jql=_build_base_jql(caixa_id, projetos))
    rows, extra = _fetch_violar_com_grupo(
        config, days_ahead=0, incluir_grupo=not _is_download(body), grupos=CAIXAS[caixa_id]["grupos"]
    )
    return _respond(rows, "chamados_a_violar_hoje", body, extra=extra)


@app.route("/api/violar-amanha", methods=["POST"])
def violar_amanha():
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    projetos = _projetos_selecionados(body)
    config = dict(_config_from_request(body), jql=_build_base_jql(caixa_id, projetos))
    rows, extra = _fetch_violar_com_grupo(
        config, days_ahead=1, incluir_grupo=not _is_download(body), grupos=CAIXAS[caixa_id]["grupos"]
    )
    return _respond(rows, "chamados_a_violar_amanha", body, extra=extra)


@app.route("/api/violar-semanal", methods=["POST"])
def violar_semanal():
    """Plano semanal: mesma lógica de Hoje/Amanhã (fetch_chamados_a_violar),
    repetida para cada um dos próximos 7 dias corridos. Devolve tanto o
    resumo por dia (pro mapa de calor) quanto os chamados de todos os dias
    combinados (pra tabela padrão + download), ordenados por horário de
    estouro do SLA."""
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    projetos = _projetos_selecionados(body)
    config = dict(_config_from_request(body), jql=_build_base_jql(caixa_id, projetos))
    grupos = CAIXAS[caixa_id]["grupos"]

    grupo_field_id = None
    try:
        grupo_field_id = _resolve_grupo_field_id(config)
    except Exception:
        # Best-effort, mesmo padrão do resto do app: sem esse campo, os dias
        # do plano semanal saem sem o detalhamento por caixa, não quebra.
        app.logger.exception("Falha ao resolver o campo Grupo Solucionador")
        grupo_field_id = None

    hoje = datetime.now(BRAZIL_TZ).date()
    dias = []
    todas_rows = []
    for offset in range(VIOLAR_SEMANAL_DIAS):
        data = hoje + timedelta(days=offset)
        rows = fetch_chamados_a_violar(
            config, days_ahead=offset, incluir_fornecedor=True, grupo_field_id=grupo_field_id
        )
        dia_info = {
            "data": data.strftime("%Y-%m-%d"),
            "dia_semana": DIAS_SEMANA_ABREV[data.weekday()],
            "total": len(rows),
        }
        if grupo_field_id:
            dia_info["por_grupo"] = _por_grupo_a_violar(rows, grupos)
        dias.append(dia_info)
        todas_rows.extend(rows)

    todas_rows.sort(key=lambda r: r["sla_estoura_em"])

    return _respond(todas_rows, "chamados_a_violar_semanal", body, extra={"dias": dias})


@app.route("/api/violados", methods=["POST"])
def violados():
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    projetos = _projetos_selecionados(body)
    config = dict(_config_from_request(body), jql=_build_base_jql(caixa_id, projetos))
    rows = fetch_chamados_violados(config, incluir_fornecedor=True)
    return _respond(rows, "chamados_violados", body)


@app.route("/api/report-diario", methods=["POST"])
def report_diario():
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    # O Report Diário monta a própria JQL a partir dos grupos (não lê
    # config["jql"]), então não depende de nenhuma JQL pré-configurada.
    config = _config_from_request(body)
    texto = build_daily_report(config, CAIXAS[caixa_id]["grupos"])
    return jsonify({"text": texto})


@app.route("/api/relatorio-consolidado", methods=["POST"])
def relatorio_consolidado():
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    config = _config_from_request(body)
    inicio, fim = _parse_periodo(body)

    try:
        categoria_field_id = _resolve_categoria_encerramento_field_id(config)
    except Exception:
        # Best-effort, igual à resolução do Grupo Solucionador: sem esse
        # campo o relatório sai sem a seção de categoria, não quebra.
        app.logger.exception("Falha ao resolver o campo Categoria de Encerramento")
        categoria_field_id = None

    texto = build_consolidated_report(
        config,
        inicio,
        fim,
        grupos=CAIXAS[caixa_id]["grupos_consolidado"],
        categoria_encerramento_field_id=categoria_field_id,
    )
    return jsonify({"text": texto})


def _parse_periodo(body):
    try:
        inicio = datetime.strptime(body.get("inicio", ""), "%Y-%m-%d").date()
        fim = datetime.strptime(body.get("fim", ""), "%Y-%m-%d").date()
    except ValueError:
        raise JiraExtractorError("Datas inválidas.")
    if inicio > fim:
        raise JiraExtractorError("A data início não pode ser depois da data fim.")
    return inicio, fim


CATEGORIAS_TOP_N_OPCOES = (3, 5, 10, 20)


def _categorias_payload(counts, total_chamados, top_n):
    total_categorizados = sum(counts.values())
    return {
        "total_chamados": total_chamados,
        "total_categorizados": total_categorizados,
        "categorias": [
            {
                "categoria": categoria,
                "quantidade": qtd,
                "percentual": round(qtd / total_categorizados * 100, 1) if total_categorizados else 0.0,
            }
            for categoria, qtd in counts.most_common(top_n)
        ],
    }


@app.route("/api/categorias-encerramento", methods=["POST"])
def categorias_encerramento():
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    config = _config_from_request(body)
    inicio, fim = _parse_periodo(body)

    incluir_encerrados = bool(body.get("encerrados", True))
    incluir_reabertos = bool(body.get("reabertos", True))
    if not incluir_encerrados and not incluir_reabertos:
        raise JiraExtractorError('Selecione ao menos "Encerrados" ou "Reabertos".')

    try:
        top_n = int(body.get("top_n", 10))
    except (TypeError, ValueError):
        top_n = 10
    if top_n not in CATEGORIAS_TOP_N_OPCOES:
        top_n = 10

    categoria_field_id = _resolve_categoria_encerramento_field_id(config)
    if not categoria_field_id:
        raise JiraExtractorError('Campo "Categoria de Encerramento" não encontrado no Jira.')

    grupos = CAIXAS[caixa_id]["grupos"]
    projetos = _projetos_selecionados(body)
    payload = {}

    if incluir_encerrados:
        counts, total = fetch_categoria_encerrados(config, grupos, inicio, fim, categoria_field_id, projetos=projetos)
        payload["encerrados"] = _categorias_payload(counts, total, top_n)

    if incluir_reabertos:
        counts, total = fetch_categoria_reabertos(config, grupos, inicio, fim, categoria_field_id, projetos=projetos)
        payload["reabertos"] = _categorias_payload(counts, total, top_n)

    return jsonify(payload)


@app.route("/api/exportar-pdf", methods=["POST"])
def exportar_pdf():
    body = request.get_json(silent=True) or {}
    texto = (body.get("text") or "").strip()
    if not texto:
        raise JiraExtractorError("Nada para exportar.")

    buf = io.BytesIO()
    export_report_pdf(texto, buf, titulo="Relatório")
    buf.seek(0)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return send_file(
        buf, mimetype="application/pdf", as_attachment=True, download_name=f"relatorio_{timestamp}.pdf"
    )


if __name__ == "__main__":
    # Só para desenvolvimento local (python api/index.py). Em produção na
    # Vercel, os arquivos de public/ são servidos diretamente pela
    # plataforma — esta rota não existe no deploy.
    from flask import send_from_directory

    PUBLIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")

    @app.route("/")
    def _serve_index():
        return send_from_directory(PUBLIC_DIR, "index.html")

    @app.route("/<path:filename>")
    def _serve_static(filename):
        return send_from_directory(PUBLIC_DIR, filename)

    @app.route("/api/dev-autologin")
    def _dev_autologin():
        # Só para poupar login manual durante testes locais: lê JIRA_EMAIL/
        # JIRA_API_TOKEN do .env (já carregado no processo por load_dotenv,
        # chamado dentro de load_fixed_config() lá em cima). Essa rota só
        # existe quando o servidor roda direto via "python api/index.py" —
        # em produção na Vercel (importado como app WSGI) ela nem é
        # registrada, então não tem como isso vazar credencial em deploy.
        email = os.getenv("JIRA_EMAIL", "")
        token = os.getenv("JIRA_API_TOKEN", "")
        return jsonify({"email": email or None, "token": token or None})

    app.run(debug=True, port=5000)
