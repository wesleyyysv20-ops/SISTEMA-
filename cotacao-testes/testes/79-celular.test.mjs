import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, hoje } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
  fornecedores: [{ id: 'f1', nome: 'KAIZEN' }, { id: 'f2', nome: 'COMANDO' }],
  cotacoes: [cotacao('c1', '0001', hoje(), 'aberta', [item('A', 'AMORTECEDOR DIANT', 'QUALQUER', { codigo: 'GP1' }), item('B', 'VELA', 'NGK', { codigo: 'BKR6E' })], [
    forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'COFAP' }, 1: { preco: 20, marca: 'NGK' } }),
    forn('f2', 'COMANDO', { 0: { preco: 12, marca: 'COFAP' }, 1: { preco: 18, marca: 'NGK' } }),
  ])],
});

test('celular: menu de baixo, nenhuma tela mais larga que o celular e comparativo em cartões', async () => {
  const s = await abrir(dados(), { largura: 390, altura: 844 });
  const { page } = s;
  assert.equal(await page.locator('#nav').isVisible(), false, 'o menu de cima some');
  assert.equal(await page.locator('#navMovel').isVisible(), true, 'o menu de baixo aparece');
  for (const [r, id] of [['inicio'], ['nova'], ['cotacoes'], ['cotacao', 'c1'], ['produtos'], ['fornecedores'], ['duvidas'], ['relatorios'], ['config']]) {
    await irPara(page, r, id);
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert.ok(sw <= cw + 1, `tela ${r} mais larga que o celular (${sw} > ${cw})`);
  }
  // menu de baixo leva às telas
  await page.click('#navMovel [data-route=cotacoes]');
  assert.match(await page.locator('#app h2').first().innerText(), /Cotações/);
  assert.match(await page.locator('#navMovel [data-route=cotacoes]').getAttribute('class'), /active/);
  // "Mais" abre as outras telas
  await page.click('#navMovel [data-act=menuMais]');
  await page.click('.menu-mais [data-ir=fornecedores]');
  assert.match(await page.locator('#app h2').first().innerText(), /Fornecedores/);
  assert.equal(await page.locator('.menu-mais').count(), 0);
  // comparativo: cartão com o preço escolhido e as quantidades visíveis
  await irPara(page, 'cotacao', 'c1');
  const linha = page.locator('.tab-comp tbody tr[data-comp-linha="0"]');
  assert.equal(await linha.locator('td.col-escolhido').isVisible(), true);
  assert.equal(await linha.locator('input[data-qtd-loja=paranoa]').isVisible(), true);
  await linha.locator('input[data-qtd-loja=paranoa]').fill('3');
  assert.equal(await page.evaluate(() => db.cotacoes[0].qtds[0].paranoa), 3);
  // tabelas viram cartões com o nome da coluna
  await irPara(page, 'cotacoes');
  assert.ok(await page.locator('#app table tbody td[data-label="Data"]').count() >= 1);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
