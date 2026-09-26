"""Tela de comparação da cotação, igual à aba COMPRAS da planilha
COTAÇÃO COMPLETA.xlsm.

Uso pelo sistema DISPPAR, quando chegar a resposta de um fornecedor:

    from tela_compras import receber_resposta
    receber_resposta("COBRA", r"C:\\...\\resposta_cobra.xlsx",
                     planilha=r"\\\\server2\\G\\COTAÇOES\\...\\COTAÇÃO COMPLETA.xlsm",
                     master=janela_principal)

A tela abre (ou vem para a frente, se já estiver aberta) com os preços
do fornecedor já nas colunas dele. Também dá para rodar sozinho:

    python tela_compras.py
"""
from __future__ import annotations

import os
import tkinter as tk
from tkinter import filedialog, messagebox

import customtkinter as ctk
from tksheet import Sheet

from cotacao_dados import (
    LIMITE_DIFERENCA, Cotacao, adivinhar_fornecedor, aplicar_resposta,
    carregar_planilha, converter_valor, exportar_excel, ler_resposta,
)

COLUNAS_ITEM = ["SEQ", "NR_FABRICA", "ATENÇÃO MARCA", "QTDE", "PRODUTO"]
COLUNAS_RESULTADO = ["MENOR", "EMPRESA", "2º MENOR", "EMPRESA", "PORCENTAGEM"]

# Cores no padrão do Excel: verde = menor preço, amarelo = diferença < 2%.
COR_MENOR = ("#C6EFCE", "#006100")
COR_POUCA_DIF = ("#FFEB9C", "#9C5700")
COR_FORNECEDOR_A = "#F2F2F2"
COR_RESULTADO = "#DDEBF7"


def moeda(v) -> str:
    if v is None:
        return ""
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def qtd_txt(v) -> str:
    return str(int(v)) if float(v).is_integer() else str(v).replace(".", ",")


class TelaCompras(ctk.CTkToplevel):
    def __init__(self, master, cotacao: Cotacao | None = None, planilha: str | None = None):
        super().__init__(master)
        self.title("COMPRAS - Comparativo da cotação")
        self.geometry("1400x760")
        self.minsize(900, 500)

        self.cot = cotacao or Cotacao()
        self.planilha = planilha
        self.so_pouca_diferenca = tk.BooleanVar(value=False)

        self._montar_barra()
        self._montar_fornecedores()
        self._montar_grade()
        self._montar_rodape()
        self.atualizar()

    # ------------------------------------------------------------ layout
    def _montar_barra(self):
        barra = ctk.CTkFrame(self, corner_radius=0)
        barra.pack(fill="x")
        ctk.CTkButton(barra, text="ABRIR COTAÇÃO", width=140,
                      command=self.abrir_planilha).pack(side="left", padx=(10, 4), pady=8)
        ctk.CTkButton(barra, text="RECEBER RESPOSTA", width=160, fg_color="#2E7D32",
                      hover_color="#1B5E20",
                      command=self.escolher_resposta).pack(side="left", padx=4, pady=8)
        ctk.CTkButton(barra, text="EXPORTAR EXCEL", width=140,
                      command=self.exportar).pack(side="left", padx=4, pady=8)
        ctk.CTkCheckBox(barra, text="Só diferença < 2%", variable=self.so_pouca_diferenca,
                        command=self.filtrar).pack(side="left", padx=(16, 4))
        self.busca = ctk.CTkEntry(barra, width=220, placeholder_text="Buscar código ou produto")
        self.busca.pack(side="right", padx=10)
        self.busca.bind("<KeyRelease>", lambda _e: self.filtrar())

    def _montar_fornecedores(self):
        # Equivale à aba FORNECEDORES: quem já respondeu fica marcado.
        self.faixa = ctk.CTkFrame(self, corner_radius=0, fg_color="transparent")
        self.faixa.pack(fill="x", padx=10, pady=(6, 0))

    def _montar_grade(self):
        self.grade = Sheet(self, show_row_index=False, show_x_scrollbar=True, show_y_scrollbar=True,
                           font=("Calibri", 11, "normal"),
                           header_font=("Calibri", 11, "bold"),
                           default_row_height=22)
        self.grade.enable_bindings(
            "single_select", "drag_select", "row_select", "column_select",
            "column_width_resize", "arrowkeys", "copy", "paste", "edit_cell",
            "delete", "rc_select", "select_all")
        self.grade.extra_bindings([("end_edit_cell", self._editou),
                                   ("end_paste", self._editou),
                                   ("end_delete", self._editou)])
        self.grade.pack(fill="both", expand=True, padx=10, pady=6)

    def _montar_rodape(self):
        self.rodape = ctk.CTkLabel(self, text="", anchor="w")
        self.rodape.pack(fill="x", padx=12, pady=(0, 8))

    # ------------------------------------------------------------ grade
    def _col_fornecedor(self, i: int) -> int:
        return len(COLUNAS_ITEM) + i * 2

    def atualizar(self):
        cot = self.cot
        cab = list(COLUNAS_ITEM)
        for f in cot.fornecedores:
            cab += [f, "MARCA"]
        cab += COLUNAS_RESULTADO

        dados = []
        for it in cot.itens:
            linha = [it.seq, it.nr_fabrica, it.marca_exigida, qtd_txt(it.qtd), it.descricao]
            for f in cot.fornecedores:
                p = cot.preco(f, it.seq)
                linha += [moeda(p.valor) if p else "", p.marca if p else ""]
            comp = cot.comparativo(it)
            dif = comp["diferenca"]
            linha += [moeda(comp["menor"]), comp["empresa"], moeda(comp["segundo"]),
                      comp["empresa2"], f"{dif:.2%}".replace(".", ",") if dif is not None else ""]
            dados.append(linha)

        self.grade.headers(cab, redraw=False)
        self.grade.set_sheet_data(dados, reset_col_positions=True, redraw=False)
        n = len(cot.fornecedores)
        larguras = [45, 230, 150, 50, 300] + [80, 90] * n + [80, 95, 80, 95, 100]
        self.grade.set_column_widths(larguras)
        inicio_res = self._col_fornecedor(n)
        self.grade.readonly_columns(list(range(len(COLUNAS_ITEM))) +
                                    list(range(inicio_res, inicio_res + 5)))
        self._colorir()
        self._atualizar_fornecedores()
        self._atualizar_rodape()
        self.filtrar()

    def _colorir(self):
        g = self.grade
        g.dehighlight_all(redraw=False)
        n = len(self.cot.fornecedores)
        inicio_res = self._col_fornecedor(n)
        total_linhas = len(self.cot.itens)
        for i in range(0, n, 2):
            for c in (self._col_fornecedor(i), self._col_fornecedor(i) + 1):
                g.highlight_cells(column=c, canvas="header", bg=COR_FORNECEDOR_A, redraw=False)
        for c in range(inicio_res, inicio_res + 5):
            g.highlight_cells(column=c, canvas="header", bg=COR_RESULTADO, redraw=False)
        for r, it in enumerate(self.cot.itens):
            comp = self.cot.comparativo(it)
            if comp["empresa"]:
                c = self._col_fornecedor(self.cot.fornecedores.index(comp["empresa"]))
                g.highlight_cells(row=r, column=c, bg=COR_MENOR[0], fg=COR_MENOR[1], redraw=False)
            if comp["diferenca"] is not None and comp["diferenca"] < LIMITE_DIFERENCA:
                g.highlight_cells(row=r, column=inicio_res + 4,
                                  bg=COR_POUCA_DIF[0], fg=COR_POUCA_DIF[1], redraw=False)
        if total_linhas:
            g.redraw()

    def _atualizar_fornecedores(self):
        for w in self.faixa.winfo_children():
            w.destroy()
        ctk.CTkLabel(self.faixa, text="Respostas:").pack(side="left", padx=(0, 6))
        for f in self.cot.fornecedores:
            ok = f in self.cot.respondidos
            ctk.CTkLabel(self.faixa, text=("✔ " if ok else "• ") + f, corner_radius=6,
                         fg_color="#2E7D32" if ok else ("#E0E0E0", "#3A3A3A"),
                         text_color="white" if ok else ("#555555", "#BBBBBB"),
                         padx=8).pack(side="left", padx=2)

    def _atualizar_rodape(self):
        cot = self.cot
        pouca = sum(1 for it in cot.itens
                    if (d := cot.comparativo(it)["diferenca"]) is not None and d < LIMITE_DIFERENCA)
        sem = sum(1 for it in cot.itens if cot.comparativo(it)["menor"] is None)
        self.rodape.configure(text=(
            f"QTDE DE ITENS: {len(cot.itens)}    |    "
            f"Respostas: {len(cot.respondidos & set(cot.fornecedores))}/{len(cot.fornecedores)}    |    "
            f"Itens sem preço: {sem}    |    Diferença < 2%: {pouca}    |    "
            f"Total pelo menor preço: R$ {moeda(cot.total_melhor_preco())}"))

    def filtrar(self):
        termo = self.busca.get().strip().upper()
        linhas = []
        for r, it in enumerate(self.cot.itens):
            if termo and termo not in f"{it.codigo} {it.similar} {it.descricao}".upper():
                continue
            if self.so_pouca_diferenca.get():
                d = self.cot.comparativo(it)["diferenca"]
                if d is None or d >= LIMITE_DIFERENCA:
                    continue
            linhas.append(r)
        if len(linhas) == len(self.cot.itens):
            self.grade.display_rows("all", redraw=True)
        else:
            self.grade.display_rows(linhas, all_rows_displayed=False, redraw=True)

    def _editou(self, _evento=None):
        # Lê de volta as colunas de fornecedor (digitadas ou coladas do Excel).
        dados = self.grade.get_sheet_data()
        for r, it in enumerate(self.cot.itens):
            for i, f in enumerate(self.cot.fornecedores):
                c = self._col_fornecedor(i)
                valor, marca = dados[r][c], dados[r][c + 1]
                self.cot.definir_preco(f, it.seq, valor, marca)
                if converter_valor(valor) is not None:
                    self.cot.respondidos.add(f)
        self.after(10, self.atualizar)

    # ------------------------------------------------------------ ações
    def abrir_planilha(self):
        caminho = filedialog.askopenfilename(
            parent=self, title="Abrir COTAÇÃO COMPLETA",
            filetypes=[("Planilha Excel", "*.xlsm *.xlsx")])
        if caminho:
            self.carregar(caminho)

    def carregar(self, caminho: str):
        try:
            self.cot = carregar_planilha(caminho)
        except Exception as e:
            messagebox.showerror("Abrir cotação", f"Não consegui ler a planilha:\n{e}", parent=self)
            return
        self.planilha = caminho
        self.title(f"COMPRAS - {os.path.basename(caminho)}")
        self.atualizar()

    def escolher_resposta(self):
        caminho = filedialog.askopenfilename(
            parent=self, title="Arquivo de resposta do fornecedor",
            filetypes=[("Planilha", "*.xlsx *.xlsm *.csv")])
        if not caminho:
            return
        sugerido = adivinhar_fornecedor(caminho, self.cot.fornecedores)
        EscolherFornecedor(self, self.cot.fornecedores, sugerido,
                           lambda f: self.receber(f, caminho))

    def receber(self, fornecedor: str, caminho: str, avisar: bool = True):
        if not self.cot.itens:
            messagebox.showwarning("Receber resposta",
                                   "Abra primeiro a COTAÇÃO COMPLETA para ter a lista de itens.",
                                   parent=self)
            return
        try:
            resumo = aplicar_resposta(self.cot, fornecedor, ler_resposta(caminho))
        except Exception as e:
            messagebox.showerror("Receber resposta", f"Não consegui ler a resposta:\n{e}", parent=self)
            return
        self.atualizar()
        self.trazer_para_frente()
        if avisar:
            msg = (f"{fornecedor.upper()}: {resumo['com_preco']} itens com preço, "
                   f"{resumo['sem_preco']} sem preço.")
            if resumo["nao_encontrados"]:
                msg += (f"\n\n{len(resumo['nao_encontrados'])} códigos não estão na cotação: "
                        + ", ".join(resumo["nao_encontrados"][:10]))
            messagebox.showinfo("Resposta recebida", msg, parent=self)

    def exportar(self):
        caminho = filedialog.asksaveasfilename(
            parent=self, title="Salvar comparativo", defaultextension=".xlsx",
            initialfile="COMPRAS.xlsx", filetypes=[("Excel", "*.xlsx")])
        if not caminho:
            return
        try:
            exportar_excel(self.cot, caminho)
        except PermissionError:
            messagebox.showerror("Exportar", "O arquivo está aberto no Excel. Feche e tente de novo.",
                                 parent=self)
            return
        messagebox.showinfo("Exportar", f"Salvo em:\n{caminho}\n\n"
                            "A aba PEDIDOS separa os itens pelo fornecedor de menor preço.",
                            parent=self)

    def trazer_para_frente(self):
        self.deiconify()
        self.lift()
        self.attributes("-topmost", True)
        self.after(300, lambda: self.attributes("-topmost", False))
        self.focus_force()


class EscolherFornecedor(ctk.CTkToplevel):
    """Pergunta de qual fornecedor é a resposta (dá para digitar um novo)."""

    def __init__(self, master, fornecedores, sugerido, ao_confirmar):
        super().__init__(master)
        self.title("De qual fornecedor é a resposta?")
        self.geometry("360x150")
        self.resizable(False, False)
        self.transient(master)
        self.ao_confirmar = ao_confirmar
        ctk.CTkLabel(self, text="Fornecedor:").pack(anchor="w", padx=16, pady=(14, 4))
        self.combo = ctk.CTkComboBox(self, values=fornecedores or [""], width=320)
        self.combo.set(sugerido or (fornecedores[0] if fornecedores else ""))
        self.combo.pack(padx=16)
        ctk.CTkButton(self, text="CONFIRMAR", command=self.confirmar).pack(pady=12)
        self.bind("<Return>", lambda _e: self.confirmar())
        self.after(100, self.grab_set)

    def confirmar(self):
        nome = self.combo.get().strip()
        if not nome:
            return
        self.destroy()
        self.ao_confirmar(nome)


# ---------------------------------------------------------------- para o sistema

_tela: TelaCompras | None = None


def abrir_tela(master=None, planilha: str | None = None) -> TelaCompras:
    """Abre a tela COMPRAS (ou devolve a que já está aberta)."""
    global _tela
    if _tela is not None and _tela.winfo_exists():
        if planilha and planilha != _tela.planilha:
            _tela.carregar(planilha)
        _tela.trazer_para_frente()
        return _tela
    if master is None:
        master = tk._default_root or ctk.CTk()
        if isinstance(master, ctk.CTk) and not master.winfo_ismapped():
            master.withdraw()
    _tela = TelaCompras(master)
    if planilha:
        _tela.carregar(planilha)
    return _tela


def receber_resposta(fornecedor: str, arquivo: str, planilha: str | None = None,
                     master=None, avisar: bool = True) -> TelaCompras:
    """Chame isto quando chegar a resposta de um fornecedor: abre a tela
    igual à aba COMPRAS já com os preços dele preenchidos."""
    tela = abrir_tela(master, planilha)
    tela.receber(fornecedor, arquivo, avisar=avisar)
    return tela


if __name__ == "__main__":
    ctk.set_appearance_mode("light")
    raiz = ctk.CTk()
    raiz.withdraw()
    tela = abrir_tela(raiz)
    tela.protocol("WM_DELETE_WINDOW", raiz.destroy)
    tela.after(200, tela.abrir_planilha)
    raiz.mainloop()
