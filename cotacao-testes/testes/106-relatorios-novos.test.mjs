import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n } from '../ajuda.mjs';

after(fechar);

const A = item('A', 'PECA A', '', { codigo: 'A-1', quantidade: null });
const B = item('B', 'PECA B', '', { codigo: 'B-1', quantidade: null });
const dados = () => base({
  fornecedores: [{ id: 'f1', nome: 'KAIZEN' }, { id: 'f2', nome: 'ROLES' }, { id: 'f3', nome: 'RMP' }],
  cotacoes: [
    // setembro: A da KAIZEN (Paranoá 2, São Sebastião 1) = 30 · B da ROLES (São Sebastião 1) = 40
    cotacao('c1', '0001', '2026-09-10', 'finalizada', [A, B], [
      forn('f1', 'KAIZEN', { 0: { preco: 10 }, 1: { preco: 50 } }), forn('f2', 'ROLES', { 0: { preco: 12 }, 1: { preco: 40 } }),
    ], { qtds: { 0: { paranoa: 2, 'sao-sebastiao': 1 }, 1: { paranoa: 0, 'sao-sebastiao': 1 } } }),
    // outubro: A da ROLES (Paranoá 3) = 30; o RMP mandou 33000 (erro de digitação); B ninguém cotou
    cotacao('c2', '0002', '2026-10-05', 'finalizada', [A, B], [
      forn('f1', 'KAIZEN', { 0: { preco: 11 } }), forn('f2', 'ROLES', { 0: { preco: 10 } }), forn('f3', 'RMP', { 0: { preco: 33000 } }),
    ], { qtds: { 0: { paranoa: 3, 'sao-sebastiao': 0 }, 1: { paranoa: 1, 'sao-sebastiao': 0 } } }),
    // finalizada sem quantidade: não dá para saber se comprou
    cotacao('c3', '0003', '2026-10-06', 'finalizada', [A], [forn('f1', 'KAIZEN', { 0: { preco: 9 } })]),
  ],
});
const total = async page => n(await page.locator('.stats').innerText()).match(/Total das compras\s+(R\$ [\d.,]+)/)[1];
const mudar = (page, sel, v) => page.$eval(sel, (el, x) => { el.value = x; el.dispatchEvent(new Event('change', { bubbles: true })); }, v);

test('relatórios: compras por mês e loja, filtros, datas, preços suspeitos e itens mais cotados', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'relatorios');
  assert.equal(await total(page), 'R$ 100,00');

  // compras por mês e por loja
  const meses = (await page.locator('#relMeses tbody tr').allInnerTexts()).map(n);
  assert.match(meses[0], /^out\/2026[\s\S]*R\$ 30,00[\s\S]*R\$ 0,00[\s\S]*R\$ 30,00\s+▼ 57,1%/);
  assert.match(meses[1], /^set\/2026\s+R\$ 20,00[\s\S]*R\$ 50,00[\s\S]*R\$ 70,00/);
  assert.match(n(await page.locator('#relMeses tfoot').innerText()), /Total\s+R\$ 50,00\s+R\$ 50,00\s+R\$ 100,00/i);

  // filtro por loja
  await mudar(page, '#relLoja', 'sao-sebastiao');
  assert.equal(await total(page), 'R$ 50,00');
  assert.match(n(await page.locator('.filtro-ativo-rel').innerText()), /loja São Sebastião/);
  await page.click('[data-act=limparFiltrosRel]');
  assert.equal(await total(page), 'R$ 100,00');

  // filtro por fornecedor: só o que foi comprado dele
  await mudar(page, '#relForn', 'f2');
  assert.equal(await total(page), 'R$ 70,00');
  assert.equal(await page.locator('#relForn tbody tr').count(), 1);
  await page.click('[data-act=limparFiltrosRel]');

  // período sob medida
  await mudar(page, '#periodoRel', 'datas');
  await mudar(page, '#relDe', '2026-10-01');
  assert.equal(await total(page), 'R$ 30,00');
  await mudar(page, '#relAte', '2026-09-30');
  assert.match(n(await page.locator('#app').innerText()), /Nenhuma compra neste período/);
  await mudar(page, '#periodoRel', '');

  // itens mais cotados: sem preço, comprado "x de y", sem quantidade e último preço PAGO
  const linhaA = n(await page.locator('#relMaisCotados tbody tr:has-text("A-1")').innerText());
  assert.match(linhaA, /3×\s+—\s+2 de 2\s+\+1 sem qtd\.\s+6\s+R\$ 10,00\s+ROLES · 05\/10\/2026/);
  assert.match(n(await page.locator('#relMaisCotados tbody tr:has-text("B-1")').innerText()), /2×\s+1×\s+1 de 2/);

  // preços suspeitos, com o atalho para o item na cotação
  const susp = n(await page.locator('#relSuspeitos').innerText());
  assert.match(susp, /nº 0002[\s\S]*A-1[\s\S]*RMP\s+R\$ 33\.000,00/);
  await page.click('#relSuspeitos [data-act=abrirItemCot]');
  await page.waitForFunction(() => rota().nome === 'cotacao' && rota().id === 'c2');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
