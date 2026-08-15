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
    enriquecer_todos_com_categoria_status,
    export_general_report_pdf,
    export_report_pdf,
    extract_fornecedor,
    fetch_categoria_encerrados,
    fetch_categoria_reabertos,
    fetch_chamados_a_violar,
    fetch_chamados_criticos,
    fetch_chamados_funcionalidade_ofensor,
    fetch_chamados_reabertos,
    fetch_chamados_violados,
    fetch_contagem_atrelados_lote,
    fetch_previstos_violar_por_dia,
    fetch_criados_x_resolvidos,
    fetch_detalhe_analista,
    fetch_resolvidos_hoje,
    fetch_status_categoria_lote,
    fetch_total_criados_periodo,
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
NIVEL_ESCALONAMENTO_FIELD_NAME = "Nivel de Escalonamento"
RESPONSAVEL_MOPS_FIELD_NAME = "Responsável pela Solicitação MOPS"

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


_account_id_cache = {}


def _resolve_account_id(config, nome_completo):
    """Resolve o accountId de um usuário pelo nome (mesmo texto do
    "assignee" exibido no Jira) — necessário porque `assignee = "Nome"` em
    JQL não é confiável no Cloud quando há ambiguidade de nome: testado
    direto na API, `assignee = "DIEGO VERGA TEIXEIRA"` devolveu 0 resultados
    mesmo havendo 46 chamados reais dele no período (provavelmente por causa
    de outros "TEIXEIRA"/"VERGA" cadastrados no mesmo Jira), enquanto
    `assignee = "<accountId>"` resolveu os 46 certinho. Cache em memória por
    (URL, nome em maiúsculas), mesmo padrão de _resolve_field_id."""
    cache_key = (config["url"], nome_completo.strip().upper())
    cached = _account_id_cache.get(cache_key)
    if cached:
        return cached

    resp = requests.get(
        f"{config['url']}/rest/api/3/user/search",
        auth=(config["email"], config["token"]),
        headers={"Accept": "application/json"},
        params={"query": nome_completo},
        timeout=15,
    )
    resp.raise_for_status()
    usuarios = resp.json()

    alvo = nome_completo.strip().upper()
    encontrados = [u for u in usuarios if (u.get("displayName") or "").strip().upper() == alvo]
    if not encontrados:
        raise JiraExtractorError(f'Não encontrei o usuário "{nome_completo}" no Jira.')
    if len(encontrados) > 1:
        app.logger.warning(
            'Mais de um usuário chamado "%s" no Jira — usando o primeiro: %s.',
            nome_completo,
            encontrados[0]["accountId"],
        )

    account_id = encontrados[0]["accountId"]
    _account_id_cache[cache_key] = account_id
    return account_id


def _resolve_categoria_encerramento_field_id(config):
    return _resolve_field_id(config, CATEGORIA_ENCERRAMENTO_FIELD_NAME)


def _resolve_nivel_escalonamento_field_id(config):
    return _resolve_field_id(config, NIVEL_ESCALONAMENTO_FIELD_NAME)


def _resolve_responsavel_mops_field_id(config):
    return _resolve_field_id(config, RESPONSAVEL_MOPS_FIELD_NAME)


def _por_grupo_a_violar(rows, grupos):
    """Para cada grupo da caixa selecionada: quantos chamados do resultado
    pertencem àquele grupo, e o ranking de "Top responsáveis" só daquele
    grupo (pra acompanhar a coluna de cada caixa no card, em vez de um
    ranking único combinando todos os grupos). Não faz nenhuma busca extra
    no Jira: só agrupa as linhas já retornadas pela busca principal (que já
    vêm com "grupo_solucionador" quando o campo foi resolvido)."""
    resultado = []
    for grupo in grupos:
        linhas_grupo = [r for r in rows if r.get("grupo_solucionador") == grupo]
        assignee_counts = Counter(r.get("assignee") for r in linhas_grupo if r.get("assignee"))
        resultado.append(
            {
                "grupo": grupo,
                "total": len(linhas_grupo),
                "top_assignees": assignee_counts.most_common(TOP_ASSIGNEES_LIMIT),
            }
        )
    return resultado


# Turnos fixos para o detalhamento de "Violados" — intervalos em minutos desde
# 00:00, extremos inclusivos. Cobrem 07:00–23:59; fora disso (madrugada) cai
# no bucket "Fora do horário" (só aparece se houver algum chamado nele).
TURNOS_VIOLADOS = [
    {"label": "Turno 1 (07:00–09:00)", "inicio_min": 7 * 60, "fim_min": 9 * 60},
    {"label": "Turno comercial (09:01–18:00)", "inicio_min": 9 * 60 + 1, "fim_min": 18 * 60},
    {"label": "Turno 2 (18:01–23:59)", "inicio_min": 18 * 60 + 1, "fim_min": 23 * 60 + 59},
]
TURNO_FORA_HORARIO = "Fora do horário (00:00–06:59)"


def _por_turno_violados(rows):
    """Conta, para cada turno fixo, quantos chamados violados têm o horário de
    estouro do SLA ("sla_estourou_em") dentro daquele intervalo. Não faz
    nenhuma busca extra no Jira: só agrupa as linhas já retornadas pela busca
    principal de Violados. Chamados sem SLA estourado preenchido (não deveria
    acontecer nesta ação, mas por segurança) não entram em nenhum turno."""
    contagem = Counter()
    for row in rows:
        sla_estourou_em = row.get("sla_estourou_em")
        if not sla_estourou_em or len(sla_estourou_em) < 16:
            continue
        try:
            hora, minuto = int(sla_estourou_em[11:13]), int(sla_estourou_em[14:16])
        except ValueError:
            continue
        minutos_totais = hora * 60 + minuto

        turno_encontrado = TURNO_FORA_HORARIO
        for turno in TURNOS_VIOLADOS:
            if turno["inicio_min"] <= minutos_totais <= turno["fim_min"]:
                turno_encontrado = turno["label"]
                break
        contagem[turno_encontrado] += 1

    resultado = [{"turno": t["label"], "total": contagem.get(t["label"], 0)} for t in TURNOS_VIOLADOS]
    if contagem.get(TURNO_FORA_HORARIO):
        resultado.append({"turno": TURNO_FORA_HORARIO, "total": contagem[TURNO_FORA_HORARIO]})
    return resultado


def _por_dia_violados(rows, previstos_por_dia=None):
    """Conta, por dia, quantos chamados tiveram o SLA estourado nesse dia (com
    base em "sla_estourou_em"). Não faz nenhuma busca extra no Jira: só
    agrupa as linhas já retornadas pela busca principal de Violados (que já
    vêm com "reaberto" calculado). "reaberto" no dia é True se ao menos um
    dos chamados daquele dia já passou por status "Reaberto".

    "previstos_por_dia" (opcional): dict {dia: [keys]} de
    fetch_previstos_violar_por_dia — chamados que tinham a data PREVISTA de
    estouro naquele dia, violado ou não (a quantidade é só len() da lista).
    Só entra como coluna extra nos dias que já aparecem aqui (que tiveram
    violado de fato); dias sem nenhum violado não entram na tabela mesmo que
    tenham previstos. As keys vão junto pra alimentar o hover da coluna."""
    contagem = Counter()
    tem_reaberto = set()
    for row in rows:
        sla_estourou_em = row.get("sla_estourou_em")
        if not sla_estourou_em or len(sla_estourou_em) < 10:
            continue
        dia = sla_estourou_em[:10]
        contagem[dia] += 1
        if row.get("reaberto") == "Sim":
            tem_reaberto.add(dia)

    resultado = []
    for dia, total in sorted(contagem.items()):
        entry = {"data": dia, "total": total, "reaberto": dia in tem_reaberto}
        if previstos_por_dia is not None:
            chaves = previstos_por_dia.get(dia, [])
            entry["previsto"] = len(chaves)
            entry["previsto_chaves"] = chaves
        resultado.append(entry)
    return resultado


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
    inicio, fim = _parse_periodo_opcional(body)
    rows = fetch_chamados_violados(config, incluir_fornecedor=True, start_date=inicio, end_date=fim)

    extra = None
    if not _is_download(body):
        # "previsto" (quem tinha prazo pra violar naquele dia, violado ou
        # não) só entra com período definido — no modo "Tudo" a busca de
        # fetch_previstos_violar_por_dia ficaria sem limite nenhum.
        previstos_por_dia = None
        if inicio and fim:
            try:
                previstos_por_dia = fetch_previstos_violar_por_dia(config, inicio, fim)
            except Exception:
                app.logger.exception("Falha ao buscar previstos para violar por dia")
        extra = {"por_turno": _por_turno_violados(rows), "por_dia": _por_dia_violados(rows, previstos_por_dia)}

    return _respond(rows, "chamados_violados", body, extra=extra)


@app.route("/api/analista-detalhe", methods=["POST"])
def analista_detalhe():
    """O roster de "Analistas de Encerramento" é uma lista fixa de nomes da
    caixa Mops Solar — a tela já esconde o botão fora dela, isso aqui é só a
    garantia do lado do servidor caso a rota seja chamada direto."""
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    if caixa_id != CAIXA_SOLAR:
        raise JiraExtractorError('Analistas de Encerramento é uma ação específica da caixa "Mops Solar".')

    config = _config_from_request(body)
    projetos = _projetos_selecionados(body)
    inicio, fim = _parse_periodo(body)

    analista = (body.get("analista") or "").strip()
    if not analista:
        raise JiraExtractorError("Informe o analista.")

    try:
        categoria_field_id = _resolve_categoria_encerramento_field_id(config)
    except Exception:
        app.logger.exception("Falha ao resolver o campo Categoria de Encerramento")
        categoria_field_id = None

    # Obrigatório (não best-effort): `assignee = "Nome"` em JQL não resolve
    # de forma confiável no Cloud quando há ambiguidade de nome — sem o
    # accountId a busca pode voltar zerada/incompleta silenciosamente (foi
    # exatamente o que aconteceu, testado e confirmado direto na API).
    account_id = _resolve_account_id(config, analista)

    resultado = fetch_detalhe_analista(
        config,
        CAIXAS[caixa_id]["grupos"],
        analista,
        inicio,
        fim,
        projetos=projetos,
        categoria_field_id=categoria_field_id,
        account_id=account_id,
    )
    return jsonify(resultado)


@app.route("/api/reabertos", methods=["POST"])
def reabertos():
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    projetos = _projetos_selecionados(body)
    config = dict(_config_from_request(body), jql=_build_base_jql(caixa_id, projetos))
    inicio, fim = _parse_periodo(body)
    rows = fetch_chamados_reabertos(config, inicio, fim, incluir_fornecedor=True)

    extra = None
    if not _is_download(body):
        # Só calcula pra exibição na tela — o download do arquivo não precisa
        # dessa consulta extra (mesma economia já aplicada ao "por_grupo" de
        # "A violar hoje/amanhã").
        total_criados = fetch_total_criados_periodo(config, inicio, fim)
        percentual_reabertura = round(len(rows) / total_criados * 100, 1) if total_criados else 0.0
        extra = {"total_criados_periodo": total_criados, "percentual_reabertura": percentual_reabertura}

    return _respond(rows, "chamados_reabertos", body, extra=extra)


@app.route("/api/report-diario", methods=["POST"])
def report_diario():
    """Chamados com status "Resolvido" no dia atual — mesmo padrão "tabela"
    de Violados/Reabertos, então o ranking "Top Analistas do dia" já sai de
    graça do summary.top_assignees calculado em _respond/_build_summary.
    O detalhamento N1/N2/PROD segue o mesmo esquema best-effort de "A violar":
    sem o campo Grupo Solucionador resolvido, a ação segue normal, só sem
    essas colunas."""
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    projetos = _projetos_selecionados(body)
    config = dict(_config_from_request(body), jql=_build_base_jql(caixa_id, projetos))

    grupo_field_id = None
    try:
        grupo_field_id = _resolve_grupo_field_id(config)
    except Exception:
        app.logger.exception("Falha ao resolver o campo Grupo Solucionador")
        grupo_field_id = None

    rows = fetch_resolvidos_hoje(config, grupo_field_id=grupo_field_id)

    extra = {}
    if grupo_field_id:
        try:
            extra["por_grupo"] = _por_grupo_a_violar(rows, CAIXAS[caixa_id]["grupos"])
        except Exception:
            app.logger.exception("Falha ao agregar chamados por grupo")

    if not _is_download(body):
        # Só calcula pra exibição na tela (mesma economia já aplicada em
        # Reabertos) — o download do arquivo de resolvidos não precisa desses
        # contadores extras. As linhas completas (não só a contagem) vão
        # junto, com as mesmas colunas das ações Reabertos/Violados — o card
        # central usa isso pra abrir a tabela de cada um em collapse.
        hoje = datetime.now(BRAZIL_TZ).date()
        try:
            reabertos_rows = fetch_chamados_reabertos(config, hoje, hoje, incluir_fornecedor=True)
            extra["reabertos_hoje"] = len(reabertos_rows)
            extra["reabertos_hoje_rows"] = reabertos_rows
        except Exception:
            app.logger.exception("Falha ao buscar reabertos hoje")
        try:
            violados_rows = fetch_chamados_violados(config, incluir_fornecedor=True, start_date=hoje, end_date=hoje)
            extra["violados_hoje"] = len(violados_rows)
            extra["violados_hoje_rows"] = violados_rows
        except Exception:
            app.logger.exception("Falha ao buscar violados hoje")

    return _respond(rows, "resolvidos_hoje", body, extra=extra or None)


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


def _parse_periodo_opcional(body):
    """Como _parse_periodo, mas devolve (None, None) quando nenhuma data foi
    informada — usado em ações onde o período é opcional (ex.: Violados,
    modo "Tudo" sem filtro de data)."""
    inicio_str = (body.get("inicio") or "").strip()
    fim_str = (body.get("fim") or "").strip()
    if not inicio_str and not fim_str:
        return None, None
    if bool(inicio_str) != bool(fim_str):
        raise JiraExtractorError("Informe as duas datas (início e fim) ou nenhuma.")
    return _parse_periodo(body)


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


# Categoria de Encerramento de Mops Tv do Futuro traz uma tag no fim do
# nome indicando a plataforma: "... [CLARO TV + APP | ...]" (app) ou
# "... [CLARO TV + | ...]" / "CLARO TV + - ..." (box, sem "APP") —
# confirmado inspecionando nomes reais resolvidos via Jira Assets. Mops
# Solar não tem essa convenção, então só separa quando a caixa é TV.
def _bucket_categoria_tv(categoria):
    texto = (categoria or "").upper()
    if "CLARO TV + APP" in texto:
        return "app"
    if "CLARO TV +" in texto:
        return "box"
    return "outros"


def _dividir_counts_tv(counts):
    baldes = {"app": Counter(), "box": Counter(), "outros": Counter()}
    for categoria, qtd in counts.items():
        baldes[_bucket_categoria_tv(categoria)][categoria] = qtd
    return baldes


def _categorias_payload_tv(counts, total_chamados, top_n):
    baldes = _dividir_counts_tv(counts)
    payload = {
        "app": _categorias_payload(baldes["app"], total_chamados, top_n),
        "box": _categorias_payload(baldes["box"], total_chamados, top_n),
    }
    if baldes["outros"]:
        payload["outros"] = _categorias_payload(baldes["outros"], total_chamados, top_n)
    return payload


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
    montar_payload = _categorias_payload_tv if caixa_id == CAIXA_TV else _categorias_payload
    payload = {}

    if incluir_encerrados:
        counts, total = fetch_categoria_encerrados(config, grupos, inicio, fim, categoria_field_id, projetos=projetos)
        payload["encerrados"] = montar_payload(counts, total, top_n)

    if incluir_reabertos:
        counts, total = fetch_categoria_reabertos(config, grupos, inicio, fim, categoria_field_id, projetos=projetos)
        payload["reabertos"] = montar_payload(counts, total, top_n)

    return jsonify(payload)


@app.route("/api/chamados-ofensor", methods=["POST"])
def chamados_ofensor():
    """"Busca Ofensor": chamados de "Gestão de Problemas" cuja
    "Funcionalidade Ofensores" é a opção escolhida no dropdown, opcionalmente
    refinado por "Nome" (summary) ou "ALM" — um dos dois, nunca os dois. Não
    traz "Categoria Ativa?" — isso é verificado depois, aos poucos, em
    /api/categoria-status-lote (ver comentário lá)."""
    body = request.get_json(silent=True) or {}
    config = _config_from_request(body)
    funcionalidade = (body.get("funcionalidade") or "").strip()
    if not funcionalidade:
        raise JiraExtractorError("Selecione uma Funcionalidade Ofensores.")
    campo_busca = (body.get("campo_busca") or "").strip() or None
    termo = (body.get("termo") or "").strip() or None
    chamados = fetch_chamados_funcionalidade_ofensor(config, funcionalidade, campo_busca=campo_busca, termo=termo)
    return jsonify({"chamados": chamados})


@app.route("/api/chamados-geral", methods=["POST"])
def chamados_geral():
    """"Extração Geral": baixa um Excel com os chamados da Funcionalidade
    Ofensores escolhida (exige Funcionalidade — não deixa exportar o
    projeto "Gestão de Problemas" inteiro sem filtro), opcionalmente
    refinado por "Nome" (summary) ou "ALM". Diferente da Busca Ofensor, não
    mostra nada em tela — só o arquivo pronto no final, então checa
    "Categoria Ativa?" de TODOS os chamados antes de responder (não em
    lotes visíveis; ver enriquecer_todos_com_categoria_status), o que pode
    levar minutos numa Funcionalidade grande (ex.: "PME" tem 424)."""
    body = request.get_json(silent=True) or {}
    config = _config_from_request(body)
    funcionalidade = (body.get("funcionalidade") or "").strip()
    if not funcionalidade:
        raise JiraExtractorError("Selecione uma Funcionalidade Ofensores.")
    campo_busca = (body.get("campo_busca") or "").strip() or None
    termo = (body.get("termo") or "").strip() or None
    chamados = fetch_chamados_funcionalidade_ofensor(config, funcionalidade, campo_busca=campo_busca, termo=termo)
    chamados = enriquecer_todos_com_categoria_status(config, chamados)
    return _send_rows(chamados, "extracao_geral_gestao_problemas", "excel")


@app.route("/api/categoria-status-lote", methods=["POST"])
def categoria_status_lote():
    """"Busca Ofensor": checa, de um LOTE pequeno de chamados por vez (não
    da lista inteira), o Status (Ativo/Inativo) da Categoria de
    Encerramento e a quantidade de chamados encerrados atrelados a essa
    mesma categoria (projeto inteiro, sem o filtro de Funcionalidade da
    busca atual) — o frontend chama isso repetidamente, lote a lote,
    enquanto carrega a tabela aos poucos e filtra por Ativo/Inativo."""
    body = request.get_json(silent=True) or {}
    config = _config_from_request(body)
    nomes = body.get("nomes") or []
    if not isinstance(nomes, list):
        raise JiraExtractorError('"nomes" precisa ser uma lista.')
    status = fetch_status_categoria_lote(config, nomes)
    atrelados = fetch_contagem_atrelados_lote(config, nomes)
    return jsonify({"status": status, "atrelados": atrelados})


@app.route("/api/criados-resolvidos", methods=["POST"])
def criados_resolvidos():
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    config = _config_from_request(body)
    inicio, fim = _parse_periodo(body)
    projetos = _projetos_selecionados(body)

    grupo_field_id = None
    try:
        grupo_field_id = _resolve_grupo_field_id(config)
    except Exception:
        app.logger.exception("Falha ao resolver o campo Grupo Solucionador")

    resultado = fetch_criados_x_resolvidos(
        config, CAIXAS[caixa_id]["grupos"], inicio, fim, projetos=projetos, grupo_field_id=grupo_field_id
    )
    return jsonify(resultado)


@app.route("/api/report-vini", methods=["POST"])
def report_vini():
    """"Report Vini" — específico da caixa Mops Tv do Futuro: consolida num
    resultado só o que hoje é visto espalhado em 3 ações (Criados x
    Resolvidos com TMA/SLA, Reabertos, Categorias de Encerramento) pro
    período escolhido (Data início/fim, igual às outras ações de período —
    não é "hoje" como o Report Diário normal)."""
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    if caixa_id != CAIXA_TV:
        raise JiraExtractorError('"Report Vini" é uma ação específica da caixa "Mops Tv do Futuro".')

    config = _config_from_request(body)
    inicio, fim = _parse_periodo(body)
    if not inicio or not fim:
        raise JiraExtractorError("Informe as duas datas (início e fim).")
    projetos = _projetos_selecionados(body)
    grupos = CAIXAS[caixa_id]["grupos"]

    grupo_field_id = None
    try:
        grupo_field_id = _resolve_grupo_field_id(config)
    except Exception:
        app.logger.exception("Falha ao resolver o campo Grupo Solucionador")

    criados_resolvidos = fetch_criados_x_resolvidos(
        config, grupos, inicio, fim, projetos=projetos, grupo_field_id=grupo_field_id
    )

    config_reabertos = dict(config, jql=_build_base_jql(caixa_id, projetos))
    reabertos_rows = fetch_chamados_reabertos(config_reabertos, inicio, fim, incluir_fornecedor=False)
    total_criados = criados_resolvidos["total_criados"]
    reabertos = {
        "total": len(reabertos_rows),
        "total_criados_periodo": total_criados,
        "percentual": round(len(reabertos_rows) / total_criados * 100, 1) if total_criados else 0.0,
    }

    categoria_field_id = _resolve_categoria_encerramento_field_id(config)
    if not categoria_field_id:
        raise JiraExtractorError('Campo "Categoria de Encerramento" não encontrado no Jira.')
    counts, total_categorizavel = fetch_categoria_encerrados(config, grupos, inicio, fim, categoria_field_id, projetos=projetos)
    categorias_encerrados = _categorias_payload_tv(counts, total_categorizavel, 5)

    return jsonify(
        {
            "criados_resolvidos": criados_resolvidos,
            "reabertos": reabertos,
            "categorias_encerrados": categorias_encerrados,
        }
    )


@app.route("/api/chamados-criticos", methods=["POST"])
def chamados_criticos():
    """COTI (P0/P1/P2) é uma classificação específica da caixa Mops Solar —
    a tela já esconde o botão fora dela, isso aqui é só a garantia do lado
    do servidor caso a rota seja chamada direto."""
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    if caixa_id != CAIXA_SOLAR:
        raise JiraExtractorError('Chamados Críticos (COTI) é uma ação específica da caixa "Mops Solar".')

    config = _config_from_request(body)
    inicio, fim = _parse_periodo(body)
    projetos = _projetos_selecionados(body)

    try:
        nivel_field_id = _resolve_nivel_escalonamento_field_id(config)
    except Exception:
        # Best-effort, mesmo padrão de Categoria de Encerramento/Grupo
        # Solucionador: sem o ID, "Chamados Clarinha" ainda sai com o total
        # certo, só a contagem por nível fica vazia.
        app.logger.exception("Falha ao resolver o campo Nível de Escalonamento")
        nivel_field_id = None

    try:
        responsavel_mops_field_id = _resolve_responsavel_mops_field_id(config)
    except Exception:
        app.logger.exception("Falha ao resolver o campo Responsável pela Solicitação MOPS")
        responsavel_mops_field_id = None

    resultado = fetch_chamados_criticos(
        config,
        CAIXAS[caixa_id]["grupos"],
        inicio,
        fim,
        projetos=projetos,
        nivel_escalonamento_field_id=nivel_field_id,
        responsavel_mops_field_id=responsavel_mops_field_id,
    )
    return jsonify(resultado)


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


@app.route("/api/relatorio-geral-pdf", methods=["POST"])
def relatorio_geral_pdf():
    """Monta o PDF combinado do Relatório Geral a partir das seções já
    calculadas no navegador (cada uma veio de uma chamada anterior a uma das
    rotas /api/* acima) — não refaz nenhuma busca no Jira, só formata o que
    já foi buscado, mesmo padrão de /api/exportar-pdf."""
    body = request.get_json(silent=True) or {}
    secoes = body.get("secoes") or []
    if not secoes:
        raise JiraExtractorError("Nada para exportar.")

    titulo = (body.get("titulo") or "Relatório Geral").strip() or "Relatório Geral"
    # "arquivo" (opcional): outros consumidores dessa mesma rota (ex.: Report
    # Vini) usam um nome de base diferente pro download — sem isso, todo
    # mundo cairia em "relatorio_geral_...", mesmo não sendo esse relatório.
    arquivo_base = (body.get("arquivo") or "relatorio_geral").strip() or "relatorio_geral"

    buf = io.BytesIO()
    export_general_report_pdf(secoes, buf, titulo=titulo)
    buf.seek(0)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return send_file(
        buf, mimetype="application/pdf", as_attachment=True, download_name=f"{arquivo_base}_{timestamp}.pdf"
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

    # threaded=True: a Extração Geral sem filtro pode levar minutos
    # respondendo (checa "Categoria Ativa?" de milhares de chamados antes
    # de montar o Excel) — sem isso, o servidor de dev fica bloqueado pra
    # qualquer outra requisição enquanto isso roda.
    app.run(debug=True, port=5000, threaded=True)
