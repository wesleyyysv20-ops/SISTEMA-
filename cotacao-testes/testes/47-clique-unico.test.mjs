import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const prods = ['A', 'B', 'C'].map((x, k) => ({ id: 'p' + k, codigo: 'COD-' + x, descricao: 'PECA ' + x, marca: 'QUALQUER' }));

test('nova cotação: editando a marca, um clique no ✕ da mesma linha já pergunta (não precisa clicar duas vezes)', async () => {
  const s = await abrir(base({ produtos: prods, rascunho: { itens: prods.map(p => ({ produtoId: p.id, quantidade: 1 })), fornecedorIds: [] } }));
  const { page } = s;
  await page.click('nav [data-route=nova]');
  await page.fill('[data-marca-item="0"]', 'SÓ NGK'); // o cursor fica no campo; ao clicar fora, salva e redesenha a linha
  await page.click('[data-item-linha="0"] [data-act=removerItem]');
  await page.waitForSelector('.dlg', { timeout: 3000 });
  assert.match(n(await page.locator('.dlg').innerText()), /Tirar este item da cotação\?\s*COD-A/);
  assert.equal(await page.evaluate(() => rascunho().itens[0].marca || db.produtos[0].marca), 'SÓ NGK', 'a marca digitada foi salva');
  await page.click('.dlg button.primary');
  assert.deepEqual(await page.evaluate(() => rascunho().itens.map(x => x.produtoId)), ['p1', 'p2']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('cotação sem respostas: explica onde aparecem o comparativo, as quantidades e a janela flutuante', async () => {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0047', '2026-09-29', 'aberta', [item('P1', 'PECA', 'NGK', { codigo: 'A1' })], [forn('f1', 'KAIZEN')])] }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  assert.match(n(await page.locator('main').innerText()), /Aguardando as respostas dos fornecedores[\s\S]*Janela flutuante/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
