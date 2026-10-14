import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }] },
  cotacoes: [cotacao('c1', '0001', '2026-10-14', 'aberta', [item('A', 'VELA', 'QUALQUER', { codigo: 'V1' }), item('B', 'FILTRO', 'QUALQUER', { codigo: 'F1' })], [
    forn('f1', 'KAIZEN', { 0: { preco: 10 }, 1: { preco: 20 } }),
    forn('f2', 'VIA PEÇAS', { 0: { preco: 12 }, 1: { preco: 25 } }),
  ])],
});

/** Clica no elemento com a tela sendo redesenhada no meio do clique (campo que gravou ao perder o foco, colega que salvou…). */
async function cliqueComRedesenho(page, sel, completo = true) {
  await page.locator(sel).first().scrollIntoViewIfNeeded();
  const b = await page.locator(sel).first().boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  // completo: troca todos os elementos (como uma tela redesenhada do zero); senão, o redesenho normal da mesma tela
  await page.evaluate(c => { if (c) telaDesenhada = null; render(); }, completo);
  await page.mouse.up();
  // o redesenho que esperou o clique roda logo depois de soltar
  await page.waitForFunction(() => !renderAdiado);
  await page.waitForTimeout(50);
}

test('um clique basta mesmo quando a tela é redesenhada no meio dele (preço, cartão, link, botão)', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  // clicar no preço da VIA PEÇAS (uma célula da tabela, não um botão)
  await cliqueComRedesenho(page, 'tr[data-comp-linha="0"] td[data-act=escolherVencedor][data-f="1"]');
  await page.waitForTimeout(200);
  if (await page.locator('.dlg').count()) await page.click('.dlg button.primary');
  assert.deepEqual(await page.evaluate(() => db.cotacoes[0].escolhas), { 0: 'f2' });
  // menu de status (summary) e botão comum
  await cliqueComRedesenho(page, '.status-cot > summary', false); // o menu aberto continua aberto depois do redesenho
  assert.equal(await page.evaluate(() => document.querySelector('.status-cot').open), true);
  await page.keyboard.press('Escape');
  await cliqueComRedesenho(page, '[data-act=analiseCot]');
  await page.waitForFunction(() => rota().nome === 'relatorios', null, { timeout: 3000 });
  // link de navegação
  await cliqueComRedesenho(page, 'nav [data-route=produtos]');
  await page.waitForFunction(() => rota().nome === 'produtos');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
