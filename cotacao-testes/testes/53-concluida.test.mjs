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
