import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

test('lista de cotações: chips de status com contagem, linha inteira abre, coluna de pedidos', async () => {
  const s = await abrir(base({
    cotacoes: [
      cotacao('c1', '0001', '2026-09-28', 'finalizada', [item('A', 'X', 'NGK')], [forn('f1', 'KAIZEN', { 0: { preco: 10 } }, { concluidoEm: '2026-09-29T10:00:00Z' })], { qtds: { 0: { paranoa: 1 } } }),
      cotacao('c2', '0002', '2026-10-01', 'aberta', [item('A', 'X', 'NGK')], [forn('f1', 'KAIZEN')], { titulo: 'COTAÇÃO 1 DE OUTUBRO' }),
    ],
  }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  assert.match(await page.locator('.chips-status').innerText(), /Todas\s*2[\s\S]*Abertas\s*1[\s\S]*Finalizadas\s*1[\s\S]*Canceladas\s*0/);
  await page.click('[data-act=filtroStatusCot][data-status=aberta].chip-status');
  assert.equal(await page.locator('#tbCot tr').count(), 1);
  await page.click('[data-act=filtroStatusCot][data-status=""].chip-status');
  assert.equal(await page.locator('#tbCot tr').count(), 2);
  assert.match(await page.locator('#tbCot tr[data-abrir-cot=c1]').innerText(), /1\/1/, 'pedidos exportados');
  // clicar no meio da linha (no título) abre a cotação
  await page.locator('#tbCot tr[data-abrir-cot=c2] td:nth-child(2)').click();
  assert.match(await page.locator('#app h2').first().innerText(), /Cotação nº 0002/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
