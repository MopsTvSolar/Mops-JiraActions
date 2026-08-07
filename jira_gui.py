"""
Interface gráfica (Tkinter) para extração de chamados Jira via REST API.

Ao abrir, conecta automaticamente usando URL/e-mail/API Token do arquivo
.env (veja .env.example) — sem tela de login. O ORDER BY da JQL é fixo no
código; "Projeto", "Grupo Solucionador" e "status a considerar" são
seleção múltipla na tela principal.

Uso:
    python jira_gui.py
"""

import logging
import os
import queue
import threading
import tkinter as tk
from datetime import date, datetime
from tkinter import font as tkfont
from tkinter import messagebox, ttk

import requests

from jira_extractor import (
    JiraExtractorError,
    build_consolidated_report,
    build_daily_report,
    export_report_pdf,
    load_config,
    log,
    run_chamados_a_violar,
    run_chamados_violados,
    run_extracao_completa,
)

FORNECEDOR_STATUS = "Aguardando Fornecedor"

# Partes fixas da JQL (não editáveis na interface).
ORDER_BY_FIXO = "cf[10419] ASC"

# Opções de seleção múltipla exibidas na tela principal.
# Projetos disponíveis (marcado = considerado). "Central de Incidentes" vem
# marcado por padrão, mantendo o comportamento anterior.
PROJETO_OPTIONS = ["Abertura de Chamados", "Central de Incidentes"]
PROJETO_PADRAO_MARCADO = {"Central de Incidentes"}

GRUPO_SOLUCIONADOR_OPTIONS = [
    "CLBR-TI-OPS-OGS-SOLAR-SALESFORCE-N2",
    "CLBR-TI-OPS-OGS SOLAR SALESFORCE",
    "CLBR-TI-OPS-PROD SOLAR SALESFORCE",
]
# Status existentes considerados pela extração (todos vêm marcados por padrão).
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

# ---------------------------------------------------------------- paleta
BG = "#f1f5f9"
CARD_BG = "#ffffff"
CARD_BORDER = "#e2e8f0"
HEADER_BG = "#1d4ed8"
HEADER_FG = "#ffffff"
TEXT = "#0f172a"
MUTED = "#64748b"
ACCENT = "#2563eb"
ACCENT_ACTIVE = "#1e40af"
ACCENT_DISABLED = "#93b4f5"
SUCCESS = "#16a34a"
DANGER = "#dc2626"
LOG_BG = "#0f172a"
LOG_FG = "#e2e8f0"
LOG_ERROR = "#f87171"
LOG_WARN = "#fbbf24"
LOG_MUTED = "#94a3b8"


class QueueLogHandler(logging.Handler):
    """Encaminha registros de log para uma fila, consumida pela thread da UI."""

    def __init__(self, log_queue):
        super().__init__()
        self.log_queue = log_queue

    def emit(self, record):
        self.log_queue.put((record.levelname, self.format(record)))


class Card(tk.Frame):
    """Frame com aparência de cartão: fundo branco e borda sutil."""

    def __init__(self, parent, **kwargs):
        super().__init__(
            parent, bg=CARD_BG, highlightbackground=CARD_BORDER, highlightthickness=1, bd=0, **kwargs
        )


class JiraApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Extração de Chamados Jira")
        self.geometry("880x640")
        self.minsize(720, 520)
        self.configure(bg=BG)

        self.config_data = None
        self.job_running = False
        self.log_queue = queue.Queue()

        self._setup_styles()

        handler = QueueLogHandler(self.log_queue)
        handler.setFormatter(logging.Formatter("%(asctime)s  %(message)s", "%H:%M:%S"))
        log.addHandler(handler)
        log.setLevel(logging.INFO)

        self._build_header()
        self.content = ttk.Frame(self, padding=20)
        self.content.pack(fill="both", expand=True)

        self._build_connecting_view()
        self.after(200, self._poll_log_queue)
        self.after(100, self._connect)

    # ---------------------------------------------------------------- estilo
    def _setup_styles(self):
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        base_font = ("Segoe UI", 10)

        style.configure("TFrame", background=BG)
        style.configure("Card.TFrame", background=CARD_BG)
        style.configure("Header.TFrame", background=HEADER_BG)

        style.configure("TLabel", background=BG, foreground=TEXT, font=base_font)
        style.configure("Card.TLabel", background=CARD_BG, foreground=TEXT, font=base_font)
        style.configure("Muted.Card.TLabel", background=CARD_BG, foreground=MUTED, font=("Segoe UI", 9))
        style.configure("Section.Card.TLabel", background=CARD_BG, foreground=MUTED, font=("Segoe UI", 9, "bold"))
        style.configure("Header.TLabel", background=HEADER_BG, foreground=HEADER_FG, font=("Segoe UI", 17, "bold"))
        style.configure("HeaderSub.TLabel", background=HEADER_BG, foreground="#dbeafe", font=("Segoe UI", 10))

        style.configure("TRadiobutton", background=CARD_BG, foreground=TEXT, font=base_font)
        style.map("TRadiobutton", background=[("active", CARD_BG)])

        style.configure("TCheckbutton", background=CARD_BG, foreground=TEXT, font=base_font)
        style.map("TCheckbutton", background=[("active", CARD_BG)])

        style.configure("Primary.TButton", font=("Segoe UI", 10, "bold"), foreground="white",
                         background=ACCENT, padding=10, borderwidth=0)
        style.map(
            "Primary.TButton",
            background=[("disabled", ACCENT_DISABLED), ("active", ACCENT_ACTIVE)],
            foreground=[("disabled", "#eff6ff")],
        )

        style.configure("Secondary.TButton", font=("Segoe UI", 9), foreground=TEXT,
                         background="#e2e8f0", padding=8, borderwidth=0)
        style.map("Secondary.TButton", background=[("active", "#cbd5e1")])

    # ---------------------------------------------------------------- header
    def _build_header(self):
        header = ttk.Frame(self, style="Header.TFrame")
        header.pack(fill="x")

        header_inner = ttk.Frame(header, style="Header.TFrame", padding=(24, 16))
        header_inner.pack(fill="x")
        ttk.Label(header_inner, text="Extração de Chamados Jira", style="Header.TLabel").pack(anchor="w")
        ttk.Label(
            header_inner, text="Central de Incidentes · monitoramento de SLA", style="HeaderSub.TLabel"
        ).pack(anchor="w")

    # ------------------------------------------------------------- conexão
    def _build_connecting_view(self):
        wrapper = ttk.Frame(self.content)
        wrapper.place(relx=0.5, rely=0.5, anchor="center")
        ttk.Label(wrapper, text="Conectando ao Jira...", font=("Segoe UI", 11)).pack()
        self._connecting_wrapper = wrapper

    def _connect(self):
        try:
            self.config_data = load_config()
        except SystemExit:
            messagebox.showerror(
                "Configuração ausente",
                "Variáveis obrigatórias ausentes no .env (JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN).\n"
                "Copie .env.example para .env e preencha os valores.",
            )
            self.destroy()
            return

        def worker():
            try:
                resp = requests.get(
                    f"{self.config_data['url']}/rest/api/3/myself",
                    auth=(self.config_data["email"], self.config_data["token"]),
                    headers={"Accept": "application/json"},
                    timeout=15,
                )
            except requests.exceptions.RequestException as e:
                self.after(0, lambda: self._connect_failed(f"Não foi possível conectar: {e}"))
                return

            if resp.status_code == 200:
                display_name = resp.json().get("displayName", self.config_data["email"])
                self.after(0, lambda: self._connect_success(display_name))
            elif resp.status_code == 401:
                self.after(0, lambda: self._connect_failed("E-mail ou API Token inválidos (configurados no .env)."))
            else:
                self.after(0, lambda: self._connect_failed(f"Erro inesperado ({resp.status_code})."))

        threading.Thread(target=worker, daemon=True).start()

    def _connect_failed(self, message):
        messagebox.showerror("Falha na conexão", message)

    def _connect_success(self, display_name):
        self._connecting_wrapper.destroy()
        self._build_main_frame(display_name)

    # ------------------------------------------------------------ main view
    def _build_main_frame(self, display_name):
        canvas = tk.Canvas(self.content, bg=BG, highlightthickness=0)
        scrollbar = ttk.Scrollbar(self.content, orient="vertical", command=canvas.yview)
        body = ttk.Frame(canvas, padding=(0, 0, 12, 0))

        body.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        body_window = canvas.create_window((0, 0), window=body, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        canvas.bind("<Configure>", lambda e: canvas.itemconfig(body_window, width=e.width))

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        def _on_mousewheel(event):
            canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

        canvas.bind("<Enter>", lambda e: canvas.bind_all("<MouseWheel>", _on_mousewheel))
        canvas.bind("<Leave>", lambda e: canvas.unbind_all("<MouseWheel>"))

        # --- status card ---
        status_card = Card(body)
        status_card.pack(fill="x", pady=(0, 14))
        status_inner = ttk.Frame(status_card, style="Card.TFrame", padding=(16, 12))
        status_inner.pack(fill="x")

        self.status_dot = tk.Label(status_inner, text="●", fg=SUCCESS, bg=CARD_BG, font=("Segoe UI", 12))
        self.status_dot.pack(side="left")
        self.status_label = tk.Label(
            status_inner, text=" Conectado", fg=SUCCESS, bg=CARD_BG, font=("Segoe UI", 10, "bold")
        )
        self.status_label.pack(side="left")
        self.identity_label = tk.Label(
            status_inner,
            text=f"Conectado como {display_name}  ({self.config_data['email']})",
            fg=MUTED, bg=CARD_BG, font=("Segoe UI", 9),
        )
        self.identity_label.pack(side="right")

        # --- filtros card ---
        filters_card = Card(body)
        filters_card.pack(fill="x", pady=(0, 14))
        filters_inner = ttk.Frame(filters_card, style="Card.TFrame", padding=(16, 14))
        filters_inner.pack(fill="x")

        ttk.Label(filters_inner, text="PROJETO", style="Section.Card.TLabel").pack(anchor="w")
        projeto_frame = ttk.Frame(filters_inner, style="Card.TFrame")
        projeto_frame.pack(anchor="w", pady=(4, 12), fill="x")
        self.projeto_vars = {}
        for projeto in PROJETO_OPTIONS:
            var = tk.BooleanVar(value=projeto in PROJETO_PADRAO_MARCADO)
            ttk.Checkbutton(projeto_frame, text=projeto, variable=var).pack(side="left", padx=(0, 16))
            self.projeto_vars[projeto] = var

        ttk.Label(filters_inner, text="GRUPO SOLUCIONADOR", style="Section.Card.TLabel").pack(anchor="w")
        grupo_frame = ttk.Frame(filters_inner, style="Card.TFrame")
        grupo_frame.pack(anchor="w", pady=(4, 12), fill="x")
        self.grupo_vars = {}
        for grupo in GRUPO_SOLUCIONADOR_OPTIONS:
            var = tk.BooleanVar(value=True)
            ttk.Checkbutton(grupo_frame, text=grupo, variable=var).pack(anchor="w")
            self.grupo_vars[grupo] = var

        ttk.Label(filters_inner, text="STATUS A CONSIDERAR", style="Section.Card.TLabel").pack(anchor="w")
        status_frame = ttk.Frame(filters_inner, style="Card.TFrame")
        status_frame.pack(anchor="w", pady=(4, 0), fill="x")
        self.status_vars = {}
        columns = 4
        for i, status in enumerate(STATUS_OPTIONS):
            var = tk.BooleanVar(value=True)
            ttk.Checkbutton(status_frame, text=status, variable=var).grid(
                row=i // columns, column=i % columns, sticky="w", padx=(0, 14), pady=2
            )
            self.status_vars[status] = var

        # --- options + actions card ---
        actions_card = Card(body)
        actions_card.pack(fill="x", pady=(0, 14))
        actions_inner = ttk.Frame(actions_card, style="Card.TFrame", padding=(16, 14))
        actions_inner.pack(fill="x")

        ttk.Label(actions_inner, text="FORMATO DE SAÍDA", style="Section.Card.TLabel").pack(anchor="w")
        options_frame = ttk.Frame(actions_inner, style="Card.TFrame")
        options_frame.pack(anchor="w", pady=(4, 14))
        self.format_var = tk.StringVar(value="both")
        for label, value in [("CSV", "csv"), ("Excel", "excel"), ("Ambos", "both")]:
            ttk.Radiobutton(options_frame, text=label, value=value, variable=self.format_var).pack(
                side="left", padx=(0, 16)
            )

        ttk.Label(actions_inner, text="AÇÕES", style="Section.Card.TLabel").pack(anchor="w")
        buttons_frame = ttk.Frame(actions_inner, style="Card.TFrame")
        buttons_frame.pack(fill="x", pady=(4, 0))

        self.btn_completa = ttk.Button(
            buttons_frame, text="📋  Extração completa", style="Primary.TButton",
            command=self._run_completa,
        )
        self.btn_completa.pack(side="left", padx=(0, 8), fill="x", expand=True)

        self.btn_hoje = ttk.Button(
            buttons_frame, text="⏰  Chamados a violar hoje", style="Primary.TButton",
            command=self._run_violar_hoje,
        )
        self.btn_hoje.pack(side="left", padx=(0, 8), fill="x", expand=True)

        self.btn_amanha = ttk.Button(
            buttons_frame, text="📅  Chamados a violar amanhã", style="Primary.TButton",
            command=self._run_violar_amanha,
        )
        self.btn_amanha.pack(side="left", padx=(0, 8), fill="x", expand=True)

        self.btn_violados = ttk.Button(
            buttons_frame, text="🔴  Chamados violados", style="Primary.TButton",
            command=self._run_violados,
        )
        self.btn_violados.pack(side="left", fill="x", expand=True)

        ttk.Button(
            actions_inner, text="Abrir pasta de saída", style="Secondary.TButton", command=self._open_output_folder
        ).pack(anchor="e", pady=(12, 0))

        # --- report diário card ---
        report_card = Card(body)
        report_card.pack(fill="x", pady=(0, 14))
        report_inner = ttk.Frame(report_card, style="Card.TFrame", padding=(16, 14))
        report_inner.pack(fill="x")

        report_header = ttk.Frame(report_inner, style="Card.TFrame")
        report_header.pack(fill="x")
        ttk.Label(report_header, text="REPORTS", style="Section.Card.TLabel").pack(side="left")

        self.btn_report = ttk.Button(
            report_header, text="📝  Report Diário", style="Primary.TButton", command=self._run_report,
        )
        self.btn_report.pack(side="left", padx=(12, 8))

        self.btn_consolidado = ttk.Button(
            report_header, text="📊  Relatório Consolidado", style="Primary.TButton",
            command=self._abrir_dialogo_consolidado,
        )
        self.btn_consolidado.pack(side="left", padx=(0, 8))

        self.btn_copiar_report = ttk.Button(
            report_header, text="Copiar", style="Secondary.TButton", command=self._copiar_report, state="disabled",
        )
        self.btn_copiar_report.pack(side="left", padx=(0, 8))

        self.btn_limpar_report = ttk.Button(
            report_header, text="Limpar", style="Secondary.TButton", command=self._limpar_report, state="disabled",
        )
        self.btn_limpar_report.pack(side="left", padx=(0, 8))

        self.btn_pdf_report = ttk.Button(
            report_header, text="📄 Exportar PDF", style="Secondary.TButton",
            command=self._exportar_pdf_report, state="disabled",
        )
        self.btn_pdf_report.pack(side="left")

        report_box_frame = tk.Frame(report_inner, bg=CARD_BG)
        report_box_frame.pack(fill="x", pady=(10, 0))

        report_scroll = tk.Scrollbar(report_box_frame)
        report_scroll.pack(side="right", fill="y")
        self.report_box = tk.Text(
            report_box_frame, height=10, wrap="word", font=("Segoe UI", 10),
            bg="#f8fafc", fg=TEXT, relief="flat", padx=10, pady=10, state="disabled",
            yscrollcommand=report_scroll.set,
        )
        self.report_box.pack(side="left", fill="both", expand=True)
        report_scroll.config(command=self.report_box.yview)

        # --- log card ---
        log_card = Card(body)
        log_card.pack(fill="both", expand=True)
        log_header = ttk.Frame(log_card, style="Card.TFrame", padding=(16, 10, 16, 0))
        log_header.pack(fill="x")
        ttk.Label(log_header, text="LOG DE EXECUÇÃO", style="Section.Card.TLabel").pack(anchor="w")

        log_body = tk.Frame(log_card, bg=CARD_BG, padx=16)
        log_body.pack(fill="both", expand=True, pady=(6, 16))

        mono_font = tkfont.Font(family="Consolas", size=9)
        log_scroll = tk.Scrollbar(log_body)
        log_scroll.pack(side="right", fill="y")
        self.log_box = tk.Text(
            log_body, bg=LOG_BG, fg=LOG_FG, insertbackground=LOG_FG, font=mono_font,
            wrap="word", state="disabled", relief="flat", padx=10, pady=10,
            yscrollcommand=log_scroll.set,
        )
        self.log_box.pack(fill="both", expand=True)
        log_scroll.config(command=self.log_box.yview)

        self.log_box.tag_config("ERROR", foreground=LOG_ERROR)
        self.log_box.tag_config("WARNING", foreground=LOG_WARN)
        self.log_box.tag_config("INFO", foreground=LOG_FG)
        self.log_box.tag_config("MUTED", foreground=LOG_MUTED)

        self.action_buttons = [
            self.btn_completa, self.btn_hoje, self.btn_amanha, self.btn_violados,
            self.btn_report, self.btn_consolidado,
        ]

    def _set_status(self, text, color):
        self.status_dot.config(fg=color)
        self.status_label.config(text=f" {text}", fg=color)

    def _open_output_folder(self):
        output_dir = os.path.abspath("output")
        os.makedirs(output_dir, exist_ok=True)
        os.startfile(output_dir)

    def _set_job_running(self, running):
        self.job_running = running
        state = "disabled" if running else "normal"
        for btn in self.action_buttons:
            btn.config(state=state)
        if running:
            self._set_status("Executando...", ACCENT)
        else:
            self._set_status("Conectado", SUCCESS)

    def _run_job(self, target, *args, on_success=None, **kwargs):
        if self.job_running:
            messagebox.showinfo("Aguarde", "Já existe uma extração em andamento.")
            return

        self._set_job_running(True)

        def worker():
            try:
                result = target(*args, **kwargs)
                if on_success is not None:
                    self.after(0, lambda: on_success(result))
            except JiraExtractorError as e:
                log.error(str(e))
            except Exception as e:
                log.error("Erro inesperado: %s", e)
            finally:
                self.after(0, lambda: self._set_job_running(False))

        threading.Thread(target=worker, daemon=True).start()

    def _build_jql(self):
        projetos = [p for p, var in self.projeto_vars.items() if var.get()]
        if not projetos:
            messagebox.showwarning("Projeto", "Selecione ao menos um projeto.")
            return None

        grupos = [g for g, var in self.grupo_vars.items() if var.get()]
        if not grupos:
            messagebox.showwarning("Grupo Solucionador", "Selecione ao menos um Grupo Solucionador.")
            return None

        status_considerar = [s for s, var in self.status_vars.items() if var.get()]
        if not status_considerar:
            messagebox.showwarning("Status a considerar", "Selecione ao menos um status.")
            return None

        projetos_str = ", ".join(f'"{p}"' for p in projetos)
        grupos_str = ", ".join(f'"{g}"' for g in grupos)
        status_str = ", ".join(f'"{s}"' for s in status_considerar)
        parts = [
            f'"Grupo Solucionador[Group Picker (single group)]" IN ({grupos_str})',
            f"project IN ({projetos_str})",
            f"status IN ({status_str})",
        ]

        return " AND ".join(parts) + f" ORDER BY {ORDER_BY_FIXO}"

    def _incluir_fornecedor(self):
        var = self.status_vars.get(FORNECEDOR_STATUS)
        return bool(var and var.get())

    def _run_completa(self):
        jql = self._build_jql()
        if jql is None:
            return
        config = dict(self.config_data, jql=jql)
        self._run_job(
            run_extracao_completa, config, fmt=self.format_var.get(), incluir_fornecedor=self._incluir_fornecedor()
        )

    def _run_violar_hoje(self):
        jql = self._build_jql()
        if jql is None:
            return
        config = dict(self.config_data, jql=jql)
        self._run_job(
            run_chamados_a_violar, config, days_ahead=0, fmt=self.format_var.get(),
            incluir_fornecedor=self._incluir_fornecedor(),
        )

    def _run_violar_amanha(self):
        jql = self._build_jql()
        if jql is None:
            return
        config = dict(self.config_data, jql=jql)
        self._run_job(
            run_chamados_a_violar, config, days_ahead=1, fmt=self.format_var.get(),
            incluir_fornecedor=self._incluir_fornecedor(),
        )

    def _run_violados(self):
        jql = self._build_jql()
        if jql is None:
            return
        config = dict(self.config_data, jql=jql)
        self._run_job(
            run_chamados_violados, config, fmt=self.format_var.get(), incluir_fornecedor=self._incluir_fornecedor()
        )

    def _run_report(self):
        # O report sempre considera os 3 Grupos Solucionador e os dois
        # projetos combinados (INC + PDST), independente dos checkboxes.
        self._run_job(
            build_daily_report, self.config_data, GRUPO_SOLUCIONADOR_OPTIONS, on_success=self._exibir_report
        )

    def _abrir_dialogo_consolidado(self):
        if self.job_running:
            messagebox.showinfo("Aguarde", "Já existe uma extração em andamento.")
            return

        dialog = tk.Toplevel(self)
        dialog.title("Relatório Consolidado")
        dialog.configure(bg=CARD_BG)
        dialog.resizable(False, False)
        dialog.transient(self)
        dialog.grab_set()

        frame = ttk.Frame(dialog, style="Card.TFrame", padding=20)
        frame.pack()

        ttk.Label(frame, text="Selecione o período", style="Card.TLabel", font=("Segoe UI", 12, "bold")).grid(
            row=0, column=0, columnspan=2, pady=(0, 14), sticky="w"
        )

        hoje = date.today().strftime("%d/%m/%Y")

        ttk.Label(frame, text="Data início (dd/mm/aaaa):", style="Muted.Card.TLabel").grid(
            row=1, column=0, sticky="w", pady=4
        )
        entry_inicio = ttk.Entry(frame, width=14)
        entry_inicio.insert(0, hoje)
        entry_inicio.grid(row=1, column=1, pady=4, padx=(10, 0))

        ttk.Label(frame, text="Data fim (dd/mm/aaaa):", style="Muted.Card.TLabel").grid(
            row=2, column=0, sticky="w", pady=4
        )
        entry_fim = ttk.Entry(frame, width=14)
        entry_fim.insert(0, hoje)
        entry_fim.grid(row=2, column=1, pady=4, padx=(10, 0))

        def _confirmar():
            try:
                inicio = datetime.strptime(entry_inicio.get().strip(), "%d/%m/%Y").date()
                fim = datetime.strptime(entry_fim.get().strip(), "%d/%m/%Y").date()
            except ValueError:
                messagebox.showwarning("Data inválida", "Use o formato dd/mm/aaaa.", parent=dialog)
                return
            if inicio > fim:
                messagebox.showwarning("Período inválido", "A data início não pode ser depois da data fim.", parent=dialog)
                return
            dialog.destroy()
            self._run_job(
                build_consolidated_report, self.config_data, inicio, fim, on_success=self._exibir_report
            )

        btn_frame = ttk.Frame(frame, style="Card.TFrame")
        btn_frame.grid(row=3, column=0, columnspan=2, pady=(16, 0), sticky="ew")
        ttk.Button(btn_frame, text="Gerar", style="Primary.TButton", command=_confirmar).pack(
            side="left", fill="x", expand=True, padx=(0, 8)
        )
        ttk.Button(btn_frame, text="Cancelar", style="Secondary.TButton", command=dialog.destroy).pack(
            side="left", fill="x", expand=True
        )

        entry_inicio.focus_set()
        entry_inicio.bind("<Return>", lambda e: _confirmar())
        entry_fim.bind("<Return>", lambda e: _confirmar())

    def _exibir_report(self, texto):
        self.report_box.config(state="normal")
        self.report_box.delete("1.0", "end")
        self.report_box.insert("1.0", texto)
        self.report_box.config(state="disabled")
        self.btn_copiar_report.config(state="normal")
        self.btn_limpar_report.config(state="normal")
        self.btn_pdf_report.config(state="normal")

    def _copiar_report(self):
        texto = self.report_box.get("1.0", "end").strip()
        self.clipboard_clear()
        self.clipboard_append(texto)

    def _limpar_report(self):
        self.report_box.config(state="normal")
        self.report_box.delete("1.0", "end")
        self.report_box.config(state="disabled")
        self.btn_copiar_report.config(state="disabled")
        self.btn_limpar_report.config(state="disabled")
        self.btn_pdf_report.config(state="disabled")

    def _exportar_pdf_report(self):
        texto = self.report_box.get("1.0", "end").strip()
        if not texto:
            messagebox.showinfo("Nada para exportar", "Gere um report antes de exportar para PDF.")
            return

        output_dir = os.path.abspath("output")
        os.makedirs(output_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        caminho = os.path.join(output_dir, f"relatorio_{timestamp}.pdf")

        try:
            export_report_pdf(texto, caminho, titulo="Relatório")
        except Exception as e:
            log.error("Falha ao exportar PDF: %s", e)
            messagebox.showerror("Erro ao exportar PDF", str(e))
            return

        log.info("PDF salvo em: %s", caminho)

    # -------------------------------------------------------------- log UI
    def _poll_log_queue(self):
        try:
            while True:
                level, message = self.log_queue.get_nowait()
                tag = level if level in ("ERROR", "WARNING") else "INFO"
                self.log_box.config(state="normal")
                self.log_box.insert("end", message + "\n", tag)
                self.log_box.see("end")
                self.log_box.config(state="disabled")
        except queue.Empty:
            pass
        self.after(200, self._poll_log_queue)


if __name__ == "__main__":
    app = JiraApp()
    app.mainloop()
