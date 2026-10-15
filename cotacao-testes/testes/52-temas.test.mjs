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
  assert.equal(await page.locator('.temas .tema-opcao').count(), 10, 'automático + 9 temas');
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
  for (const t of ['claro', 'suave', 'neutro', 'verde', 'contraste', 'escuro', 'grafite', 'noite', 'oceano']) {
    await page.evaluate(x => aplicarTema(x), t);
    for (const r of ['inicio', 'nova', 'cotacoes', 'produtos', 'fornecedores', 'duvidas', 'relatorios', 'config']) await page.evaluate(x => ir(x), r);
    await page.evaluate(() => ir('cotacao', 'c1'));
    assert.doesNotMatch(await page.locator('#app').innerText(), /Não foi possível abrir esta tela/, t);
  }
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('temas: todos legíveis (contraste mínimo de 4,5:1 no texto, no texto de apoio e nos botões)', async () => {
  const s = await abrir(base({}));
  const { page } = s;
  const ruins = await page.evaluate(() => {
    const rgb = c => { const d = document.createElement('i'); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color.match(/[\d.]+/g).map(Number); d.remove(); return v; };
    const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const razao = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const out = [];
    for (const [t] of TEMAS.filter(([k]) => k !== 'auto')) {
      aplicarTema(t);
      const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      for (const [a, b] of [['--text', '--card'], ['--text', '--bg'], ['--muted', '--card'], ['--muted', '--bg'], ['--on-primary', '--primary'], ['--ok', '--ok-bg'], ['--warn', '--warn-bg'], ['--danger', '--danger-bg'], ['--bar-text', '--bar']]) {
        const r = razao(v(a), v(b));
        if (r < 4.5) out.push(`${t}: ${a} sobre ${b} = ${r.toFixed(2)}`);
      }
    }
    return out;
  });
  assert.deepEqual(ruins, []);
  await s.fechar();
});

test('tamanho da letra: muda todas as telas, fica guardado e vai para a janela de temas', async () => {
  const s = await abrir(base({}));
  const { page } = s;
  const corpo = () => page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  await page.click('nav [data-route=config]');
  assert.equal(await page.locator('.fontes .fonte-opcao').count(), 5);
  assert.equal(await corpo(), 15, 'normal');
  await page.click('.fonte-opcao[data-fonte=gg]');
  assert.equal(await corpo(), 18, 'maior: 15px × 1,2');
  assert.match(await page.locator('.fonte-opcao[data-fonte=gg]').getAttribute('class'), /ativo/);
  await page.reload();
  assert.equal(await corpo(), 18, 'continua depois de recarregar');
  await page.click('[data-act=abrirTemas]');
  assert.match(await page.locator('.dlg-temas .fonte-opcao[data-fonte=gg]').getAttribute('class'), /ativo/);
  await page.click('.dlg-temas .fonte-opcao[data-fonte=p]');
  assert.equal(await corpo(), 13.5, 'pequena: 15px × 0,9');
  await page.click('.dlg-temas .fonte-opcao[data-fonte=n]');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.fonte), undefined, 'normal tira a escolha');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
