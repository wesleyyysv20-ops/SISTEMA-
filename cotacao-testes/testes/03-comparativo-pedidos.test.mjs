import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, salvarDepois, lerXlsx, valor, item, forn, cotacao, n, ns } from '../ajuda.mjs';

after(fechar);

const itens = [item('p1', 'ROLAMENTO RODA', '', { quantidade: 2 }), item('p2', 'PASTILHA FREIO'), item('p3', 'FILTRO OLEO', '', { quantidade: 3 })];
const dados = () => base({
  fornecedores: [{ id: 'f1', nome: 'Auto Mix' }, { id: 'f2', nome: 'Via Peças' }, { id: 'f3', nome: 'Dist Sul' }],
  cotacoes: [
    cotacao('c0', '0001', '2026-09-01', 'finalizada', itens, [forn('f1', 'Auto Mix', { 0: { preco: 100 }, 1: { preco: 50 }, 2: { preco: 20 } })]),
    cotacao('c1', '0002', '2026-09-20', 'aberta', itens, [
      forn('f1', 'Auto Mix', { 0: { preco: 150 }, 1: { preco: 48 }, 2: { preco: 21 } }, { cond: { pagamento: '28 dias' } }),
      forn('f2', 'Via Peças', { 0: { preco: 140 }, 1: { preco: 52 }, 2: { preco: 5 } }),
      forn('f3', 'Dist Sul', { 0: { preco: 160 }, 1: { preco: 55 }, 2: { preco: 22 } }),
    ]),
  ],
});

async function abrirCotacao() {
  const s = await abrir(dados());
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return s;
}

const pedidos = page => page.locator('#secPedidos tbody tr').allInnerTexts().then(ns);

test('menor preço ganha, diferença 1º × 2º e avisos de preço fora do normal', async () => {
  const s = await abrirCotacao();
  const { page } = s;
  const vencedores = await page.locator('.tab-comp tbody tr').evaluateAll(rs => rs.slice(0, 3).map(r => r.querySelector('td.best')?.innerText.split('\n')[0].replace(/\u00a0/g, ' ')));
  assert.deepEqual(vencedores, ['R$ 140,00', 'R$ 48,00', 'R$ 5,00']);
  const difs = await page.locator('.dif-seg').allInnerTexts().then(ns);
  assert.deepEqual(difs, ['7,1%', '8,3%', '320,0%']);
  const alertas = await page.locator('.alerta-preco').allInnerTexts().then(ns);
  assert.ok(alertas.includes('⚠ ↑40% vs último'), 'rolamento 40% acima do último pago');
  assert.ok(alertas.includes('⚠ muito abaixo dos outros'), 'filtro a R$ 5 muito abaixo');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('escolher outro fornecedor na mão muda os pedidos; clicar de novo desfaz', async () => {
  const s = await abrirCotacao();
  const { page } = s;
  assert.match((await pedidos(page))[0], /Auto Mix[\s\S]*1 item[\s\S]*R\$ 48,00/);
  await page.click('td[data-i="0"][data-f="0"]', { position: { x: 8, y: 8 } });
  assert.match((await pedidos(page))[0], /Auto Mix[\s\S]*2 item[\s\S]*R\$ 348,00/);
  assert.equal(await page.locator('td.escolhido').count(), 1);
  await page.click('td[data-i="0"][data-f="0"]', { position: { x: 8, y: 8 } });
  assert.match((await pedidos(page))[0], /Auto Mix[\s\S]*1 item/);
  assert.equal(await page.locator('td.escolhido').count(), 0);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('pedido de compra e comparativo em Excel', async () => {
  const s = await abrirCotacao();
  const { page } = s;
  const todos = await salvarDepois(s, () => page.click('#secPedidos [data-act=baixarPedidos]'));
  assert.equal(todos.nome, 'Pedidos_0002.xlsx');
  const wb = await lerXlsx(todos.buffer);
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Auto Mix', 'Via Peças']);
  const ws = wb.getWorksheet('Via Peças');
  assert.equal(valor(ws.getCell('A1')), 'PEDIDO DE COMPRA');
  const linhas = [];
  ws.eachRow(r => linhas.push(r.values.slice(1).map(v => (v && v.formula ? v.result : v))));
  const rol = linhas.find(l => l[1] === 'p1');
  assert.deepEqual([rol[3], rol[6], rol[7]], [2, 140, 280], 'QTD 2 × R$ 140');
  const total = linhas.find(l => String(l[0]).startsWith('TOTAL DO PEDIDO'));
  assert.equal(total.at(-1), 295);

  const comp = await salvarDepois(s, () => page.click('[data-act=exportarComparativo]'));
  const wc = (await lerXlsx(comp.buffer)).getWorksheet('Comparativo');
  const cab = wc.getRow(3).values.slice(1);
  assert.ok(cab.includes('Dif. 1º × 2º'));
  assert.ok(cab.includes('2º melhor preço'));
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
