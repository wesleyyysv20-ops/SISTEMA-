import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

test('comparativo: colunas # e Produto ficam fixas ao rolar para o lado', async () => {
  const nomes = ['ALFA', 'BETA', 'COBRA ROLAMENTOS', 'DELTA', 'ELETROPAR', 'FREMAX', 'GAMA', 'KAIZEN', 'PELLEGRINO', 'SKY GROUP', 'VIA PEÇAS', 'ZETA'];
  const fs = nomes.map((nome, k) => forn('f' + k, nome, { 0: { preco: 10 + k, marca: 'NGK' }, 1: { preco: 20 + k } }));
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0027', '2026-09-28', 'aberta', [item('P1', 'ADITIVO COMBUSTIVEL (GASOLINA)', 'QUALQUER', { codigo: '1622-ADITIVO' }), item('P2', 'VELA', 'NGK')], fs)] }), { largura: 1000, altura: 800 });
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const wrap = page.locator('.tab-comp').locator('xpath=..');
  const pos = () => page.evaluate(() => {
    const r = sel => document.querySelector(sel).getBoundingClientRect().left;
    return { num: r('.tab-comp tbody tr td:nth-child(1)'), prod: r('.tab-comp tbody tr td:nth-child(2)'), cab: r('.tab-comp thead th:nth-child(2)'), forn: r('.tab-comp tbody tr td:nth-child(3)') };
  });
  const antes = await pos();
  const rolou = await wrap.evaluate(el => { el.scrollLeft = 600; return el.scrollLeft; });
  assert.ok(rolou > 300, 'a tabela é mais larga que a tela');
  const depois = await pos();
  assert.equal(Math.round(depois.num), Math.round(antes.num), '# não saiu do lugar');
  assert.equal(Math.round(depois.prod), Math.round(antes.prod), 'Produto não saiu do lugar');
  assert.equal(Math.round(depois.cab), Math.round(antes.cab), 'cabeçalho Produto não saiu do lugar');
  assert.ok(depois.forn < antes.forn - 300, 'as colunas dos fornecedores rolaram');
  // o que passa por baixo não aparece através da coluna fixa (fundo opaco)
  const fundo = await page.evaluate(() => getComputedStyle(document.querySelector('.tab-comp tbody tr td:nth-child(2)')).backgroundColor);
  assert.notEqual(fundo, 'rgba(0, 0, 0, 0)');
  if (process.env.FOTO) await wrap.screenshot({ path: process.env.FOTO });
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
