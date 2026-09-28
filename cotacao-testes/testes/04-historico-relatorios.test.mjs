import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n, ns } from '../ajuda.mjs';

after(fechar);

const itens = [item('p1', 'ROLAMENTO RODA', '', { quantidade: 2 }), item('p2', 'PASTILHA FREIO'), item('p3', 'FILTRO OLEO', '', { quantidade: 3 })];
const dados = () => base({
  produtos: [{ id: 'p1', codigo: 'p1', descricao: 'ROLAMENTO RODA' }, { id: 'p2', codigo: 'p2', descricao: 'PASTILHA FREIO' },
    { id: 'p3', codigo: 'p3', descricao: 'FILTRO OLEO' }, { id: 'p4', codigo: 'p4', descricao: 'CORREIA' }],
  cotacoes: [
    cotacao('cx', '0000', '2026-08-01', 'cancelada', itens, [forn('f1', 'Auto Mix', { 0: { preco: 1 } })]),
    cotacao('c0', '0001', '2026-08-10', 'finalizada', itens, [forn('f1', 'Auto Mix', { 0: { preco: 100 }, 1: { preco: 50 }, 2: { preco: 20 } }), forn('f2', 'Via Peças', { 0: { preco: 110 }, 1: { preco: 45 } })]),
    cotacao('cm', '0002', '2026-09-01', 'finalizada', itens, [forn('f1', 'Auto Mix', { 0: { preco: 120 } }), forn('f2', 'Via Peças', { 0: { preco: 118 } })]),
    cotacao('c1', '0003', '2026-09-20', 'aberta', itens, [
      forn('f1', 'Auto Mix', { 0: { preco: 150 }, 1: { preco: 48 }, 2: { preco: 21 } }),
      forn('f2', 'Via Peças', { 0: { preco: 140 }, 1: { preco: 52 }, 2: { preco: 5 } }),
      forn('f3', 'Dist Sul', { 0: { preco: 160 }, 1: { preco: 55 }, 2: { preco: 22 } })]),
  ],
});

test('produtos: último preço pago, variação e histórico (cotação cancelada não conta)', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=produtos]');
  await page.check('#soComPreco');
  assert.equal(await page.locator('#tbProd > tr').count(), 3);
  await page.click('[data-act=verHistorico][data-id=p1]');
  const hist = await page.locator('.hist-linha').innerText().then(n);
  assert.match(hist, /Último pago\s+R\$ 140,00/);
  assert.match(hist, /Menor pago\s+R\$ 100,00/);
  assert.match(hist, /↑ 40,0%/);
  assert.doesNotMatch(hist, /nº 0000/);
  assert.equal(await page.locator('.hist-linha table:not(.hf-tabela) tbody tr').count(), 3);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('relatórios: total, economia e fornecedores que mais ganham', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'relatorios');
  const resumo = await page.locator('.stats').innerText().then(n);
  assert.match(resumo, /Cotações com resposta\s+3/);
  assert.match(resumo, /Total das compras\s+R\$ 884,00/);
  assert.match(resumo, /Economia vs média dos preços\s+R\$ 71,17/);
  const primeiro = await page.locator('section:has(h3:text("Fornecedores")) tbody tr').first().innerText().then(n);
  assert.match(primeiro, /^Via Peças/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('histórico por fornecedor: uma linha por fornecedor, tabela de variação e dica com os preços', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=produtos]');
  await page.click('[data-act=verHistorico][data-id=p1]');
  assert.deepEqual(await page.locator('.hf-legenda > span:has(.hf-sw)').allInnerTexts(), ['Auto Mix', 'Via Peças', 'Dist Sul']);
  assert.equal(await page.locator('.hf-serie').count(), 3);
  const tabela = await page.locator('.hf-tabela tbody tr').allInnerTexts().then(ns);
  // última cotação: Via Peças R$ 140 (mais barata), Auto Mix R$ 150, Dist Sul R$ 160
  assert.match(tabela[0], /^Via Peças\s+3×\s+2×\s+R\$ 110,00[\s\S]*R\$ 140,00[\s\S]*↑ 27,3%/);
  assert.match(tabela[1], /^Auto Mix\s+3×\s+1×\s+R\$ 100,00[\s\S]*R\$ 150,00[\s\S]*↑ 50,0%/);
  assert.match(tabela[2], /^Dist Sul\s+1×\s+0×/);
  await page.locator('.hf-col').nth(1).hover();
  const dica = n(await page.locator('.hf-tip').innerText()).replace(/\s+/g, ' ');
  assert.match(dica, /01\/09\/2026 · cotação nº 0002 Via Peças R\$ 118,00 ✓ Auto Mix R\$ 120,00/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
