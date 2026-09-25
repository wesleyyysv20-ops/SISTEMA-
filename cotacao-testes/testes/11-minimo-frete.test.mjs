import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n, ns } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  fornecedores: [
    { id: 'f1', nome: 'Auto Mix', frete: 30, freteGratisAcima: 500 },
    { id: 'f2', nome: 'Via Peças', pedidoMinimo: 200 },
    { id: 'f3', nome: 'Dist Sul' },
  ],
  cotacoes: [cotacao('c1', '0011', '2026-09-20', 'aberta', [item('A', 'AMORTECEDOR'), item('B', 'BOBINA'), item('C', 'CORREIA')], [
    forn('f1', 'Auto Mix', { 0: { preco: 100 }, 1: { preco: 60 }, 2: { preco: 40 } }),
    forn('f2', 'Via Peças', { 0: { preco: 110 }, 1: { preco: 50 }, 2: { preco: 45 } }),
    forn('f3', 'Dist Sul', { 1: { preco: 55 } }),
  ], { qtds: { 0: { 'sao-sebastiao': 3 }, 1: { 'sao-sebastiao': 2 }, 2: { paranoa: 1 } } })],
});

async function abrirCotacao() {
  const s = await abrir(dados());
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return s;
}

test('avisa pedido abaixo do mínimo, mostra frete e sugere passar os itens com a conta', async () => {
  const s = await abrirCotacao();
  const { page } = s;
  const aviso = await page.locator('.aviso-minimo').innerText().then(n);
  assert.match(aviso, /Via Peças: pedido de R\$ 100,00, abaixo do mínimo de R\$ 200,00 \(faltam R\$ 100,00\)/);
  assert.match(aviso, /Passar o item para o 2º colocado: itens \+R\$ 10,00 → custa R\$ 10,00 a mais/);
  assert.match(await page.locator('.aviso-frete').innerText().then(n), /Auto Mix cobra frete de R\$ 30,00: faltam R\$ 160,00 para o frete grátis/);
  const total = await page.locator('#secPedidos tr.total').innerText().then(n);
  assert.match(total, /R\$ 440,00\s+\+ frete R\$ 30,00 = R\$ 470,00/);

  await page.click('[data-act=moverItensMinimo]');
  assert.match(await page.locator('.dlg p').innerText().then(n), /BOBINA: R\$ 50,00 → Dist Sul R\$ 55,00/);
  await page.click('.dlg button.primary');
  assert.equal(await page.locator('.aviso-minimo').count(), 0);
  const fornecedores = await page.locator('#secPedidos tbody tr td:first-child b').allInnerTexts();
  assert.deepEqual(fornecedores, ['Auto Mix', 'Dist Sul']);
  assert.match(await page.locator('#secPedidos tr.total').innerText().then(n), /R\$ 450,00\s+\+ frete R\$ 30,00 = R\$ 480,00/);
  assert.equal(await page.locator('td.escolhido').count(), 1, 'fica como escolha manual (dá para desfazer)');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('"Manter assim" tira o aviso; regras ficam no cadastro do fornecedor', async () => {
  const s = await abrirCotacao();
  const { page } = s;
  await page.click('[data-act=manterMinimo]');
  assert.equal(await page.locator('.aviso-minimo').count(), 0);
  assert.match(await page.locator('#secPedidos').innerText().then(n), /mín\. R\$ 200,00/);
  await irPara(page, 'fornecedores');
  await page.click('[data-act=editarForn][data-id=f3]');
  await page.fill('[name=pedidoMinimo]', '150,00');
  await page.fill('[name=frete]', '25');
  await page.click('[data-form=fornecedor] button.primary');
  assert.match(await page.locator('#tbForn').innerText().then(n), /Dist Sul[\s\S]*mínimo R\$ 150,00 · frete R\$ 25,00/);
  const f3 = await page.evaluate(() => db.fornecedores.find(f => f.id === 'f3'));
  assert.equal(f3.pedidoMinimo, 150);
  assert.equal(f3.frete, 25);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
