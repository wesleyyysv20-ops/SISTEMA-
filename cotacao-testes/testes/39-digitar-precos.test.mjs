import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

test('digitar preços do fornecedor: a tabela mostra o código de cada item', async () => {
  const itens = [item('P1', 'ADITIVO COMBUSTIVEL (GASOLINA)', 'QUALQUER', { codigo: 'ADT-01' }), item('P2', 'AMORTECEDOR DIANTEIRO', 'SÓ COFAP', { codigo: 'GP30562' })];
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0039', '2026-09-29', 'aberta', itens, [forn('f1', 'KAIZEN', { 1: { preco: 189.26 } })])] }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.click('[data-act=digitar][data-f="0"]');
  const painel = page.locator('#painelDigitar');
  assert.deepEqual((await painel.locator('thead th').allInnerTexts()).map(t => n(t).trim().toUpperCase()).slice(0, 3), ['#', 'CÓDIGO', 'DESCRIÇÃO']);
  assert.deepEqual(await painel.locator('td.cod-digitar').allInnerTexts(), ['ADT-01', 'GP30562']);
  assert.match(n(await painel.locator('tbody tr').nth(1).innerText()), /2\s+GP30562\s+AMORTECEDOR DIANTEIRO/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
