import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n, ns } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  fornecedores: [{ id: 'f1', nome: 'Auto Mix' }, { id: 'f2', nome: 'Via Peças' }, { id: 'f3', nome: 'Dist Sul' }],
  cotacoes: [cotacao('c1', '0017', '2026-09-08', 'finalizada', [item('A', 'AMORTECEDOR', 'SÓ COFAP'), item('B', 'BUCHA', 'QUALQUER')], [
    // respondeu em 24 h, no prazo, cotou tudo, marca certa (COF = COFAP)
    forn('f1', 'Auto Mix', { 0: { preco: 100, marca: 'COF' }, 1: { preco: 50, marca: 'X' } }, { enviadoEm: '2026-09-08T10:00:00Z', respondidoEm: '2026-09-09T10:00:00Z' }),
    // respondeu em 4 dias, fora do prazo, cotou 1 de 2, marca errada
    forn('f2', 'Via Peças', { 0: { preco: 90, marca: 'MONROE' } }, { enviadoEm: '2026-09-08T10:00:00Z', respondidoEm: '2026-09-12T10:00:00Z' }),
    // recebeu e não respondeu
    forn('f3', 'Dist Sul', null, { enviadoEm: '2026-09-08T10:00:00Z' }),
  ], {
    prazoResposta: '2026-09-10',
    // nota fiscal da Auto Mix: amortecedor faturado a R$ 110 (cotado a R$ 100) e a bucha não veio
    recebimentos: [{ id: 'r1', fornecedorId: 'f1', lojaId: null, importadoEm: '2026-09-15T10:00:00Z',
      nf: { numero: '1', emissao: '2026-09-14', emitente: { nome: 'AUTO MIX', cnpj: '' }, dest: {}, total: 110 },
      itens: [{ n: 1, cProd: 'A', xProd: 'AMORTECEDOR', un: 'PC', q: 1, vUn: 110, vProd: 110, vDesc: 0, idx: 0, como: 'codigo' }] }],
  })],
});

test('nota dos fornecedores: resposta, prazo, cobertura, marca e notas fiscais', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'relatorios');
  const linhas = await page.locator('#notaFornecedores tbody tr').allInnerTexts().then(ns);
  assert.equal(linhas.length, 3);
  // Auto Mix: 25%·1 + 15%·1 + 20%·1 + 20%·1 + 20%·0 (nota com divergência) = 8,0
  assert.match(linhas[0], /^Auto Mix\s+8,0\s+1\/1 \(100%\)\s+1\/1 \(100%\)\s+24 h\s+2\/2 \(100%\)\s+0 de 1\s+0\s+1 de 1\s+1 item\(ns\) não vieram\s+R\$ 10,00$/);
  // Via Peças: (25%·1 + 15%·0 + 20%·0,5 + 20%·0) ÷ 80% = 4,4 (sem notas fiscais: fica fora da conta)
  assert.match(linhas[1], /^Via Peças\s+4,4\s+1\/1 \(100%\)\s+0\/1 \(0%\)\s+4 dias\s+1\/2 \(50%\)\s+1 de 1\s+0\s+—\s+—$/);
  // Dist Sul: não respondeu
  assert.match(linhas[2], /^Dist Sul\s+0,0\s+0\/1 \(0%\)/);
  const detalhe = await page.locator('#notaFornecedores tbody tr').nth(1).locator('.nota-forn').getAttribute('title');
  assert.match(detalhe, /Responde no prazo \(15%\): 0%/);
  assert.match(detalhe, /Notas fiscais sem divergência \(20%\): sem dados/);

  await irPara(page, 'fornecedores');
  const notas = await page.locator('#tbForn tr').evaluateAll(rs => rs.map(r => r.cells[0].innerText.split('\n')[0] + ':' + (r.querySelector('.nota-forn')?.innerText || '—')));
  assert.deepEqual(notas, ['Auto Mix:8,0', 'Dist Sul:0,0', 'Via Peças:4,4']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
