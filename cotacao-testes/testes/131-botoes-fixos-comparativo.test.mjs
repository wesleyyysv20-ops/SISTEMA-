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
  test(`comparativo: botões Janela flutuante e Compacto ficam fixos ao rolar (${largura} px)`, async () => {
    const s = await abrir(dados(), { largura, altura: 800 });
    const { page } = s;
    await page.evaluate(() => { try { localStorage.setItem('cotacao.compacto', '0'); } catch (e) { /* */ } });
    await page.click('nav [data-route=cotacoes]');
    await page.click('[data-route=cotacao][data-id=c1]');
    await page.waitForSelector('.tab-comp tbody tr');
    await page.evaluate(() => document.getElementById('secComp').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#barraFixaComp').isVisible(), false, 'com a barra original à vista, a fixa fica escondida');
    await page.evaluate(() => window.scrollBy(0, 700));
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#barraFixaComp').isVisible(), true, 'rolou: a barra fixa aparece');
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
    assert.deepEqual(s.erros, []);
    await s.fechar();
  });
}
