import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { abrir, base, fechar, salvarDepois, lerXlsx, valor, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

const itens = ['A', 'B', 'C'].map(x => item('P' + x, 'PECA ' + x, 'QUALQUER', { codigo: 'COD-' + x }));
const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [
    { id: 'paranoa', nome: 'Paranoá', sigla: 'DPR', cnpj: '11.111.111/0001-11', endereco: 'Quadra 2, Paranoá' },
    { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS', cnpj: '22.222.222/0001-22', endereco: 'Rua 1, São Sebastião' },
  ] },
  fornecedores: [{ id: 'f1', nome: 'KAIZEN' }, { id: 'f2', nome: 'VIA PEÇAS' }],
  cotacoes: [cotacao('c1', '0029', '2026-09-28', 'aberta', itens, [
    forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 30 }, 2: { preco: 5 } }),
    forn('f2', 'VIA PEÇAS', { 0: { preco: 20 }, 1: { preco: 20 } }),
    forn('f3', 'COBRA'),
  ], { qtds: { 0: { paranoa: 2, 'sao-sebastiao': 3 }, 1: { paranoa: 1 }, 2: { 'sao-sebastiao': 4 } } })],
});

/** Linhas de itens de uma aba de pedido: { cab, linhas } (valores já calculados). */
function lerPedido(ws) {
  const linhas = [];
  let cab = null;
  ws.eachRow(r => {
    const v = r.values.slice(1).map(x => (x && x.formula ? x.result : x));
    if (v.includes('Item')) cab = v; else if (cab && typeof v[0] === 'number') linhas.push(v);
  });
  return { cab, linhas, col: nome => cab.indexOf(nome) };
}

async function abrirCot() {
  const s = await abrir(dados());
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return s;
}

test('exportar pedido: planilhas individuais por loja (zip) e cotação do fornecedor marcada como concluída', async () => {
  const s = await abrirCot();
  const { page } = s;
  assert.deepEqual(await page.locator('.corpo-recolhe [data-act=exportarPedidoForn]').allInnerTexts(), ['⬇ Exportar (2)', '⬇ Exportar (1)']);
  assert.equal(await page.locator('.corpo-recolhe [data-act=enviar]').count(), 0, 'sem o botão Enviar na linha');
  // trocar a opção na janela não mexe no formato do envio de pedidos em lote
  assert.equal(await page.evaluate(() => ui.formatoPedido ?? null), null);
  assert.equal(await page.locator('.corpo-recolhe .btn-desligado button:disabled').innerText(), '⬇ Exportar (0)');
  assert.match(await page.locator('.corpo-recolhe .btn-desligado').getAttribute('title'), /COBRA ainda não respondeu/);

  // Esc na janela: nada acontece
  await page.click('[data-act=exportarPedidoForn] >> nth=0');
  assert.deepEqual(await page.locator('.dlg-formato .formato-opcao b').allInnerTexts(),
    ['Planilhas individuais por loja', 'Planilha somada — entregar em Paranoá', 'Planilha somada — entregar em São Sebastião']);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => db.cotacoes[0].fornecedores[0].concluidoEm || null), null);

  await page.click('[data-act=exportarPedidoForn] >> nth=0');
  await page.check('input[name=formatoExport][value=individual]');
  assert.equal(await page.evaluate(() => ui.formatoPedido ?? null), null, 'não mexe no formato do envio em lote');
  const arq = await salvarDepois(s, () => page.click('.dlg-formato button.primary'));
  assert.equal(arq.nome, 'Pedidos_0029_kaizen_por_loja.zip');
  const zip = await JSZip.loadAsync(arq.buffer);
  assert.deepEqual(Object.keys(zip.files).sort(), ['Pedido_0029_kaizen_paranoa.xlsx', 'Pedido_0029_kaizen_sao_sebastiao.xlsx']);
  const pa = (await lerXlsx(await zip.file('Pedido_0029_kaizen_paranoa.xlsx').async('nodebuffer'))).worksheets[0];
  assert.equal(valor(pa.getCell('A1')), 'PEDIDO DE COMPRA — PARANOÁ');
  const p1 = lerPedido(pa);
  assert.deepEqual(p1.linhas.map(l => [l[1], l[p1.col('QTD')]]), [['COD-A', 2]], 'só o que o Paranoá pediu');
  const ss = lerPedido((await lerXlsx(await zip.file('Pedido_0029_kaizen_sao_sebastiao.xlsx').async('nodebuffer'))).worksheets[0]);
  assert.deepEqual(ss.linhas.map(l => [l[1], l[ss.col('QTD')]]), [['COD-A', 3], ['COD-C', 4]]);

  // marcada como concluída; o formato fica lembrado no cadastro do fornecedor
  assert.match(await page.locator('.corpo-recolhe tbody tr').first().locator('td').nth(3).innerText(), /✓ Concluída/, 'na coluna Envio');
  assert.deepEqual(await page.evaluate(() => db.fornecedores.find(f => f.id === 'f1').formatoPedido), { tipo: 'individual' });
  // reabrir
  await page.click('[data-act=reabrirForn]');
  await page.click('.dlg button.primary');
  assert.equal(await page.locator('.corpo-recolhe [data-act=reabrirForn]').count(), 0);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('exportar pedido: planilha somada entregue numa loja (e a janela lembra a forma do fornecedor)', async () => {
  const s = await abrirCot();
  const { page } = s;
  await page.click('[data-act=exportarPedidoForn] >> nth=0');
  await page.check('input[name=formatoExport][value="somada:sao-sebastiao"]');
  const arq = await salvarDepois(s, () => page.keyboard.press('Enter'));
  assert.equal(arq.nome, 'Pedido_0029_kaizen_entrega_sao_sebastiao.xlsx');
  const ws = (await lerXlsx(arq.buffer)).worksheets[0];
  assert.equal(valor(ws.getCell('A1')), 'PEDIDO DE COMPRA — ENTREGA EM SÃO SEBASTIÃO');
  // formato combinado: título na 1ª linha e a tabela logo abaixo (sem bloco de dados)
  assert.equal(valor(ws.getCell('A2')), 'Item');
  assert.deepEqual(ws.columns.map(c => c.width), [5.1, 18, 15.1, 4.7, 10.7, 31.6, 10.3, 12.7]);
  const p = lerPedido(ws);
  assert.equal(p.col('QTD Paranoá'), -1, 'uma coluna de quantidade só (somada)');
  assert.deepEqual(p.linhas.map(l => [l[1], l[p.col('QTD')]]), [['COD-A', 5], ['COD-C', 4]]);
  const tot = ws.getCell(`H${3 + p.linhas.length}`);
  assert.deepEqual([tot.font.bold, tot.font.size, tot.font.color.argb], [true, 14, 'FFFF0000'], 'total em vermelho, negrito, 14');

  // próxima vez: já vem marcada a forma usada
  await page.click('[data-act=exportarPedidoForn] >> nth=0');
  assert.equal(await page.locator('input[name=formatoExport]:checked').getAttribute('value'), 'somada:sao-sebastiao');
  await page.keyboard.press('Escape');

  // comparativo: "Mostrar itens de" continua com o botão do pedido do fornecedor escolhido
  await page.selectOption('#filtroVencedor', 'f2');
  assert.equal(await page.locator('#pedidoFiltro button').innerText(), '⬇ Pedido de VIA PEÇAS');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('pedido exportado: itens em ordem alfabética da descrição, numerados em sequência', async () => {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0030', '2026-09-28', 'aberta',
    [item('P1', 'SENSOR DETONACAO', 'QUALQUER', { codigo: 'S1' }), item('P2', 'COLA RAPIDA', 'QUALQUER', { codigo: 'C1' }), item('P3', 'JUNTA FIXA', 'QUALQUER', { codigo: 'J1' })],
    [forn('f1', 'KAIZEN', { 0: { preco: 10 }, 1: { preco: 5 }, 2: { preco: 7 } })])] }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.click('[data-act=exportarPedidoForn]');
  const arq = await salvarDepois(s, () => page.keyboard.press('Enter'));
  const p = lerPedido((await lerXlsx(arq.buffer)).worksheets[0]);
  assert.deepEqual(p.linhas.map(l => [l[0], l[p.col('Descrição')]]), [[1, 'COLA RAPIDA'], [2, 'JUNTA FIXA'], [3, 'SENSOR DETONACAO']]);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
