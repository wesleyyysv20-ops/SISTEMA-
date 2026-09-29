import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

test('título da cotação: editar pela lista e pelo topo da cotação', async () => {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0046', '2026-09-29', 'aberta', [item('P1', 'PECA', 'NGK', { codigo: 'A1' })], [forn('f1', 'KAIZEN')])] }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  assert.match(n(await page.locator('#tbCot tr').first().innerText()), /—/);
  // pela lista
  await page.locator('#tbCot tr').first().hover();
  await page.click('#tbCot [data-act=editarTituloCot]');
  await page.fill('#dlgCampo', 'COTAÇÃO 29 DE SETEMBRO GERAL');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => db.cotacoes[0].titulo), 'COTAÇÃO 29 DE SETEMBRO GERAL');
  assert.match(n(await page.locator('#tbCot tr').first().innerText()), /COTAÇÃO 29 DE SETEMBRO GERAL/);
  // pelo topo da cotação (Cancelar não muda)
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.click('main [data-act=editarTituloCot]');
  assert.equal(await page.inputValue('#dlgCampo'), 'COTAÇÃO 29 DE SETEMBRO GERAL');
  await page.click('.dlg button:text("Cancelar")');
  assert.equal(await page.evaluate(() => db.cotacoes[0].titulo), 'COTAÇÃO 29 DE SETEMBRO GERAL');
  await page.click('main [data-act=editarTituloCot]');
  await page.fill('#dlgCampo', 'URGENTE');
  await page.keyboard.press('Enter');
  assert.match(n(await page.locator('main .titulo-cot').innerText()), /URGENTE/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
