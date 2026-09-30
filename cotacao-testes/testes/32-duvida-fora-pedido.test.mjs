import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { abrir, base, fechar, salvarDepois, lerXlsx, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const itens = ['A', 'B', 'C'].map(x => item('P' + x, 'PECA ' + x, 'QUALQUER', { codigo: 'COD-' + x }));
const dados = (extra = {}) => base({
  config: { loja: 'DISPPAR', lojas: [
    { id: 'paranoa', nome: 'Paranoá', sigla: 'DPR', cnpj: '11.111.111/0001-11', endereco: 'Quadra 2, Paranoá' },
    { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS', cnpj: '22.222.222/0001-22', endereco: 'Rua 1, São Sebastião' },
  ] },
  fornecedores: [{ id: 'f1', nome: 'KAIZEN' }, { id: 'f2', nome: 'VIA PEÇAS' }],
  cotacoes: [cotacao('c1', '0032', '2026-09-28', 'aberta', itens, [
    forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'QUALQUER' }, 1: { preco: 30 }, 2: { preco: 5 } }),
    forn('f2', 'VIA PEÇAS', { 0: { preco: 20 }, 1: { preco: 20 } }),
  ], { qtds: { 0: { paranoa: 2, 'sao-sebastiao': 3 }, 1: { paranoa: 1 }, 2: { 'sao-sebastiao': 4 } } })],
  ...extra,
});

async function abrirCot(extra) {
  const s = await abrir(dados(extra));
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return s;
}
const itensKaizen = (page, loja = null) => page.evaluate(l => pedidosPorFornecedor(db.cotacoes[0], l).find(p => p.fi === 0)?.itens.map(x => [x.it.codigo, x.qtd]) ?? [], loja);
/** [código, QTD] das linhas de itens da planilha do pedido. */
function linhasPedido(ws) {
  const out = []; let cab = null;
  ws.eachRow(r => {
    const v = r.values.slice(1).map(x => (x && x.formula ? x.result : x));
    if (v.includes('Item')) cab = v; else if (cab && typeof v[0] === 'number') out.push([v[1], v[cab.indexOf('QTD')]]);
  });
  return out;
}

test('item em dúvida: linha destacada e fora do pedido exportado; sai da fila e volta ao pedido', async () => {
  const s = await abrirCot();
  const { page } = s;
  const linha = page.locator('.tab-comp tbody tr[data-comp-linha="0"]');
  await linha.locator('[data-act=duvidaItem]').click();
  await page.click('.dlg button[data-r="1"]'); // as duas lojas (as que têm quantidade)
  assert.match(await linha.getAttribute('class'), /\bsit-duvida\b/);
  assert.match(n(await linha.locator('.chip-duvida').innerText()), /❓ em dúvida · DPR \+ DSS · fora do pedido/);
  assert.match(n(await page.locator('.pill-aviso.aviso-duvida').innerText()), /❓ 1 em dúvida/);
  assert.match(n(await page.locator('#secPedidos').innerText()), /1 item\(ns\) em Dúvidas ficam fora dos pedidos/);
  assert.deepEqual(await itensKaizen(page), [['COD-C', 4]]);

  // exportar: só São Sebastião tem item do KAIZEN (o COD-A ficou de fora)
  await page.click('.corpo-recolhe [data-act=exportarPedidoForn] >> nth=0');
  await page.check('input[name=formatoExport][value=individual]');
  const arq = await salvarDepois(s, () => page.click('.dlg-formato button.primary'));
  assert.equal(arq.nome, 'Pedido_0032_kaizen_sao_sebastiao.xlsx');
  assert.deepEqual(linhasPedido((await lerXlsx(arq.buffer)).worksheets[0]), [['COD-C', 4]]);

  // a loja respondeu: tira da fila de Dúvidas e o item volta ao pedido
  await page.click('nav [data-route=duvidas]');
  while (await page.locator('[data-act=removerDuvida]').count()) await page.locator('[data-act=removerDuvida]').first().click();
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  assert.doesNotMatch(await page.locator('.tab-comp tbody tr[data-comp-linha="0"]').getAttribute('class'), /sit-duvida/);
  assert.equal(await page.locator('.chip-duvida').count(), 0);
  assert.deepEqual(await itensKaizen(page), [['COD-A', 5], ['COD-C', 4]]);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('dúvida de uma loja só (fila antiga, sem o número do item): sai só do pedido daquela loja', async () => {
  const s = await abrirCot({ duvidas: [{ id: 'd1', codigo: 'cod-a', empresa: 'DPR', qtd: 2, valor: 10, marca: '', obs: '', origem: { cotId: 'c1', numero: '0032', fornecedor: 'KAIZEN' } }] });
  const { page } = s;
  assert.match(n(await page.locator('.tab-comp tbody tr[data-comp-linha="0"] .chip-duvida').innerText()), /em dúvida · DPR · fora do pedido/);
  assert.deepEqual(await itensKaizen(page, 'paranoa'), []);
  assert.deepEqual(await itensKaizen(page, 'sao-sebastiao'), [['COD-A', 3], ['COD-C', 4]]);
  // somada: só a quantidade de São Sebastião
  await page.click('.corpo-recolhe [data-act=exportarPedidoForn] >> nth=0');
  await page.check('input[name=formatoExport][value="somada:sao-sebastiao"]');
  const arq = await salvarDepois(s, () => page.click('.dlg-formato button.primary'));
  assert.deepEqual(linhasPedido((await lerXlsx(arq.buffer)).worksheets[0]), [['COD-A', 3], ['COD-C', 4]]);
  // outra cotação com o mesmo código não é afetada
  assert.equal(await page.evaluate(() => duvidasPorItem({ id: 'outra', itens: db.cotacoes[0].itens }).size), 0);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
