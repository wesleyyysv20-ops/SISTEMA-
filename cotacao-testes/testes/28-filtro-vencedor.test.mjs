import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

test('comparativo: "Mostrar itens de" um fornecedor para digitar só as quantidades dele', async () => {
  const itens = ['A', 'B', 'C', 'D', 'E'].map(x => item('P' + x, 'PECA ' + x, 'QUALQUER', { codigo: x }));
  // KAIZEN ganha A, C, E; VIA ganha B; D fica sem preço
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0028', '2026-09-28', 'aberta', itens, [
    forn('f1', 'KAIZEN', { 0: { preco: 10 }, 1: { preco: 30 }, 2: { preco: 10 }, 4: { preco: 10 } }),
    forn('f2', 'VIA PEÇAS', { 0: { preco: 20 }, 1: { preco: 20 } }),
  ])] }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const visiveis = () => page.locator('.tab-comp tbody tr[data-comp-linha]:not([hidden])').evaluateAll(trs => trs.map(tr => tr.querySelector('td:nth-child(2)').innerText.split('\n')[0].trim()));
  const opcoes = await page.locator('#filtroVencedor option').allInnerTexts();
  assert.deepEqual(opcoes, ['Todos os itens (5)', 'KAIZEN (3)', 'VIA PEÇAS (1)', 'Sem preço / aguardando (1)']);

  await page.selectOption('#filtroVencedor', 'f1');
  assert.deepEqual(await visiveis(), ['A', 'C', 'E']);
  // o cursor já vai para a 1ª quantidade; Enter desce só pelos itens mostrados
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await page.keyboard.type('4');
  assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(db.cotacoes[0].qtds).map(([i, o]) => [i, o.paranoa]))), { 0: 2, 2: 3, 4: 4 });

  // continua filtrado depois de redesenhar (ex.: trocar o vencedor de um item)
  await page.evaluate(() => render());
  assert.deepEqual(await visiveis(), ['A', 'C', 'E']);
  await page.selectOption('#filtroVencedor', '__sem');
  assert.deepEqual(await visiveis(), ['D']);
  await page.selectOption('#filtroVencedor', '');
  assert.equal((await visiveis()).length, 5);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('comparativo: na coluna Produto o código vem em cima e a descrição embaixo', async () => {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0028', '2026-09-28', 'aberta', [item('P1', 'ADITIVO COMBUSTIVEL (GASOLINA)', 'QUALQUER', { codigo: '1622-ADITIVO', similar: 'X99' })], [forn('f1', 'KAIZEN', { 0: { preco: 10 } })])] }));
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  const cel = s.page.locator('.tab-comp tbody tr').first().locator('td').nth(1);
  const [linha1, linha2] = (await cel.innerText()).split('\n');
  assert.equal(linha1.trim(), '1622-ADITIVO');
  assert.match(linha2, /^ADITIVO COMBUSTIVEL \(GASOLINA\) · sim\. X99/);
  assert.equal(await cel.locator('.small.muted').first().innerText(), 'ADITIVO COMBUSTIVEL (GASOLINA) · sim. X99');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('quantidades: Tab anda na linha (Paranoá → São Sebastião → item de baixo); Enter desce na mesma loja', async () => {
  const itens = ['A', 'B', 'C'].map(x => item('P' + x, 'PECA ' + x, 'QUALQUER', { codigo: x }));
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0033', '2026-09-28', 'aberta', itens, [forn('f1', 'KAIZEN', { 0: { preco: 1 }, 1: { preco: 1 }, 2: { preco: 1 } })])] }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const atual = () => page.evaluate(() => [document.activeElement.dataset.qtdLoja, document.activeElement.dataset.i].join(':'));
  await page.click('[data-qtd-loja=paranoa][data-i="0"]');
  await page.keyboard.press('Tab');
  assert.equal(await atual(), 'sao-sebastiao:0', 'Tab vai para São Sebastião');
  await page.keyboard.press('Tab');
  assert.equal(await atual(), 'paranoa:1', 'depois desce para o item de baixo');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await atual(), 'sao-sebastiao:0');
  await page.keyboard.press('Enter');
  assert.equal(await atual(), 'sao-sebastiao:1', 'Enter desce na mesma loja');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
