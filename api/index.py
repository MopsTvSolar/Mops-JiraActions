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

import calendar
import csv
import io
import json
import os
import re
import sqlite3
import sys
import zipfile
from collections import Counter, defaultdict
from contextlib import closing
from datetime import date, datetime, timedelta

from flask import Flask, jsonify, request, send_file
import requests
from openpyxl import Workbook, load_workbook
from werkzeug.exceptions import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from jira_extractor import (  # noqa: E402
    BRAZIL_TZ,
    GRUPO_N1,
    GRUPO_N2,
    GRUPO_PROD,
    JiraExtractorError,
    PROJETO_INC,
    PROJETO_PDST,
    SLA_RESOLUTION_FIELDS,
    export_general_report_pdf,
    extract_eps_subclassificacao,
    extract_fornecedor,
    fetch_categoria_encerrados,
    fetch_chamados_a_violar,
    fetch_chamados_criticos,
    fetch_chamados_geral_classificacao,
    fetch_chamados_por_query,
    fetch_chamados_reabertos,
    fetch_chamados_violados,
    fetch_colaboradores_mes,
    fetch_criados_por_dia_grupo,
    fetch_previstos_violar_por_dia,
    fetch_criados_x_resolvidos,
    fetch_grupo_criacao_mensal,
    fetch_fornecedor_criacao_mensal,
    fetch_reabertos_analitico,
    fetch_resolvidos_encerrados_analitico,
    fetch_resolvidos_hoje_assignees,
    fetch_a_violar_abertos_por_grupo,
    fetch_aguardando_fornecedor_por_grupo,
    fetch_pdst_abertos_por_grupo,
    fetch_total_a_violar_abertos,
    fetch_total_aguardando_fornecedor,
    fetch_total_criados_periodo,
    fetch_total_pdst_abertos,
    fetch_total_violados_abertos,
    fetch_violados_abertos_por_grupo,
    fetch_issues,
    flatten_issue,
    load_fixed_config,
)

# Seg=0 ... Dom=6, casando com date.weekday().
DIAS_SEMANA_ABREV = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
VIOLAR_SEMANAL_DIAS = 7

# Grupos Solucionador fixos (mesmos da GUI) — usados no detalhamento "por
# grupo" dos cards de "a violar hoje/amanhã".
GRUPOS_SOLUCIONADOR = [
    "CLBR-TI-OPS-OGS-SOLAR-SALESFORCE-N2",
    "CLBR-TI-OPS-OGS SOLAR SALESFORCE",
    "CLBR-TI-OPS-PROD SOLAR SALESFORCE",
]

# Só N1/N2 (sem o grupo Prod) — usado pelo "Pareto Solar", que considera
# apenas as duas caixas N1/N2 da Mops Solar.
GRUPOS_SOLUCIONADOR_N1_N2 = [g for g in GRUPOS_SOLUCIONADOR if g != GRUPO_PROD]

# Seletores "Tudo/N1/N2/PROD" (múltipla escolha) de Material ICG — pedido
# explícito do usuário: 1 pra página de indicadores (SLA/Abertos/
# Reabertura, padrão N1+N2) e 1 pro gráfico "Atendimento diário" (padrão
# Tudo), independentes.
MATERIAL_ICG_GRUPOS_MAPA = {"n1": GRUPO_N1, "n2": GRUPO_N2, "prod": GRUPO_PROD}


def _resolver_grupos(selecionados, padrao):
    """"selecionados" (lista de "n1"/"n2"/"prod"/"tudo", do corpo da
    requisição) -> lista de nomes de grupo. "tudo" = os 3 grupos
    (N1+N2+PROD); corpo ausente/vazio ou sem nenhum item válido cai em
    "padrao"."""
    chaves = set(selecionados or [])
    if "tudo" in chaves:
        return list(GRUPOS_SOLUCIONADOR)
    grupos = [MATERIAL_ICG_GRUPOS_MAPA[c] for c in chaves if c in MATERIAL_ICG_GRUPOS_MAPA]
    return grupos or list(padrao)

CAIXA_SOLAR = "solar"
CAIXA_TV = "tv"
CAIXA_PADRAO = CAIXA_SOLAR

GRUPOS_TV = [
    "CLBR-TI-OPS-MOPS TV DO FUTURO",
    "CLBR-TI-OPS-MOPS-TV DO FUTURO N2",
]

# Cada "caixa solucionadora" tem sua lista de grupos, usada tanto para
# montar a JQL geral (grupo + projeto, ver _build_base_jql) quanto no
# detalhamento "por grupo".
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

# Cache local de chamados: cada arquivo é um .xlsx com uma planilha (mesmas
# colunas de "Extração por Query" — ver fetch_chamados_por_query) com os
# chamados de um mês. Só existe/funciona rodando localmente (python
# api/index.py): na Vercel essa pasta não existe, e as rotas /api/cache/*
# respondem com um erro claro em vez de quebrar o deploy. "CACHE_BASE_DIR"
# configurável via variável de ambiente pra não depender do caminho fixo do
# usuário em outra máquina — é a pasta-raiz onde moram as subpastas por
# caixa (Solar/TV, ver CACHE_PARTICOES abaixo).
CACHE_BASE_DIR = os.getenv("CACHE_DIR") or r"C:\Users\edufe\OneDrive\Área de Trabalho\Cache"

# "CACHE_DIR" é a pasta de fato usada pelos dashboards que leem o cache
# Solar direto (Home, Pareto Solar, SLA etc. — sempre com CACHE_DIR
# hardcoded, sem passar pela tela de Cache/_cache_resolve_particao).
# Mora em "CACHE_BASE_DIR/Solar" (o usuário reorganizou as pastas e moveu
# os 10 arquivos reais de Solar pra lá, no mesmo padrão de "CACHE_BASE_DIR/
# TV" que a caixa Tv já usava).
CACHE_DIR = os.path.join(CACHE_BASE_DIR, "Solar")

# Partições da tela de Cache: cada uma é uma CAIXA (decide a JQL usada
# pra achar chamados novos — ver _cache_jql_periodo) + uma pasta PADRÃO
# (só usada quando a tela não manda uma pasta própria — ver
# _cache_resolve_particao abaixo). "solar" é a pasta de sempre (CACHE_DIR);
# "tv" é uma subpasta própria (mesma pasta que "Extração em Lote" já usa
# como destino padrão pros arquivos de Tv gerados na mão). Nunca misturam
# Solar e Tv no mesmo arquivo (foi exatamente esse bug, numa tentativa
# anterior de somar as 2 caixas numa query só, que corrompeu a "data
# corte" da sincronização incremental).
CACHE_PARTICOES = {
    CAIXA_SOLAR: {"id": CAIXA_SOLAR, "label": "Solar", "pasta": CACHE_DIR, "caixa": CAIXA_SOLAR},
    CAIXA_TV: {"id": CAIXA_TV, "label": "Tv", "pasta": os.path.join(CACHE_BASE_DIR, "TV"), "caixa": CAIXA_TV},
}
CACHE_PARTICAO_PADRAO = CAIXA_SOLAR


def _cache_resolve_particao(body):
    """Qual caixa + pasta uma requisição da tela de Cache está usando:
    "caixa" no corpo ("solar"/"tv", decide a JQL de busca de chamados
    novos — ver _cache_jql_periodo) e "pasta" (opcional — caminho absoluto
    local escolhido na própria tela; sem ele, usa a pasta padrão daquela
    caixa, CACHE_PARTICOES[caixa]["pasta"], mesmo comportamento de sempre
    pra quem não manda esse campo). Pasta e caixa são independentes: dá
    pra apontar "solar" pra qualquer pasta, não só a padrão — útil pra
    inspecionar uma cópia/backup sem mexer na pasta real."""
    caixa_id = (body.get("caixa") or body.get("particao") or CACHE_PARTICAO_PADRAO).strip().lower()
    if caixa_id not in CACHE_PARTICOES:
        raise JiraExtractorError(f'Caixa de cache inválida: "{caixa_id}".')
    padrao = CACHE_PARTICOES[caixa_id]
    pasta = (body.get("pasta") or "").strip() or padrao["pasta"]
    return {"id": padrao["id"], "label": padrao["label"], "pasta": pasta, "caixa": padrao["caixa"]}


CACHE_COL_CHAVE = "Número do Chamado"
CACHE_COL_STATUS = "Status"
CACHE_COL_GRUPO = "Grupo Solucionador"
CACHE_STATUS_FECHADOS = {"Encerrado", "Resolvido", "Cancelado", "Reprovado", "Arquivado"}
CACHE_SYNC_META_FILENAME = "_sync_meta.json"
# Nº de chaves por consulta "key IN (...)" na sincronização — evita montar
# uma JQL gigante de uma vez quando a planilha tem muitos chamados abertos.
CACHE_SYNC_LOTE = 150

# Nome do arquivo segue "<mês-abrev>-<ano>.xlsx" (ex.: "out-2026.xlsx") —
# usado só pra ordenar a lista cronologicamente na tela (ordem alfabética
# bagunçaria: "abr" viria antes de "jan").
CACHE_NOME_RE = re.compile(r"^([a-zà-ÿ]{3})-(\d{4})\.xlsx$", re.IGNORECASE)
CACHE_MESES_ABREV = {
    "jan": 1,
    "fev": 2,
    "mar": 3,
    "abr": 4,
    "mai": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "set": 9,
    "out": 10,
    "nov": 11,
    "dez": 12,
}


def _cache_ordenar_chave(nome):
    """Chave de ordenação pra sorted(): (ano, mês, nome) quando o nome bate
    com "<mês-abrev>-<ano>.xlsx" (CACHE_NOME_RE/CACHE_MESES_ABREV) — fora
    desse padrão, ou com abreviação de mês desconhecida, cai no fim da
    lista (ordenado por nome entre si, nunca derruba a tela)."""
    match = CACHE_NOME_RE.match(nome)
    if match:
        mes_num = CACHE_MESES_ABREV.get(match.group(1).lower())
        if mes_num is not None:
            return (0, int(match.group(2)), mes_num, nome)
    return (1, 0, 0, nome)

# Mapeia cada "Grupo Solucionador" (coluna da planilha) de volta pra sua
# caixa (CAIXAS) — usado só pra separar "chamados em aberto" por caixa na
# tela de Cache. GRUPO_PROD entra à parte ("prod", não "solar"): mesmo
# pedido explícito do usuário de ver Prod separado de N1/N2 na tela de
# Cache. Grupo fora dessa lista (ou célula vazia) cai no balde
# CACHE_CAIXA_OUTROS.
CACHE_CAIXA_PROD = "prod"
CACHE_GRUPO_PARA_CAIXA = {grupo: caixa_id for caixa_id, info in CAIXAS.items() for grupo in info["grupos"]}
CACHE_GRUPO_PARA_CAIXA[GRUPO_PROD] = CACHE_CAIXA_PROD
CACHE_CAIXA_OUTROS = "outros"

CACHE_MESES_ABREV_REVERSO = {numero: abrev for abrev, numero in CACHE_MESES_ABREV.items()}

# As mesmas 8 colunas de "Extração por Query" (ver fetch_chamados_por_query)
# + "Violado"/"Já foi Reaberto" (Sim/Não) + "Data de Resolução"
# (resolutiondate bruto do Jira) + "PROP_Site" (EPS) + "Sub-Classificação"
# — essas 5 últimas calculadas à parte (ver
# _cache_violado_reaberto_jira/_cache_resolucao_jira/_cache_eps_sub_jira)
# — é o formato que toda planilha de cache usa, tanto a criada do zero
# (mês novo) quanto as linhas novas acrescentadas numa sincronização.
# Planilhas de antes dessas 5 últimas colunas existirem são migradas na
# hora pelo /api/cache/sincronizar-preparar (_cache_migrar_colunas).
CACHE_COL_CATEGORIA = "Categoria de Encerramento"
CACHE_COL_ALM = "ALM do Ofensor"
CACHE_COL_CLASSIFICACAO = "Classificação"
CACHE_COL_CRIACAO = "Data de Criação"
CACHE_COL_RESPONSAVEL = "Responsável"
CACHE_COL_VIOLADO = "Violado"
CACHE_COL_REABERTO = "Já foi Reaberto"
CACHE_COL_RESOLUCAO = "Data de Resolução"
CACHE_COL_EPS = "PROP_Site"
CACHE_COL_SUBCLASSIFICACAO = "Sub-Classificação"
CACHE_COLUNAS = [
    CACHE_COL_CHAVE,
    CACHE_COL_CATEGORIA,
    CACHE_COL_ALM,
    CACHE_COL_STATUS,
    CACHE_COL_CLASSIFICACAO,
    CACHE_COL_GRUPO,
    CACHE_COL_CRIACAO,
    CACHE_COL_RESPONSAVEL,
    CACHE_COL_VIOLADO,
    CACHE_COL_REABERTO,
    CACHE_COL_RESOLUCAO,
    CACHE_COL_EPS,
    CACHE_COL_SUBCLASSIFICACAO,
]
CACHE_STATUS_RESOLVIDOS = {"Resolvido", "Encerrado"}

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


# Projetos que o usuário pode marcar/desmarcar no painel "PROJETOS".
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


def _build_base_jql_home(caixa_id):
    """Como _build_base_jql, mas só pros widgets da home: o grupo Prod (só
    existe na Solar, GRUPO_PROD) considera só "Abertura de Chamados"; os
    demais grupos (N1/N2) consideram só "Central de Incidentes".

    Projetos fixos, diferente das ações da tela (os cards da home não
    seguem o painel "PROJETOS" escolhido pelo usuário): os grupos N1/N2
    (de qualquer caixa) sempre consideram só "Central de Incidentes"; o
    grupo Prod (só existe na Solar, GRUPO_PROD) sempre considera só
    "Abertura de Chamados" — mesma regra em todos os widgets da home (ver
    também _grupo_projeto_clause em jira_extractor.py, usado por quem
    monta grupos/projetos em vez de JQL pronta).

    Usada pelas rotas que passam config["jql"] pronto pra
    fetch_chamados_a_violar/fetch_chamados_violados em vez de grupos/
    projetos separados (home_violar_semanal, home_classificacao_funil)."""
    grupos = CAIXAS[caixa_id]["grupos"]
    outros_grupos = [g for g in grupos if g != GRUPO_PROD]

    partes = []
    if outros_grupos:
        outros_str = ", ".join(f'"{g}"' for g in outros_grupos)
        partes.append(
            f'("Grupo Solucionador[Group Picker (single group)]" IN ({outros_str}) AND project = "{PROJETO_INC}")'
        )
    if GRUPO_PROD in grupos:
        partes.append(
            f'("Grupo Solucionador[Group Picker (single group)]" = "{GRUPO_PROD}" AND project = "{PROJETO_PDST}")'
        )
    return f"({' OR '.join(partes)})"


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


def _rows_to_excel_bytes_multi(sheets, fieldnames):
    """Como _rows_to_excel_bytes, mas gera VÁRIAS abas — "sheets" é uma
    lista de (nome_da_aba, linhas). Diferente de _rows_to_excel_bytes (que
    infere as colunas de rows[0], exigindo pelo menos 1 linha), aqui as
    colunas ("fieldnames") são fixas e compartilhadas por todas as abas —
    permite gerar uma aba vazia (só cabeçalho) quando não há chamados
    naquele recorte, sem quebrar. Usado por /api/tv-resolvidos-reabertos."""
    wb = Workbook()
    primeira = True
    for nome_aba, linhas in sheets:
        ws = wb.active if primeira else wb.create_sheet()
        primeira = False
        ws.title = nome_aba[:31]  # limite de 31 caracteres do Excel pro nome da aba
        ws.append(fieldnames)
        for row in linhas:
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
TIPO_INCIDENTE_MOPS_FIELD_NAME = "Tipo Incidente MOPS"
CATEGORIA_ENCERRAMENTO_FIELD_NAME = "Categoria de Encerramento"
NIVEL_ESCALONAMENTO_FIELD_NAME = "Nivel de Escalonamento"
RESPONSAVEL_MOPS_FIELD_NAME = "Responsável pela Solicitação MOPS"
SUBCLASSIFICACAO_FIELD_NAME = "Sub-Classificação"
CLASSIFICACAO_FIELD_NAME = "Classificação"
EPS_FIELD_NAME = "PROP_Site"

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

    def _clause_names_normalizadas(campo):
        return {(c or "").strip().strip('"').casefold() for c in (campo.get("clauseNames") or [])}

    # "clauseNames" é a lista que o PRÓPRIO parser de JQL usa pra resolver
    # 'Nome do Campo' dentro de uma cláusula — mais confiável que "name"
    # (só o rótulo de exibição) quando dois campos têm o mesmo rótulo, mas
    # só um deles é o que a JQL realmente aceita nesse texto. Foi
    # exatamente esse o bug com "Classificação" num Jira que tinha 2 campos
    # com esse rótulo: um deles era o campo de ordenação Rank (valores tipo
    # "0|ijnrjj:"), "name" batia nos dois, mas só o campo certo tinha
    # "Classificação" em clauseNames.
    por_clause = [f for f in campos if alvo in _clause_names_normalizadas(f)]
    if por_clause:
        escolhido = por_clause[0]
        if len(por_clause) > 1:
            app.logger.warning(
                'Mais de um campo com "%s" em clauseNames no Jira (%s) — usando %s. '
                "Se for o campo errado, me diga o ID correto.",
                field_name,
                [f["id"] for f in por_clause],
                escolhido["id"],
            )
        field_id = escolhido["id"]
        app.logger.info('Campo "%s" resolvido como %s (via clauseNames).', field_name, field_id)
        _field_id_cache[cache_key] = field_id
        return field_id

    encontrados = [f for f in campos if (f.get("name") or "").strip().casefold() == alvo]
    if encontrados:
        escolhido = encontrados[0]
        if len(encontrados) > 1:
            app.logger.warning(
                'Mais de um campo chamado "%s" no Jira (%s), nenhum batendo por clauseNames — usando %s. '
                "Se for o campo errado, me diga o ID correto.",
                field_name,
                [f["id"] for f in encontrados],
                escolhido["id"],
            )
        field_id = escolhido["id"]
        app.logger.info('Campo "%s" resolvido como %s (via name).', field_name, field_id)
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


def _resolve_tipo_incidente_mops_field_id(config):
    return _resolve_field_id(config, TIPO_INCIDENTE_MOPS_FIELD_NAME)


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


def _resolve_subclassificacao_field_id(config):
    return _resolve_field_id(config, SUBCLASSIFICACAO_FIELD_NAME)


def _resolve_classificacao_field_id(config):
    return _resolve_field_id(config, CLASSIFICACAO_FIELD_NAME)


def _resolve_eps_field_id(config):
    return _resolve_field_id(config, EPS_FIELD_NAME)


def _por_grupo_a_violar(rows, grupos):
    """Para cada grupo da caixa selecionada: quantos chamados do resultado
    pertencem àquele grupo, o ranking de "Top responsáveis" só daquele
    grupo (pra acompanhar a coluna de cada caixa no card, em vez de um
    ranking único combinando todos os grupos), quantos ainda estão sem
    responsável (campo "assignee" vazio) e o detalhamento por status
    (VIOLAR_STATUSES) — usado no hover do quadradinho do dia. Não faz
    nenhuma busca extra no Jira: só agrupa as linhas já retornadas pela
    busca principal (que já vêm com "grupo_solucionador"/"assignee"/"status"
    quando os campos foram resolvidos)."""
    resultado = []
    for grupo in grupos:
        linhas_grupo = [r for r in rows if r.get("grupo_solucionador") == grupo]
        assignee_counts = Counter(r.get("assignee") for r in linhas_grupo if r.get("assignee"))
        sem_responsavel = sum(1 for r in linhas_grupo if not r.get("assignee"))
        status_counts = Counter(r.get("status") for r in linhas_grupo if r.get("status"))
        resultado.append(
            {
                "grupo": grupo,
                "total": len(linhas_grupo),
                "top_assignees": assignee_counts.most_common(TOP_ASSIGNEES_LIMIT),
                "sem_responsavel": sem_responsavel,
                "por_status": status_counts.most_common(),
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


@app.route("/api/home-reabertos-mes", methods=["POST"])
def home_reabertos_mes():
    """Widget da home "Reabertos do mês": % de reabertura, do começo do mês
    atual até hoje. Reaproveita fetch_chamados_reabertos +
    fetch_total_criados_periodo, exatamente a mesma conta já usada na ação
    Reabertos (total de reabertos ÷ total de criados no mesmo período/
    caixa/projetos) — só que com esse período fixo em vez do escolhido
    pelo usuário. Uma seção por caixa (Solar e Claro Tv).

    Projetos fixos — ver nota em _build_base_jql_home. Essa rota já foi
    "SLA + reabertura" junta (home_sla_mes) — o pedaço de SLA virou widget
    à parte, histórico e 100% cache (ver /api/home-sla-cache), então saiu
    daqui (evitava uma consulta ao Jira que não tinha mais consumidor)."""
    body = request.get_json(silent=True) or {}
    hoje = datetime.now(BRAZIL_TZ).date()
    inicio_mes = hoje.replace(day=1)

    caixas_resultado = []
    for caixa_id in CAIXAS:
        config = _config_from_request(body)
        config_reabertos = dict(config, jql=_build_base_jql_home(caixa_id))
        reabertos_rows = fetch_chamados_reabertos(config_reabertos, inicio_mes, hoje)
        total_criados_periodo = fetch_total_criados_periodo(config_reabertos, inicio_mes, hoje)
        percentual_reabertura = (
            round(len(reabertos_rows) / total_criados_periodo * 100, 1) if total_criados_periodo else 0.0
        )

        caixas_resultado.append(
            {
                "caixa": caixa_id,
                "total_reabertos": len(reabertos_rows),
                "total_criados_periodo": total_criados_periodo,
                "percentual_reabertura": percentual_reabertura,
            }
        )

    return jsonify({"inicio": inicio_mes.strftime("%Y-%m-%d"), "fim": hoje.strftime("%Y-%m-%d"), "caixas": caixas_resultado})


@app.route("/api/home-colaboradores-cache", methods=["POST"])
def home_colaboradores_cache():
    """Widget da home "Colaboradores" (tag "Cacheado"): uma coluna por mês
    (Resolvidos/Violados/Reabertos), montada só a partir das planilhas de
    cache locais — não consulta o Jira (ver _cache_colaboradores_mensal).
    Não depende de e-mail/token, mesmo padrão de /api/cache/arquivos; só
    funciona rodando localmente (mesma limitação do resto do /api/cache/*)."""
    return jsonify(_cache_colaboradores_mensal())


def _cache_para_cada_linha(pasta, colunas_necessarias, processar_linha):
    """Varre cada planilha .xlsx de "pasta", linha a linha, chamando
    "processar_linha(valor)" pra cada uma — "valor(coluna)" devolve o
    valor daquela coluna na linha atual. Ignora silenciosamente planilhas
    sem alguma das colunas necessárias (cache desatualizado) ou que falham
    ao abrir (loga e segue pras próximas); "pasta" ausente/inexistente
    também é ignorado em silêncio (não é erro — ex.: a pasta Tv ainda não
    foi criada). Usado pelos widgets "SLA" e "Criados x Resolvidos" da
    home, que precisam varrer a pasta de CADA partição (Solar e Tv têm
    pastas próprias, ver CACHE_PARTICOES — não dá mais pra separar
    Solar/Tv filtrando pelo Grupo Solucionador dentro de uma varredura só
    da pasta de Solar, já que os 2 caches não se misturam mais)."""
    if not pasta or not os.path.isdir(pasta):
        return
    nomes = [n for n in os.listdir(pasta) if n.lower().endswith(".xlsx") and not n.startswith("~$")]
    for nome in nomes:
        try:
            wb = load_workbook(os.path.join(pasta, nome), read_only=True, data_only=True)
        except Exception:
            app.logger.exception('Falha ao ler a planilha de cache "%s"', nome)
            continue
        try:
            ws = wb.active
            linhas = ws.iter_rows(values_only=True)
            header = next(linhas, None)
            if not header or any(c not in header for c in colunas_necessarias):
                continue
            idx = {c: header.index(c) for c in colunas_necessarias}

            for linha in linhas:
                if linha is None or all(v is None for v in linha):
                    continue

                def valor(col, linha=linha):
                    i = idx[col]
                    return linha[i] if i < len(linha) else None

                processar_linha(valor)
        finally:
            wb.close()


def _cache_sla_historico():
    """Widget "SLA" da home: % dentro do prazo de TODOS os meses que
    aparecerem no cache (sem recorte). Réplica do gadget nativo do Jira
    "MOPS SOLAR - ACOMPANHAMENTO SLA (ANALITICO)" (JQL de origem
    confirmada pelo usuário: "resolved >= startOfMonth() AND resolved <=
    endOfMonth() AND project IN (...) AND \"Grupo Solucionador[...]\" IN
    (...) AND status != \"Cancelado\""), só que usando o cache em vez do
    Jira ao vivo e sem recorte de mês (histórico): bucket pelo mês da
    "Data de Resolução" (não pelo mês do arquivo — "resolved" na JQL é a
    data de resolução, não a de criação) e status != "Cancelado" (entra
    Resolvido/Encerrado/Reprovado/Arquivado — só Cancelado fica de fora,
    mais amplo que CACHE_STATUS_RESOLVIDOS). "Violado" == "N/A" (chamado
    sem o campo de SLA que o gadget usa, CACHE_SLA_FIELD_PRINCIPAL — ver
    _cache_violado_reaberto_jira) não entra na conta nem como dentro nem
    como fora do prazo, mesmo critério do gadget (que também os exclui do
    gráfico). Geral por caixa, sem separar por grupo (pedido explícito do
    usuário): Solar é N1+N2+Prod juntos (1 gráfico por mês,
    GRUPOS_SOLUCIONADOR, nos 2 projetos — a JQL de origem não restringe
    projeto por grupo); Claro Tv é N1+N2 juntos (GRUPOS_TV) — cada caixa
    lida da PRÓPRIA pasta (CACHE_PARTICOES), não dá mais pra achar Tv
    dentro da pasta de Solar (ver _cache_para_cada_linha)."""
    pasta_solar = CACHE_PARTICOES[CAIXA_SOLAR]["pasta"]
    pasta_tv = CACHE_PARTICOES[CAIXA_TV]["pasta"]
    if not os.path.isdir(pasta_solar):
        raise JiraExtractorError(f'Pasta de cache não encontrada neste ambiente: "{pasta_solar}".')

    contagem_solar = defaultdict(lambda: {"dentro": 0, "fora": 0})
    contagem_tv = defaultdict(lambda: {"dentro": 0, "fora": 0})
    colunas_necessarias = (CACHE_COL_STATUS, CACHE_COL_GRUPO, CACHE_COL_VIOLADO, CACHE_COL_RESOLUCAO)

    def processar(valor, grupos_aceitos, bucket_por_mes):
        if valor(CACHE_COL_GRUPO) not in grupos_aceitos:
            return
        if valor(CACHE_COL_STATUS) == "Cancelado":
            return
        violado_valor = valor(CACHE_COL_VIOLADO)
        if violado_valor == "N/A":
            return
        resolucao = _cache_parse_data_iso(valor(CACHE_COL_RESOLUCAO))
        if not resolucao:
            return
        chave = f"{resolucao.year:04d}-{resolucao.month:02d}"
        bucket_por_mes[chave]["fora" if violado_valor == "Sim" else "dentro"] += 1

    _cache_para_cada_linha(pasta_solar, colunas_necessarias, lambda valor: processar(valor, GRUPOS_SOLUCIONADOR, contagem_solar))
    _cache_para_cada_linha(pasta_tv, colunas_necessarias, lambda valor: processar(valor, GRUPOS_TV, contagem_tv))

    todos_os_meses = sorted(set(contagem_solar.keys()) | set(contagem_tv.keys()))

    def montar_linha(bucket_por_mes):
        linhas = []
        for chave in todos_os_meses:
            b = bucket_por_mes.get(chave, {"dentro": 0, "fora": 0})
            total = b["dentro"] + b["fora"]
            percentual = round(b["dentro"] / total * 100, 1) if total else 0.0
            linhas.append(
                {"mes": chave, "dentro_prazo": b["dentro"], "fora_prazo": b["fora"], "percentual_dentro_prazo": percentual}
            )
        return linhas

    return {
        "meses": todos_os_meses,
        "solar": montar_linha(contagem_solar),
        "tv": montar_linha(contagem_tv),
    }


@app.route("/api/home-sla-cache", methods=["POST"])
def home_sla_cache():
    """Widget da home "SLA" (tag "Cacheado"): histórico de todos os meses,
    % dentro do prazo por grupo, montado só a partir das planilhas de
    cache locais — não consulta o Jira (ver _cache_sla_historico). Não
    depende de e-mail/token, mesmo padrão de /api/home-colaboradores-cache;
    só funciona rodando localmente."""
    return jsonify(_cache_sla_historico())


def _cache_criados_resolvidos_historico():
    """Widget da home "Criados x Resolvidos por mês" (tag "Cacheado"):
    histórico de TODOS os meses do cache, por caixa (Solar: N1+N2+Prod
    juntos, GRUPOS_SOLUCIONADOR; Claro Tv: N1+N2 juntos, GRUPOS_TV — mesmo
    agrupamento "geral por caixa" do widget "SLA" acima, exposto separado
    em vez de somado, pra alimentar o seletor de caixa do painel), cada
    caixa lida da PRÓPRIA pasta (CACHE_PARTICOES, ver
    _cache_para_cada_linha). "criados" é todo chamado da caixa, qualquer
    status, pelo mês da "Data de Criação"; "resolvidos" é só status em
    CACHE_STATUS_RESOLVIDOS (Resolvido/Encerrado), pelo mês da "Data de
    Resolução"; "reabertos" é todo chamado com CACHE_COL_REABERTO == "Sim",
    pelo mês da "Data de Criação" (mesmo bucket de "criados" — usado pelo
    gráfico "Índice de reabertura" de Material ICG, ver carregarMaterialIcg
    em app.js)."""
    pasta_solar = CACHE_PARTICOES[CAIXA_SOLAR]["pasta"]
    pasta_tv = CACHE_PARTICOES[CAIXA_TV]["pasta"]
    if not os.path.isdir(pasta_solar):
        raise JiraExtractorError(f'Pasta de cache não encontrada neste ambiente: "{pasta_solar}".')

    criados_solar = defaultdict(int)
    resolvidos_solar = defaultdict(int)
    reabertos_solar = defaultdict(int)
    criados_tv = defaultdict(int)
    resolvidos_tv = defaultdict(int)
    reabertos_tv = defaultdict(int)
    colunas_necessarias = (CACHE_COL_STATUS, CACHE_COL_GRUPO, CACHE_COL_CRIACAO, CACHE_COL_RESOLUCAO, CACHE_COL_REABERTO)

    def processar(valor, grupos_aceitos, criados_por_mes, resolvidos_por_mes, reabertos_por_mes):
        if valor(CACHE_COL_GRUPO) not in grupos_aceitos:
            return
        criacao = _cache_parse_data_iso(valor(CACHE_COL_CRIACAO))
        if criacao:
            chave_criacao = f"{criacao.year:04d}-{criacao.month:02d}"
            criados_por_mes[chave_criacao] += 1
            if valor(CACHE_COL_REABERTO) == "Sim":
                reabertos_por_mes[chave_criacao] += 1
        if valor(CACHE_COL_STATUS) in CACHE_STATUS_RESOLVIDOS:
            resolucao = _cache_parse_data_iso(valor(CACHE_COL_RESOLUCAO))
            if resolucao:
                resolvidos_por_mes[f"{resolucao.year:04d}-{resolucao.month:02d}"] += 1

    _cache_para_cada_linha(
        pasta_solar,
        colunas_necessarias,
        lambda valor: processar(valor, GRUPOS_SOLUCIONADOR, criados_solar, resolvidos_solar, reabertos_solar),
    )
    _cache_para_cada_linha(
        pasta_tv, colunas_necessarias, lambda valor: processar(valor, GRUPOS_TV, criados_tv, resolvidos_tv, reabertos_tv)
    )

    todos_os_meses = sorted(set(criados_solar) | set(resolvidos_solar) | set(criados_tv) | set(resolvidos_tv))

    def montar_linhas(criados_por_mes, resolvidos_por_mes, reabertos_por_mes):
        return [
            {
                "mes": chave,
                "criados": criados_por_mes.get(chave, 0),
                "resolvidos": resolvidos_por_mes.get(chave, 0),
                "reabertos": reabertos_por_mes.get(chave, 0),
            }
            for chave in todos_os_meses
        ]

    return {
        "meses": todos_os_meses,
        "caixas": {
            CAIXA_SOLAR: montar_linhas(criados_solar, resolvidos_solar, reabertos_solar),
            CAIXA_TV: montar_linhas(criados_tv, resolvidos_tv, reabertos_tv),
        },
    }


@app.route("/api/home-criados-resolvidos-cache", methods=["POST"])
def home_criados_resolvidos_cache():
    """Widget da home "Criados x Resolvidos por mês" (tag "Cacheado"):
    histórico de todos os meses, montado só a partir das planilhas de
    cache locais — não consulta o Jira (ver
    _cache_criados_resolvidos_historico). Não depende de e-mail/token,
    mesmo padrão de /api/home-sla-cache; só funciona rodando localmente."""
    return jsonify(_cache_criados_resolvidos_historico())


@app.route("/api/home-coti-mes", methods=["POST"])
def home_coti_mes():
    """Widget da home: os mesmos 4 cards de COTI (P0/P1/P2) da ação
    "Chamados Críticos" (fetch_chamados_criticos), do começo do mês atual
    até hoje. COTI é uma classificação específica da caixa Mops Solar (sem
    equivalente na Claro Tv, mesma regra da ação original), então essa
    carta só tem uma seção — não usa o padrão de "as duas caixas" do resto
    da home.

    N1/N2 sempre só "Central de Incidentes", Prod só "Abertura de
    Chamados" — ver nota em _build_base_jql_home."""
    body = request.get_json(silent=True) or {}
    projetos = [PROJETO_INC]
    hoje = datetime.now(BRAZIL_TZ).date()
    inicio_mes = hoje.replace(day=1)

    config = _config_from_request(body)
    resultado = fetch_chamados_criticos(
        config, CAIXAS[CAIXA_SOLAR]["grupos"], inicio_mes, hoje, projetos=projetos, prod_projetos=[PROJETO_PDST]
    )

    return jsonify(
        {
            "inicio": inicio_mes.strftime("%Y-%m-%d"),
            "fim": hoje.strftime("%Y-%m-%d"),
            "total_criticos_abertos": resultado["total_criticos_abertos"],
            "total_criticos_atual": resultado["total_criticos_atual"],
            "total_pontuais": resultado["total_pontuais"],
            "percentual_pontuais": resultado["percentual_pontuais"],
            "percentual_criticos": resultado["percentual_criticos"],
            "total_criados": resultado["total_criados"],
        }
    )


@app.route("/api/home-classificacao-funil", methods=["POST"])
def home_classificacao_funil():
    """Widget da home: funil de Classificação — top 5 valores de
    "Classificação" com mais chamados criados (Análise de Jornada, modo
    "Geral" — fetch_chamados_geral_classificacao + ranking igual ao de
    lá, só que limitado ao top 5), do começo do mês atual até hoje. Cada
    item do ranking já traz "por_subclassificacao": top 5 valores de
    "Sub-Classificação" dentro dessa Classificação (mesmo mecanismo de
    Análise de Jornada), pro hover da tela. Uma seção por caixa (Solar e
    Claro Tv), cada uma com os próprios campos resolvidos (best-effort:
    sem "Classificação", a caixa sai com o funil vazio; sem
    "Sub-Classificação", cada item sai com "por_subclassificacao" vazio —
    nenhum dos dois quebra a outra caixa).

    N1/N2 sempre só "Central de Incidentes", Prod só "Abertura de
    Chamados" — ver nota em _build_base_jql_home."""
    body = request.get_json(silent=True) or {}
    hoje = datetime.now(BRAZIL_TZ).date()
    inicio_mes = hoje.replace(day=1)

    caixas_resultado = []
    for caixa_id in CAIXAS:
        config = dict(_config_from_request(body), jql=_build_base_jql_home(caixa_id))

        try:
            classificacao_field_id = _resolve_classificacao_field_id(config)
        except Exception:
            app.logger.exception("Falha ao resolver o campo Classificação")
            classificacao_field_id = None

        try:
            subclassificacao_field_id = _resolve_subclassificacao_field_id(config)
        except Exception:
            app.logger.exception("Falha ao resolver o campo Sub-Classificação")
            subclassificacao_field_id = None

        ranking = []
        if classificacao_field_id:
            rows = fetch_chamados_geral_classificacao(
                config, inicio_mes, hoje, classificacao_field_id, subclassificacao_field_id=subclassificacao_field_id
            )
            totais = Counter(r.get("classificacao") for r in rows if r.get("classificacao"))
            top5 = totais.most_common(5)

            sub_por_classificacao = {}
            if subclassificacao_field_id:
                for r in rows:
                    c, sub = r.get("classificacao"), r.get("sub_classificacao")
                    if c and sub:
                        sub_por_classificacao.setdefault(c, Counter())[sub] += 1

            ranking = [
                {
                    "classificacao": c,
                    "total": total,
                    "por_subclassificacao": [
                        {"sub_classificacao": sub, "total": sub_total}
                        for sub, sub_total in sub_por_classificacao.get(c, Counter()).most_common(5)
                    ],
                }
                for c, total in top5
            ]

        caixas_resultado.append({"caixa": caixa_id, "ranking": ranking})

    return jsonify({"inicio": inicio_mes.strftime("%Y-%m-%d"), "fim": hoje.strftime("%Y-%m-%d"), "caixas": caixas_resultado})


@app.route("/api/home-grupo-criacao", methods=["POST"])
def home_grupo_criacao():
    """Widget da home: réplica de um gadget de dashboard nativo do Jira
    (Grupo Solucionador × mês de criação) — entre os chamados atualmente
    abertos, quantos foram criados em cada mês, por grupo. Mostra as duas
    caixas de uma vez (não depende do alternador Solar/Claro Tv) — cada
    caixa usa seus próprios grupos (CAIXAS[caixa]["grupos"]: 3 pra Solar, 2
    pra Claro Tv), então o resultado já "respeita as regras" de cada uma
    sozinho.

    N1/N2 sempre só "Central de Incidentes", Prod só "Abertura de
    Chamados" — ver nota em _build_base_jql_home."""
    body = request.get_json(silent=True) or {}
    config = _config_from_request(body)

    try:
        grupo_field_id = _resolve_grupo_field_id(config)
    except Exception:
        app.logger.exception("Falha ao resolver o campo Grupo Solucionador")
        raise JiraExtractorError('Campo "Grupo Solucionador" não encontrado no Jira.')

    caixas_resultado = [
        dict(
            caixa=caixa_id,
            **fetch_grupo_criacao_mensal(
                config, CAIXAS[caixa_id]["grupos"], grupo_field_id, prod_projetos=[PROJETO_PDST]
            ),
        )
        for caixa_id in CAIXAS
    ]
    return jsonify({"caixas": caixas_resultado})


@app.route("/api/home-fornecedor-criacao", methods=["POST"])
def home_fornecedor_criacao():
    """Widget da home: réplica de um gadget de dashboard nativo do Jira
    (Fornecedor Responsável × mês de criação) — entre os chamados
    atualmente em "Aguardando Fornecedor", quantos foram criados em cada
    mês, por Fornecedor Responsável (extract_fornecedor). Mostra as duas
    caixas de uma vez, mesmo padrão de home_grupo_criacao.

    N1/N2 sempre só "Central de Incidentes", Prod só "Abertura de
    Chamados" — ver nota em _build_base_jql_home."""
    body = request.get_json(silent=True) or {}
    config = _config_from_request(body)

    caixas_resultado = [
        dict(
            caixa=caixa_id,
            **fetch_fornecedor_criacao_mensal(
                config, CAIXAS[caixa_id]["grupos"], projetos=[PROJETO_INC], prod_projetos=[PROJETO_PDST]
            ),
        )
        for caixa_id in CAIXAS
    ]
    return jsonify({"caixas": caixas_resultado})


@app.route("/api/home-criados-mes", methods=["POST"])
def home_criados_mes():
    """Widget da home "Chamados Criados": um quadradinho por dia (do começo
    do mês atual até hoje) e por grupo (N1/N2/PROD pra Solar, N1/N2 pra
    Claro Tv) — mesmo estilo visual de "A violar". O número em evidência é
    o total de chamados criados naquele dia; embaixo, menor, quantos desses
    já foram P0/P1/P2 em algum momento (fetch_criados_por_dia_grupo).

    N1/N2 sempre só "Central de Incidentes", Prod só "Abertura de
    Chamados" — ver nota em _build_base_jql_home."""
    body = request.get_json(silent=True) or {}
    projetos = [PROJETO_INC]
    hoje = datetime.now(BRAZIL_TZ).date()
    inicio_mes = hoje.replace(day=1)

    caixas_resultado = []
    for caixa_id in CAIXAS:
        config = _config_from_request(body)
        grupos = CAIXAS[caixa_id]["grupos"]

        try:
            grupo_field_id = _resolve_grupo_field_id(config)
        except Exception:
            app.logger.exception("Falha ao resolver o campo Grupo Solucionador")
            grupo_field_id = None

        dias = []
        if grupo_field_id:
            total_por_dia_grupo, p0p1p2_por_dia_grupo = fetch_criados_por_dia_grupo(
                config, grupos, inicio_mes, hoje, grupo_field_id, projetos=projetos, prod_projetos=[PROJETO_PDST]
            )
            dia_atual = inicio_mes
            while dia_atual <= hoje:
                chave = dia_atual.strftime("%Y-%m-%d")
                por_grupo = [
                    {
                        "grupo": grupo,
                        "total": total_por_dia_grupo.get((chave, grupo), 0),
                        "p0p1p2": p0p1p2_por_dia_grupo.get((chave, grupo), 0),
                    }
                    for grupo in grupos
                ]
                dias.append(
                    {"data": chave, "dia_semana": DIAS_SEMANA_ABREV[dia_atual.weekday()], "por_grupo": por_grupo}
                )
                dia_atual += timedelta(days=1)

        caixas_resultado.append({"caixa": caixa_id, "dias": dias})

    return jsonify({"inicio": inicio_mes.strftime("%Y-%m-%d"), "fim": hoje.strftime("%Y-%m-%d"), "caixas": caixas_resultado})


@app.route("/api/home-violar-semanal", methods=["POST"])
def home_violar_semanal():
    """Widget da home: "A violar" dos próximos 7 dias, uma linha por caixa
    (Solar e Claro Tv) de uma vez — mesma lógica de "Plano semanal"
    (fetch_chamados_a_violar), incluindo o detalhamento por grupo
    (_por_grupo_a_violar) pro quadradinho mostrar N1/N2/PROD — Claro Tv só
    tem N1/N2 (CAIXAS["tv"]["grupos"] não tem "Prod"), então o
    detalhamento sai automaticamente correto pra cada caixa. Também traz,
    em "extra_por_grupo", os mesmos 4 contadores do card "Violados —
    Quantidade atual sem solução" ("a_violar", "violados",
    "aguardando_fornecedor", "pdst"), cada um detalhado por grupo (N1/N2/
    PROD pra Solar, N1/N2 pra Claro Tv — 1 coluna por grupo na tela, 4
    cards empilhados em cada). Sem o campo Grupo Solucionador, cai pra um
    único grupo "Total" em cada (mesmo fallback de
    fetch_violados_abertos_por_grupo).

    N1/N2 sempre só "Central de Incidentes", Prod só "Abertura de
    Chamados" — ver nota em _build_base_jql_home."""
    body = request.get_json(silent=True) or {}
    hoje = datetime.now(BRAZIL_TZ).date()

    caixas_resultado = []
    for caixa_id in CAIXAS:
        config = dict(_config_from_request(body), jql=_build_base_jql_home(caixa_id))
        grupos = CAIXAS[caixa_id]["grupos"]

        grupo_field_id = None
        try:
            grupo_field_id = _resolve_grupo_field_id(config)
        except Exception:
            # Best-effort, mesmo padrão do "Plano semanal": sem esse campo,
            # os dias saem sem o detalhamento por grupo, não quebra.
            app.logger.exception("Falha ao resolver o campo Grupo Solucionador")
            grupo_field_id = None

        if grupo_field_id:
            extra_por_grupo = {
                "a_violar": fetch_a_violar_abertos_por_grupo(config, grupos, grupo_field_id),
                "violados": fetch_violados_abertos_por_grupo(config, grupos, grupo_field_id),
                "aguardando_fornecedor": fetch_aguardando_fornecedor_por_grupo(config, grupos, grupo_field_id),
                "pdst": fetch_pdst_abertos_por_grupo(config, grupos, grupo_field_id),
            }
        else:
            extra_por_grupo = {
                "a_violar": [{"grupo": None, "total": fetch_total_a_violar_abertos(config)}],
                "violados": [{"grupo": None, "total": fetch_total_violados_abertos(config)}],
                "aguardando_fornecedor": [{"grupo": None, "total": fetch_total_aguardando_fornecedor(config)}],
                "pdst": [{"grupo": None, "total": fetch_total_pdst_abertos(config)}],
            }

        dias = []
        for offset in range(VIOLAR_SEMANAL_DIAS):
            data = hoje + timedelta(days=offset)
            rows = fetch_chamados_a_violar(config, days_ahead=offset, grupo_field_id=grupo_field_id)
            dia_info = {
                "data": data.strftime("%Y-%m-%d"),
                "dia_semana": DIAS_SEMANA_ABREV[data.weekday()],
                "total": len(rows),
            }
            if grupo_field_id:
                dia_info["por_grupo"] = _por_grupo_a_violar(rows, grupos)
            dias.append(dia_info)
        caixas_resultado.append({"caixa": caixa_id, "extra_por_grupo": extra_por_grupo, "dias": dias})

    return jsonify({"caixas": caixas_resultado})


# Pasta de destino pré-selecionada na tela de "Extração em Lote" — mesma
# pasta de Cache, numa subpasta "TV" (pedido do usuário: gerar o cache de
# Tv manualmente, 1 arquivo por mês, em vez do cache automático).
EXTRACAO_LOTE_PASTA_PADRAO = os.path.join(CACHE_BASE_DIR, "TV")

# Nº de chamados por lote em "Extração em Lote" (preenchimento das colunas
# calculadas) — mesmo valor/motivo de CACHE_SYNC_LOTE: evita consultas
# gigantes de uma vez só, que é exatamente o que vinha causando timeout em
# "Extração por Query" pra JQLs grandes/sem recorte de data.
EXTRACAO_LOTE_TAMANHO = CACHE_SYNC_LOTE


@app.route("/api/extracao-lote/preparar", methods=["POST"])
def extracao_lote_preparar():
    """1º passo de "Extração em Lote": roda a JQL de 1 query da lista
    (fetch_chamados_por_query — as 8 colunas base, sem as 5 calculadas
    ainda) e devolve as linhas + o tamanho de lote esperado. A tela divide
    as chaves dessas linhas em lotes de
    EXTRACAO_LOTE_TAMANHO e manda um de cada vez pra
    /api/extracao-lote/lote, preenchendo as colunas calculadas aos poucos
    — mesmo motivo/padrão de /api/cache/sincronizar-preparar: não deixar
    uma JQL grande numa única requisição gigante (timeout)."""
    body = request.get_json(silent=True) or {}
    config = _config_from_request(body)
    jql = (body.get("jql") or "").strip()
    if not jql:
        raise JiraExtractorError("Informe a JQL.")

    categoria_field_id = _resolve_categoria_encerramento_field_id(config)
    if not categoria_field_id:
        raise JiraExtractorError('Campo "Categoria de Encerramento" não encontrado no Jira.')
    classificacao_field_id = _resolve_classificacao_field_id(config)
    if not classificacao_field_id:
        raise JiraExtractorError('Campo "Classificação" não encontrado no Jira.')
    try:
        grupo_field_id = _resolve_grupo_field_id(config)
    except Exception:
        app.logger.exception("Falha ao resolver o campo Grupo Solucionador")
        grupo_field_id = None

    linhas = fetch_chamados_por_query(config, jql, categoria_field_id, classificacao_field_id, grupo_field_id)
    return jsonify({"linhas": linhas, "lote": EXTRACAO_LOTE_TAMANHO})


@app.route("/api/extracao-lote/lote", methods=["POST"])
def extracao_lote_lote():
    """2º passo (chamado repetidas vezes, um lote de até
    EXTRACAO_LOTE_TAMANHO chaves por vez — ver extracao_lote_preparar):
    calcula as 5 colunas calculadas do cache (Violado/Já foi Reaberto/Data
    de Resolução/PROP_Site/Sub-Classificação) só pras chaves desse lote —
    mesma lógica de _cache_adicionar_colunas_calculadas, só que devolvendo
    por chave em vez de mutar uma lista de linhas inteira de uma vez."""
    body = request.get_json(silent=True) or {}
    config = _config_from_request(body)
    chaves = body.get("chaves") or []
    if not isinstance(chaves, list) or not chaves:
        raise JiraExtractorError('"chaves" precisa ser uma lista não vazia.')
    if len(chaves) > EXTRACAO_LOTE_TAMANHO:
        raise JiraExtractorError(f"Lote maior que o permitido (máximo {EXTRACAO_LOTE_TAMANHO}).")

    info_por_chave = _cache_violado_reaberto_jira(config, chaves)
    resolucao_por_chave = _cache_resolucao_jira(config, chaves)
    eps_sub_por_chave = _cache_eps_sub_jira(config, chaves)

    resultados = {}
    for chave in chaves:
        info = info_por_chave.get(chave, {})
        eps_sub = eps_sub_por_chave.get(chave, {})
        resultados[chave] = {
            CACHE_COL_VIOLADO: info.get("violado"),
            CACHE_COL_REABERTO: info.get("reaberto"),
            CACHE_COL_RESOLUCAO: resolucao_por_chave.get(chave),
            CACHE_COL_EPS: eps_sub.get("eps"),
            CACHE_COL_SUBCLASSIFICACAO: eps_sub.get("subclassificacao"),
        }
    return jsonify({"resultados": resultados})


@app.route("/api/extracao-lote/salvar", methods=["POST"])
def extracao_lote_salvar():
    """3º e último passo: grava as linhas já montadas (base + calculadas,
    vindas prontas da tela — nenhuma consulta ao Jira aqui) num arquivo
    novo dentro de "pasta" (cria a pasta se não existir). Só roda
    localmente, mesma limitação de /api/cache/*: em ambientes sem sistema
    de arquivos gravável (ex.: Vercel), falha com um erro claro em vez de
    derrubar o deploy.

    "formato" ("xlsx", padrão, ou "csv") decide a extensão/o jeito de
    escrever — "nome_arquivo" é saneado (sem separador de caminho, e
    sempre troca/completa pra extensão de "formato", mesmo que o usuário
    tenha digitado outra) pra não permitir escrever fora de "pasta" só
    manipulando o nome, nem gerar um arquivo com extensão que não bate com
    o conteúdo. "pasta" em si não tem essa restrição (é um caminho
    absoluto local escolhido na própria tela, mesmo nível de confiança do
    CACHE_DIR)."""
    body = request.get_json(silent=True) or {}
    pasta = (body.get("pasta") or "").strip() or EXTRACAO_LOTE_PASTA_PADRAO
    nome_arquivo = (body.get("nome_arquivo") or "").strip()
    linhas = body.get("linhas") or []
    formato = (body.get("formato") or "xlsx").strip().lower()
    if formato not in ("xlsx", "csv"):
        formato = "xlsx"

    if not nome_arquivo:
        raise JiraExtractorError("Informe o nome do arquivo.")
    nome_arquivo = os.path.basename(nome_arquivo)
    nome_arquivo = re.sub(r"\.(xlsx|csv)$", "", nome_arquivo, flags=re.IGNORECASE)
    nome_arquivo += f".{formato}"
    if not linhas:
        raise JiraExtractorError(f'Nenhum chamado encontrado — "{nome_arquivo}" não foi salvo.')

    try:
        os.makedirs(pasta, exist_ok=True)
    except OSError as e:
        raise JiraExtractorError(f'Não foi possível criar/acessar a pasta "{pasta}": {e}')

    caminho = os.path.join(pasta, nome_arquivo)
    try:
        if formato == "csv":
            with open(caminho, "wb") as f:
                f.write(_rows_to_csv_bytes([{c: linha.get(c) for c in CACHE_COLUNAS} for linha in linhas]))
        else:
            wb = Workbook()
            ws = wb.active
            ws.append(CACHE_COLUNAS)
            for linha in linhas:
                ws.append([linha.get(c) for c in CACHE_COLUNAS])
            wb.save(caminho)
    except OSError as e:
        raise JiraExtractorError(f'Não foi possível salvar "{caminho}": {e}')

    return jsonify({"pasta": pasta, "nome_arquivo": nome_arquivo, "caminho": caminho, "total": len(linhas)})


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



@app.route("/api/colaboradores", methods=["POST"])
def colaboradores():
    """Ação "Colaboradores": mesma tabela por colaborador (Resolvidos,
    Violados, Reabertos, % dentro do prazo) do widget da home
    (fetch_colaboradores_mes), mas com período/caixa/projetos escolhidos
    pelo usuário em vez do mês atual fixo com os dois de uma vez — mesmo
    padrão de reabertos/analise_jornada."""
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    projetos = _projetos_selecionados(body)
    config = _config_from_request(body)
    inicio, fim = _parse_periodo(body)
    linhas = fetch_colaboradores_mes(config, CAIXAS[caixa_id]["grupos"], inicio, fim, projetos=projetos)

    return jsonify({"inicio": inicio.strftime("%Y-%m-%d"), "fim": fim.strftime("%Y-%m-%d"), "colaboradores": linhas})


# Mostrar as >500 categorias distintas que aparecem num mês não ajuda em
# nada (Pareto é sobre achar os "poucos vitais") — só as top N entram como
# barra própria (o resto fica de fora do gráfico). Cada campo tem seu
# próprio N, mesmo valor nos 2 por pedido explícito do usuário.
PARETO_SOLAR_TOP_N = {
    "classificacao": 15,
    "categoria": 15,
    "categoria_reaberto": 15,
    "fornecedor": 15,
}

# "Categoria de Encerramento" (as 2 variantes, geral e só-reabertos) só
# considera chamados do projeto "Central de Incidentes" (chave "INC-...")
# — pedido explicitamente pelo usuário; "Classificação" continua
# considerando as 2 caixas (INC + PDST).
PARETO_SOLAR_PROJETO_PREFIXO = {"categoria": "INC", "categoria_reaberto": "INC"}

# Campos que só entram no carrossel quando o chamado já foi reaberto
# (CACHE_COL_REABERTO == "Sim") — 3º carrossel do Pareto Solar, pedido
# explicitamente pelo usuário: mesma "Categoria de Encerramento", mas só
# da fatia que reabriu.
PARETO_SOLAR_SOMENTE_REABERTO = {"categoria_reaberto"}


def _pareto_payload(counts, total_chamados, top_n):
    """Top N categorias (maior pro menor, já com percentual acumulado) —
    base do Pareto Solar. Sem "Outros": só as top N aparecem (pedido
    explícito do usuário pra tirar o bucket de "o resto" dos 2 gráficos) —
    o percentual/acumulado de cada uma continua relativo ao total de
    chamados categorizados (não só à soma das top N), então o acumulado da
    última barra não necessariamente fecha em 100%."""
    mais_comuns = counts.most_common()
    top = mais_comuns[:top_n]
    total_categorizados = sum(qtd for _, qtd in mais_comuns)

    categorias = []
    acumulado = 0.0
    for categoria, qtd in top:
        pct = round(qtd / total_categorizados * 100, 1) if total_categorizados else 0.0
        acumulado += pct
        categorias.append(
            {"categoria": categoria, "quantidade": qtd, "percentual": pct, "percentual_acumulado": round(acumulado, 1)}
        )

    return {
        "total_chamados": total_chamados,
        "total_categorizados": total_categorizados,
        "categorias": categorias,
    }


# Os 3 campos que o "Pareto Solar" mostra (1 carrossel pra cada) — chave
# curta usada na resposta JSON, valor é a coluna real da planilha de cache.
PARETO_SOLAR_CAMPOS = {
    "classificacao": CACHE_COL_CLASSIFICACAO,
    "categoria": CACHE_COL_CATEGORIA,
    "categoria_reaberto": CACHE_COL_CATEGORIA,
}


@app.route("/api/pareto-solar", methods=["POST"])
def pareto_solar():
    """"Pareto Solar": Pareto de "Classificação", de "Categoria de
    Encerramento" e de "Categoria de Encerramento" só dos reabertos (3
    carrosséis no front, todos na mesma resposta pra não duplicar a
    varredura do cache) de TODOS os meses que aparecem no cache — um
    gráfico por mês, do mais antigo pro mais recente (pedido explícito do
    usuário: "deve trazer todos os meses", não só os últimos 3). Só os
    grupos N1/N2 da Mops Solar (GRUPOS_SOLUCIONADOR_N1_N2, sem o grupo
    Prod). Lê só as planilhas de cache local (nenhuma consulta ao Jira na
    hora, nem credenciais — mesmo padrão do widget "Colaboradores" da
    home/_cache_colaboradores_mensal): "encerrado" aqui é status Resolvido
    ou Encerrado (CACHE_STATUS_RESOLVIDOS, pedido explícito do usuário —
    não conta Cancelado/Reprovado/Arquivado mesmo que tenham Data de
    Resolução preenchida), e cada chamado entra no mês da sua própria
    "Data de Resolução" (não do mês do arquivo — um chamado criado em
    agosto e resolvido em outubro conta no Pareto de outubro). As 2
    variantes de "Categoria de Encerramento" só consideram chamados do
    projeto Central de Incidentes (PARETO_SOLAR_PROJETO_PREFIXO); a
    "só reabertos" filtra ainda por CACHE_COL_REABERTO == "Sim"
    (PARETO_SOLAR_SOMENTE_REABERTO)."""
    if not os.path.isdir(CACHE_DIR):
        raise JiraExtractorError(f'Pasta de cache não encontrada neste ambiente: "{CACHE_DIR}".')

    # Os meses não são mais uma janela fixa — vão surgindo conforme a
    # varredura encontra chamados resolvidos/criados em cada um
    # (defaultdict em vez de dict pré-populado numa lista de 3 meses).
    counts_por_campo = {campo: defaultdict(Counter) for campo in PARETO_SOLAR_CAMPOS}
    totais_por_campo = {campo: defaultdict(int) for campo in PARETO_SOLAR_CAMPOS}

    # Cards "Quantidade"/"Percentual de abertura" do carrossel "Categoria de
    # Encerramento (só reabertos)" — população por Data de Criação (todo
    # chamado INC do mês, resolvido ou não; os outros contadores acima só
    # enxergam quem já tem Data de Resolução), pra responder "quantos % dos
    # chamados CRIADOS nesse mês já foram reabertos" (não "dos encerrados").
    criados_por_mes = defaultdict(int)
    reabertos_por_mes = defaultdict(int)

    nomes = [n for n in os.listdir(CACHE_DIR) if n.lower().endswith(".xlsx") and not n.startswith("~$")]
    colunas_necessarias = (
        CACHE_COL_CHAVE,
        CACHE_COL_STATUS,
        CACHE_COL_GRUPO,
        CACHE_COL_CRIACAO,
        CACHE_COL_RESOLUCAO,
        CACHE_COL_REABERTO,
        *PARETO_SOLAR_CAMPOS.values(),
    )
    for nome in nomes:
        try:
            wb = load_workbook(os.path.join(CACHE_DIR, nome), read_only=True, data_only=True)
        except Exception:
            app.logger.exception('Falha ao ler a planilha de cache "%s"', nome)
            continue
        try:
            ws = wb.active
            linhas = ws.iter_rows(values_only=True)
            header = next(linhas, None)
            if not header or any(c not in header for c in colunas_necessarias):
                continue
            idx = {c: header.index(c) for c in colunas_necessarias}

            for linha in linhas:
                if linha is None or all(v is None for v in linha):
                    continue

                def valor(col, linha=linha):
                    i = idx[col]
                    return linha[i] if i < len(linha) else None

                if valor(CACHE_COL_GRUPO) not in GRUPOS_SOLUCIONADOR_N1_N2:
                    continue
                prefixo_chamado = str(valor(CACHE_COL_CHAVE) or "").split("-")[0].upper()
                reaberto_chamado = valor(CACHE_COL_REABERTO) == "Sim"

                if prefixo_chamado == "INC":
                    criacao = _cache_parse_data_iso(valor(CACHE_COL_CRIACAO))
                    if criacao:
                        chave_criacao = f"{criacao.year:04d}-{criacao.month:02d}"
                        criados_por_mes[chave_criacao] += 1
                        if reaberto_chamado:
                            reabertos_por_mes[chave_criacao] += 1

                if valor(CACHE_COL_STATUS) not in CACHE_STATUS_RESOLVIDOS:
                    continue
                resolucao = _cache_parse_data_iso(valor(CACHE_COL_RESOLUCAO))
                if not resolucao:
                    continue
                chave = f"{resolucao.year:04d}-{resolucao.month:02d}"
                for campo, coluna in PARETO_SOLAR_CAMPOS.items():
                    prefixo_exigido = PARETO_SOLAR_PROJETO_PREFIXO.get(campo)
                    if prefixo_exigido and prefixo_chamado != prefixo_exigido:
                        continue
                    if campo in PARETO_SOLAR_SOMENTE_REABERTO and not reaberto_chamado:
                        continue
                    totais_por_campo[campo][chave] += 1
                    valor_campo = valor(coluna)
                    if valor_campo:
                        counts_por_campo[campo][chave][valor_campo] += 1
        finally:
            wb.close()

    # União de todo mês que apareceu em qualquer um dos 3 campos — os 3
    # <select> do front mostram a mesma lista mesmo que, num mês
    # específico, um dos campos não tenha tido nenhum chamado (sai com o
    # gráfico vazio, "Nenhum chamado classificado", em vez de faltar a
    # opção no <select>).
    todos_os_meses = sorted(set().union(*(totais_por_campo[campo].keys() for campo in PARETO_SOLAR_CAMPOS)))

    def montar(campo):
        resultado = [
            {
                "mes": chave,
                **_pareto_payload(counts_por_campo[campo][chave], totais_por_campo[campo][chave], PARETO_SOLAR_TOP_N[campo]),
            }
            for chave in todos_os_meses
        ]
        # Cards "Quantidade"/"Percentual de abertura" (lado esquerdo do
        # carrossel "Categoria de Encerramento (só reabertos)") — só faz
        # sentido aqui, os outros 2 carrosséis não são "só reabertos".
        if campo in PARETO_SOLAR_SOMENTE_REABERTO:
            for item in resultado:
                chave = item["mes"]
                criados = criados_por_mes[chave]
                reabertos = reabertos_por_mes[chave]
                item["criados_no_mes"] = criados
                item["reabertos_no_mes"] = reabertos
                item["percentual_reabertura"] = round(reabertos / criados * 100, 1) if criados else 0.0
        return resultado

    return jsonify({campo: {"meses": montar(campo)} for campo in PARETO_SOLAR_CAMPOS})


@app.route("/api/pareto-solar-fornecedor", methods=["POST"])
def pareto_solar_fornecedor():
    """4º carrossel do Pareto Solar — "Fornecedor Responsável", único que
    consulta o Jira na hora (precisa credenciais): diferente dos outros 3
    (100% cache local), esse não dá pra reconstruir do cache porque (a)
    "Fornecedor Responsável" não é uma coluna salva e (b) o dado em si é o
    status ATUAL do chamado ("Aguardando Fornecedor" agora, não "esteve
    nesse status em algum momento") — não é um fato histórico pra guardar
    numa planilha de snapshot mensal. Réplica do gadget "Fornecedor
    Responsável × Mês de Criação" da home (fetch_fornecedor_criacao_mensal
    — chamados ATUALMENTE em "Aguardando Fornecedor", por mês de criação,
    TODOS os meses que aparecerem, sem recorte), virado num Pareto por mês
    (maior fornecedor primeiro). Só os grupos N1/N2 da Mops Solar
    (GRUPOS_SOLUCIONADOR_N1_N2, sem Prod) — mesmo recorte dos outros 3."""
    body = request.get_json(silent=True) or {}
    config = _config_from_request(body)

    dados = fetch_fornecedor_criacao_mensal(config, GRUPOS_SOLUCIONADOR_N1_N2, projetos=[PROJETO_INC])

    counts_por_mes = {chave: Counter() for chave in dados["meses"]}
    totais_por_mes = {chave: 0 for chave in dados["meses"]}
    for linha in dados["linhas"]:
        for i, chave in enumerate(dados["meses"]):
            qtd = linha["por_mes"][i]
            if qtd:
                counts_por_mes[chave][linha["fornecedor"]] += qtd
                totais_por_mes[chave] += qtd

    meses_resultado = [
        {"mes": chave, **_pareto_payload(counts_por_mes[chave], totais_por_mes[chave], PARETO_SOLAR_TOP_N["fornecedor"])}
        for chave in dados["meses"]
    ]
    return jsonify({"meses": meses_resultado})


# Os 3 "campos" que o popup de drill-down (clique numa barra de
# "Classificação") pode mostrar — chave recebida do front, valor é a
# coluna real da planilha de cache. "categoria" aqui tem o mesmo nome do
# campo ("categoria") que PARETO_SOLAR_CAMPOS usa no carrossel pai, mas é
# uma rota totalmente separada (_pareto_solar_contar_drilldown), nada a
# ver com PARETO_SOLAR_CAMPOS.
PARETO_SOLAR_DRILLDOWN_CAMPOS = {
    "subclassificacao": CACHE_COL_SUBCLASSIFICACAO,
    "eps": CACHE_COL_EPS,
    "categoria": CACHE_COL_CATEGORIA,
}

# "Categoria de Encerramento" só considera INC mesmo dentro do drill-down
# (mesma regra do carrossel "Categoria de Encerramento" — ver
# PARETO_SOLAR_PROJETO_PREFIXO); "Sub-Classificação"/"PROP_Site" não têm
# essa restrição (igual "Classificação", population INC+PDST).
PARETO_SOLAR_DRILLDOWN_PROJETO_PREFIXO = {"categoria": "INC"}


@app.route("/api/pareto-solar-subclassificacao", methods=["POST"])
def pareto_solar_subclassificacao():
    """Drill-down do carrossel "Classificação" do Pareto Solar — clicar
    numa barra abre (popup no front) um Pareto só daquela Classificação,
    no mesmo mês, podendo alternar entre 3 campos
    (PARETO_SOLAR_DRILLDOWN_CAMPOS: Sub-Classificação, PROP_Site ou
    Categoria de Encerramento — "campo" no corpo da requisição, default
    "subclassificacao"). Mesma fonte/critério do carrossel pai (cache
    local, grupos N1/N2 da Mops Solar, status Resolvido ou Encerrado —
    CACHE_STATUS_RESOLVIDOS —, bucket por mês da "Data de Resolução")."""
    body = request.get_json(silent=True) or {}
    mes = (body.get("mes") or "").strip()
    classificacao = (body.get("classificacao") or "").strip()
    campo = (body.get("campo") or "subclassificacao").strip()
    if not mes or not classificacao:
        raise JiraExtractorError('Informe "mes" e "classificacao".')
    coluna = PARETO_SOLAR_DRILLDOWN_CAMPOS.get(campo)
    if not coluna:
        raise JiraExtractorError(f'"campo" inválido: "{campo}".')
    if not os.path.isdir(CACHE_DIR):
        raise JiraExtractorError(f'Pasta de cache não encontrada neste ambiente: "{CACHE_DIR}".')

    prefixo_exigido = PARETO_SOLAR_DRILLDOWN_PROJETO_PREFIXO.get(campo)

    counts = Counter()
    total = 0
    nomes = [n for n in os.listdir(CACHE_DIR) if n.lower().endswith(".xlsx") and not n.startswith("~$")]
    colunas_necessarias = (
        CACHE_COL_CHAVE,
        CACHE_COL_STATUS,
        CACHE_COL_GRUPO,
        CACHE_COL_CLASSIFICACAO,
        CACHE_COL_RESOLUCAO,
        coluna,
    )
    for nome in nomes:
        try:
            wb = load_workbook(os.path.join(CACHE_DIR, nome), read_only=True, data_only=True)
        except Exception:
            app.logger.exception('Falha ao ler a planilha de cache "%s"', nome)
            continue
        try:
            ws = wb.active
            linhas = ws.iter_rows(values_only=True)
            header = next(linhas, None)
            if not header or any(c not in header for c in colunas_necessarias):
                continue
            idx = {c: header.index(c) for c in colunas_necessarias}

            for linha in linhas:
                if linha is None or all(v is None for v in linha):
                    continue

                def valor(col, linha=linha):
                    i = idx[col]
                    return linha[i] if i < len(linha) else None

                if valor(CACHE_COL_GRUPO) not in GRUPOS_SOLUCIONADOR_N1_N2:
                    continue
                if valor(CACHE_COL_CLASSIFICACAO) != classificacao:
                    continue
                if prefixo_exigido:
                    prefixo_chamado = str(valor(CACHE_COL_CHAVE) or "").split("-")[0].upper()
                    if prefixo_chamado != prefixo_exigido:
                        continue
                if valor(CACHE_COL_STATUS) not in CACHE_STATUS_RESOLVIDOS:
                    continue
                resolucao = _cache_parse_data_iso(valor(CACHE_COL_RESOLUCAO))
                if not resolucao or f"{resolucao.year:04d}-{resolucao.month:02d}" != mes:
                    continue
                total += 1
                valor_campo = valor(coluna)
                if valor_campo:
                    counts[valor_campo] += 1
        finally:
            wb.close()

    payload = _pareto_payload(counts, total, PARETO_SOLAR_TOP_N["classificacao"])
    return jsonify({"mes": mes, "classificacao": classificacao, "campo": campo, **payload})


# "Material ICG" — FCA's (Fato/Causa/Ação), pedido explícito do usuário:
# hierarquia Mês -> Dia de apresentação -> FCA's. Cada dia tem 1 FCA por
# indicador (MATERIAL_ICG_FCA_INDICADORES) e cada FCA é uma ÁRVORE —
# Fato(s) na raiz, Causa(s) dentro de cada Fato, Ação(ões) dentro de cada
# Causa.
# Salvo num SQLite local (pedido: "arquivo sqlite por enquanto"), na raiz
# de CACHE_BASE_DIR (ao lado de Solar/TV): é registro manual, não cache
# de chamados do Jira. Só funciona rodando localmente, como o Cache.
MATERIAL_ICG_FCA_DB = os.path.join(CACHE_BASE_DIR, "material_icg_fca.sqlite")

MATERIAL_ICG_FCA_INDICADORES = {
    "abertos": "Índice de chamados abertos",
    "sla": "SLA de atendimento",
    "reabertura": "Índice de reabertura",
    "clarinha": "Clarinha",
    "aguardando_fornecedor": "Aguardando fornecedor acima de 1 semana",
}

# Tipo de cada nível da árvore -> tipo que o pai precisa ter (None = raiz).
MATERIAL_ICG_FCA_PAI_ESPERADO = {"fato": None, "causa": "fato", "acao": "causa"}

_MATERIAL_ICG_FCA_SCHEMA = """
CREATE TABLE IF NOT EXISTS fca_mes (
    id INTEGER PRIMARY KEY,
    mes TEXT NOT NULL UNIQUE,
    criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fca_apresentacao (
    id INTEGER PRIMARY KEY,
    mes_id INTEGER NOT NULL REFERENCES fca_mes(id) ON DELETE CASCADE,
    data TEXT NOT NULL UNIQUE,
    criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fca (
    id INTEGER PRIMARY KEY,
    apresentacao_id INTEGER NOT NULL REFERENCES fca_apresentacao(id) ON DELETE CASCADE,
    indicador TEXT NOT NULL,
    criado_em TEXT NOT NULL,
    UNIQUE (apresentacao_id, indicador)
);
CREATE TABLE IF NOT EXISTS fca_item (
    id INTEGER PRIMARY KEY,
    fca_id INTEGER NOT NULL REFERENCES fca(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES fca_item(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('fato', 'causa', 'acao')),
    texto TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
);
"""


def _material_icg_fca_conexao():
    """Abre o SQLite (cria arquivo e tabelas na 1ª vez). foreign_keys
    precisa ser ligado por conexão no SQLite — sem isso o ON DELETE
    CASCADE (excluir dia -> FCA's -> itens) não roda."""
    os.makedirs(os.path.dirname(MATERIAL_ICG_FCA_DB), exist_ok=True)
    conexao = sqlite3.connect(MATERIAL_ICG_FCA_DB)
    conexao.row_factory = sqlite3.Row
    conexao.execute("PRAGMA foreign_keys = ON")
    conexao.executescript(_MATERIAL_ICG_FCA_SCHEMA)
    _material_icg_fca_migrar_mes(conexao)
    return conexao


def _material_icg_fca_migrar_mes(conexao):
    """Banco criado antes do nível "Mês" existir: "fca_apresentacao" não
    tem "mes_id". Adiciona a coluna e pendura cada dia já salvo no mês da
    própria data (criando o mês se preciso) — nenhum dia se perde. (A
    coluna adicionada via ALTER não fica NOT NULL; a API sempre preenche.)"""
    colunas = {linha["name"] for linha in conexao.execute("PRAGMA table_info(fca_apresentacao)")}
    if "mes_id" in colunas:
        return
    with conexao:
        conexao.execute("ALTER TABLE fca_apresentacao ADD COLUMN mes_id INTEGER REFERENCES fca_mes(id) ON DELETE CASCADE")
        for (mes,) in conexao.execute("SELECT DISTINCT substr(data, 1, 7) FROM fca_apresentacao").fetchall():
            conexao.execute("INSERT OR IGNORE INTO fca_mes (mes, criado_em) VALUES (?, ?)", (mes, _agora_iso()))
        conexao.execute(
            "UPDATE fca_apresentacao SET mes_id = (SELECT id FROM fca_mes WHERE fca_mes.mes = substr(fca_apresentacao.data, 1, 7))"
        )


def _agora_iso():
    return datetime.now(BRAZIL_TZ).strftime("%Y-%m-%d %H:%M:%S")


def _material_icg_fca_listar():
    """Todos os meses (mais recente primeiro) -> dias (mais recente
    primeiro) -> FCA's com a árvore de itens já montada (fato -> causas ->
    ações)."""
    with closing(_material_icg_fca_conexao()) as conexao:
        meses = conexao.execute("SELECT id, mes FROM fca_mes ORDER BY mes DESC").fetchall()
        apresentacoes = conexao.execute("SELECT id, mes_id, data FROM fca_apresentacao ORDER BY data DESC").fetchall()
        fcas = conexao.execute("SELECT id, apresentacao_id, indicador FROM fca ORDER BY id").fetchall()
        itens = conexao.execute("SELECT id, fca_id, parent_id, tipo, texto FROM fca_item ORDER BY id").fetchall()

    filhos_por_pai = defaultdict(list)
    for item in itens:
        filhos_por_pai[(item["fca_id"], item["parent_id"])].append(item)

    def arvore(fca_id, parent_id):
        return [
            {"id": item["id"], "tipo": item["tipo"], "texto": item["texto"], "filhos": arvore(fca_id, item["id"])}
            for item in filhos_por_pai[(fca_id, parent_id)]
        ]

    fcas_por_dia = defaultdict(list)
    for fca in fcas:
        fcas_por_dia[fca["apresentacao_id"]].append(
            {"id": fca["id"], "indicador": fca["indicador"], "itens": arvore(fca["id"], None)}
        )

    dias_por_mes = defaultdict(list)
    for a in apresentacoes:
        dias_por_mes[a["mes_id"]].append({"id": a["id"], "data": a["data"], "fcas": fcas_por_dia[a["id"]]})

    return {
        "indicadores": MATERIAL_ICG_FCA_INDICADORES,
        "meses": [{"id": m["id"], "mes": m["mes"], "apresentacoes": dias_por_mes[m["id"]]} for m in meses],
    }


def _body_id(body, campo):
    try:
        return int(body.get(campo))
    except (TypeError, ValueError):
        raise JiraExtractorError(f'Informe "{campo}".')


@app.route("/api/material-icg/fca/listar", methods=["POST"])
def material_icg_fca_listar():
    """Lista os dias de apresentação com FCA's e árvores (ver
    _material_icg_fca_listar). Não depende de e-mail/token."""
    return jsonify(_material_icg_fca_listar())


@app.route("/api/material-icg/fca/mes/criar", methods=["POST"])
def material_icg_fca_mes_criar():
    body = request.get_json(silent=True) or {}
    mes = (body.get("mes") or "").strip()
    try:
        datetime.strptime(mes, "%Y-%m")
    except ValueError:
        raise JiraExtractorError('Informe "mes" (AAAA-MM).')
    with closing(_material_icg_fca_conexao()) as conexao, conexao:
        try:
            conexao.execute("INSERT INTO fca_mes (mes, criado_em) VALUES (?, ?)", (mes, _agora_iso()))
        except sqlite3.IntegrityError:
            raise JiraExtractorError("Esse mês já foi adicionado.")
    return jsonify(_material_icg_fca_listar())


@app.route("/api/material-icg/fca/mes/excluir", methods=["POST"])
def material_icg_fca_mes_excluir():
    """Exclui o mês e, em cascata, os dias/FCA's/itens dele."""
    mes_id = _body_id(request.get_json(silent=True) or {}, "id")
    with closing(_material_icg_fca_conexao()) as conexao, conexao:
        conexao.execute("DELETE FROM fca_mes WHERE id = ?", (mes_id,))
    return jsonify(_material_icg_fca_listar())


@app.route("/api/material-icg/fca/apresentacao/criar", methods=["POST"])
def material_icg_fca_apresentacao_criar():
    """Cria um dia de apresentação dentro de um mês — a data precisa ser
    desse mês."""
    body = request.get_json(silent=True) or {}
    mes_id = _body_id(body, "mes_id")
    data_iso = (body.get("data") or "").strip()
    try:
        datetime.strptime(data_iso, "%Y-%m-%d")
    except ValueError:
        raise JiraExtractorError('Informe "data" (AAAA-MM-DD).')
    with closing(_material_icg_fca_conexao()) as conexao, conexao:
        mes = conexao.execute("SELECT mes FROM fca_mes WHERE id = ?", (mes_id,)).fetchone()
        if not mes:
            raise JiraExtractorError("Mês não encontrado.")
        if data_iso[:7] != mes["mes"]:
            raise JiraExtractorError("A data precisa ser do mesmo mês.")
        try:
            conexao.execute(
                "INSERT INTO fca_apresentacao (mes_id, data, criado_em) VALUES (?, ?, ?)", (mes_id, data_iso, _agora_iso())
            )
        except sqlite3.IntegrityError:
            raise JiraExtractorError("Já existe um dia de apresentação nessa data.")
    return jsonify(_material_icg_fca_listar())


@app.route("/api/material-icg/fca/apresentacao/excluir", methods=["POST"])
def material_icg_fca_apresentacao_excluir():
    """Exclui o dia e, em cascata, os FCA's e itens dele."""
    apresentacao_id = _body_id(request.get_json(silent=True) or {}, "id")
    with closing(_material_icg_fca_conexao()) as conexao, conexao:
        conexao.execute("DELETE FROM fca_apresentacao WHERE id = ?", (apresentacao_id,))
    return jsonify(_material_icg_fca_listar())


@app.route("/api/material-icg/fca/criar", methods=["POST"])
def material_icg_fca_criar():
    body = request.get_json(silent=True) or {}
    apresentacao_id = _body_id(body, "apresentacao_id")
    indicador = (body.get("indicador") or "").strip()
    if indicador not in MATERIAL_ICG_FCA_INDICADORES:
        raise JiraExtractorError("Indicador inválido.")
    with closing(_material_icg_fca_conexao()) as conexao, conexao:
        if not conexao.execute("SELECT 1 FROM fca_apresentacao WHERE id = ?", (apresentacao_id,)).fetchone():
            raise JiraExtractorError("Dia de apresentação não encontrado.")
        try:
            conexao.execute(
                "INSERT INTO fca (apresentacao_id, indicador, criado_em) VALUES (?, ?, ?)",
                (apresentacao_id, indicador, _agora_iso()),
            )
        except sqlite3.IntegrityError:
            raise JiraExtractorError("Esse dia já tem um FCA desse indicador.")
    return jsonify(_material_icg_fca_listar())


@app.route("/api/material-icg/fca/excluir", methods=["POST"])
def material_icg_fca_excluir():
    """Exclui o FCA e, em cascata, a árvore de itens dele."""
    fca_id = _body_id(request.get_json(silent=True) or {}, "id")
    with closing(_material_icg_fca_conexao()) as conexao, conexao:
        conexao.execute("DELETE FROM fca WHERE id = ?", (fca_id,))
    return jsonify(_material_icg_fca_listar())


@app.route("/api/material-icg/fca/item/criar", methods=["POST"])
def material_icg_fca_item_criar():
    """Cria um nó da árvore, vazio. Fato só na raiz; Causa só dentro de
    Fato; Ação só dentro de Causa (MATERIAL_ICG_FCA_PAI_ESPERADO) — e o
    pai precisa ser do MESMO FCA."""
    body = request.get_json(silent=True) or {}
    fca_id = _body_id(body, "fca_id")
    tipo = (body.get("tipo") or "").strip()
    if tipo not in MATERIAL_ICG_FCA_PAI_ESPERADO:
        raise JiraExtractorError("Tipo inválido.")
    parent_id = None if body.get("parent_id") in (None, "") else _body_id(body, "parent_id")

    with closing(_material_icg_fca_conexao()) as conexao, conexao:
        if not conexao.execute("SELECT 1 FROM fca WHERE id = ?", (fca_id,)).fetchone():
            raise JiraExtractorError("FCA não encontrado.")
        tipo_pai_esperado = MATERIAL_ICG_FCA_PAI_ESPERADO[tipo]
        if tipo_pai_esperado is None:
            if parent_id is not None:
                raise JiraExtractorError("Fato não pode ter item pai.")
        else:
            pai = conexao.execute("SELECT fca_id, tipo FROM fca_item WHERE id = ?", (parent_id,)).fetchone()
            if not pai or pai["fca_id"] != fca_id or pai["tipo"] != tipo_pai_esperado:
                raise JiraExtractorError("Item pai inválido para esse tipo.")
        agora = _agora_iso()
        conexao.execute(
            "INSERT INTO fca_item (fca_id, parent_id, tipo, texto, criado_em, atualizado_em) VALUES (?, ?, ?, '', ?, ?)",
            (fca_id, parent_id, tipo, agora, agora),
        )
    return jsonify(_material_icg_fca_listar())


@app.route("/api/material-icg/fca/item/atualizar", methods=["POST"])
def material_icg_fca_item_atualizar():
    """Salva o texto de um nó (a tela chama ao sair do campo). Não devolve
    a lista inteira — a tela não redesenha, pra não perder o foco."""
    body = request.get_json(silent=True) or {}
    item_id = _body_id(body, "id")
    texto = (body.get("texto") or "").strip()
    with closing(_material_icg_fca_conexao()) as conexao, conexao:
        cursor = conexao.execute(
            "UPDATE fca_item SET texto = ?, atualizado_em = ? WHERE id = ?", (texto, _agora_iso(), item_id)
        )
        if cursor.rowcount == 0:
            raise JiraExtractorError("Item não encontrado.")
    return jsonify({"ok": True})


@app.route("/api/material-icg/fca/item/excluir", methods=["POST"])
def material_icg_fca_item_excluir():
    """Exclui o nó e, em cascata, os filhos dele (Fato -> Causas -> Ações)."""
    item_id = _body_id(request.get_json(silent=True) or {}, "id")
    with closing(_material_icg_fca_conexao()) as conexao, conexao:
        conexao.execute("DELETE FROM fca_item WHERE id = ?", (item_id,))
    return jsonify(_material_icg_fca_listar())


def _cache_material_icg_dados(
    inicio_iso=None, fim_iso=None, grupos_linha_raw=None, grupos_indicadores_raw=None, granularidade="dia"
):
    """Tudo que a tela de Material ICG precisa (SLA/Abertos/Reabertura do
    período selecionado + barra comparativa + "Atendimento diário"), num
    ÚNICO scan da pasta de cache do Solar. SLA/Abertos/Reabertura (e suas
    médias/comparativa) seguem o seletor de grupos da página de
    indicadores ("grupos_indicadores_raw", padrão N1/N2); o gráfico
    "Atendimento diário" tem o seletor próprio ("grupos_linha_raw",
    padrão Tudo) — ver _resolver_grupos. Por isso o scan guarda cada dia
    JÁ separado por grupo (N1/N2/PROD) —
    cada seção soma só os grupos que faz sentido pra ela, sem reler os
    .xlsx.

    Período é sempre por DIA aqui no backend — a tela tem 2 modos de
    filtro (seletor "Mês" ou "Personalizado" com "De"/"até"), mas o modo
    "Mês" já chega aqui convertido em "inicio"/"fim" (1º dia do mês ao
    último, ou até hoje se for o mês corrente) pelo frontend; sem
    "inicio"/"fim", cai no padrão do mês atual real (dia 1 até hoje).

    Comparativa = mesmo número de dias do período selecionado, IMEDIATA-
    MENTE anterior a ele (ex.: período de 18 dias -> os 18 dias
    anteriores ao "De"). Não trava mais em mês calendário: o filtro já é
    por dia, então "mesmo período anterior" generaliza igual pra qualquer
    intervalo.

    SLA bucket pela "Data de Resolução" (mesma regra de _cache_sla_
    historico: status != "Cancelado", exclui "Violado" == "N/A");
    criados/reabertos pela "Data de Criação" e resolvidos (encerrados)
    pela "Data de Resolução" em CACHE_STATUS_RESOLVIDOS (mesmas regras de
    _cache_criados_resolvidos_historico)."""
    pasta_solar = CACHE_PARTICOES[CAIXA_SOLAR]["pasta"]
    if not os.path.isdir(pasta_solar):
        raise JiraExtractorError(f'Pasta de cache não encontrada neste ambiente: "{pasta_solar}".')

    hoje = datetime.now(BRAZIL_TZ).date()
    try:
        inicio = datetime.strptime(inicio_iso, "%Y-%m-%d").date() if inicio_iso else hoje.replace(day=1)
        fim = datetime.strptime(fim_iso, "%Y-%m-%d").date() if fim_iso else hoje
    except ValueError:
        raise JiraExtractorError('"inicio"/"fim" inválidos (esperado AAAA-MM-DD).')
    if inicio > fim:
        raise JiraExtractorError('"inicio" não pode ser depois de "fim".')

    grupos_linha = _resolver_grupos(grupos_linha_raw, GRUPOS_SOLUCIONADOR)
    grupos_indicadores = _resolver_grupos(grupos_indicadores_raw, GRUPOS_SOLUCIONADOR_N1_N2)

    duracao_dias = (fim - inicio).days + 1
    fim_anterior = inicio - timedelta(days=1)
    inicio_anterior = fim_anterior - timedelta(days=duracao_dias - 1)

    # "por_dia[dia][grupo]" — bucket por dia E por grupo (N1/N2/PROD),
    # pra cada seção poder somar só os grupos que precisa a partir do
    # MESMO scan (ver docstring acima).
    por_dia = defaultdict(lambda: defaultdict(lambda: {"dentro": 0, "fora": 0, "criados": 0, "resolvidos": 0, "reabertos": 0}))
    colunas_necessarias = (
        CACHE_COL_STATUS,
        CACHE_COL_GRUPO,
        CACHE_COL_VIOLADO,
        CACHE_COL_RESOLUCAO,
        CACHE_COL_CRIACAO,
        CACHE_COL_REABERTO,
    )

    def chave_dia(d):
        return f"{d.year:04d}-{d.month:02d}-{d.day:02d}"

    def processar(valor):
        grupo = valor(CACHE_COL_GRUPO)
        if grupo not in GRUPOS_SOLUCIONADOR:
            return
        status = valor(CACHE_COL_STATUS)
        if status != "Cancelado":
            violado_valor = valor(CACHE_COL_VIOLADO)
            if violado_valor != "N/A":
                resolucao = _cache_parse_data_iso(valor(CACHE_COL_RESOLUCAO))
                if resolucao:
                    por_dia[chave_dia(resolucao)][grupo]["fora" if violado_valor == "Sim" else "dentro"] += 1
        criacao = _cache_parse_data_iso(valor(CACHE_COL_CRIACAO))
        if criacao:
            por_dia[chave_dia(criacao)][grupo]["criados"] += 1
            if valor(CACHE_COL_REABERTO) == "Sim":
                por_dia[chave_dia(criacao)][grupo]["reabertos"] += 1
        if status in CACHE_STATUS_RESOLVIDOS:
            resolucao = _cache_parse_data_iso(valor(CACHE_COL_RESOLUCAO))
            if resolucao:
                por_dia[chave_dia(resolucao)][grupo]["resolvidos"] += 1

    _cache_para_cada_linha(pasta_solar, colunas_necessarias, processar)

    def somar_periodo(ini, fim_, grupos):
        agregado = {"dentro": 0, "fora": 0, "criados": 0, "resolvidos": 0, "reabertos": 0}
        dia = ini
        while dia <= fim_:
            por_grupo = por_dia.get(chave_dia(dia))
            if por_grupo:
                for grupo in grupos:
                    c = por_grupo.get(grupo)
                    if c:
                        for chave_valor in agregado:
                            agregado[chave_valor] += c[chave_valor]
            dia += timedelta(days=1)
        return agregado

    def montar_bloco(agregado):
        total_sla = agregado["dentro"] + agregado["fora"]
        percentual = round(agregado["dentro"] / total_sla * 100, 1) if total_sla else 0.0
        return {
            "sla": {"dentro_prazo": agregado["dentro"], "fora_prazo": agregado["fora"], "percentual_dentro_prazo": percentual},
            "abertos": agregado["criados"],
            "reabertura": {
                "criados": agregado["criados"],
                "resolvidos": agregado["resolvidos"],
                "reabertos": agregado["reabertos"],
            },
        }

    atual = somar_periodo(inicio, fim, grupos_indicadores)
    anterior = somar_periodo(inicio_anterior, fim_anterior, grupos_indicadores)

    # Média dos últimos 3 meses (card por repartição, pedido explícito do
    # usuário): MESMO intervalo de dia-do-mês do período selecionado,
    # deslocado 1/2/3 meses pra trás (ex.: 01/10 a 18/10 -> [01/07 a
    # 18/07], [01/08 a 18/08], [01/09 a 18/09]) — não é o "comparativo"
    # acima (que é só 1 período, de mesma DURAÇÃO, imediatamente antes).
    # Dia além do fim do mês de destino é truncado nele (ex.: dia 31 num
    # mês de 30 dias cai no dia 30).
    def mes_atras(d, meses):
        indice_mes = (d.year * 12 + (d.month - 1)) - meses
        ano_novo, mes_novo = divmod(indice_mes, 12)
        mes_novo += 1
        dias_no_mes_novo = calendar.monthrange(ano_novo, mes_novo)[1]
        return date(ano_novo, mes_novo, min(d.day, dias_no_mes_novo))

    periodos_3_meses = [(mes_atras(inicio, n), mes_atras(fim, n)) for n in (1, 2, 3)]
    agregados_3_meses = [somar_periodo(ini, fim_, grupos_indicadores) for ini, fim_ in periodos_3_meses]

    soma_3_meses = {"dentro": 0, "fora": 0, "criados": 0, "resolvidos": 0, "reabertos": 0}
    for agregado in agregados_3_meses:
        for chave_valor in soma_3_meses:
            soma_3_meses[chave_valor] += agregado[chave_valor]

    total_sla_3_meses = soma_3_meses["dentro"] + soma_3_meses["fora"]
    # Dias totais somados dos 3 períodos — não é sempre "duracao_dias * 3"
    # porque cada período pode cair num mês de tamanho diferente (o "mês
    # atrás" trunca o dia no fim do mês quando ele é mais curto).
    dias_totais_3_meses = sum((fim_ - ini).days + 1 for ini, fim_ in periodos_3_meses)
    media_3_meses = {
        "sla_percentual": round(soma_3_meses["dentro"] / total_sla_3_meses * 100, 1) if total_sla_3_meses else 0.0,
        "abertos_media": round(soma_3_meses["criados"] / 3, 1),
        "reabertura_percentual_media": round(soma_3_meses["reabertos"] / soma_3_meses["criados"] * 100, 1)
        if soma_3_meses["criados"]
        else 0.0,
        "periodos": [{"inicio": ini.isoformat(), "fim": fim_.isoformat()} for ini, fim_ in periodos_3_meses],
    }

    # "Atendimento diário" (pedido explícito do usuário): gráfico de linha,
    # 1 ponto por dia do período selecionado + baseline (média diária dos
    # últimos 3 meses, mesmos "periodos_3_meses" de cima) — só essa seção
    # usa "grupos_linha" (seletor Tudo/N1/N2/PROD da tela), em vez do
    # N1/N2 fixo do resto da tela.
    serie_diaria = []
    dia_serie = inicio
    while dia_serie <= fim:
        por_grupo = por_dia.get(chave_dia(dia_serie))
        criados_dia = resolvidos_dia = 0
        if por_grupo:
            for grupo in grupos_linha:
                c = por_grupo.get(grupo)
                if c:
                    criados_dia += c["criados"]
                    resolvidos_dia += c["resolvidos"]
        serie_diaria.append({"data": dia_serie.isoformat(), "criados": criados_dia, "resolvidos": resolvidos_dia})
        dia_serie += timedelta(days=1)

    agregados_3_meses_linha = [somar_periodo(ini, fim_, grupos_linha) for ini, fim_ in periodos_3_meses]
    soma_3_meses_linha_criados = sum(a["criados"] for a in agregados_3_meses_linha)
    soma_3_meses_linha_resolvidos = sum(a["resolvidos"] for a in agregados_3_meses_linha)
    atendimento_diario = {
        "granularidade": "dia",
        "serie": serie_diaria,
        "baseline_criados": round(soma_3_meses_linha_criados / dias_totais_3_meses, 1) if dias_totais_3_meses else 0.0,
        "baseline_resolvidos": round(soma_3_meses_linha_resolvidos / dias_totais_3_meses, 1) if dias_totais_3_meses else 0.0,
    }

    # Meses com dado no cache (pro seletor "Mês" da tela, modo alternativo
    # ao filtro "De"/"até" — pedido explícito do usuário) — de graça a
    # partir do "por_dia" já montado acima, sem nenhum scan extra.
    meses_disponiveis = sorted({chave_dia_existente[:7] for chave_dia_existente in por_dia})

    # Filtro "Ano" da tela (pedido explícito do usuário): o gráfico vira 1
    # ponto por MÊS em vez de por dia, e o baseline também — pra cada mês,
    # média dos 3 meses anteriores a ele (mesma ideia de "últimos 3 meses"
    # dos outros cards, só que móvel mês a mês). Só entram na média os
    # meses que existem no cache (o cache começa em jan/2026 — sem nenhum
    # mês anterior disponível, o baseline daquele mês fica vazio).
    if granularidade == "mes":
        meses_no_cache = set(meses_disponiveis)

        def limites_mes(ano, mes):
            return date(ano, mes, 1), date(ano, mes, calendar.monthrange(ano, mes)[1])

        def total_mes(ano, mes):
            ini, fim_ = limites_mes(ano, mes)
            return somar_periodo(ini, fim_, grupos_linha)

        serie_mensal = []
        ano_mes, mes_mes = inicio.year, inicio.month
        while (ano_mes, mes_mes) <= (fim.year, fim.month):
            ini_mes, fim_mes = limites_mes(ano_mes, mes_mes)
            # Mês corrente / fim do filtro no meio do mês: soma só até "fim".
            atual_mes = somar_periodo(max(ini_mes, inicio), min(fim_mes, fim), grupos_linha)

            anteriores = []
            for n in (1, 2, 3):
                ano_ant, mes_ant = divmod(ano_mes * 12 + (mes_mes - 1) - n, 12)
                mes_ant += 1
                if f"{ano_ant:04d}-{mes_ant:02d}" in meses_no_cache:
                    anteriores.append(total_mes(ano_ant, mes_ant))

            serie_mensal.append(
                {
                    "data": ini_mes.isoformat(),
                    "criados": atual_mes["criados"],
                    "resolvidos": atual_mes["resolvidos"],
                    "baseline_criados": round(sum(a["criados"] for a in anteriores) / len(anteriores), 1)
                    if anteriores
                    else None,
                    "baseline_resolvidos": round(sum(a["resolvidos"] for a in anteriores) / len(anteriores), 1)
                    if anteriores
                    else None,
                }
            )
            ano_mes, mes_mes = (ano_mes + 1, 1) if mes_mes == 12 else (ano_mes, mes_mes + 1)

        atendimento_diario = {"granularidade": "mes", "serie": serie_mensal}

    return {
        "inicio": inicio.isoformat(),
        "fim": fim.isoformat(),
        "inicio_anterior": inicio_anterior.isoformat(),
        "fim_anterior": fim_anterior.isoformat(),
        "meses_disponiveis": meses_disponiveis,
        **montar_bloco(atual),
        "comparativo": montar_bloco(anterior),
        "media_3_meses": media_3_meses,
        "atendimento_diario": atendimento_diario,
    }


@app.route("/api/material-icg/dados", methods=["POST"])
def material_icg_dados():
    """SLA/Abertos/Reabertura do período selecionado + barra comparativa
    (mesmo tanto de dias, imediatamente anterior) + "Atendimento diário",
    de Material ICG — tudo num scan só do cache local (ver _cache_
    material_icg_dados). "inicio"/"fim" (AAAA-MM-DD, opcionais) são o
    filtro "De"/"até" da tela — sem eles, cai no mês atual real.
    "grupos_indicadores"/"grupos_linha" (listas de "n1"/"n2"/"prod"/
    "tudo", opcionais) são os seletores de grupo da página de indicadores
    (padrão N1/N2) e do gráfico "Atendimento diário" (padrão os 3 grupos).
    Não depende de e-mail/token, mesmo
    padrão de /api/home-sla-cache; só funciona rodando localmente."""
    body = request.get_json(silent=True) or {}
    inicio_iso = (body.get("inicio") or "").strip() or None
    fim_iso = (body.get("fim") or "").strip() or None
    grupos_linha_raw = body.get("grupos_linha")
    grupos_indicadores_raw = body.get("grupos_indicadores")
    # "mes" quando o filtro da tela é "Ano" (gráfico por mês) — ver
    # _cache_material_icg_dados.
    granularidade = "mes" if body.get("granularidade") == "mes" else "dia"
    return jsonify(
        _cache_material_icg_dados(inicio_iso, fim_iso, grupos_linha_raw, grupos_indicadores_raw, granularidade)
    )


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


@app.route("/api/report-vini", methods=["POST"])
def report_vini():
    """"Report Vini" — específico da caixa Mops Tv do Futuro: consolida num
    resultado só o que hoje é visto espalhado em 3 ações (Criados x
    Resolvidos com TMA/SLA, Reabertos, Categorias de Encerramento) pro
    período escolhido (Data início/fim)."""
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


@app.route("/api/tv-resolvidos-reabertos", methods=["POST"])
def tv_resolvidos_reabertos():
    """Botão específico da caixa Mops Tv do Futuro: Excel de 2 abas pro
    período informado —

      - "Resolvidos e Encerrados": status IN (Resolvido, Encerrado) AND
        resolutiondate no período (fetch_resolvidos_encerrados_analitico).
      - "Reabertos": status WAS "Reaberto" em algum momento AND created no
        período (fetch_reabertos_analitico).

    Cada linha traz Número do Chamado, Data Criação, Classificação e
    Categoria de Encerramento (mesmas colunas do analítico de "Categorias
    de Encerramento"). Sempre os 2 projetos (Central de Incidentes +
    Abertura de Chamados) — "Todos os resolvidos/reabertos" não deveria
    variar conforme o painel "PROJETOS" da tela, então não usa
    _projetos_selecionados aqui."""
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    if caixa_id != CAIXA_TV:
        raise JiraExtractorError('Essa extração é específica da caixa "Mops Tv do Futuro".')

    config = _config_from_request(body)
    inicio, fim = _parse_periodo(body)
    grupos = CAIXAS[caixa_id]["grupos"]
    projetos = [PROJETO_INC, PROJETO_PDST]

    classificacao_field_id = _resolve_classificacao_field_id(config)
    if not classificacao_field_id:
        raise JiraExtractorError('Campo "Classificação" não encontrado no Jira.')
    categoria_field_id = _resolve_categoria_encerramento_field_id(config)
    if not categoria_field_id:
        raise JiraExtractorError('Campo "Categoria de Encerramento" não encontrado no Jira.')

    resolvidos_rows = fetch_resolvidos_encerrados_analitico(
        config, grupos, inicio, fim, classificacao_field_id, categoria_field_id, projetos=projetos
    )
    reabertos_rows = fetch_reabertos_analitico(
        config, grupos, inicio, fim, classificacao_field_id, categoria_field_id, projetos=projetos
    )

    if not resolvidos_rows and not reabertos_rows:
        return jsonify({"empty": True, "message": "Nenhum chamado encontrado para o período."})

    fieldnames = ["Número do Chamado", "Data Criação", "Classificação", "Categoria de Encerramento"]
    data = _rows_to_excel_bytes_multi(
        [("Resolvidos e Encerrados", resolvidos_rows), ("Reabertos", reabertos_rows)], fieldnames
    )
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return send_file(
        io.BytesIO(data),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=f"tv_resolvidos_reabertos_{timestamp}.xlsx",
    )


@app.route("/api/report-diario", methods=["POST"])
def report_diario():
    """Report Diário consolidado: junta, numa chamada só, os mesmos números
    que já existem espalhados noutras ações — tudo escopado a "hoje" — "A
    violar" (fetch_chamados_a_violar, days_ahead=0), "Violados"
    (fetch_chamados_violados do dia), "Reabertos" (fetch_chamados_reabertos
    do dia) e "Top analista do dia" (quem mais resolveu hoje). Funciona nas
    duas caixas: cada busca já usa os grupos/projetos/JQL da caixa
    selecionada, sem nenhuma regra extra específica de caixa aqui."""
    body = request.get_json(silent=True) or {}
    caixa_id = _resolve_caixa(body)
    projetos = _projetos_selecionados(body)
    config = dict(_config_from_request(body), jql=_build_base_jql(caixa_id, projetos))
    hoje = datetime.now(BRAZIL_TZ).date()

    a_violar_hoje = len(fetch_chamados_a_violar(config, days_ahead=0))
    violados_hoje = len(fetch_chamados_violados(config, start_date=hoje, end_date=hoje))
    reabertos_hoje = len(fetch_chamados_reabertos(config, hoje, hoje))

    assignees = fetch_resolvidos_hoje_assignees(config)
    top_analistas = Counter(a for a in assignees if a).most_common(TOP_ASSIGNEES_LIMIT)

    return jsonify(
        {
            "data": hoje.strftime("%Y-%m-%d"),
            "a_violar_hoje": a_violar_hoje,
            "violados_hoje": violados_hoje,
            "reabertos_hoje": reabertos_hoje,
            "resolvidos_hoje": len(assignees),
            "top_analistas": top_analistas,
        }
    )


@app.route("/api/relatorio-geral-pdf", methods=["POST"])
def relatorio_geral_pdf():
    """Monta um PDF combinado a partir de "secoes" já calculadas no
    navegador — não refaz nenhuma busca no Jira, só formata o que já foi
    buscado. Usada pelo Report Vini (única consumidora hoje)."""
    body = request.get_json(silent=True) or {}
    secoes = body.get("secoes") or []
    if not secoes:
        raise JiraExtractorError("Nada para exportar.")

    titulo = (body.get("titulo") or "Relatório").strip() or "Relatório"
    # "arquivo" (opcional): outros futuros consumidores dessa rota podem
    # usar um nome de base diferente pro download.
    arquivo_base = (body.get("arquivo") or "relatorio").strip() or "relatorio"

    buf = io.BytesIO()
    export_general_report_pdf(secoes, buf, titulo=titulo)
    buf.seek(0)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return send_file(
        buf, mimetype="application/pdf", as_attachment=True, download_name=f"{arquivo_base}_{timestamp}.pdf"
    )


def _cache_meta_path(pasta=CACHE_DIR):
    return os.path.join(pasta, CACHE_SYNC_META_FILENAME)


def _cache_load_meta(pasta=CACHE_DIR):
    caminho = _cache_meta_path(pasta)
    if not os.path.isfile(caminho):
        return {}
    try:
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _cache_save_meta(meta, pasta=CACHE_DIR):
    with open(_cache_meta_path(pasta), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def _cache_resolve_path(nome_arquivo, pasta=CACHE_DIR):
    """Valida o nome do arquivo informado pela tela contra a pasta da
    partição de cache em uso (só o nome base, sem separador de caminho, e
    precisa já existir lá) — evita que um nome arbitrário no corpo da
    requisição leia/escreva fora de "pasta"."""
    nome = os.path.basename((nome_arquivo or "").strip())
    if not nome or not nome.lower().endswith(".xlsx") or nome.startswith("~$") or nome != nome_arquivo.strip():
        raise JiraExtractorError("Arquivo de cache inválido.")
    caminho = os.path.join(pasta, nome)
    if not os.path.isfile(caminho):
        raise JiraExtractorError(f'Arquivo "{nome}" não encontrado na pasta de cache.')
    return caminho, nome


def _cache_contar_status(caminho):
    """Lê as colunas "Status" e "Grupo Solucionador" da planilha (modo
    read_only, sem carregar estilos/fórmulas) e devolve (total_de_chamados,
    total_em_aberto, abertos_por_caixa) — "em aberto" é quem não está em
    CACHE_STATUS_FECHADOS. "abertos_por_caixa" é {"solar": N, "prod": N,
    "tv": N, "outros": N}, só com as chaves que tiverem pelo menos 1
    chamado (grupo fora de CAIXAS ou célula vazia cai em "outros", GRUPO_
    PROD cai em "prod" — ver CACHE_GRUPO_PARA_CAIXA); sem a coluna "Grupo
    Solucionador" na planilha, todo aberto cai em "outros"."""
    wb = load_workbook(caminho, read_only=True, data_only=True)
    try:
        ws = wb.active
        linhas = ws.iter_rows(values_only=True)
        header = next(linhas, None)
        if not header or CACHE_COL_STATUS not in header:
            return 0, 0, {}
        idx_status = header.index(CACHE_COL_STATUS)
        idx_grupo = header.index(CACHE_COL_GRUPO) if CACHE_COL_GRUPO in header else None

        total = 0
        abertos = 0
        abertos_por_caixa = Counter()
        for linha in linhas:
            if linha is None or all(v is None for v in linha):
                continue
            total += 1
            status = linha[idx_status] if idx_status < len(linha) else None
            if status not in CACHE_STATUS_FECHADOS:
                abertos += 1
                grupo = linha[idx_grupo] if idx_grupo is not None and idx_grupo < len(linha) else None
                caixa_id = CACHE_GRUPO_PARA_CAIXA.get(grupo, CACHE_CAIXA_OUTROS)
                abertos_por_caixa[caixa_id] += 1
        return total, abertos, dict(abertos_por_caixa)
    finally:
        wb.close()


def _cache_listar_planilhas(pasta=CACHE_DIR):
    if not os.path.isdir(pasta):
        raise JiraExtractorError(f'Pasta de cache não encontrada neste ambiente: "{pasta}".')

    meta = _cache_load_meta(pasta)
    arquivos = []
    nomes = [nome for nome in os.listdir(pasta) if nome.lower().endswith(".xlsx") and not nome.startswith("~$")]
    for nome in sorted(nomes, key=_cache_ordenar_chave):
        caminho = os.path.join(pasta, nome)
        try:
            total, abertos, abertos_por_caixa = _cache_contar_status(caminho)
        except Exception:
            app.logger.exception('Falha ao ler a planilha de cache "%s"', nome)
            total, abertos, abertos_por_caixa = None, None, {}
        arquivos.append(
            {
                "nome": nome,
                "total": total,
                "abertos": abertos,
                "abertos_por_caixa": abertos_por_caixa,
                "sincronizado_em": meta.get(nome),
            }
        )
    return arquivos


def _cache_consultar_em_lotes(config, keys, extra_jql, fields):
    """Consulta o Jira em lotes de CACHE_SYNC_LOTE chaves por vez
    ("key IN (...)" [AND extra_jql]) — evita montar uma JQL gigante de uma
    vez quando há muitas chaves pra checar. Devolve a lista de issues de
    todos os lotes combinados. Usado pelas 3 checagens da sincronização do
    cache (status atual, violado, já foi reaberto)."""
    if not keys:
        return []
    issues = []
    chaves_unicas = sorted(set(keys))
    for i in range(0, len(chaves_unicas), CACHE_SYNC_LOTE):
        lote = chaves_unicas[i : i + CACHE_SYNC_LOTE]
        keys_str = ", ".join(f'"{k}"' for k in lote)
        jql = f"key IN ({keys_str})"
        if extra_jql:
            jql += f" AND {extra_jql}"
        issues.extend(fetch_issues(config, jql, fields))
    return issues


def _cache_status_atual_jira(config, keys):
    """Para uma lista de chaves de chamados, busca no Jira o status ATUAL de
    cada uma e devolve {chave: status}. Usado só na sincronização do cache
    (chamados fechados não entram aqui — quem chama já filtrou isso
    antes)."""
    status_por_key = {}
    for issue in _cache_consultar_em_lotes(config, keys, None, ["status"]):
        row = flatten_issue(issue, ["status"])
        status_por_key[row["key"]] = row["status"]
    return status_por_key


# Campo de SLA usado especificamente pelo widget "SLA" da home — o gadget
# nativo do Jira que ele replica ("MOPS SOLAR - ACOMPANHAMENTO SLA
# (ANALITICO)") é "Chart By: Tempo de resolução - cf[10629]"
# ESPECIFICAMENTE, não "qualquer um dos 2 campos de SLA que existir".
# customfield_10419 e customfield_10629 são 2 métricas DIFERENTES, nunca
# preenchidas ao mesmo tempo no mesmo chamado (confirmado comparando
# direto na API: dos chamados fechados de um mês, uma parte só tem
# cf10419 — 45.5% de violação numa amostra —, o resto só tem cf10629 —
# 10.1% — bem diferente; usar "o que vier primeiro" é o que fazia o
# widget "SLA" não bater com o gadget real). Quem só tem cf10419 (sem
# cf10629) não entra na conta do SLA (nem dentro, nem fora) — "N/A" em
# vez de "Sim"/"Não", mesmo critério do gadget (que também os exclui do
# gráfico).
CACHE_SLA_FIELD_PRINCIPAL = SLA_RESOLUTION_FIELDS[1]


def _cache_violado_reaberto_jira(config, keys):
    """Para uma lista de chaves, devolve {chave: {"violado": "Sim"/"Não"/
    "N/A", "reaberto": "Sim"/"Não"}}. "violado" lê só o campo de SLA
    CACHE_SLA_FIELD_PRINCIPAL (cf[10629], igual o gadget "MOPS SOLAR -
    ACOMPANHAMENTO SLA" que o widget "SLA" da home replica) — "N/A" pra
    quem não tem esse campo (não é "Sim"/"Não" porque não é SLA violado
    nem dentro do prazo, é simplesmente outra métrica/fora do escopo
    desse gadget). "reaberto" continua pelo JQL (status WAS "Reaberto").
    Usado tanto pra preencher chamados novos quanto pra recalcular os que
    ainda estão em aberto/fechados há pouco tempo (CACHE_SLA_RECHECK_DIAS)
    e pra migrar planilhas antigas (sem essas 2 colunas ainda)."""
    if not keys:
        return {}
    chaves_unicas = sorted(set(keys))
    violado_por_key = {}
    for issue in _cache_consultar_em_lotes(config, chaves_unicas, None, [CACHE_SLA_FIELD_PRINCIPAL]):
        campo_sla = issue.get("fields", {}).get(CACHE_SLA_FIELD_PRINCIPAL)
        if not campo_sla:
            violado_por_key[issue.get("key")] = "N/A"
            continue
        ciclo = campo_sla.get("ongoingCycle") or (campo_sla.get("completedCycles") or [None])[-1]
        violado_por_key[issue.get("key")] = "Sim" if ciclo and ciclo.get("breached") else "Não"

    reabertos = {
        issue.get("key") for issue in _cache_consultar_em_lotes(config, chaves_unicas, 'status WAS "Reaberto"', ["key"])
    }
    return {
        chave: {
            "violado": violado_por_key.get(chave, "N/A"),
            "reaberto": "Sim" if chave in reabertos else "Não",
        }
        for chave in chaves_unicas
    }


def _cache_resolucao_jira(config, keys):
    """Para uma lista de chaves, busca no Jira a "Data de Resolução"
    (resolutiondate bruto, ISO 8601 — None pra quem ainda não foi
    resolvido) de cada uma e devolve {chave: resolutiondate}. Mesmo padrão
    de _cache_status_atual_jira; usado tanto pra chamados novos quanto pra
    recalcular os que ainda estão em aberto (podem ser resolvidos depois) e
    pra migrar planilhas antigas (sem essa coluna ainda)."""
    resolucao_por_key = {}
    for issue in _cache_consultar_em_lotes(config, keys, None, ["resolutiondate"]):
        row = flatten_issue(issue, ["resolutiondate"])
        resolucao_por_key[row["key"]] = row["resolutiondate"]
    return resolucao_por_key


def _cache_eps_sub_jira(config, keys):
    """Para uma lista de chaves, busca no Jira "PROP_Site" (EPS) e
    "Sub-Classificação" de cada uma e devolve {chave: {"eps":...,
    "subclassificacao":...}} — mesmo padrão de _cache_violado_reaberto_jira
    (os 2 field_id são resolvidos por nome; falha ao resolver um deles não
    derruba o outro, só sai None pra ele). Usado tanto pra chamados novos
    quanto pra recalcular/migrar planilhas antigas (sem essas 2 colunas
    ainda)."""
    if not keys:
        return {}
    eps_field_id = None
    try:
        eps_field_id = _resolve_eps_field_id(config)
    except Exception:
        app.logger.exception('Falha ao resolver o campo "PROP_Site" (EPS)')
    subclassificacao_field_id = None
    try:
        subclassificacao_field_id = _resolve_subclassificacao_field_id(config)
    except Exception:
        app.logger.exception('Falha ao resolver o campo "Sub-Classificação"')
    if not eps_field_id and not subclassificacao_field_id:
        return {}

    campos = [c for c in (eps_field_id, subclassificacao_field_id) if c]
    issues = _cache_consultar_em_lotes(config, keys, None, campos)
    return extract_eps_subclassificacao(config, issues, eps_field_id, subclassificacao_field_id)


def _cache_nome_arquivo_mes(ano, mes):
    return f"{CACHE_MESES_ABREV_REVERSO[mes]}-{ano}.xlsx"


def _cache_mes_do_arquivo(nome):
    """Devolve (ano, mês) a partir do nome "<mês-abrev>-<ano>.xlsx" (mesmo
    padrão de _cache_ordenar_chave) — None se o nome não bater com esse
    formato, ou a abreviação de mês for desconhecida."""
    match = CACHE_NOME_RE.match(nome)
    if not match:
        return None
    mes = CACHE_MESES_ABREV.get(match.group(1).lower())
    if mes is None:
        return None
    return int(match.group(2)), mes


def _cache_parse_data_iso(valor):
    """Converte o texto de uma data ISO 8601 do Jira (ex.:
    "2026-10-13T17:41:44.034-0300") num datetime — usado tanto pra "Data de
    Criação" (achar a "data corte" na sincronização) quanto pra "Data de
    Resolução" (bucket por mês no Pareto Solar). Ignora o fuso (todo
    chamado vem do mesmo Jira, então a ordem relativa não muda) — None se
    vier vazio/inesperado."""
    if not valor:
        return None
    try:
        return datetime.strptime(str(valor)[:19], "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return None


def _cache_jql_periodo(inicio, fim, caixa_id=CAIXA_SOLAR):
    """JQL fixa do cache: "a query pega tudo que foi criado nas caixas
    daquela partição" (N1/N2/Prod da Mops Solar, ou N1/N2 de Claro Tv —
    _build_base_jql(caixa_id), independente da caixa selecionada no
    alternador da tela), criado entre "inicio" e "fim" (dates, intervalo
    fechado, 00:00 a 23:59). "caixa_id" (CAIXA_SOLAR, padrão, ou CAIXA_TV)
    é o da partição de cache sendo usada (ver CACHE_PARTICOES) — cada
    partição só traz chamados da própria caixa, nunca as duas juntas (ver
    o histórico de bug em _cache_jql_periodo: combinar as duas numa query
    só quebrou a "data corte" de sincronização incremental)."""
    base = _build_base_jql(caixa_id)
    return f'{base} AND created >= "{inicio} 00:00" AND created <= "{fim} 23:59"'


def _cache_adicionar_colunas_calculadas(config, linhas):
    """Preenche, em cada linha de "linhas" (mutado in place — precisa ter
    CACHE_COL_CHAVE), as 5 colunas calculadas do cache (Violado/Já foi
    Reaberto/Data de Resolução/PROP_Site/Sub-Classificação — ver
    CACHE_COLUNAS_CALCULADAS), consultando o Jira em lotes por chave
    (_cache_violado_reaberto_jira/_cache_resolucao_jira/
    _cache_eps_sub_jira). Usada por _cache_buscar_novos (monta/sincroniza
    planilha de cache)."""
    chaves = [linha[CACHE_COL_CHAVE] for linha in linhas]
    info_por_chave = _cache_violado_reaberto_jira(config, chaves)
    resolucao_por_chave = _cache_resolucao_jira(config, chaves)
    eps_sub_por_chave = _cache_eps_sub_jira(config, chaves)
    for linha in linhas:
        info = info_por_chave.get(linha[CACHE_COL_CHAVE], {})
        linha[CACHE_COL_VIOLADO] = info.get("violado")
        linha[CACHE_COL_REABERTO] = info.get("reaberto")
        linha[CACHE_COL_RESOLUCAO] = resolucao_por_chave.get(linha[CACHE_COL_CHAVE])
        eps_sub = eps_sub_por_chave.get(linha[CACHE_COL_CHAVE], {})
        linha[CACHE_COL_EPS] = eps_sub.get("eps")
        linha[CACHE_COL_SUBCLASSIFICACAO] = eps_sub.get("subclassificacao")
    return linhas


def _cache_buscar_novos(config, inicio, fim, caixa_id=CAIXA_SOLAR):
    """Busca no Jira os chamados criados no período (mesma JQL/colunas de
    "Extração por Query" — fetch_chamados_por_query), pra popular uma
    planilha de cache nova ou acrescentar linhas novas numa sincronização.
    "caixa_id" é a caixa da partição de cache (ver CACHE_PARTICOES/
    _cache_jql_periodo). "Categoria de Encerramento"/"Classificação" são
    obrigatórios (sem eles não dá pra montar as colunas da planilha);
    "Grupo Solucionador" é best-effort, mesmo padrão do resto do app."""
    categoria_field_id = _resolve_categoria_encerramento_field_id(config)
    if not categoria_field_id:
        raise JiraExtractorError('Campo "Categoria de Encerramento" não encontrado no Jira.')
    classificacao_field_id = _resolve_classificacao_field_id(config)
    if not classificacao_field_id:
        raise JiraExtractorError('Campo "Classificação" não encontrado no Jira.')
    try:
        grupo_field_id = _resolve_grupo_field_id(config)
    except Exception:
        app.logger.exception("Falha ao resolver o campo Grupo Solucionador")
        grupo_field_id = None

    jql = _cache_jql_periodo(inicio, fim, caixa_id)
    linhas = fetch_chamados_por_query(config, jql, categoria_field_id, classificacao_field_id, grupo_field_id)
    return _cache_adicionar_colunas_calculadas(config, linhas)


def _cache_criar_planilha_mes(config, ano, mes, pasta=CACHE_DIR, caixa_id=CAIXA_SOLAR):
    """Cria do zero a planilha de cache de um mês, dentro de "pasta" (a da
    partição de cache em uso — ver CACHE_PARTICOES): busca tudo que foi
    criado nesse mês inteiro (dia 1 até o fim do mês, ou até hoje se for o
    mês corrente/incompleto), só da caixa "caixa_id", e grava um .xlsx
    novo com as mesmas colunas de sempre (CACHE_COLUNAS). Devolve (nome,
    caminho, quantidade de linhas)."""
    hoje = datetime.now(BRAZIL_TZ).date()
    inicio = date(ano, mes, 1)
    fim = min(date(ano, mes, calendar.monthrange(ano, mes)[1]), hoje)

    linhas = _cache_buscar_novos(config, inicio, fim, caixa_id) if inicio <= fim else []

    wb = Workbook()
    ws = wb.active
    ws.append(CACHE_COLUNAS)
    for linha in linhas:
        ws.append([linha.get(c) for c in CACHE_COLUNAS])

    nome = _cache_nome_arquivo_mes(ano, mes)
    try:
        os.makedirs(pasta, exist_ok=True)
    except OSError as e:
        raise JiraExtractorError(f'Não foi possível criar/acessar a pasta "{pasta}": {e}')
    caminho = os.path.join(pasta, nome)
    wb.save(caminho)
    return nome, caminho, len(linhas)


def _cache_garantir_mes_atual(body, particao):
    """"Quando o mês virar, automaticamente criar uma nova planilha" — se a
    planilha do mês corrente ainda não existe na pasta da partição em uso
    (ver CACHE_PARTICOES), cria e popula ela na hora (precisa de e-mail/
    token no corpo; sem credenciais válidas, não cria agora — a próxima
    listagem com o usuário logado tenta de novo). Best-effort: qualquer
    falha aqui (Jira fora do ar, campo não encontrado etc.) só vai pro
    log, nunca derruba a listagem."""
    hoje = datetime.now(BRAZIL_TZ).date()
    nome = _cache_nome_arquivo_mes(hoje.year, hoje.month)
    if os.path.isfile(os.path.join(particao["pasta"], nome)):
        return

    try:
        config = _config_from_request(body)
    except JiraExtractorError:
        return

    try:
        nome, _caminho, quantidade = _cache_criar_planilha_mes(
            config, hoje.year, hoje.month, particao["pasta"], particao["caixa"]
        )
        meta = _cache_load_meta(particao["pasta"])
        meta[nome] = datetime.now(BRAZIL_TZ).isoformat()
        _cache_save_meta(meta, particao["pasta"])
        app.logger.info('Planilha de cache do mês atual criada automaticamente: "%s" (%d chamados).', nome, quantidade)
    except Exception:
        app.logger.exception('Falha ao criar automaticamente a planilha do mês atual ("%s").', nome)


def _cache_colaboradores_mensal():
    """Monta a matriz Colaborador × Mês (Resolvidos/Violados/Reabertos) a
    partir das planilhas de cache — nenhuma consulta ao Jira, só lê os
    arquivos locais (widget "Colaboradores" da home, tag "Cacheado").
    "solar" aqui já inclui Prod (mesmo agrupamento de sempre desse widget —
    diferente da tela de Cache, que separa Prod à parte em colunas
    próprias). Arquivo que não bate com "<mês-abrev>-<ano>.xlsx" é
    ignorado (não dá pra posicionar numa coluna de mês)."""
    if not os.path.isdir(CACHE_DIR):
        raise JiraExtractorError(f'Pasta de cache não encontrada neste ambiente: "{CACHE_DIR}".')

    nomes = [n for n in os.listdir(CACHE_DIR) if n.lower().endswith(".xlsx") and not n.startswith("~$")]
    arquivos_por_mes = []
    for nome in sorted(nomes, key=_cache_ordenar_chave):
        mes_info = _cache_mes_do_arquivo(nome)
        if mes_info:
            arquivos_por_mes.append((mes_info, nome))

    meses = [f"{ano:04d}-{mes:02d}" for (ano, mes), _nome in arquivos_por_mes]
    dados = {CAIXA_SOLAR: {}, CAIXA_TV: {}}

    for (ano, mes), nome in arquivos_por_mes:
        mes_chave = f"{ano:04d}-{mes:02d}"
        try:
            wb = load_workbook(os.path.join(CACHE_DIR, nome), read_only=True, data_only=True)
        except Exception:
            app.logger.exception('Falha ao ler a planilha de cache "%s"', nome)
            continue
        try:
            ws = wb.active
            linhas = ws.iter_rows(values_only=True)
            header = next(linhas, None)
            if not header:
                continue
            colunas_necessarias = (CACHE_COL_STATUS, CACHE_COL_GRUPO, CACHE_COL_RESPONSAVEL)
            if any(c not in header for c in colunas_necessarias):
                continue
            idx = {
                c: header.index(c) if c in header else None
                for c in (CACHE_COL_STATUS, CACHE_COL_GRUPO, CACHE_COL_RESPONSAVEL, CACHE_COL_VIOLADO, CACHE_COL_REABERTO)
            }

            for linha in linhas:
                if linha is None or all(v is None for v in linha):
                    continue

                def valor(col, linha=linha):
                    i = idx[col]
                    return linha[i] if i is not None and i < len(linha) else None

                responsavel = valor(CACHE_COL_RESPONSAVEL)
                if not responsavel:
                    continue
                caixa_bruta = CACHE_GRUPO_PARA_CAIXA.get(valor(CACHE_COL_GRUPO))
                if caixa_bruta == CAIXA_TV:
                    caixa_id = CAIXA_TV
                elif caixa_bruta in (CAIXA_SOLAR, CACHE_CAIXA_PROD):
                    caixa_id = CAIXA_SOLAR
                else:
                    continue  # fora das 3 caixas rastreadas pelo cache

                bucket = dados[caixa_id].setdefault(responsavel, {}).setdefault(
                    mes_chave, {"resolvidos": 0, "violados": 0, "reabertos": 0, "dentro": 0, "fora": 0}
                )
                if valor(CACHE_COL_STATUS) in CACHE_STATUS_RESOLVIDOS:
                    bucket["resolvidos"] += 1
                    # "dentro"/"fora" (base do SLA% do Total, ver _montar_caixa) só
                    # conta chamados com Violado "Sim"/"Não" — "N/A" (sem o campo
                    # de SLA que o gadget de referência usa, CACHE_SLA_FIELD_PRINCIPAL)
                    # fica de fora da conta, mesma regra de _cache_sla_historico.
                    violado_valor = valor(CACHE_COL_VIOLADO)
                    if violado_valor == "Sim":
                        bucket["fora"] += 1
                    elif violado_valor == "Não":
                        bucket["dentro"] += 1
                if valor(CACHE_COL_VIOLADO) == "Sim":
                    bucket["violados"] += 1
                if valor(CACHE_COL_REABERTO) == "Sim":
                    bucket["reabertos"] += 1
        finally:
            wb.close()

    def _montar_caixa(caixa_id):
        # "total" soma os 3 campos em todos os meses — usado tanto pra
        # ordenar (maior primeiro) quanto pra coluna "Total" da tabela
        # (mesmo formato Resolvidos/Violados/Reabertos dos meses). Esconde
        # quem não teve nenhum chamado em nenhuma das 3 colunas em nenhum
        # mês (linha toda zerada, só polui a tabela).
        colaboradores = []
        for nome_colab, por_mes in dados[caixa_id].items():
            total = {
                "resolvidos": sum(v["resolvidos"] for v in por_mes.values()),
                "violados": sum(v["violados"] for v in por_mes.values()),
                "reabertos": sum(v["reabertos"] for v in por_mes.values()),
            }
            if not (total["resolvidos"] or total["violados"] or total["reabertos"]):
                continue
            # SLA% do colaborador sobre o TOTAL (todos os meses juntos, não por
            # mês) — dentro/(dentro+fora), excluindo os "N/A" (ver comentário
            # acima, na contagem de "dentro"/"fora").
            dentro = sum(v["dentro"] for v in por_mes.values())
            fora = sum(v["fora"] for v in por_mes.values())
            total_com_sla = dentro + fora
            total["percentual_dentro_prazo"] = round(dentro / total_com_sla * 100, 1) if total_com_sla else None
            colaboradores.append({"nome": nome_colab, "por_mes": por_mes, "total": total})
        colaboradores.sort(
            key=lambda c: c["total"]["resolvidos"] + c["total"]["violados"] + c["total"]["reabertos"], reverse=True
        )
        return colaboradores

    return {
        "meses": meses,
        "caixas": [
            {"caixa": CAIXA_SOLAR, "colaboradores": _montar_caixa(CAIXA_SOLAR)},
            {"caixa": CAIXA_TV, "colaboradores": _montar_caixa(CAIXA_TV)},
        ],
    }


@app.route("/api/cache/arquivos", methods=["POST"])
def cache_arquivos():
    """Lista as planilhas da pasta escolhida na tela ("caixa" + "pasta"
    opcional no corpo — ver _cache_resolve_particao/CACHE_PARTICOES), uma
    por mês. Normalmente não depende de e-mail/token (só lê o sistema de
    arquivos local) — exceto quando a planilha do mês corrente ainda não
    existe, caso em que usa as credenciais do corpo (se vierem) pra criar
    e popular ela na hora (_cache_garantir_mes_atual). Pra cada planilha:
    total de chamados, quantos ainda estão em aberto (status fora de
    CACHE_STATUS_FECHADOS, por caixa) e a última vez que foi sincronizada
    (None se nunca). "caixas" devolve o label + a pasta PADRÃO de cada
    caixa (pra tela saber pra qual caminho voltar o campo de texto quando
    o usuário troca de caixa)."""
    body = request.get_json(silent=True) or {}
    particao = _cache_resolve_particao(body)
    _cache_garantir_mes_atual(body, particao)
    return jsonify(
        {
            "caixa": particao["caixa"],
            "pasta": particao["pasta"],
            "caixas": [{"id": v["id"], "label": v["label"], "pasta_padrao": v["pasta"]} for v in CACHE_PARTICOES.values()],
            "arquivos": _cache_listar_planilhas(particao["pasta"]),
        }
    )


@app.route("/api/cache/escolher-pasta", methods=["POST"])
def cache_escolher_pasta():
    """Abre um seletor de pasta NATIVO do sistema operacional — só faz
    sentido rodando localmente (mesma máquina do navegador e do
    "python api/index.py": o diálogo abre no desktop de quem está rodando
    o servidor, não no navegador de quem está vendo a tela). Usa tkinter
    (vem junto do Python padrão no Windows; importado aqui dentro, não no
    topo do arquivo, pra não virar dependência obrigatória do resto do
    app — as rotas de produção/Vercel não precisam de GUI nenhuma).
    Devolve {"pasta": caminho} com o que foi escolhido, ou "" se a pessoa
    cancelou o diálogo (não é erro)."""
    body = request.get_json(silent=True) or {}
    inicial = (body.get("pasta") or "").strip()
    if not os.path.isdir(inicial):
        inicial = CACHE_BASE_DIR if os.path.isdir(CACHE_BASE_DIR) else os.path.expanduser("~")

    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        raise JiraExtractorError("Seletor de pasta nativo não disponível neste ambiente.")

    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        escolhida = filedialog.askdirectory(initialdir=inicial, title="Escolher pasta de origem do cache")
        root.destroy()
    except Exception as e:
        raise JiraExtractorError(f"Não foi possível abrir o seletor de pasta: {e}")

    return jsonify({"pasta": escolhida or ""})


# Colunas calculadas à parte (não vêm de fetch_chamados_por_query) que
# toda planilha de cache precisa ter — usado por _cache_migrar_colunas
# pra saber o que acrescentar em planilhas antigas, e por
# _cache_entradas_pendentes pra saber o que conferir se ainda falta.
CACHE_COLUNAS_CALCULADAS = (
    CACHE_COL_VIOLADO,
    CACHE_COL_REABERTO,
    CACHE_COL_RESOLUCAO,
    CACHE_COL_EPS,
    CACHE_COL_SUBCLASSIFICACAO,
)

# Subconjunto de CACHE_COLUNAS_CALCULADAS cuja ausência dispara
# reconferência (ver "falta_algo" em _cache_entradas_pendentes).
# PROP_Site e Sub-Classificação ficam de fora de propósito: são
# preenchidas 1 única vez — só quando o chamado entra na planilha como
# linha nova (sincronizar-finalizar) — e nunca mudam depois (não é um
# dado que o Jira atualiza ao longo da vida do chamado, como
# Violado/Reaberto/Resolução são). Sem essa exclusão, chamado com esses
# campos genuinamente vazios no Jira (não é "ainda não conferido", é
# "não tem mesmo") entrava pra sempre na lista de pendentes, gerando
# consultas inúteis a cada sincronização.
CACHE_COLUNAS_RECHECK_AO_FALTAR = (CACHE_COL_VIOLADO, CACHE_COL_REABERTO, CACHE_COL_RESOLUCAO)


def _cache_migrar_colunas(ws, header):
    """Planilhas criadas antes de alguma coluna calculada
    (CACHE_COLUNAS_CALCULADAS) existir não têm essa coluna — acrescenta
    agora (linhas já existentes ficam em branco, entram no backfill de
    _cache_entradas_pendentes). Devolve {coluna: índice 1-based}. Muta
    "header" in place."""
    for coluna in CACHE_COLUNAS_CALCULADAS:
        if coluna not in header:
            header.append(coluna)
            ws.cell(row=1, column=len(header)).value = coluna
    return {coluna: header.index(coluna) + 1 for coluna in CACHE_COLUNAS_CALCULADAS}


# Jira finaliza o SLA ("Violado") de forma ASSÍNCRONA — o ciclo pode ficar
# "ongoingCycle" (ainda não marcado breached) na hora exata em que o
# chamado fecha e só vira "completedCycles" (breached definitivo) dias
# depois. Sem isso, um chamado fechado logo após o sync checar Violado
# ficava com valor errado PARA SEMPRE (nunca mais reconferido) — foi o que
# gerou números de SLA incorretos no widget "SLA" da home (descoberto
# comparando com o gadget nativo do Jira: cache mostrava só 4 violados de
# ~400 chamados do mês, o gadget real mostrava 48 de 474). Todo chamado
# fechado há até esse tanto de dias é reconferido de novo a cada
# sincronização, não só os ainda abertos. 5 dias (não mais 30): um
# chamado Resolvido vira Encerrado automaticamente em até 72h se não for
# reaberto, então o SLA já deveria estar definitivo bem antes disso —
# 5 dias dá uma folga de ~48h além desse prazo.
CACHE_SLA_RECHECK_DIAS = 5


def _cache_entradas_pendentes(ws, col_chave, col_status, cols_calculadas):
    """Varre todas as linhas da planilha e devolve a lista de entradas que
    precisam de alguma consulta ao Jira na sincronização: todo chamado em
    aberto (pode mudar de status, violar, reabrir ou ser resolvido) + todo
    chamado (aberto ou fechado) que ainda não tem alguma das
    CACHE_COLUNAS_RECHECK_AO_FALTAR preenchida (planilha migrada agora, ou
    linha de antes dessas colunas existirem — PROP_Site/Sub-Classificação
    ficam de fora desse gatilho, ver CACHE_COLUNAS_RECHECK_AO_FALTAR) +
    todo chamado fechado há até CACHE_SLA_RECHECK_DIAS dias (o SLA pode ter
    sido finalizado pelo Jira só depois do fechamento — ver
    CACHE_SLA_RECHECK_DIAS). "cols_calculadas" é o dict {coluna: índice
    1-based} devolvido por _cache_migrar_colunas. Cada entrada é {"linha":
    row_idx, "chave": chave, "aberto": bool} — "aberto" decide se o lote
    vai sobrescrever a célula "Status" daquela linha ou só os campos
    calculados à parte."""
    entradas = []
    hoje = datetime.now(BRAZIL_TZ).date()
    col_resolucao = cols_calculadas.get(CACHE_COL_RESOLUCAO)
    for row_idx in range(2, ws.max_row + 1):
        chave = ws.cell(row=row_idx, column=col_chave).value
        if not chave:
            continue
        status_atual = ws.cell(row=row_idx, column=col_status).value
        aberto = status_atual not in CACHE_STATUS_FECHADOS
        falta_algo = any(
            not ws.cell(row=row_idx, column=col).value
            for coluna, col in cols_calculadas.items()
            if coluna in CACHE_COLUNAS_RECHECK_AO_FALTAR
        )

        fechado_recente = False
        if not aberto and col_resolucao:
            resolucao = _cache_parse_data_iso(ws.cell(row=row_idx, column=col_resolucao).value)
            if resolucao and (hoje - resolucao.date()).days <= CACHE_SLA_RECHECK_DIAS:
                fechado_recente = True

        if aberto or falta_algo or fechado_recente:
            entradas.append({"linha": row_idx, "chave": chave, "aberto": aberto})
    return entradas


@app.route("/api/cache/sincronizar-preparar", methods=["POST"])
def cache_sincronizar_preparar():
    """1º passo da sincronização: migra as colunas calculadas
    (CACHE_COLUNAS_CALCULADAS: Violado/Já foi Reaberto/Data de
    Resolução/PROP_Site/Sub-Classificação) se a planilha ainda não tiver
    (escrita rápida, só o cabeçalho) e devolve a lista de entradas que
    precisam de alguma consulta ao Jira (_cache_entradas_pendentes) — a
    tela divide essa lista em lotes de CACHE_SYNC_LOTE chamados e manda um
    lote por vez pra /api/cache/sincronizar-lote, mostrando o progresso
    (ex.: "03/10") na própria linha da planilha. Não consulta o Jira ainda
    (só abre/grava a planilha local). "particao" no corpo escolhe a pasta
    (ver CACHE_PARTICOES)."""
    body = request.get_json(silent=True) or {}
    _config_from_request(body)  # só valida que vieram credenciais
    particao = _cache_resolve_particao(body)
    caminho, nome = _cache_resolve_path(body.get("nome"), particao["pasta"])

    wb = load_workbook(caminho)
    try:
        ws = wb.active
        header = [cell.value for cell in ws[1]]
        if CACHE_COL_CHAVE not in header or CACHE_COL_STATUS not in header:
            raise JiraExtractorError(
                f'A planilha "{nome}" não tem as colunas "{CACHE_COL_CHAVE}"/"{CACHE_COL_STATUS}" esperadas.'
            )
        col_chave = header.index(CACHE_COL_CHAVE) + 1
        col_status = header.index(CACHE_COL_STATUS) + 1
        cols_calculadas = _cache_migrar_colunas(ws, header)

        entradas = _cache_entradas_pendentes(ws, col_chave, col_status, cols_calculadas)

        wb.save(caminho)
    finally:
        wb.close()

    return jsonify({"nome": nome, "entradas": entradas, "lote": CACHE_SYNC_LOTE})


@app.route("/api/cache/sincronizar-lote", methods=["POST"])
def cache_sincronizar_lote():
    """2º passo (chamado repetidas vezes, um lote por vez — ver
    sincronizar-preparar): pra até CACHE_SYNC_LOTE chamados de uma vez
    (parâmetro é sempre o número do chamado, INC-xxxxxx ou PDST-xxxxxx —
    "key IN (...)" no Jira, nunca mais que um lote de cada vez pra não
    pesar a API), busca o status ATUAL (só sobrescreve a célula "Status"
    de quem a tela marcou como "aberto" nesse lote) e as
    CACHE_COLUNAS_CALCULADAS (Violado/Já foi Reaberto/Data de
    Resolução/PROP_Site/Sub-Classificação, sempre, pra todo mundo do
    lote) — e grava na planilha. "particao" no corpo escolhe a pasta (ver
    CACHE_PARTICOES)."""
    body = request.get_json(silent=True) or {}
    config = _config_from_request(body)
    particao = _cache_resolve_particao(body)
    caminho, nome = _cache_resolve_path(body.get("nome"), particao["pasta"])
    entradas = body.get("entradas") or []
    if not isinstance(entradas, list) or not entradas:
        raise JiraExtractorError('"entradas" precisa ser uma lista não vazia.')
    if len(entradas) > CACHE_SYNC_LOTE:
        raise JiraExtractorError(f"Lote maior que o permitido (máximo {CACHE_SYNC_LOTE}).")

    chaves = [e.get("chave") for e in entradas if e.get("chave")]

    wb = load_workbook(caminho)
    try:
        ws = wb.active
        header = [cell.value for cell in ws[1]]
        colunas_esperadas = (CACHE_COL_STATUS, *CACHE_COLUNAS_CALCULADAS)
        if any(c not in header for c in colunas_esperadas):
            raise JiraExtractorError(f'A planilha "{nome}" não está preparada (chame sincronizar-preparar antes).')
        col_status = header.index(CACHE_COL_STATUS) + 1
        col_violado = header.index(CACHE_COL_VIOLADO) + 1
        col_reaberto = header.index(CACHE_COL_REABERTO) + 1
        col_resolucao = header.index(CACHE_COL_RESOLUCAO) + 1
        col_eps = header.index(CACHE_COL_EPS) + 1
        col_subclassificacao = header.index(CACHE_COL_SUBCLASSIFICACAO) + 1

        status_por_key = _cache_status_atual_jira(config, chaves)
        try:
            info_sla = _cache_violado_reaberto_jira(config, chaves)
        except Exception:
            app.logger.exception('Falha ao calcular Violado/Já foi Reaberto pra um lote de "%s"', nome)
            info_sla = {}
        try:
            resolucao_por_key = _cache_resolucao_jira(config, chaves)
        except Exception:
            app.logger.exception('Falha ao calcular Data de Resolução pra um lote de "%s"', nome)
            resolucao_por_key = {}
        try:
            eps_sub_por_key = _cache_eps_sub_jira(config, chaves)
        except Exception:
            app.logger.exception('Falha ao calcular PROP_Site/Sub-Classificação pra um lote de "%s"', nome)
            eps_sub_por_key = {}

        atualizados = 0
        for entrada in entradas:
            row_idx, chave, aberto = entrada.get("linha"), entrada.get("chave"), entrada.get("aberto")
            if not row_idx or not chave:
                continue
            if aberto:
                novo_status = status_por_key.get(chave)
                if novo_status and novo_status != ws.cell(row=row_idx, column=col_status).value:
                    ws.cell(row=row_idx, column=col_status).value = novo_status
                    atualizados += 1
            info = info_sla.get(chave)
            if info:
                ws.cell(row=row_idx, column=col_violado).value = info["violado"]
                ws.cell(row=row_idx, column=col_reaberto).value = info["reaberto"]
            if chave in resolucao_por_key:
                ws.cell(row=row_idx, column=col_resolucao).value = resolucao_por_key[chave]
            eps_sub = eps_sub_por_key.get(chave)
            if eps_sub:
                ws.cell(row=row_idx, column=col_eps).value = eps_sub.get("eps")
                ws.cell(row=row_idx, column=col_subclassificacao).value = eps_sub.get("subclassificacao")

        wb.save(caminho)
    finally:
        wb.close()

    return jsonify({"nome": nome, "processados": len(entradas), "atualizados": atualizados})


@app.route("/api/cache/sincronizar-finalizar", methods=["POST"])
def cache_sincronizar_finalizar():
    """3º e último passo: acha a "data corte" (maior "Data de Criação" já
    presente na planilha, depois de todos os lotes já aplicados) e busca
    no Jira tudo que foi criado depois dela até o fim do mês daquele
    arquivo (ou até hoje, se for o mês corrente) — mesma JQL fixa de
    sempre, só da caixa da partição em uso (ver CACHE_PARTICOES/
    _cache_jql_periodo), já vem com Violado/Já foi Reaberto calculados
    (_cache_buscar_novos). Quem ainda não está na planilha entra como
    linha nova. Best-effort (uma falha aqui não desfaz os lotes já salvos)
    — sempre marca a planilha como sincronizada no final, já que a etapa
    de status/SLA (a cara da operação) já rodou."""
    body = request.get_json(silent=True) or {}
    config = _config_from_request(body)
    particao = _cache_resolve_particao(body)
    caminho, nome = _cache_resolve_path(body.get("nome"), particao["pasta"])

    wb = load_workbook(caminho)
    try:
        ws = wb.active
        header = [cell.value for cell in ws[1]]
        if CACHE_COL_CHAVE not in header:
            raise JiraExtractorError(f'A planilha "{nome}" não tem a coluna "{CACHE_COL_CHAVE}" esperada.')
        col_chave = header.index(CACHE_COL_CHAVE) + 1
        col_criacao = header.index(CACHE_COL_CRIACAO) + 1 if CACHE_COL_CRIACAO in header else None

        chaves_existentes = set()
        data_corte = None
        for row_idx in range(2, ws.max_row + 1):
            chave = ws.cell(row=row_idx, column=col_chave).value
            if not chave:
                continue
            chaves_existentes.add(chave)
            if col_criacao:
                criado_em = _cache_parse_data_iso(ws.cell(row=row_idx, column=col_criacao).value)
                if criado_em and (data_corte is None or criado_em > data_corte):
                    data_corte = criado_em

        novos = 0
        mes_info = _cache_mes_do_arquivo(nome)
        if mes_info:
            ano, mes = mes_info
            hoje = datetime.now(BRAZIL_TZ).date()
            fim = min(date(ano, mes, calendar.monthrange(ano, mes)[1]), hoje)
            inicio = data_corte.date() if data_corte else date(ano, mes, 1)
            if inicio <= fim:
                try:
                    novas_linhas = _cache_buscar_novos(config, inicio, fim, particao["caixa"])
                except Exception:
                    app.logger.exception('Falha ao buscar novos chamados pra planilha "%s"', nome)
                    novas_linhas = []
                for linha in novas_linhas:
                    chave = linha.get(CACHE_COL_CHAVE)
                    if not chave or chave in chaves_existentes:
                        continue
                    ws.append([linha.get(c) for c in header])
                    chaves_existentes.add(chave)
                    novos += 1

        wb.save(caminho)
    finally:
        wb.close()

    total, abertos, abertos_por_caixa = _cache_contar_status(caminho)

    meta = _cache_load_meta(particao["pasta"])
    sincronizado_em = datetime.now(BRAZIL_TZ).isoformat()
    meta[nome] = sincronizado_em
    _cache_save_meta(meta, particao["pasta"])

    return jsonify(
        {
            "nome": nome,
            "novos": novos,
            "total": total,
            "abertos": abertos,
            "abertos_por_caixa": abertos_por_caixa,
            "sincronizado_em": sincronizado_em,
        }
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
