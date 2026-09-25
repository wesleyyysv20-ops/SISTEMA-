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
   `Código, Descrição, Unidade, Similar, Marca, Categoria`. Produtos com o mesmo código são atualizados.
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
   - **Escolher o vencedor na mão:** clique no preço de outro fornecedor para comprar dele
     aquele item (clique de novo para voltar ao menor preço).
   - **Aviso de preço fora do normal:** preços com mais de 30% de diferença do último preço pago
     (em cotações anteriores não canceladas), ou muito diferentes dos outros fornecedores, ganham um ⚠.
   - **Dif. 1º × 2º:** em cada item, quanto o 2º melhor preço é mais caro que o melhor (em %), e de
     qual fornecedor é o 2º preço. Também sai no comparativo em Excel.
8. **Pedidos de compra:** a seção *Pedidos de compra* gera uma planilha por fornecedor só com os
   itens que ele ganhou (código, similar, QTD, marca oferecida, valor e total), ou um arquivo único
   com uma aba por fornecedor.

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

## Histórico de preços e relatórios

- **Produtos:** a coluna *Último preço pago* mostra um mini gráfico da evolução e a variação para a
  compra anterior. O botão 📈 abre o histórico completo do produto: gráfico, cada cotação com o
  fornecedor, o preço pago, a diferença 1º × 2º e todos os preços recebidos. *Só com preço* filtra os
  produtos que já apareceram em cotações.
- **Relatórios:** por período, mostra o total comprado, a economia em relação à média e ao preço
  mais caro recebido, a diferença média entre o 1º e o 2º preço, quais fornecedores ganham mais itens
  e o resumo de cada cotação. As cotações canceladas não entram.

## Envio para vários fornecedores e cobrança

- Na cotação, marque os fornecedores (primeira coluna) e use **✉ Enviar para os marcados**:
  - **Opção 1:** baixe todas as planilhas num **.zip** (cada uma com o nome do fornecedor) e abra os
    e-mails em sequência; o fornecedor da vez fica destacado e é marcado como enviado ao abrir o e-mail.
  - **Opção 2:** um e-mail só com todos em **cópia oculta** e a planilha da cotação sem nome.
- **⬇ Planilhas dos marcados (.zip)** baixa só as planilhas.
- **Prazo:** o prazo de resposta pode ser alterado na própria cotação. Quando ele vence (ou falta o
  número de dias definido em Configurações), a cotação mostra quem falta responder, a lista de
  cotações ganha um aviso e o menu *Cotações* mostra um número. **📣 Cobrar quem falta** abre o
  e-mail de lembrete (modelo editável em Configurações) para cada um ou para todos juntos.

## Compra dividida entre as lojas

- As lojas ficam em **Configurações → Lojas** (padrão: São Sebastião e Paranoá), com CNPJ e endereço
  de entrega de cada uma.
- A cotação pede o preço por unidade. Depois das respostas, o comparativo tem uma coluna de
  **quantidade para cada loja** (Enter ou ↓ desce para o próximo item). Itens sem quantidade não
  entram nos pedidos.
- **Pedidos de compra:** por fornecedor e por loja (com o endereço de entrega da loja), todos de uma
  loja num arquivo, ou as lojas juntas (uma coluna de quantidade por loja).

## Marcas

- A marca pedida aparece no comparativo, e a marca respondida por cada fornecedor ganha uma etiqueta:
  ✓ (igual ou abreviação reconhecida, como COF = COFAP, MM = MAGNETI MARELLI, NKT = NAKATA),
  **? confira** (abreviação curta, a confirmar) ou **⚠ marca diferente**.
- Preço com marca diferente não ganha automaticamente (opção em Configurações); você ainda pode
  escolhê-lo clicando no preço.
- Clicando na etiqueta: confirmar que é a mesma marca, marcar como outra marca ou corrigir a marca.
  O sistema aprende as abreviações confirmadas; elas ficam em **Configurações → Abreviações de marcas**.
- No pedido de compra vai o nome completo da marca quando a abreviação foi reconhecida.

## Backup e cotações arquivadas

- Quando o último backup passa do prazo (7 dias por padrão; ajustável em Configurações → Backup), um
  aviso aparece no topo com **⬇ Baixar backup agora** ou **Lembrar amanhã**. O backup só conta como
  feito quando o arquivo é salvo de verdade.
- **Arquivar:** a cotação sai da lista, mas continua no histórico de preços e nos relatórios. A lista
  sugere arquivar as canceladas e as finalizadas com mais de 60 dias; *Ver só as arquivadas* mostra as
  arquivadas, e **↩ Desarquivar** (na cotação) traz de volta.
