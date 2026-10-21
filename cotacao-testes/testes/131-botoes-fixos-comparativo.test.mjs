import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

const LOJAS = [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }];
const itens = Array.from({ length: 60 }, (_, i) => item('P' + i, 'PECA ' + i, 'NGK', { codigo: 'COD-' + i }));
const precos = k => Object.fromEntries(itens.map((_, i) => [i, { preco: 10 + i + k, marca: 'NGK' }]));
const dados = () => base({ config: { loja: 'DISPPAR', lojas: LOJAS }, cotacoes: [cotacao('c1', '0131', '2026-09-29', 'aberta', itens, [
  forn('f1', 'KAIZEN', precos(0)), forn('f2', 'VIA PEÇAS', precos(2)),
])] });

for (const largura of [1366, 830]) {
  test(`comparativo: botões Janela flutuante e Compacto ficam sempre à vista (${largura} px)`, async () => {
    const s = await abrir(dados(), { largura, altura: 800 });
    const { page } = s;
    await page.evaluate(() => { try { localStorage.setItem('cotacao.compacto', '0'); } catch (e) { /* */ } });
    assert.equal(await page.locator('#barraFixaComp').isVisible(), false, 'fora do comparativo a barra fica escondida');
    await page.click('nav [data-route=cotacoes]');
    assert.equal(await page.locator('#barraFixaComp').isVisible(), false, 'na lista de cotações também');
    await page.click('[data-route=cotacao][data-id=c1]');
    await page.waitForSelector('.tab-comp tbody tr');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#barraFixaComp').isVisible(), true, 'no comparativo, sem rolar: a barra fixa já aparece');
    assert.equal(await page.locator('[data-act="abrirPip"]').count(), 1, 'os seletores por data-act acham só o botão original');
    assert.equal(await page.locator('[data-act="alternarCompacto"]').count(), 1);
    const cantos = await page.evaluate(() => { const r = document.getElementById('barraFixaComp').getBoundingClientRect(); return { dir: innerWidth - r.right, baixo: innerHeight - r.bottom }; });
    assert.ok(cantos.dir <= 20, 'sem o "↑" no topo a barra ocupa o canto: ' + cantos.dir);
    await page.evaluate(() => window.scrollBy(0, 700));
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#barraFixaComp').isVisible(), true, 'rolou: a barra fixa continua');
    const baixoPagina = await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); return parseFloat(getComputedStyle(document.body).paddingBottom); });
    assert.ok(baixoPagina >= 60, 'folga no fim da página para a barra não tapar o conteúdo');
    await page.click('#fixoCompacto');
    await page.waitForTimeout(700);
    assert.match(await page.locator('.tab-comp').getAttribute('class'), /compacto/);
    await page.evaluate(() => window.scrollBy(0, 700));
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#fixoCompacto').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#fixoCompacto').getAttribute('class'), /ativo/);
    await page.click('#fixoCompacto');
    await page.waitForTimeout(700);
    assert.doesNotMatch(await page.locator('.tab-comp').getAttribute('class'), /compacto/);
    const vis = await page.evaluate(() => { const r = document.querySelector('.painel-comp').getBoundingClientRect(); return Math.min(r.bottom, innerHeight) - Math.max(r.top, 0); });
    assert.ok(vis > 300, 'ao sair do compacto pelo botão fixo, a tabela continua à vista');
    await page.click('nav [data-route=cotacoes]');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#barraFixaComp').isVisible(), false, 'saiu do comparativo: a barra some');
    assert.deepEqual(s.erros, []);
    await s.fechar();
  });
}
