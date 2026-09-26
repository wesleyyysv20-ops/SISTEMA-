# Tela COMPRAS da cotação

Tela em Python/customtkinter igual à aba **COMPRAS** da planilha `COTAÇÃO COMPLETA.xlsm`:
itens da cotação nas linhas, duas colunas por fornecedor (valor e marca) e no final
**MENOR / EMPRESA / 2º MENOR / EMPRESA / PORCENTAGEM**.

- Verde: fornecedor com o menor preço do item.
- Amarelo na PORCENTAGEM: diferença para o 2º menor abaixo de 2% (vale conferir a marca).
- Faixa de respostas no topo: substitui a aba FORNECEDORES (quem já respondeu fica marcado).
- As células de preço aceitam digitar e colar do Excel (Ctrl+V).
- **EXPORTAR EXCEL** gera a aba COMPRAS e uma aba **PEDIDOS** com os itens separados pelo
  fornecedor que ganhou, com total por fornecedor.

A tela lê todos os itens da aba PLANILHA. A macro `SIMILAR` da planilha só copiava as
linhas 6 a 35 (30 itens) para a aba COMPRAS.

## Instalar

```
pip install -r requirements.txt
```

## Usar pelo sistema DISPPAR

Quando chegar a resposta de um fornecedor (o arquivo de cotação devolvido com VALOR e MARCA
preenchidos):

```python
from tela_compras import receber_resposta

receber_resposta(
    "COBRA",                                   # nome do fornecedor
    r"C:\Downloads\cotacao_cobra.xlsx",        # arquivo que ele mandou
    planilha=r"\\server2\G\COTAÇOES\WESLEY\COTAÇÃO COMPLETA.xlsm",
    master=janela_principal,                   # a janela CTk do sistema
)
```

A tela abre já com os preços do fornecedor. Se ela já estiver aberta, só vem para a frente
e recebe a nova coluna. `planilha` só é necessário na primeira chamada.

## Usar sozinho

```
python tela_compras.py
```

Clique em **ABRIR COTAÇÃO** e depois em **RECEBER RESPOSTA** para cada arquivo que chegar.

## Gerar o .exe

Junto com o resto do sistema, no PyInstaller:

```
pyinstaller --noconsole --collect-all customtkinter --collect-all tksheet main.py
```
