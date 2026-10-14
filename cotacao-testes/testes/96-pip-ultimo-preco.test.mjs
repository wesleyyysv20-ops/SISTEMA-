import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const itens = [item('PA', 'ADITIVO', 'QUALQUER', { codigo: '1622-ADITIVO' }), item('PB', 'VELA', 'NGK', { codigo: 'BKR6E' })];
const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }] },
  cotacoes: [
    cotacao('c0', '0001', '2026-09-01', 'finalizada', itens, [forn('f1', 'PELLEGRINO', { 0: { preco: 15.12 }, 1: { preco: 22 } })], { qtds: { 0: { paranoa: 1 }, 1: { paranoa: 1 } } }),
    cotacao('c1', '0002', '2026-10-13', 'aberta', itens, [forn('f2', 'KAIZEN', { 0: { preco: 21.74 }, 1: { preco: 20 } })]),
  ],
});

test('janela flutuante: último preço pago e a variação (▲ subiu / ▼ caiu)', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.evaluate(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined });
    window.open = () => { const f = document.createElement('iframe'); f.id = 'janelaTeste'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:470px;z-index:99999;background:#fff'; document.body.appendChild(f); return f.contentWindow; };
  });
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.locator('.tab-comp tbody tr[data-comp-linha="0"] td').nth(1).click();
  await page.click('[data-act=abrirPip]');
  const j = page.frameLocator('#janelaTeste');
  await j.locator('#pip .pip-cod').waitFor();
  assert.match(n(await j.locator('.pip-ultimo').innerText()), /último R\$ 15,12 ▲ 43,8% · PELLEGRINO/);
  assert.equal(await j.locator('.pip-ultimo .var-ult').getAttribute('class'), 'var-ult subiu');
  // próximo item: ficou mais barato
  await page.keyboard.press('Enter');
  await j.locator('.pip-cod-txt', { hasText: 'BKR6E' }).waitFor();
  assert.match(n(await j.locator('.pip-ultimo').innerText()), /último R\$ 22,00 ▼ 9,1%/);
  assert.equal(await j.locator('.pip-ultimo .var-ult').getAttribute('class'), 'var-ult caiu');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
