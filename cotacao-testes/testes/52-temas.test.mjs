import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

test('temas: escolher em Configurações ou pelo 🎨, fica guardado e todas as telas abrem em cada tema', async () => {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0001', '2026-09-29', 'aberta', [item('P1', 'PECA', 'NGK', { codigo: 'A1' })], [forn('f1', 'KAIZEN', { 0: { preco: 10 } })])] }));
  const { page } = s;
  const tema = () => page.evaluate(() => document.documentElement.dataset.theme || 'auto');
  const fundo = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.click('nav [data-route=config]');
  assert.equal(await page.locator('.temas .tema-opcao').count(), 5, 'automático + 4 temas');
  const claro = await fundo();
  await page.click('.tema-opcao[data-tema=grafite]');
  assert.equal(await tema(), 'grafite');
  assert.notEqual(await fundo(), claro, 'o fundo mudou');
  assert.match(await page.locator('.tema-opcao[data-tema=grafite]').getAttribute('class'), /ativo/);
  // continua depois de recarregar
  await page.reload();
  assert.equal(await tema(), 'grafite');
  // pelo botão do topo
  await page.click('[data-act=abrirTemas]');
  await page.click('.dlg-temas .tema-opcao[data-tema=suave]');
  assert.equal(await tema(), 'suave');
  await page.keyboard.press('Escape');
  // automático: tira a escolha (segue o Windows)
  await page.click('nav [data-route=config]');
  await page.click('.tema-opcao[data-tema=auto]');
  assert.equal(await tema(), 'auto');
  // todas as telas em cada tema, sem erros
  for (const t of ['claro', 'suave', 'escuro', 'grafite']) {
    await page.evaluate(x => aplicarTema(x), t);
    for (const r of ['inicio', 'nova', 'cotacoes', 'produtos', 'fornecedores', 'duvidas', 'relatorios', 'config']) await page.evaluate(x => ir(x), r);
    await page.evaluate(() => ir('cotacao', 'c1'));
    assert.doesNotMatch(await page.locator('#app').innerText(), /Não foi possível abrir esta tela/, t);
  }
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
