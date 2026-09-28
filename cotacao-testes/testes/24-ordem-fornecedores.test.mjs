import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, salvarDepois, lerXlsx, valor, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

test('comparativo: fornecedores em ordem alfabética, cada preço no fornecedor certo (tela e Excel)', async () => {
  // na cotação a ordem é Via Peças, Kaizen, Auto Mix
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0024', '2026-09-28', 'aberta', [item('P1', 'COXIM MOTOR', 'QUALQUER', { codigo: 'CX1' })], [
    forn('f1', 'Via Peças', { 0: { preco: 30 } }),
    forn('f2', 'KAIZEN', { 0: { preco: 10 } }),
    forn('f3', 'Auto Mix', { 0: { preco: 20 } }),
  ])] }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const cab = await page.locator('.tab-comp thead th').allInnerTexts();
  assert.deepEqual(cab.slice(2, 5), ['AUTO MIX', 'KAIZEN', 'VIA PEÇAS']);
  const precos = await page.locator('.tab-comp tbody tr').first().locator('td').allInnerTexts().then(l => l.slice(2, 5).map(t => n(t).split('\n')[0]));
  assert.deepEqual(precos, ['R$ 20,00', 'R$ 10,00', 'R$ 30,00']);
  const totais = await page.locator('#totalComp td').allInnerTexts().then(l => l.slice(2, 5).map(t => n(t).split('\n')[0]));
  assert.deepEqual(totais, ['R$ 20,00', 'R$ 10,00', 'R$ 30,00']);

  // clicar no preço da coluna "Via Peças" escolhe a Via Peças
  await page.locator('.tab-comp tbody tr').first().locator('td').nth(4).click();
  assert.equal(await page.evaluate(() => db.cotacoes[0].escolhas[0]), 'f1');

  const arq = await salvarDepois(s, () => page.click('[data-act=exportarComparativo]'));
  const ws = (await lerXlsx(arq.buffer)).getWorksheet('Comparativo');
  assert.deepEqual([6, 7, 8].map(col => valor(ws.getRow(3).getCell(col))), ['Auto Mix', 'KAIZEN', 'Via Peças']);
  assert.deepEqual([6, 7, 8].map(col => valor(ws.getRow(4).getCell(col))), [20, 10, 30]);
  assert.equal(ws.getRow(4).getCell(8).font?.bold, true, 'o vencedor (escolhido: Via Peças) fica destacado na coluna certa');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
