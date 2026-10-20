import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

test('fornecedores da cotação e "Falta exportar" em ordem alfabética', async () => {
  const its = [item('P1', 'VELA', 'NGK', { codigo: 'V-1' })];
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0001', '2026-09-29', 'aberta', its, [
    forn('f3', 'ROLES', { 0: { preco: 9 } }), forn('f1', 'KAIZEN', { 0: { preco: 10 } }), forn('f2', 'COMANDO', { 0: { preco: 11 } }),
  ])] }));
  const { page } = s;
  await page.evaluate(() => { const c = db.cotacoes[0]; c.itens[0].qtd = 2; c.escolhas = { 0: 0 }; ir('cotacao', 'c1'); });
  const nomes = await page.locator('#secForn .corpo-recolhe tbody tr .forn-cot-nome').evaluateAll(l => l.map(e => e.innerText.split('\n')[0].trim()));
  assert.deepEqual(nomes, ['COMANDO', 'KAIZEN', 'ROLES']);
  // a linha certa continua ligada ao fornecedor certo
  assert.match(await page.locator('#secForn .corpo-recolhe tbody tr:has-text("ROLES")').innerText(), /9,00/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
