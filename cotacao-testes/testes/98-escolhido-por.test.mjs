import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const itens = ['A', 'B', 'C'].map(x => item('P' + x, 'PECA ' + x, 'QUALQUER', { codigo: 'COD-' + x }));
const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }] },
  cotacoes: [cotacao('c1', '0001', '2026-10-14', 'aberta', itens, [
    forn('f1', 'KAIZEN', { 0: { preco: 10 }, 1: { preco: 20 }, 2: { preco: 30 } }),
    forn('f2', 'VIA PEÇAS', { 0: { preco: 11 }, 1: { preco: 21 }, 2: { preco: 31 } }),
  ], {
    escolhas: { 0: 'f2', 1: 'f2' },
    // item 1: o Sandro escolheu (em outro computador); item 2: escolha antiga, de antes de guardar quem escolheu
    escolhidoPor: { 0: { f: 'f2', por: 'sandro@disppar.com.br', em: '2026-10-14T13:05:00Z' } },
  })],
});

test('janela flutuante e comparativo mostram quem escolheu o fornecedor do item', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.evaluate(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined });
    window.open = () => { const f = document.createElement('iframe'); f.id = 'janelaTeste'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:470px;z-index:99999;background:#fff'; document.body.appendChild(f); return f.contentWindow; };
  });
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  // comparativo: o nome do colega junto do "escolhido"
  assert.match(n(await page.locator('tr[data-comp-linha="0"] .tag-escolha').innerText()), /escolhido · Sandro/);
  assert.match(await page.locator('tr[data-comp-linha="0"] .tag-escolha').getAttribute('title'), /Escolhido por Sandro em 14\/10/);
  // janela flutuante no item 1
  await page.locator('.tab-comp tbody tr[data-comp-linha="0"] td').nth(1).click();
  await page.click('[data-act=abrirPip]');
  const j = page.frameLocator('#janelaTeste');
  await j.locator('#pip .pip-cod').waitFor();
  assert.match(n(await j.locator('.pip-tags').innerText()), /escolhido por Sandro/);
  assert.equal(await j.locator('.pip-tag.outro').count(), 1, 'escolha de colega em destaque');
  // item 2: escolha antiga (sem registro de quem fez)
  await page.keyboard.press('Enter');
  await j.locator('.pip-cod-txt', { hasText: 'COD-B' }).waitFor();
  assert.match(n(await j.locator('.pip-tags').innerText()), /escolhido manualmente/);
  // item 3: eu escolho a VIA PEÇAS aqui
  await page.evaluate(() => { escolherVencedorItem(db.cotacoes[0], 2, 1); });
  await page.click('.dlg button.primary');
  await page.evaluate(() => { pip.i = 2; desenharPip(true); });
  await j.locator('.pip-cod-txt', { hasText: 'COD-C' }).waitFor();
  await page.waitForFunction(() => /escolhido por você/.test(document.getElementById('janelaTeste').contentDocument.body.innerText));
  assert.equal(await page.evaluate(() => db.cotacoes[0].escolhidoPor[2].f), 'f2');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
