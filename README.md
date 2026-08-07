# Extração de Chamados Jira

Ferramenta Python que extrai chamados do Jira Cloud via REST API (JQL configurável) e exporta para CSV e/ou Excel. Disponível em duas formas: uma **interface gráfica** ([jira_gui.py](jira_gui.py)), pensada para o time todo usar sem precisar mexer em `.env`/terminal, e uma **linha de comando** ([jira_extractor.py](jira_extractor.py)), útil para automação.

## Interface gráfica (recomendado para o time)

```
pip install -r requirements.txt
python jira_gui.py
```

Ao abrir, conecta automaticamente usando **URL, e-mail e API Token do `.env`** (a mesma configuração para todo o time — veja "Copie `.env.example`..." abaixo). Não há tela de login.

O `ORDER BY` da JQL é fixo no código — não aparece nem é editável na tela. Já **Projeto**, **Grupo Solucionador** e **status a considerar** são seleção múltipla (checkboxes) na tela principal:

- **Projeto**: marque um ou mais projetos (`Abertura de Chamados`, `Central de Incidentes`). Apenas "Central de Incidentes" vem marcado por padrão.
- **Grupo Solucionador**: marque um ou mais grupos (`CLBR-TI-OPS-OGS-SOLAR-SALESFORCE-N2`, `CLBR-TI-OPS-OGS SOLAR SALESFORCE`, `CLBR-TI-OPS-PROD SOLAR SALESFORCE`) para incluir na busca. Todos vêm marcados por padrão.
- **Status a considerar**: marque quais status (`Triagem`, `Aguardando Suporte`, `Aguardando Fornecedor`, `Reaberto`, `Em atendimento`, `Aguardando Cliente`, `Aberto`, `Encaminhado`, `Encerrado`, `Resolvido`, `Cancelado`) entram no resultado. Todos vêm marcados por padrão.

A JQL final é montada a partir dessas seleções toda vez que um botão de ação é clicado. Quando **Aguardando Fornecedor** está marcado, a saída ganha automaticamente a coluna `fornecedor_responsavel`.

A tela principal mostra o status da conexão, os filtros acima, o formato de saída (CSV/Excel/Ambos) e os quatro botões de extração:
- **📋 Extração completa**
- **⏰ Chamados a violar hoje**
- **📅 Chamados a violar amanhã**
- **🔴 Chamados violados** — chamados cujo SLA de resolução já estourou (`"Tempo de Resolução" < 0h OR "Tempo de resolução" < 0h`), reaproveitando os mesmos filtros de grupo/status

Abaixo das ações fica o card **Reports**, com dois botões que escrevem na mesma caixa de texto:

- **📝 Report Diário**: gera o "Relatório MOPS Operacional" do dia atual (veja modelo abaixo).
- **📊 Relatório Consolidado**: abre um diálogo pedindo **data início** e **data fim** (dd/mm/aaaa) e gera um relatório de SLA, taxas de reabertura e top analistas para o período (veja modelo mais abaixo).

Ambos **sempre** consideram os 3 Grupos Solucionador e os dois projetos (Central de Incidentes + Abertura de Chamados) combinados — não dependem dos checkboxes de Projeto/Grupo/Status da tela.

Depois de gerado, o report pode ser: **Copiar** (área de transferência, pra colar no Slack/Teams/WhatsApp), **📄 Exportar PDF** (salva em `output/relatorio_<timestamp>.pdf`) ou **Limpar** (apaga a caixa).

O conteúdo tem rolagem (barra lateral ou roda do mouse) caso não caiba na altura da janela. O log de execução aparece na própria janela, e o botão **Abrir pasta de saída** abre a pasta `output/` no Explorer.

Para alterar o `ORDER BY` fixo ou a lista de projetos/grupos/status disponíveis nos checkboxes, edite as constantes no topo de [jira_gui.py](jira_gui.py).

### Executável (sem precisar instalar Python)

Para distribuir para quem não tem Python instalado, gere um `.exe` único e "windowed" (sem janela de terminal/console — o log de execução continua aparecendo normalmente dentro da própria janela da aplicação):

```
pip install -r requirements.txt pyinstaller
python -m PyInstaller --onefile --windowed --name "ExtratorJira" --clean --noconfirm jira_gui.py
```

O executável fica em `dist/ExtratorJira.exe`. Para distribuir, copie junto o `.env.example` (renomeie para `.env` e preencha URL/e-mail/API Token — ele deve ficar **na mesma pasta do `.exe`**). Qualquer usuário do time pode então rodar só com um duplo clique, sem instalar nada.



1. Instale as dependências:
   ```
   pip install -r requirements.txt
   ```

2. Copie `.env.example` para `.env` e preencha:
   - `JIRA_URL`: URL do seu Jira (ex: `https://suaempresa.atlassian.net`)
   - `JIRA_EMAIL`: e-mail da sua conta Atlassian
   - `JIRA_API_TOKEN`: gere em https://id.atlassian.com/manage-profile/security/api-tokens
   - `JIRA_JQL`: query JQL padrão (pode ser sobrescrita via `--jql`)

## Uso (CLI)

Rodando sem argumentos, o script abre um menu interativo:

```
python jira_extractor.py

===== Extração de Chamados Jira =====
1 - Extração completa
2 - Chamados a violar no dia (SLA 07:00 às 23:59)
3 - Chamados a violar amanhã (SLA 07:00 às 23:59)
4 - Chamados violados
0 - Sair
```

- **1 - Extração completa**: busca todos os chamados que satisfazem a `JIRA_JQL` do `.env` e exporta.
- **2/3 - Chamados a violar hoje/amanhã**: reaproveita os filtros de projeto/grupo/status da `JIRA_JQL` do `.env` (ignorando o `ORDER BY`), restringe aos status "Aguardando Suporte", "Encaminhado" e "Em atendimento", e retorna apenas os chamados cujo SLA de **Tempo de Resolução** estoura no dia-alvo, dentro da janela **07:00–23:59**, ordenados do mais urgente para o menos urgente. A saída inclui `sla_estoura_em`, `hora_violacao` (HH:MM) e `horas_restantes`.
- **4 - Chamados violados**: reaproveita os filtros base da `JIRA_JQL` do `.env` e adiciona `AND (cf[10419] < 0h OR cf[10629] < 0h)`, retornando chamados cujo SLA de resolução já estourou. A saída inclui `sla_estourou_em` e `horas_em_atraso`.

Para automação (cron, Agendador de Tarefas, etc.), use `--mode` para pular o menu:

```
# Extração completa direto, sem menu
python jira_extractor.py --mode completa

# Chamados a violar no dia, sem menu
python jira_extractor.py --mode violar

# Chamados já violados, sem menu
python jira_extractor.py --mode violados

# Sobrescreve a JQL da extração completa
python jira_extractor.py --mode completa --jql "project = ABC AND status = Done"

# Escolhe apenas CSV ou apenas Excel
python jira_extractor.py --mode completa --format csv
python jira_extractor.py --mode violar --format excel

# Escolhe os campos extraídos (apenas no modo "completa")
python jira_extractor.py --mode completa --fields key,summary,status,assignee,created

# Nome customizado do arquivo de saída
python jira_extractor.py --mode completa --output relatorio_agosto
```

Os arquivos são salvos na pasta `output/`, com timestamp no nome (ex: `chamados_jira_20260805_164500.csv`, `chamados_a_violar_hoje_20260805_175330.csv`).

## Campos padrão extraídos (extração completa)

`summary`, `status`, `issuetype`, `priority`, `assignee`, `reporter`, `project`, `created`, `updated`, `resolutiondate` (mais a `key` do chamado).

Qualquer campo válido do Jira pode ser usado via `--fields` (ex: `labels`, `components`, `description`, campos customizados como `customfield_10010`).

## Chamados a violar no dia — como funciona

O SLA "Tempo de Resolução" no Jira Service Management expõe um campo customizado (`customfield_10419` no projeto "Abertura de Chamados", `customfield_10629` no projeto "Central de Incidentes" — o ID varia por esquema de projeto) contendo `breachTime`, a data/hora em que o prazo estoura. Enquanto o chamado está aberto, esse dado fica em `ongoingCycle`; quando o Jira finaliza o SLA (às vezes de forma assíncrona, um tempo depois do chamado já estar resolvido), ele passa para `completedCycles` — `extract_sla_breach()` verifica os dois. O script:

1. Busca todos os chamados abertos (filtro base do `.env`, sem `ORDER BY`).
2. Lê o campo de SLA correspondente ao esquema do projeto do chamado.
3. Mantém apenas os que ainda não estouraram (`breached = false`) e cujo `breachTime` cai **hoje**, entre 07:00 e 23:59 (horário de Brasília, fixo em -03:00).
4. Ordena por horário de estouro (mais urgente primeiro).

Se o seu Jira usar outro campo/ID para o SLA de resolução, ajuste a lista `SLA_RESOLUTION_FIELDS` em [jira_extractor.py](jira_extractor.py).

## Coluna "Fornecedor Responsável"

Quando o status **Aguardando Fornecedor** está entre os selecionados (GUI) ou quando `incluir_fornecedor=True` é passado (CLI/API interna), a saída ganha a coluna `fornecedor_responsavel`, lida do campo customizado `customfield_31880` (com `customfield_16762` como alternativa). Ajuste `FORNECEDOR_RESPONSAVEL_FIELDS` em [jira_extractor.py](jira_extractor.py) se o ID mudar.

## Report Diário ("Relatório MOPS Operacional")

Disponível apenas na GUI, via `build_daily_report()` em [jira_extractor.py](jira_extractor.py). As 6 métricas são calculadas **separadamente para cada um dos 3 Grupos Solucionador**. Formato gerado:

```
⏰RELATÓRIO MOPS OPERACIONAL - 05/08 21:00

# CLBR-TI-OPS-OGS-SOLAR-SALESFORCE-N2 #
🔸 Incidentes resolvidos: 18
🔸 Solicitações resolvidas: 0
🔸 Chamados a violar no dia atual: 0
🔸 Quantidade atual de fornecedores: 26
🔸 Top analista do dia: CRISTIAN SARAIVA BETTUCI (4 resolvidos)
🔸 Quantidade de violados no dia: 1

# CLBR-TI-OPS-OGS SOLAR SALESFORCE #
🔸 Incidentes resolvidos: 52
🔸 Solicitações resolvidas: 2
🔸 Chamados a violar no dia atual: 0
🔸 Quantidade atual de fornecedores: 3
🔸 Top analista do dia: TAMIRES COSTA SANTOS (21 resolvidos)
🔸 Quantidade de violados no dia: 3

# CLBR-TI-OPS-PROD SOLAR SALESFORCE #
🔸 Incidentes resolvidos: 1
🔸 Solicitações resolvidas: 5
🔸 Chamados a violar no dia atual: 0
🔸 Quantidade atual de fornecedores: 0
🔸 Top analista do dia: DIEGHO MORAES BISTRATINI (5 resolvidos)
🔸 Quantidade de violados no dia: 1

# Resumo Geral #
🔸 Incidentes resolvidos: 71
🔸 Solicitações resolvidas: 7
🔸 Chamados a violar no dia atual: 0
🔸 Quantidade atual de fornecedores: 29
🔸 Top analista do dia: TAMIRES COSTA SANTOS (21 resolvidos)
🔸 Quantidade de violados no dia: 5
```

"Incidentes resolvidos" = chamados `Resolvido` no projeto Central de Incidentes; "Solicitações resolvidas" = chamados `Resolvido` no projeto Abertura de Chamados. O **Resumo Geral**, no final, recalcula as mesmas métricas considerando os 3 grupos juntos na mesma consulta (não é soma aritmética dos blocos feita à parte — por isso "Top analista" reflete o analista com mais resolvidos no total, não por grupo).

Como cada métrica é calculada por grupo (sempre combinando os dois projetos, hoje entre 07:00 e 23:59, horário de Brasília):

- **Resolvido INC/PDST**: chamados com `status = "Resolvido"` e `resolutiondate` dentro da janela de hoje, contados separadamente por projeto.
- **Chamados a violar no dia atual**: reaproveita a mesma lógica do botão "Chamados a violar hoje".
- **Quantidade atual de fornecedores**: contagem atual (sem filtro de data) de chamados com `status = "Aguardando Fornecedor"`.
- **Top analista do dia**: entre os chamados resolvidos hoje (INC + PDST), o assignee com mais chamados resolvidos.
- **Quantidade de violados no dia**: filtra primeiro no Jira quem já estourou (`"Tempo de Resolução" < 0h OR "Tempo de resolução" < 0h`, mesma lógica de "Chamados violados") e depois conta, entre esses, quantos têm o horário de estouro (`breachTime`) dentro da janela de hoje.

## Relatório Consolidado (por período)

Via `build_consolidated_report()` em [jira_extractor.py](jira_extractor.py). O botão **📊 Relatório Consolidado** pede data início e fim (dd/mm/aaaa) e considera o **dia inteiro** de cada data (00:00 do início até 23:59 do fim, horário de Brasília), sempre com os 3 Grupos Solucionador fixos. As seções **SLA** e **Taxas de Reabertura** consideram apenas o projeto **Central de Incidentes**; a seção **Top Analistas** combina Central de Incidentes + Abertura de Chamados. Formato gerado:

```
📊 RELATÓRIO CONSOLIDADO - 01/08/2026 a 06/08/2026

# SLA - CAIXAS GERAIS #

🔸 Total geral de chamados abertos (considere as 3 caixas): 1271
🔸 Total geral de chamados encerrados (considere as 3 caixas): 1317
🔸 Encerrados dentro do prazo: 1206 (92.6%)
🔸 Encerrados violados: 97 (7.4%)
🔸 SLA percentual (dentro do prazo x violados): 92.6%

# TAXAS DE REABERTURA - CAIXAS GERAIS #

🔸 Reabertos N1 (CLBR-TI-OPS-OGS SOLAR SALESFORCE): 3 (60.0%)
🔸 Reabertos N2 (CLBR-TI-OPS-OGS-SOLAR-SALESFORCE-N2): 2 (40.0%)
🔸 Reabertos Prod (CLBR-TI-OPS-PROD SOLAR SALESFORCE): 0 (0.0%)
🔸 Soma total de reabertura: 5 (2.6%)

# TOP ANALISTAS #

🔸 Top 1 analista N1: TAMIRES COSTA SANTOS (42 encerrados)
🔸 Top 2 analista N1: MICHELLE CRISTINA DA SILVA RICARDO (40 encerrados)
🔸 Top 3 analista N1: LETICIA NOVARINO BRITTO (32 encerrados)
🔸 Top 1 analista N2: GUILHERME BONDEZAN YONAMINE (21 encerrados)
🔸 Top 2 analista N2: DANIEL DOS SANTOS REIS (9 encerrados)
🔸 Top 3 analista N2: JONATAS DA SILVA PEREIRA (9 encerrados)

# ESCALONAMENTOS E PRIORIDADES #

🔸 Chamados Clarinha: 0
🔸 Escalonamentos LJ: 10
🔸 Chamados Críticos totais: 58 (4.6%)
🔸 Chamados Pontuais: 17 (29.3%)
```

Como cada métrica é calculada:

- **Total geral de chamados abertos**: chamados `created` dentro do período, nas 3 caixas combinadas, **só projeto Central de Incidentes**.
- **Total geral de chamados encerrados**: chamados com `resolutiondate` dentro do período, nas 3 caixas combinadas, **só projeto Central de Incidentes** — não filtra pelo status atual (um chamado resolvido no período e depois reaberto/movido para outro status ainda conta, igual ao gadget nativo do Jira usado como referência).
- **Encerrados dentro do prazo / Encerrados violados**: dos chamados com **status atual `Resolvido` ou `Encerrado`** e `resolutiondate` no período (um subconjunto do "Total geral de chamados encerrados" acima, que não filtra por status atual), quantos têm o campo de SLA "Tempo de Resolução" com `breached = false` (dentro do prazo) ou `breached = true` (estourado). Chamados sem esse campo preenchido não entram em nenhuma das duas. Os percentuais são sobre a soma dessas duas linhas (não sobre o total geral de encerrados).
- **SLA percentual**: `Encerrados dentro do prazo ÷ (Encerrados dentro do prazo + Encerrados violados) × 100` — sempre entre 0% e 100%.
- **Reabertos N1/N2/Prod**: chamados `created` dentro do período que em algum momento passaram pelo status `Reaberto` (`status WAS "Reaberto"`), contados separadamente por caixa, **só projeto Central de Incidentes**. O percentual de cada caixa é sobre o **total de reabertos** (soma das 3 caixas).
- **Soma total de reabertura**: soma dos 3 valores acima; o percentual aqui é sobre o **total geral de chamados abertos** (linha acima).
- **Top 1/2/3 analista N1/N2**: ranking dos assignees com mais chamados "Encerrados" no período, **combinando Central de Incidentes + Abertura de Chamados**, calculado separadamente para a caixa N1 (`CLBR-TI-OPS-OGS SOLAR SALESFORCE`) e a caixa N2 (`CLBR-TI-OPS-OGS-SOLAR-SALESFORCE-N2`). Não há ranking para a caixa Prod.
- **Chamados Clarinha**: chamados `created` dentro do período (3 caixas, só Central de Incidentes) com o campo `Nivel de Escalonamento` preenchido, independente do status atual.
- **Escalonamentos LJ**: mesma lógica, com o campo `Tipo Incidente MOPS` preenchido.
- **Chamados Críticos totais**: chamados `created` dentro do período cuja prioridade **já foi** P0, P1 ou P2 em algum momento (`priority WAS IN (P0, P1, P2)`), independente da prioridade atual.
- **Chamados Pontuais**: dos críticos acima, os que **não são mais** P0/P1/P2 atualmente (`priority WAS IN (P0, P1, P2) AND priority NOT IN (P0, P1, P2)`) — entraram como crítico e depois baixaram de prioridade.

## Exportar report para PDF

Via `export_report_pdf()` em [jira_extractor.py](jira_extractor.py), usando a biblioteca `reportlab`. Funciona com o texto de qualquer um dos dois reports (Diário ou Consolidado) — o botão **📄 Exportar PDF** fica habilitado assim que um report é gerado na tela, e salva em `output/relatorio_<timestamp>.pdf`.

O PDF é estilizado (mesma paleta de cores da GUI), não é um dump de texto puro:

- **Cabeçalho azul** em toda página, com o título do report (extraído da primeira linha, ex: "RELATÓRIO MOPS OPERACIONAL - 06/08 10:00") e o subtítulo "Central de Incidentes · Monitoramento de SLA".
- **Seções/caixas** (`# CLBR-TI-OPS-... #`, `# Resumo Geral #`, `# SLA - CAIXAS GERAIS #` etc.) viram títulos azuis em negrito com uma linha divisória embaixo.
- **Marcadores** (`🔸 Rótulo: Valor`) viram uma bolinha azul (`•`) com o valor em **negrito**, para destacar os números.
- **Rodapé** com data/hora de geração e número de página.

A fonte padrão do PDF (Helvetica) não tem glifos de emoji, então os emojis do título (📄⏰📊) são removidos ao extrair o texto do cabeçalho; acentuação em português é preservada normalmente.
