import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

const itens = ['A', 'B', 'C'].map(x => item('P' + x, 'PECA ' + x, 'QUALQUER', { codigo: 'COD-' + x }));

test('quantidades: setas andam pela grade e número digitado fora do campo vai para a quantidade', async () => {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0033', '2026-09-28', 'aberta', itens, [forn('f1', 'KAIZEN', { 0: { preco: 10 }, 1: { preco: 20 }, 2: { preco: 5 } })])] }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const onde = () => page.evaluate(() => { const a = document.activeElement; return a?.dataset?.qtdLoja ? `${a.dataset.i}/${a.dataset.qtdLoja}` : a?.tagName; });
  const qtd = (i, l) => page.evaluate(([i, l]) => db.cotacoes[0].qtds?.[i]?.[l] ?? null, [i, l]);

  await page.click('.qtd-loja[data-i="0"][data-qtd-loja="paranoa"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await onde(), '0/sao-sebastiao');
  await page.keyboard.press('ArrowRight'); // já está na última loja: fica
  assert.equal(await onde(), '0/sao-sebastiao');
  await page.keyboard.press('ArrowDown');
  assert.equal(await onde(), '1/sao-sebastiao');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await onde(), '1/paranoa');
  await page.keyboard.press('ArrowUp');
  assert.equal(await onde(), '0/paranoa');

  // clicou fora (no nome do item da linha 3) e digitou: o número vai para a quantidade daquela linha
  await page.locator('.tab-comp tbody tr[data-comp-linha="2"] td').nth(1).click();
  await page.evaluate(() => document.activeElement.blur());
  assert.equal(await onde(), 'BODY');
  await page.keyboard.type('25');
  assert.equal(await onde(), '2/paranoa');
  assert.equal(await qtd(2, 'paranoa'), 25);

  // clicou fora de novo e apertou a seta: volta para a quantidade
  await page.locator('.tab-comp tbody tr[data-comp-linha="2"] td').nth(1).click();
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('ArrowDown');
  assert.equal(await onde(), '2/paranoa');
  // com janela aberta o teclado não vai para a quantidade
  await page.evaluate(() => { document.activeElement.blur(); confirmar('Teste?', 'Ok'); });
  await page.keyboard.type('7');
  assert.equal(await qtd(2, 'paranoa'), 25);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
