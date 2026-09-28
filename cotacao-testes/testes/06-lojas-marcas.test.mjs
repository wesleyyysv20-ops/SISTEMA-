import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, salvarDepois, lerXlsx, valor, item, forn, cotacao, irPara, n, ns } from '../ajuda.mjs';

after(fechar);

const itens = [item('A1', 'AMORTECEDOR', 'COFAP'), item('B2', 'BOBINA', 'MAGNETI MARELLI'), item('C3', 'ROLAMENTO', 'NSK/SKF'), item('D4', 'BOMBA', 'NAKATA'), item('E5', 'FILTRO')];
const dados = () => base({
  cotacoes: [cotacao('c1', '0006', '2026-09-20', 'aberta', itens, [
    forn('f1', 'Auto Mix', { 0: { preco: 100, marca: 'COF' }, 1: { preco: 50, marca: 'MM' }, 2: { preco: 30, marca: 'SKF' }, 3: { preco: 80, marca: 'NK' }, 4: { preco: 10 } }),
    forn('f2', 'Via Peças', { 0: { preco: 90, marca: 'MONROE' }, 1: { preco: 55, marca: 'M.MARELLI' }, 2: { preco: 25, marca: 'IRB' }, 3: { preco: 85, marca: 'NKT' }, 4: { preco: 12 } })])],
});

async function abrirCotacao() {
  const s = await abrir(dados());
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return s;
}
const qtd = (i, loja) => `[data-qtd-loja="${loja}"][data-i="${i}"]`;
const chips = page => page.locator('.tab-comp tbody tr').evaluateAll(rs => rs.slice(0, 4).map(r => [...r.querySelectorAll('.chip-marca')].map(c => c.className.replace('chip-marca ', '') + ':' + c.innerText).join(' | ')));

test('marcas: abreviações reconhecidas, marca errada não ganha sozinha', async () => {
  const s = await abrirCotacao();
  const { page } = s;
  assert.deepEqual(await chips(page), [
    'ok:✓ COF | errada:⚠ MONROE ≠ COFAP',
    'ok:✓ MM | ok:✓ M.MARELLI',
    'ok:✓ SKF | errada:⚠ IRB ≠ NSK/SKF',
    'duvida:? NK — confira | ok:✓ NKT',
  ]);
  // Via Peças é mais barata no amortecedor, mas com marca errada: ganha a Auto Mix
  const venc = await page.locator('.tab-comp tbody tr').first().locator('td.best').innerText().then(n);
  assert.match(venc, /R\$ 100,00/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('marcas: confirmar abreviação é aprendido; corrigir muda o vencedor', async () => {
  const s = await abrirCotacao();
  const { page } = s;
  await page.click('.chip-marca.duvida');
  await page.click('.dlg button.primary'); // "Sim, é NAKATA"
  assert.equal(await page.locator('.chip-marca.duvida').count(), 0);
  await page.click('.chip-marca.errada >> text=IRB');
  await page.click('.dlg button:text("Corrigir")');
  await page.fill('#dlgCampo', 'NSK');
  await page.keyboard.press('Enter');
  const rol = await page.locator('.tab-comp tbody tr').nth(2).locator('td.best').innerText().then(n);
  assert.match(rol, /R\$ 25,00/, 'com a marca corrigida, o menor preço ganha');
  await irPara(page, 'config');
  assert.match(await page.locator('section:has(h2:text("Abreviações")) tbody').innerText().then(n), /NAKATA\s+NK/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('quantidades por loja: totais, pedidos separados por loja e lojas juntas', async () => {
  const s = await abrirCotacao();
  const { page } = s;
  await page.click(qtd(0, 'sao-sebastiao'));
  await page.keyboard.type('3');
  await page.keyboard.press('Enter'); // desce para o item de baixo
  await page.keyboard.type('2');
  await page.click(qtd(0, 'paranoa'));
  await page.keyboard.type('1');
  assert.match(await page.locator('#tot-0').innerText().then(n), /R\$ 400,00/);
  assert.match(await page.locator('#tot-4').innerText().then(n), /sem qtd/);
  const tot = await page.locator('#totalComp').innerText().then(n);
  assert.match(tot, /5 un\.\s+R\$ 400,00\s+1 un\.\s+R\$ 100,00\s+R\$ 500,00/);

  const ss = await salvarDepois(s, () => page.click('[data-act=baixarPedido][data-f="0"][data-loja=sao-sebastiao]'));
  assert.equal(ss.nome, 'Pedido_0006_auto_mix_sao_sebastiao.xlsx');
  const ws = (await lerXlsx(ss.buffer)).worksheets[0];
  assert.equal(valor(ws.getCell('A1')), 'PEDIDO DE COMPRA — SÃO SEBASTIÃO');
  const linhas = [];
  ws.eachRow(r => linhas.push(r.values.slice(1).map(v => (v && v.formula ? v.result : v))));
  const amort = linhas.find(l => l[1] === 'A1');
  assert.deepEqual([amort[3], amort[4], amort.at(-1)], [3, 'COFAP', 300], 'QTD da loja e marca por extenso');

  const juntas = await salvarDepois(s, () => page.click('[data-act=baixarPedido][data-f="0"]:not([data-loja])'));
  const wj = (await lerXlsx(juntas.buffer)).worksheets[0];
  const cab = [];
  wj.eachRow(r => { if (r.values.includes('Item')) cab.push(...r.values.slice(1)); });
  assert.deepEqual(cab.slice(3, 6), ['QTD São Sebastião', 'QTD Paranoá', 'QTD TOTAL']);

  // quantidades ficam salvas
  await page.waitForTimeout(600);
  await page.reload();
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  assert.equal(await page.locator(qtd(0, 'sao-sebastiao')).inputValue(), '3');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
