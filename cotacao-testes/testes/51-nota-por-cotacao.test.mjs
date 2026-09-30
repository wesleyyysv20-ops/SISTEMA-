import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const itens = ['A', 'B'].map(x => item('P' + x, 'PECA ' + x, 'NGK', { codigo: 'COD-' + x }));

test('nota dos fornecedores: análise geral e por cotação (também pelo botão na cotação)', async () => {
  const s = await abrir(base({ cotacoes: [
    cotacao('c1', '0001', '2026-09-28', 'finalizada', itens, [forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 5, marca: 'NGK' } }), forn('f2', 'COMANDO', { 0: { preco: 9, marca: 'BOSCH' } })]),
    cotacao('c2', '0002', '2026-09-29', 'aberta', itens, [forn('f1', 'KAIZEN', { 0: { preco: 11, marca: 'NGK' } }), forn('f2', 'COMANDO')], { titulo: 'URGENTE' }),
  ] }));
  const { page } = s;
  await page.click('nav [data-route=relatorios]');
  const linha = nome => page.locator('#notaFornecedores tbody tr', { hasText: nome }).innerText().then(n);
  // geral: as duas cotações
  assert.match(await linha('KAIZEN'), /2\/2[\s\S]*3\/4/);
  assert.match(await linha('COMANDO'), /1\/2/);
  // só a cotação 0002
  await page.selectOption('#notaCot', 'c2');
  assert.match(n(await page.locator('#notaFornecedores h3').innerText()), /Nota dos fornecedores — cotação nº 0002/);
  assert.match(await linha('KAIZEN'), /1\/1[\s\S]*1\/2/);
  // COMANDO ainda não respondeu uma cotação aberta: não entra na conta (está no prazo)
  assert.equal(await page.locator('#notaFornecedores tbody tr', { hasText: 'COMANDO' }).count(), 0);
  // volta para a geral
  await page.selectOption('#notaCot', '');
  assert.match(await linha('KAIZEN'), /2\/2/);
  // pelo botão dentro da cotação 0001
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.click('[data-act=analiseCot]');
  assert.equal(await page.evaluate(() => rota().nome), 'relatorios');
  assert.equal(await page.inputValue('#notaCot'), 'c1');
  assert.match(await linha('COMANDO'), /1\/1[\s\S]*1\/2[\s\S]*1\s*de 1/, 'marca errada na cotação 0001');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
