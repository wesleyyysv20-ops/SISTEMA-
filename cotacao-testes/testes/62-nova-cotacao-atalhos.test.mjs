import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const dados = rascunho => base({
  produtos: [{ id: 'p1', codigo: 'GP30562', descricao: 'AMORTECEDOR', marca: 'SÓ COFAP' }, { id: 'p2', codigo: 'BKR6E', descricao: 'VELA', marca: '' }, { id: 'p3', codigo: 'F10', descricao: 'FILTRO', marca: 'TECFIL' }],
  fornecedores: [{ id: 'f1', nome: 'KAIZEN', email: 'k@x.com' }, { id: 'f2', nome: 'VIA PEÇAS', email: '' }, { id: 'f3', nome: 'COMANDO', email: 'c@x.com' }],
  cotacoes: [cotacao('c1', '0006', '2026-09-29', 'aberta', [item('A', 'FILTRO', 'TECFIL', { codigo: 'F10', produtoId: 'p3' })], [forn('f1', 'KAIZEN'), forn('f2', 'VIA PEÇAS')],
    { criadoEm: '2026-09-29T10:00:00Z', obs: 'Entrega na loja. Informar prazo.', prazoHora: '10:30' })],
  ...(rascunho ? { rascunho } : {}),
});

test('nova cotação: título do dia, prazo no próximo dia útil e observações da última cotação', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=nova]');
  const r = await page.evaluate(() => ({ ...rascunho(), hoje: new Date().getDate(), dia: new Date(rascunho().prazoResposta + 'T12:00').getDay() }));
  assert.match(r.titulo, new RegExp(`^COTAÇÃO ${r.hoje} DE [A-ZÇ]+$`));
  assert.ok(r.dia >= 1 && r.dia <= 5, 'dia útil');
  assert.equal(r.prazoHora, '10:30');
  assert.equal(r.obs, 'Entrega na loja. Informar prazo.');
  assert.equal(await page.inputValue('[data-draft=titulo]'), r.titulo);
  assert.match(await page.locator('.nc-obs summary').innerText(), /Entrega na loja/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('nova cotação: "os de sempre", todos e nenhum; barra fixa com o resumo; conferência antes de criar', async () => {
  const s = await abrir(dados({ titulo: 'X', prazoResposta: '2020-01-01', prazoHora: '09:00', obs: '', fornecedorIds: [], itens: [{ produtoId: 'p1', marca: '' }, { produtoId: 'p2', marca: '' }, { produtoId: 'p3', marca: '' }] }));
  const { page } = s;
  await page.click('nav [data-route=nova]');
  await page.click('[data-act=fornDeSempre]');
  assert.deepEqual(await page.evaluate(() => rascunho().fornecedorIds.sort()), ['f1', 'f2']);
  await page.click('[data-act=fornTodos]');
  assert.equal(await page.evaluate(() => rascunho().fornecedorIds.length), 3);
  await page.click('[data-act=fornNenhum]');
  assert.equal(await page.evaluate(() => rascunho().fornecedorIds.length), 0);
  await page.click('[data-act=fornDeSempre]');
  const barra = n(await page.locator('#barraCriar').innerText());
  assert.match(barra, /3 itens\s*🏪 2 fornecedor\(es\)\s*⏰ 01\/01 09:00\s*⚠ 5 ponto\(s\) a conferir/);
  // mudar o prazo atualiza a barra na hora
  await page.fill('[data-draft=prazoResposta]', '2099-12-31');
  assert.match(n(await page.locator('#barraCriar').innerText()), /31\/12 09:00\s*⚠ 4 ponto/);
  // conferência: sem marca, item em cotação aberta e fornecedor sem e-mail
  await page.click('[data-act=criarCotacao]');
  const dlg = n(await page.locator('.dlg').innerText());
  assert.match(dlg, /1 item\(ns\) sem marca pedida: BKR6E/);
  assert.match(dlg, /1 item\(ns\) já estão numa cotação aberta: F10 \(nº 0006\)/);
  assert.match(dlg, /1 fornecedor\(es\) sem e-mail: VIA PEÇAS/);
  await page.click('.dlg button:text("Cancelar")');
  assert.equal(await page.evaluate(() => db.cotacoes.length), 1, 'não criou');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
