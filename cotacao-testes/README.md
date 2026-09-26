# Testes do sistema de cotação

Abrem o sistema (`../cotacao/index.html`) num navegador sem janela e conferem cada função:
os arquivos gerados (planilhas, pedidos, .zip, backup) são abertos e checados célula a célula.

| Arquivo | O que confere |
| --- | --- |
| `01-nova-cotacao` | arquivo do DataCar, conferência por grupo, itens repetidos, planilha do fornecedor |
| `02-importar-resposta` | importação da resposta (com e sem aba de controle, sem nome, arquivo .xls antigo) |
| `03-comparativo-pedidos` | vencedor, diferença 1º × 2º, avisos de preço, escolha manual, pedidos e comparativo em Excel |
| `04-historico-relatorios` | histórico de preços dos produtos e relatórios |
| `05-envio-prazo` | envio em sequência, e-mail com cópia oculta, .zip das planilhas, prazo e cobrança |
| `06-lojas-marcas` | quantidades por loja, pedidos por loja, marcas abreviadas e marca errada |
| `07-backup-arquivo` | lembrete de backup e cotações arquivadas |
| `08-telas` | todas as telas abrem sem erro e sem rolagem lateral (1366 e 1024 px) |
| `09-nfe` | conferência da nota fiscal (XML da NF-e) com o pedido: fornecedor, loja, divergências, vínculos |
| `10-enviar-pedidos` | envio dos pedidos de compra por e-mail (texto, lojas de entrega, .zip, uma aba por loja ou lojas juntas) |
| `11-minimo-frete` | pedido mínimo e frete: avisos, sugestão de passar itens para o 2º colocado, cadastro |
| `12-padrao-disppar` | padrão do DISPPAR e da COTAÇÃO COMPLETA: marca exigida, sugestão pela OBS, colar códigos, banco, dúvidas, início |

## Rodar

```
cd cotacao-testes
npm install
npx playwright install chromium   # só na primeira vez
npm test
```

No GitHub eles rodam sozinhos a cada alteração em `cotacao/` (workflow *Testes do sistema de cotação*).
