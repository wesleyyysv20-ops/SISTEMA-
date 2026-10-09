import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n } from '../ajuda.mjs';

after(fechar);

test('etiqueta de aviso: cada clique leva ao próximo item com o aviso (e volta ao primeiro no fim)', async () => {
  const itens = ['A', 'B', 'C', 'D', 'E'].map(x => item('P' + x, 'PECA ' + x, ['B', 'D'].includes(x) ? 'SÓ NGK' : 'QUALQUER', { codigo: x }));
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0001', '2026-10-09', 'aberta', itens, [
    forn('f1', 'KAIZEN', { 0: { preco: 10 }, 1: { preco: 10, marca: 'BOSCH' }, 2: { preco: 10 }, 3: { preco: 10, marca: 'BOSCH' }, 4: { preco: 10 } }),
    forn('f2', 'VIA', { 0: { preco: 11 }, 1: { preco: 12, marca: 'NGK' }, 2: { preco: 11 }, 3: { preco: 12, marca: 'NGK' }, 4: { preco: 11 } }),
  ])] }));
  const { page } = s;
  await irPara(page, 'cotacao', 'c1');
  const atual = () => page.evaluate(() => ui.linhaComp?.i);
  const pill = page.locator('.pill-aviso.aviso-marca');
  await pill.click();
  assert.equal(await atual(), 1, '1º item com marca diferente (B)');
  assert.match(await page.locator('.tab-comp tr[data-comp-linha="1"]').getAttribute('class'), /linha-atual/);
  assert.match(n(await pill.innerText()), /1\/2/);
  await pill.click();
  assert.equal(await atual(), 3, 'próximo (D)');
  assert.match(n(await pill.innerText()), /2\/2/);
  await pill.click();
  assert.equal(await atual(), 1, 'no fim, volta ao primeiro');
  // a lista continua inteira (o clique não filtra); o ⏷ filtra
  assert.equal(await page.locator('.tab-comp tbody tr[data-comp-linha]:not([hidden])').count(), 5);
  await page.click('.pill-filtro[data-tipo=marca]');
  assert.equal(await page.locator('.tab-comp tbody tr[data-comp-linha]:not([hidden])').count(), 2);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
