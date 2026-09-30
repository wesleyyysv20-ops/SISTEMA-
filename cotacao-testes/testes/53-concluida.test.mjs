import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, salvarDepois, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const LOJAS = [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }];
const itens = ['A', 'B'].map(x => item('P' + x, 'PECA ' + x, 'NGK', { codigo: 'COD-' + x }));
async function abrirCot() {
  const s = await abrir(base({ config: { loja: 'DISPPAR', lojas: LOJAS }, cotacoes: [cotacao('c1', '0053', '2026-09-29', 'aberta', itens, [
    forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 20, marca: 'NGK' } }),
    forn('f2', 'VIA PEÇAS', { 0: { preco: 12, marca: 'NGK' } }),
  ], { qtds: { 0: { paranoa: 2 }, 1: { 'sao-sebastiao': 3 } } })] }));
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return s;
}
const concluida = page => page.evaluate(() => !!db.cotacoes[0].fornecedores[0].concluidoEm);

test('pedido baixado pela seção Pedidos: concluída quando todas as lojas saem; "lojas juntas" conclui na hora', async () => {
  const s = await abrirCot();
  const { page } = s;
  const linhaKaizen = page.locator('#secPedidos tbody tr', { hasText: 'KAIZEN' });
  await salvarDepois(s, () => linhaKaizen.locator('[data-act=baixarPedido][data-loja=paranoa]').click());
  assert.equal(await concluida(page), false, 'só Paranoá: ainda falta São Sebastião');
  await salvarDepois(s, () => page.locator('#secPedidos tbody tr', { hasText: 'KAIZEN' }).locator('[data-act=baixarPedido][data-loja="sao-sebastiao"]').click());
  assert.equal(await concluida(page), true, 'as duas lojas: concluída');
  assert.match(n(await page.locator('.corpo-recolhe tbody tr').first().innerText()), /Concluída/);
  // reabrir e baixar "lojas juntas": conclui na hora
  await page.click('[data-act=reabrirForn]');
  await page.click('.dlg button.primary');
  assert.equal(await concluida(page), false);
  await salvarDepois(s, () => page.locator('#secPedidos tbody tr', { hasText: 'KAIZEN' }).locator('[data-act=baixarPedido]:not([data-loja])').click());
  assert.equal(await concluida(page), true);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('"✓ marcar concluída" para quem já exportou antes', async () => {
  const s = await abrirCot();
  const { page } = s;
  await page.locator('.corpo-recolhe tbody tr', { hasText: 'KAIZEN' }).locator('[data-act=marcarConcluida]').click();
  assert.equal(await concluida(page), true);
  assert.match(n(await page.locator('.corpo-recolhe tbody tr', { hasText: 'KAIZEN' }).innerText()), /Concluída/);
  // quem não ganhou nenhum item com quantidade não tem o botão
  assert.equal(await page.locator('.corpo-recolhe tbody tr', { hasText: 'VIA PEÇAS' }).locator('[data-act=marcarConcluida]').count(), 0, 'VIA PEÇAS não ganhou nenhum item: sem pedido, sem botão');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('digitar as quantidades acende o "Exportar (N)" do fornecedor na hora (sem redesenhar a tela)', async () => {
  const s = await abrir(base({ config: { loja: 'DISPPAR', lojas: LOJAS }, cotacoes: [cotacao('c1', '0053', '2026-09-29', 'aberta', itens, [
    forn('f1', 'KAMPEAO', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 20, marca: 'NGK' } }),
    forn('f2', 'OUTRO', { 2: { preco: 5, marca: 'NGK' } }),
  ], { itens: [...itens, item('PC', 'PECA C', 'NGK', { codigo: 'COD-C' })], qtds: { 2: { paranoa: 1 } } })] }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const botao = () => page.locator('.corpo-recolhe tbody tr', { hasText: 'KAMPEAO' }).locator('.exp-forn').innerText().then(t => t.trim());
  assert.equal(await botao(), '⬇ Exportar (0)');
  await page.evaluate(() => { document.querySelector('.tab-comp').dataset.marca = 'antes'; });
  await page.fill('.tab-comp [data-qtd-loja=paranoa][data-i="0"]', '3');
  await page.waitForFunction(() => document.querySelector('.corpo-recolhe .exp-forn[data-exp-f="0"]').innerText.trim() === '⬇ Exportar (1)', null, { timeout: 3000 });
  await page.fill('.tab-comp [data-qtd-loja="sao-sebastiao"][data-i="1"]', '2');
  await page.waitForFunction(() => document.querySelector('.corpo-recolhe .exp-forn[data-exp-f="0"]').innerText.trim() === '⬇ Exportar (2)', null, { timeout: 3000 });
  assert.equal(await page.evaluate(() => document.querySelector('.tab-comp').dataset.marca), 'antes', 'a tabela não foi redesenhada');
  assert.equal(await page.locator('.corpo-recolhe [data-act=exportarPedidoForn][data-f="0"]').count(), 1, 'botão ativo');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
