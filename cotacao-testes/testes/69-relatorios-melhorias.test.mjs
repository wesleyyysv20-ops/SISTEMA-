import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, salvarDepois, lerXlsx, n } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  fornecedores: [{ id: 'f1', nome: 'KAIZEN' }, { id: 'f2', nome: 'VIA PEÇAS' }],
  cotacoes: [cotacao('c1', '0001', '2026-09-20', 'finalizada', [item('A', 'VELA', 'NGK'), item('B', 'FILTRO', 'TECFIL'), item('C', 'BOMBA', 'URBA')], [
    forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 30, marca: 'TECFIL' }, 2: { preco: 50, marca: 'URBA' } }),
    forn('f2', 'VIA PEÇAS', { 0: { preco: 12, marca: 'NGK' }, 1: { preco: 20, marca: 'TECFIL' }, 2: { preco: 40, marca: 'URBA' } }),
  ], { titulo: 'GERAL' })],
});

test('relatórios: destaques, ordenar colunas, análise pelo nome e Excel', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'relatorios');
  assert.match(n(await page.locator('.destaques-rel').innerText()), /Quem mais ganhou: VIA PEÇAS — 2 itens[\s\S]*Maior economia: cotação nº 0001 \(GERAL\)/);
  const nomes = () => page.locator('#relForn tbody tr td:first-child').allInnerTexts();
  assert.deepEqual(await nomes(), ['VIA PEÇAS', 'KAIZEN']);
  await page.click('#relForn [data-act=ordemRelForn][data-campo=nome]');
  assert.deepEqual(await nomes(), ['KAIZEN', 'VIA PEÇAS'], 'A→Z');
  await page.click('#relForn [data-act=ordemRelForn][data-campo=nome]');
  assert.deepEqual(await nomes(), ['VIA PEÇAS', 'KAIZEN'], 'Z→A');
  // nome abre a análise detalhada
  await page.click('#relForn [data-act=analiseForn][data-id=f1]');
  await page.locator('.dlg-analise-forn').waitFor();
  await page.click('.dlg-analise-forn .actions button');
  // Excel
  const arq = await salvarDepois(s, () => page.click('[data-act=exportarRelatorio]'));
  const wb = await lerXlsx(arq.buffer);
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Resumo', 'Fornecedores', 'Por cotação', 'Nota dos fornecedores']);
  const forns = wb.getWorksheet('Fornecedores');
  assert.equal(forns.getCell('A2').value, 'VIA PEÇAS');
  assert.equal(forns.getCell('G2').numFmt, '#,##0.00');
  assert.equal(forns.getCell('F2').numFmt, '0.0%');
  assert.equal(wb.getWorksheet('Por cotação').getCell('B2').value, 'GERAL');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
