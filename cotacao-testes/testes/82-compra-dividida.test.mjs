import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
  fornecedores: [{ id: 'f1', nome: 'KAIZEN' }, { id: 'f2', nome: 'VIA PEÇAS' }],
  cotacoes: [cotacao('c1', '0001', '2026-10-06', 'aberta', [item('A', 'AMORTECEDOR', 'QUALQUER', { codigo: 'GP1' }), item('B', 'VELA', 'QUALQUER', { codigo: 'BKR6E' })], [
    forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'COFAP' }, 1: { preco: 20, marca: 'NGK' } }),
    forn('f2', 'VIA PEÇAS', { 0: { preco: 12, marca: 'MONROE' }, 1: { preco: 25, marca: 'NGK' } }),
  ], { qtds: { 0: { paranoa: 2 } } })],
});

test('compra dividida: parte do item na empresa ganhadora e parte em outra (pedidos, totais e relatórios)', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'cotacao', 'c1');
  await page.click('.tab-comp tr[data-comp-linha="0"] .div-add');
  const dlg = page.locator('.dlg-dividir');
  assert.match(n(await dlg.innerText()), /Ganhou: KAIZEN R\$ 10,00/);
  await dlg.locator('[name=q_paranoa]').fill('1');
  await dlg.locator('[name=q_sao-sebastiao]').fill('3');
  assert.match(n(await dlg.locator('.div-total').innerText()), /4 un\. × R\$ 12,00 = R\$ 48,00/);
  await dlg.locator('button.primary').click();
  // etiqueta na linha e total da linha: 2×10 + 4×12 = 68
  assert.match(n(await page.locator('.tab-comp tr[data-comp-linha="0"] .div-chip').innerText()), /VIA PEÇAS · 4 un\. \(DPR 1 · DSS 3\) · R\$ 48,00/);
  assert.match(n(await page.locator('#tot-0').innerText()), /R\$ 68,00[\s\S]*6 un\. \(4 divididas\)/);
  // pedidos: KAIZEN 2 un. a 10; VIA PEÇAS 4 un. a 12 (DPR 1, DSS 3)
  const peds = await page.evaluate(() => pedidosPorFornecedor(db.cotacoes[0]).map(p => [p.f.nome, p.itens.map(x => [x.it.codigo, x.qtd, x.preco, x.qtds]), p.total]));
  assert.deepEqual(peds, [
    ['KAIZEN', [['GP1', 2, 10, { paranoa: 2, 'sao-sebastiao': 0 }]], 20],
    ['VIA PEÇAS', [['GP1', 4, 12, { paranoa: 1, 'sao-sebastiao': 3 }]], 48],
  ]);
  // o mesmo total em todo o sistema: resumo da cotação e relatórios
  assert.match(n(await page.locator('#resumoCot').innerText()), /Total do pedido\s*R\$ 68,00/);
  const rel = await page.evaluate(() => { const c = db.cotacoes[0]; return comparar(c).melhor; });
  assert.equal(rel, 68);
  // mudar e tirar a divisão pela etiqueta
  await page.click('.tab-comp tr[data-comp-linha="0"] .div-chip');
  await page.click('.dlg-dividir [data-r=tirar]');
  assert.equal(await page.locator('.div-chip').count(), 0);
  assert.equal(await page.evaluate(() => pedidosPorFornecedor(db.cotacoes[0]).length), 1);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('compra dividida pela janela flutuante', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.evaluate(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { requestWindow: async () => {
      const f = document.createElement('iframe'); f.id = 'janelaTeste'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:560px;z-index:99999;background:#fff'; document.body.appendChild(f);
      const w = f.contentWindow; w.document.open(); w.document.write('<!doctype html><html><head></head><body></body></html>'); w.document.close(); return w;
    } } });
  });
  await irPara(page, 'cotacao', 'c1');
  await page.locator('.tab-comp tbody tr[data-comp-linha="1"] td').nth(1).click();
  await page.click('[data-act=abrirPip]');
  const j = page.frameLocator('#janelaTeste');
  await j.locator('#pip .pip-cod').waitFor();
  await j.locator('.div-add').click();
  await j.locator('.dlg-dividir [name=q_paranoa]').fill('2');
  await j.locator('.dlg-dividir button.primary').click();
  await j.locator('.div-chip').waitFor();
  assert.match(n(await j.locator('.div-chip').innerText()), /VIA PEÇAS · 2 un\./);
  assert.deepEqual(await page.evaluate(() => db.cotacoes[0].divisoes), { 1: { f2: { paranoa: 2 } } });
  assert.match(n(await page.locator('.tab-comp tr[data-comp-linha="1"] .div-chip').innerText()), /VIA PEÇAS/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
