import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
  fornecedores: [{ id: 'f1', nome: 'KAIZEN' }, { id: 'f2', nome: 'VIA PEÇAS' }],
  cotacoes: [cotacao('c1', '0001', '2026-10-09', 'aberta', [item('A', 'AMORTECEDOR', 'QUALQUER', { codigo: 'GP1' }), item('B', 'VELA', 'QUALQUER', { codigo: 'BKR6E' }), item('C', 'FILTRO', 'QUALQUER', { codigo: 'PSL55' })], [
    forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'COFAP' }, 1: { preco: 20, marca: 'NGK' }, 2: { preco: 9, marca: 'TECFIL' } }),
    forn('f2', 'VIA PEÇAS', { 0: { preco: 12, marca: 'PERFECT' }, 1: { preco: 25, marca: 'BOSCH' }, 2: { preco: 11, marca: 'PERFECT' } }),
  ], { qtds: { 0: { paranoa: 2 }, 1: { paranoa: 1 }, 2: { paranoa: 3 } } })],
});
const visiveis = page => page.locator('.tab-comp tbody tr[data-comp-linha]:not([hidden])').evaluateAll(trs => trs.map(tr => +tr.dataset.compLinha));

test('já comprado: sai dos pedidos e dos totais; desfazer volta', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'cotacao', 'c1');
  await page.click('.tab-comp tr[data-comp-linha="1"] [data-act=marcarComprado]');
  assert.match(n(await page.locator('#tot-1').innerText()), /já comprado/);
  const peds = await page.evaluate(() => pedidosPorFornecedor(db.cotacoes[0]).flatMap(p => p.itens.map(x => x.it.codigo)));
  assert.deepEqual(peds.sort(), ['GP1', 'PSL55'], 'a vela não vai em nenhum pedido');
  assert.match(n(await page.locator('#resumoCot').innerText()), /Total do pedido\s*R\$ 47,00/); // 2×10 + 3×9
  assert.equal(await page.locator('.pill-aviso.comprado').count(), 1);
  await page.click('.tab-comp tr[data-comp-linha="1"] [data-act=marcarComprado]');
  assert.match(n(await page.locator('#resumoCot').innerText()), /Total do pedido\s*R\$ 67,00/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('editar a marca do fornecedor direto no comparativo', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'cotacao', 'c1');
  await page.click('.tab-comp tr[data-comp-linha="0"] .btn-editar-preco');
  assert.match(await page.locator('.dlg .dlg-tit').innerText(), /Editar o preço de KAIZEN/);
  await page.click('.dlg button:text("Corrigir a marca…")');
  await page.fill('.dlg input', 'monroe');
  await page.click('.dlg button.primary');
  assert.deepEqual(await page.evaluate(() => db.cotacoes[0].fornecedores[0].respostas[0]), { preco: 10, marca: 'MONROE', marcaOriginal: 'COFAP' });
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('filtro por marca e a parte dividida aparecendo para a outra empresa', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'cotacao', 'c1');
  await page.selectOption('#filtroMarca', 'PERFECT');
  assert.deepEqual(await visiveis(page), [0, 2], 'só itens com preço na marca PERFECT');
  assert.equal(await page.locator('.tab-comp td.marca-filtrada').count(), 2);
  await page.selectOption('#filtroMarca', '');
  // divisão: parte da vela com a VIA PEÇAS → aparece em "Itens de: VIA PEÇAS"
  await page.evaluate(() => { db.cotacoes[0].divisoes = { 1: { f2: { 'sao-sebastiao': 2 } } }; salvar(); render(); });
  assert.match(await page.locator('#filtroVencedor option[value=f2]').innerText(), /VIA PEÇAS \(1\)/);
  await page.selectOption('#filtroVencedor', 'f2');
  assert.deepEqual(await visiveis(page), [1]);
  assert.equal(await page.locator('.tab-comp tr[data-comp-linha="1"] .div-chip.div-destaque').count(), 1);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('produtos: ver todos, conferência do cadastro e itens mais cotados', async () => {
  const produtos = Array.from({ length: 450 }, (_, i) => ({ id: 'p' + i, codigo: 'C' + i, descricao: 'PECA ' + i, unidade: 'UN', marca: 'QUALQUER', categoria: '' }));
  produtos.push({ id: 'x1', codigo: 'C1', descricao: 'OUTRA PECA', unidade: 'UN', marca: 'QUALQUER' }); // código repetido
  produtos.push({ id: 'x2', codigo: 'FA1', descricao: 'FILTRO DE AR', unidade: 'UN', marca: 'QUALQUER', similar: 'PR9' });
  produtos.push({ id: 'x3', codigo: 'PR9', descricao: 'PORCA FLANGE', unidade: 'UN', marca: 'QUALQUER' });
  const s = await abrir(base({ produtos, cotacoes: [
    cotacao('c1', '0001', '2026-10-01', 'aberta', [item('p1', 'PECA 1', 'QUALQUER', { codigo: 'C1' }), item('p2', 'PECA 2', 'QUALQUER', { codigo: 'C2' })], [forn('f1', 'KAIZEN', { 0: { preco: 5 }, 1: { preco: 6 } })], { qtds: { 0: { paranoa: 1 } } }),
    cotacao('c2', '0002', '2026-10-02', 'aberta', [item('p1', 'PECA 1', 'QUALQUER', { codigo: 'C1' })], [forn('f1', 'KAIZEN', { 0: { preco: 5.5 } })]),
  ] }));
  const { page } = s;
  await irPara(page, 'produtos');
  assert.match(n(await page.locator('#tbProd .mais-prod').innerText()), /Mostrando 200 de 453/);
  await page.click('[data-act=todosProdutos]');
  assert.equal(await page.locator('#tbProd tr:not(.hist-linha)').count(), 454, '453 produtos + a linha "mostrando todos"');
  const conf = n(await page.locator('.limpeza-cad').innerText());
  assert.match(conf, /1 código\(s\) repetido\(s\)/);
  assert.match(conf, /FILTRO DE AR tem o similar PR9, que é PORCA FLANGE/);
  await irPara(page, 'relatorios');
  const mais = n(await page.locator('#relMaisCotados').innerText());
  assert.match(mais, /C1\s+PECA 1[\s\S]*2×/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
