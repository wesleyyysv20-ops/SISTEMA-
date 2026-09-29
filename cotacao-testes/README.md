# Testes do sistema de cotação

Abrem o sistema (`../cotacao/index.html`) num navegador sem janela e conferem cada função:
os arquivos gerados (planilhas, pedidos, .zip, backup) são abertos e checados célula a célula.

| Arquivo | O que confere |
| --- | --- |
| `01-nova-cotacao` | arquivo do DataCar, conferência por grupo, itens repetidos, planilha do fornecedor |
| `02-importar-resposta` | importação da resposta (com e sem aba de controle, sem nome, arquivo .xls antigo) |
| `03-comparativo-pedidos` | vencedor, diferença 1º × 2º, avisos de preço, escolha manual, pedidos e comparativo em Excel (escolher outro preço pede confirmação) |
| `04-historico-relatorios` | histórico de preços dos produtos e relatórios |
| `05-envio-prazo` | envio em sequência, e-mail com cópia oculta, .zip das planilhas, prazo e cobrança |
| `06-lojas-marcas` | quantidades por loja, pedidos por loja, marcas abreviadas e marca errada |
| `07-backup-arquivo` | lembrete de backup e cotações arquivadas |
| `08-telas` | todas as telas abrem sem erro e sem rolagem lateral (1366 e 1024 px) |
| `09-nfe` | conferência da nota fiscal (XML da NF-e) com o pedido: fornecedor, loja, divergências, vínculos |
| `10-enviar-pedidos` | envio dos pedidos de compra por e-mail (texto, lojas de entrega, .zip, uma aba por loja ou lojas juntas) |
| `11-minimo-frete` | pedido mínimo e frete: avisos, sugestão de passar itens para o 2º colocado, cadastro |
| `12-padrao-disppar` | padrão do DISPPAR e da COTAÇÃO COMPLETA: marca exigida, sugestão pela OBS, colar códigos, banco, dúvidas, início |
| `13-importar-varias` | várias planilhas respondidas importadas de uma vez, com resumo e arquivo com erro |
| `14-nota-fornecedores` | nota dos fornecedores (resposta, prazo, cobertura, marca, notas fiscais) |
| `15-repetidos-kit` | códigos repetidos (regra do KIT do DISPPAR), etiqueta KIT, vermelho na planilha |
| `16-supabase` | site publicado: login, lista de acesso, dados salvos no Supabase (Supabase simulado) |
| `17-publicar` | robô de publicação (Supabase e Cloudflare simulados): cria, configura, convida e gera o config.js; pode rodar de novo |
| `18-marca-padrao` | nova cotação: Enter salva a marca e vai para o próximo item; Enter duas vezes grava como padrão no cadastro; sugestão de marca ao digitar; código editável só na cotação (KIT CORREIA/TENSOR) |
| `19-busca-itens` | nova cotação: procurar na lista (código, similar, marca, descrição), incluir do cadastro o que não está na lista, cadastrar no banco o que não existe e tirar item com confirmação |
| `20-duvida-lojas` | ❓ do comparativo: escolher a loja (uma ou as duas), quantidade e observação; Paranoá antes de São Sebastião |
| `21-marca-recusada` | "Não, é outra marca": o preço não ganha, o item fica aguardando outro preço; desfazer e nova marca do fornecedor; preço errado: remover ou corrigir pelo ✕ do preço |
| `22-marca-obrigatoria` | produto sem marca exigida: aviso e exclusão com confirmação, trocar marca (FREEMAX → FREMAX), bloqueio no formulário, na planilha e no DataCar |
| `23-dois-computadores` | gravação segura: juntar versões, dois computadores ao mesmo tempo, aba fechada antes de enviar, lotes antigos viram baldes |
| `24-ordem-fornecedores` | comparativo com os fornecedores em ordem alfabética (tela, totais e Excel), cada preço no fornecedor certo |
| `25-kaizen-estoque` | Kaizen: "MARCA/estoque" separa marca e estoque; quando ganha, a quantidade das lojas não passa do estoque; Rio Juntas: marca GO destacada (demora para chegar); Comando ganha até 5% acima do 1º (com o detalhe); estoque insuficiente: campo vermelho e aviso no item com o que foi digitado |
| `26-recolher-fornecedores` | quadro Fornecedores da cotação recolhível: começa fechado com resumo, abre/fecha no clique ou Enter, lembra a escolha |
| `27-coluna-fixa` | comparativo: colunas # e Produto fixas ao rolar para o lado; escolher outro preço mantém a rolagem |
| `28-filtro-vencedor` | comparativo: "Mostrar itens de" um fornecedor (ou sem preço) para digitar só as quantidades dele; etiquetas de aviso filtram os itens delas |
| `29-exportar-pedido` | exportar o pedido do fornecedor: uma planilha Excel por loja, cada uma com o seu "Salvar como" ou somada entregue numa loja; marca a cotação dele como concluída e lembra a forma; nome do arquivo editável; itens com o nº da planilha enviada aos fornecedores |
| `30-prazo-hora-dif` | prazo de resposta com hora (vence no mesmo dia, conta na nota do fornecedor); Dif. 1º × 2º mostra o mais barato quando você escolheu outro ; alerta quando a diferença passa de 100% (possível preço errado); marcar preço como certo; alterar preço pelo alerta |
| `31-foco-alt-tab` | quantidade: o cursor continua no mesmo campo ao redesenhar a tela e ao sair e voltar para a janela (Alt+Tab) |
| `32-duvida-fora-pedido` | item marcado em Dúvidas: linha destacada (roxo) e fora do pedido exportado da loja da dúvida; sai da fila e volta ao pedido |
| `33-setas-quantidade` | quantidades: ↑ ↓ ← → andam pela grade (loja e item); número digitado fora do campo vai para a quantidade da linha marcada |
| `34-duvidas-agrupadas` | fila de dúvidas: itens iguais numa linha só ("2 DPR e 5 DSS", também no texto do WhatsApp); filtro por fornecedor; editar a quantidade de cada loja |
| `35-usuarios` | usuários: administrador cadastra (e-mail + senha inicial), troca a senha e tira o acesso; a pessoa entra e troca a própria senha; outro computador recebe as alterações |
| `36-janela-flutuante` | janela flutuante (Chrome/Edge: sempre por cima; Firefox: janelinha separada): item atual, quantidades, Enter/setas/Tab, estoque do Kaizen e sincronia com o comparativo; filtro por fornecedor; ❓ Dúvida na própria janela |
| `37-versao-nova` | versão nova publicada: a aba aberta mostra "Atualizar agora", salva o pendente e recarrega |
| `38-tres-pessoas` | 3 pessoas ao mesmo tempo: quem digita não é interrompido e recebe os números dos outros; junção campo a campo (quantidades, respostas de fornecedores, dúvidas) |

## Rodar

```
cd cotacao-testes
npm install
npx playwright install chromium   # só na primeira vez
npm test
```

No GitHub eles rodam sozinhos a cada alteração em `cotacao/` (workflow *Testes do sistema de cotação*).
