# Sistema de Cotação

Sistema web para cadastrar produtos e fornecedores, montar cotações, enviar a planilha Excel
para os fornecedores preencherem e comparar os preços que eles devolverem.

Roda direto no navegador — não precisa instalar nada nem de servidor.

## Como abrir

- **No computador:** abra o arquivo `cotacao/index.html` no Chrome/Edge (duplo clique).
- **Por link (PC ou celular):** se o GitHub Pages estiver ativado neste repositório
  (Settings → Pages → Source: *GitHub Actions*), o workflow `Publicar sistema de cotação`
  publica o sistema a cada alteração na branch `main`.

> Quando aberto como página publicada no Claude, os dados ficam salvos na nuvem junto com a
> página e aparecem em qualquer dispositivo. Aberto como arquivo local, os dados ficam salvos **no navegador em que você usa o sistema**. Use
> *Configurações → Baixar backup* com frequência. O mesmo arquivo de backup serve para
> passar os dados para outro computador/navegador (*Restaurar backup*).

## Fluxo de uso

1. **Configurações:** preencha nome da loja, CNPJ, seu nome, telefone e e-mail
   (aparecem no cabeçalho da planilha e no e-mail). Dá para editar o texto padrão do e-mail.
2. **Produtos:** cadastre um a um ou importe uma planilha (`.xlsx` ou `.csv`) com as colunas
   `Código, Descrição, Unidade, Marca, Categoria`. Produtos com o mesmo código são atualizados.
3. **Fornecedores:** cadastre nome, contato e e-mail.
4. **Nova cotação:** busque os produtos, informe as quantidades, marque os fornecedores e clique
   em *Criar cotação*.
5. **Enviar:** na cotação, clique em **✉ Enviar** na linha do fornecedor. No painel que abre,
   baixe a planilha daquele fornecedor e abra o e-mail (Gmail, Outlook ou programa de e-mail)
   já com destinatário, assunto e texto — é só **anexar o arquivo baixado** e enviar. Se o
   e-mail não abrir, há botões para copiar destinatário, assunto e texto. (Navegadores não
   permitem anexar arquivos automaticamente em links de e-mail.)
6. **Receber:** quando o fornecedor devolver a planilha preenchida, clique em **📥 Importar**
   (ou use *Importar planilha respondida* na lista de cotações — o sistema reconhece sozinho
   de qual cotação e fornecedor é o arquivo). Também é possível **✎ Digitar** os preços.
7. **Comparar:** o comparativo mostra os preços lado a lado, o menor preço de cada item em
   verde, o total de cada fornecedor e o total da melhor combinação. Dá para exportar em Excel.

## A planilha enviada ao fornecedor

- Cabeçalho com os dados da loja, nº da cotação, data, prazo de resposta e observações.
- Colunas: Item, Código, Descrição, Marca/Ref., Unid., Qtd., **Preço Unit.**, Total (fórmula),
  **Prazo Entrega**, **Observação**.
- Campos para **condição de pagamento, prazo de entrega, frete, validade e vendedor**.
- Só os campos em amarelo ficam editáveis (proteção sem senha, pode ser desligada em Configurações).
- Uma aba oculta (`_dados`) identifica a cotação e o fornecedor na hora da importação.

## Arquivos

| Arquivo | O que é |
| --- | --- |
| `index.html` | Página do sistema |
| `app.js` | Toda a lógica (cadastros, cotações, Excel, e-mail) |
| `style.css` | Visual |
| `vendor/exceljs.min.js` | Biblioteca [ExcelJS](https://github.com/exceljs/exceljs) 4.4.0 (licença MIT) usada para gerar e ler as planilhas |
