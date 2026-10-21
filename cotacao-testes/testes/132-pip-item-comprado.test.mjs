import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

const cods = ['A', 'B', 'C', 'D'];

test('janela flutuante: item já comprado não aparece, passa para o próximo e volta ao desmarcar', async () => {
  const s = await abrir(base({
    config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
    cotacoes: [cotacao('c1', '0132', '2026-09-30', 'aberta', cods.map(x => item('P' + x, 'PECA ' + x, 'NGK', { codigo: 'COD-' + x })), [
      forn('f1', 'KAIZEN', Object.fromEntries(cods.map((_, i) => [i, { preco: 10, marca: 'NGK' }]))),
      forn('f2', 'VIA PEÇAS', Object.fromEntries(cods.map((_, i) => [i, { preco: 11, marca: 'NGK' }]))),
    ], { comprados: { 1: { em: '2026-10-21T10:00:00Z', por: 'x' } } })],
  }));
  const { page } = s;
  await page.evaluate(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { requestWindow: async () => {
      const f = document.createElement('iframe'); f.id = 'janelaTeste'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:600px;z-index:99999;background:#fff'; document.body.appendChild(f);
      const w = f.contentWindow; w.document.open(); w.document.write('<!doctype html><html><head></head><body></body></html>'); w.document.close(); return w;
    } } });
  });
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.click('[data-act=abrirPip]');
  const j = page.frameLocator('#janelaTeste');
  await j.locator('#pip .pip-cod').waitFor();
  const cod = async () => (await j.locator('.pip-cod-txt').innerText()).trim();
  const pos = async () => (await j.locator('.pip-pos').innerText()).replace(/\s+/g, ' ');
  // B (já comprado) fica fora: 3 itens na lista
  assert.equal(await cod(), 'COD-A');
  assert.match(await pos(), /1 de 3/);
  assert.deepEqual(await j.locator('.pip-prox').allInnerTexts(), ['COD-C', 'COD-D']);
  await j.locator('[data-pip=prox]').click();
  assert.equal(await cod(), 'COD-C');
  assert.match(await pos(), /2 de 3/);
  // marcar o item aberto como comprado: a janela vai para o próximo não comprado
  await j.locator('[data-pip=comprado]').click();
  await j.locator('.pip-cod-txt', { hasText: 'COD-D' }).waitFor();
  assert.match(await pos(), /2 de 2/);
  // D é o último: marcar leva ao anterior não comprado (A)
  await j.locator('[data-pip=comprado]').click();
  await j.locator('.pip-cod-txt', { hasText: 'COD-A' }).waitFor();
  assert.match(await pos(), /1 de 1/);
  // todos comprados: mensagem simples
  await j.locator('[data-pip=comprado]').click();
  await j.locator('#pipTodosComprados').waitFor();
  assert.match(await j.locator('#pipTodosComprados').innerText(), /Todos os itens já foram comprados/);
  assert.match(await j.locator('#pipForn option').first().innerText(), /Todos os itens \(0\)/, 'a contagem do seletor ignora os comprados');
  await page.screenshot({ path: 'C:/Users/BALCAO/AppData/Local/Temp/claude/C--Users-BALCAO-Desktop-SISTEMA-COTA--O-WEB/0842de55-740c-47ad-bb81-1d7bee283500/scratchpad/fotos/pip-comprado-pagina.png' });
  await j.locator('body').screenshot({ path: 'C:/Users/BALCAO/AppData/Local/Temp/claude/C--Users-BALCAO-Desktop-SISTEMA-COTA--O-WEB/0842de55-740c-47ad-bb81-1d7bee283500/scratchpad/fotos/pip-comprado.png' });
  // desmarcar B no comparativo: volta a aparecer
  await page.evaluate(() => document.querySelector('[data-act=marcarComprado][data-i="1"]').click());
  await j.locator('.pip-cod-txt', { hasText: 'COD-B' }).waitFor();
  assert.match(await pos(), /1 de 1/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
