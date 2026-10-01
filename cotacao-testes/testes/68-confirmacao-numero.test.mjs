import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, salvarDepois } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  fornecedores: [{ id: 'f1', nome: 'COMANDO', contato: 'ROBERTO', substituto: 'GERALDO', email: 'r@x.com' }, { id: 'f2', nome: 'KAIZEN', contato: 'PEDRO' }, { id: 'f3', nome: 'SAMA', contato: 'BRENO' }],
  cotacoes: [cotacao('c1', '0006', '2026-10-01', 'aberta', [item('A', 'VELA', 'NGK')], [forn('f1', 'COMANDO'), forn('f2', 'KAIZEN'), forn('f3', 'SAMA')], { prazoResposta: '2099-12-31', criadoEm: '2026-10-01T10:00:00Z' })],
});

test('confirmação de recebimento: caixinha na cotação, atendente/substituto e quem confirmou no Início', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.evaluate(() => { localStorage.setItem('cotacao.fornAberto', '1'); render(); });
  assert.match(await page.locator('.corpo-recolhe tbody tr').first().innerText(), /COMANDO\s*ROBERTO · subst\. GERALDO · r@x\.com/);
  await page.check('[data-confirmar-forn="0"]');
  await page.check('[data-confirmar-forn="2"]');
  assert.ok(await page.evaluate(() => db.cotacoes[0].fornecedores[0].confirmadoEm));
  assert.match(await page.locator('.resumo-recolhe').innerText(), /2 de 3 confirmaram o recebimento/);
  await page.uncheck('[data-confirmar-forn="2"]');
  assert.equal(await page.evaluate(() => db.cotacoes[0].fornecedores[2].confirmadoEm), null);
  // no Início
  await page.click('nav [data-route=inicio]');
  const cartao = await page.locator('.cartao-cot').innerText();
  assert.match(cartao, /Confirmaram o recebimento\s*1\/3\s*✓ COMANDO · falta: KAIZEN, SAMA/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('número da cotação não repete; a repetida (mais nova) pode trocar de número', async () => {
  const s = await abrir(base({
    produtos: [{ id: 'p1', codigo: 'A', descricao: 'X', marca: 'NGK' }],
    config: { loja: 'Loja Teste', proxNumero: 6 }, // contador atrasado
    cotacoes: [
      cotacao('c1', '0006', '2026-09-29', 'finalizada', [item('A', 'X', 'NGK')], [], { criadoEm: '2026-09-29T10:00:00Z' }),
      cotacao('c2', '0006', '2026-10-01', 'aberta', [item('A', 'X', 'NGK')], [], { criadoEm: '2026-10-01T10:00:00Z' }),
    ],
    rascunho: { titulo: 'N', prazoResposta: '2099-12-31', prazoHora: '09:00', obs: '', fornecedorIds: [], papelzinhos: { arquivo: 'x', adicionados: 0, jaEstavam: 0 }, itens: [{ produtoId: 'p1' }] },
  }));
  const { page } = s;
  // a mais antiga não mostra o aviso; a mais nova mostra
  await page.evaluate(() => ir('cotacao', 'c1'));
  assert.equal(await page.locator('.aviso-num-repetido').count(), 0);
  await page.evaluate(() => ir('cotacao', 'c2'));
  await page.click('[data-act=renumerarCot]');
  await page.click('.dlg button.primary');
  assert.equal(await page.evaluate(() => db.cotacoes.find(c => c.id === 'c2').numero), '0007');
  assert.equal(await page.locator('.aviso-num-repetido').count(), 0);
  // a próxima cotação criada pula para o 0008, mesmo com o contador atrasado
  await page.evaluate(() => { db.config.proxNumero = 3; });
  await page.click('nav [data-route=nova]');
  await salvarDepois(s, async () => {
    await page.click('[data-act=criarCotacao]');
    if (await page.locator('.dlg button.primary').count()) await page.click('.dlg button.primary');
  });
  assert.deepEqual(await page.evaluate(() => db.cotacoes.map(c => c.numero).sort()), ['0006', '0007', '0008']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
