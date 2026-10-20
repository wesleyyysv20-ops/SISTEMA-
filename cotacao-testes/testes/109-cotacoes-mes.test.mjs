import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

test('cotações: filtro por mês e arquivar as finalizadas dos meses anteriores (as abertas ficam)', async () => {
  const s = await abrir(base({
    cotacoes: [
      cotacao('c1', '0001', '2026-09-10', 'finalizada', [item('A', 'PECA A')], [forn('f1', 'KAIZEN')]),
      cotacao('c2', '0002', '2026-09-28', 'aberta', [item('A', 'PECA A')], [forn('f1', 'KAIZEN')]),
      cotacao('c3', '0003', '2026-10-05', 'finalizada', [item('A', 'PECA A')], [forn('f1', 'KAIZEN')]),
      cotacao('c4', '0004', '2026-10-15', 'aberta', [item('A', 'PECA A')], [forn('f1', 'KAIZEN')]),
    ],
  }));
  const { page } = s;
  await page.clock.setFixedTime(new Date('2026-10-20T10:00:00-03:00'));
  await page.click('nav [data-route=cotacoes]');
  const nums = () => page.locator('#tbCot tr td:first-child b').allInnerTexts();
  // filtro por mês
  assert.deepEqual(await page.locator('#mesCot option').allInnerTexts(), ['Todos os meses', 'outubro/2026 (2)', 'setembro/2026 (2)']);
  await page.selectOption('#mesCot', '2026-09');
  assert.deepEqual(await nums(), ['0002', '0001']);
  await page.selectOption('#mesCot', '');
  // sugestão: só a finalizada de setembro (a aberta de setembro continua na lista)
  assert.match(await page.locator('.sugestao-arquivar').innerText(), /1 cotação\(ões\) podem ser arquivadas[\s\S]*1 finalizada\(s\) de meses anteriores: nº 0001/);
  await page.click('[data-act=arquivarSugeridas]');
  await page.click('.dlg button.primary');
  assert.deepEqual(await nums(), ['0004', '0003', '0002']);
  // as arquivadas continuam acessíveis, com o filtro por mês
  await page.check('#verArquivadas');
  assert.deepEqual(await nums(), ['0001']);
  assert.deepEqual(await page.locator('#mesCot option').allInnerTexts(), ['Todos os meses', 'setembro/2026 (1)']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
