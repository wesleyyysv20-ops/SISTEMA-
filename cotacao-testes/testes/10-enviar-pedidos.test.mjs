import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { abrir, base, fechar, salvarDepois, lerXlsx, valor, item, forn, cotacao, n, ns } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  config: { loja: 'Loja Teste', comprador: 'Wes', lojas: [
    { id: 'sao-sebastiao', nome: 'São Sebastião', cnpj: '', endereco: 'Rua 1, São Sebastião' },
    { id: 'paranoa', nome: 'Paranoá', cnpj: '', endereco: 'Quadra 2, Paranoá' }] },
  cotacoes: [cotacao('c1', '0010', '2026-09-20', 'aberta',
    [item('A1', 'AMORTECEDOR'), item('B2', 'BOBINA'), item('C3', 'CORREIA')], [
      forn('f1', 'Auto Mix', { 0: { preco: 100 }, 1: { preco: 50 }, 2: { preco: 30 } }, { email: 'auto@x.com', cond: { pagamento: '28 dias' } }),
      forn('f2', 'Via Peças', { 2: { preco: 20 } }),
    ], { qtds: { 0: { 'sao-sebastiao': 3, paranoa: 1 }, 1: { paranoa: 2 }, 2: { 'sao-sebastiao': 5 } } })],
});

async function abrirPainel() {
  const s = await abrir(dados());
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  await s.page.click('[data-act=enviarPedidos]');
  await s.page.waitForSelector('#painelLote');
  return s;
}

test('e-mail do pedido já vai com total e lojas de entrega; abrir marca como enviado', async () => {
  const s = await abrirPainel();
  const { page } = s;
  const linhas = await page.locator('.tab-lote tbody tr').allInnerTexts().then(ns);
  assert.equal(linhas.length, 2);
  assert.match(linhas[0], /Auto Mix\s+R\$ 500,00\s+2 item/);
  assert.match(linhas[1], /Via Peças\s+R\$ 100,00[\s\S]*sem e-mail/);
  const href = await page.locator('.tab-lote tr.atual a:text("Gmail")').getAttribute('href');
  const url = new URL(href);
  assert.equal(url.searchParams.get('to'), 'auto@x.com');
  assert.equal(url.searchParams.get('su'), 'Pedido de compra - cotação nº 0010 - Loja Teste');
  const corpo = n(url.searchParams.get('body'));
  assert.match(corpo, /2 item\(ns\), total de R\$ 500,00/);
  assert.match(corpo, /uma aba para cada:\n- São Sebastião \(Rua 1, São Sebastião\): 1 item\(ns\), R\$ 300,00\n- Paranoá \(Quadra 2, Paranoá\): 2 item\(ns\), R\$ 200,00/);
  await page.click('.tab-lote tr.atual a:text("Gmail")');
  await page.waitForFunction(() => document.querySelector('.tab-lote tr.feito'));
  await page.click('[data-act=fecharLote]');
  assert.match(await page.locator('#secPedidos').innerText().then(n), /Auto Mix[\s\S]*✉ pedido enviado/);
  // Via Peças sem e-mail: marca na mão
  await page.click('[data-act=enviarPedidos]');
  await page.click('.tab-lote tbody tr:nth-child(2) [data-act=marcarLote]');
  assert.equal(await page.locator('.tab-lote tr.feito').count(), 2);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('pedidos em .zip: uma planilha por fornecedor, uma aba por loja (ou lojas juntas)', async () => {
  const s = await abrirPainel();
  const { page } = s;
  const arq = await salvarDepois(s, () => page.click('[data-act=zipPedidos]'));
  assert.equal(arq.nome, 'Pedidos_0010.zip');
  const zip = await JSZip.loadAsync(arq.buffer);
  assert.deepEqual(Object.keys(zip.files).sort(), ['Pedido_0010_auto_mix.xlsx', 'Pedido_0010_via_pecas.xlsx']);
  const wb = await lerXlsx(await zip.file('Pedido_0010_auto_mix.xlsx').async('nodebuffer'));
  assert.deepEqual(wb.worksheets.map(w => w.name), ['São Sebastião', 'Paranoá']);
  assert.equal(valor(wb.getWorksheet('Paranoá').getCell('A1')), 'PEDIDO DE COMPRA — PARANOÁ');
  const via = await lerXlsx(await zip.file('Pedido_0010_via_pecas.xlsx').async('nodebuffer'));
  assert.deepEqual(via.worksheets.map(w => w.name), ['São Sebastião'], 'só a loja que tem itens');

  await page.check('input[name=formatoPedido][value=juntas]');
  const corpo = n(new URL(await page.locator('.tab-lote tbody tr').first().locator('a:text("Gmail")').getAttribute('href')).searchParams.get('body'));
  assert.match(corpo, /Entregar nas lojas/);
  const um = await salvarDepois(s, () => page.click('[data-act=baixarPedidoForn][data-forn=f1]'));
  const wj = await lerXlsx(um.buffer);
  assert.equal(wj.worksheets.length, 1);
  let cab = [];
  wj.worksheets[0].eachRow(r => { if (r.values.includes('Item')) cab = r.values.slice(1); });
  assert.deepEqual(cab.slice(3, 6), ['QTD São Sebastião', 'QTD Paranoá', 'QTD TOTAL']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
