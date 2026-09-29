import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const itens = [item('P1', 'VELA IGNICAO', 'NGK', { codigo: 'BKR6E' }), item('P2', 'BOBINA', 'SÓ CAR80', { codigo: 'BI318' })];
const qtd = (i, loja) => `[data-qtd-loja="${loja}"][data-i="${i}"]`;

async function abrirCot(fornecedores, extra = {}) {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0025', '2026-09-28', 'aberta', itens, fornecedores, extra)] }));
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return s;
}

test('Kaizen: "NGK/685" = marca NGK e estoque 685 (só para a Kaizen)', async () => {
  const s = await abrirCot([
    forn('f1', 'KAIZEN', { 0: { preco: 20.96, marca: 'NGK/685' }, 1: { preco: 8.67, marca: 'SUN ELETRI/318' } }),
    forn('f2', 'Via Peças', { 0: { preco: 25, marca: 'NGK/10' } }),
  ], { recusadas: { 1: { f1: 'SUN ELETRI 318' } } });
  const { page } = s;
  const r = await page.evaluate(() => db.cotacoes[0].fornecedores.map(f => Object.values(f.respostas).map(o => [o.marca, o.estoque ?? null])));
  assert.deepEqual(r, [[['NGK', 685], ['SUN ELETRI', 318]], [['NGK/10', null]]], 'outro fornecedor não muda');
  const linha0 = n(await page.locator('.tab-comp tbody tr').first().innerText());
  assert.match(linha0, /✓ NGK\s+estoque 685/);
  assert.match(linha0, /KAIZEN\s+estoque 685/, 'coluna Fornecedor mostra o estoque do vencedor');
  // a marca recusada antes continua recusada
  assert.equal(await page.locator('.tab-comp tbody tr').nth(1).locator('.chip-marca.recusada').count(), 1);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('Kaizen ganhou: a soma das lojas não passa do estoque', async () => {
  const s = await abrirCot([forn('f1', 'Kaizen Autopeças', { 0: { preco: 20, marca: 'NGK/10' } }), forn('f2', 'Via Peças', { 0: { preco: 30, marca: 'NGK' } })]);
  const { page } = s;
  await page.fill(qtd(0, 'paranoa'), '6');
  assert.equal(await page.inputValue(qtd(0, 'paranoa')), '6');
  await page.fill(qtd(0, 'sao-sebastiao'), '9');
  assert.equal(await page.inputValue(qtd(0, 'sao-sebastiao')), '4', 'ajustado para o que sobra do estoque');
  assert.match(await page.locator('#toast').innerText(), /tem só 10 em estoque deste item \(6 já na outra loja\)\. Quantidade ajustada para 4/);
  assert.deepEqual(await page.evaluate(() => db.cotacoes[0].qtds[0]), { paranoa: 6, 'sao-sebastiao': 4 });

  // passa a comprar da Via Peças (sem limite): pode mais
  await page.click('.tab-comp tbody tr >> nth=0 >> td.escolhivel >> nth=1');
  await page.click('.dlg button.primary'); // confirma a escolha
  await page.fill(qtd(0, 'sao-sebastiao'), '9');
  assert.equal(await page.inputValue(qtd(0, 'sao-sebastiao')), '9');
  // volta para a Kaizen: avisa que ficou acima do estoque
  await page.click('.tab-comp tbody tr >> nth=0 >> td.escolhivel >> nth=0');
  await page.click('.dlg button.primary'); // confirma a escolha
  assert.match(n(await page.locator('#tot-0').innerText()), /acima do estoque \(10\)/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('Rio Juntas: itens com marca GO ficam destacados (demoram mais para chegar); só para a Rio Juntas', async () => {
  const s = await abrirCot([
    forn('f1', 'RIO JUNTAS', { 0: { preco: 10, marca: 'GO' }, 1: { preco: 50, marca: 'sabo go' } }),
    forn('f2', 'VIA PEÇAS', { 0: { preco: 12, marca: 'GO' }, 1: { preco: 30, marca: 'GOLD' } }),
  ]);
  const { page } = s;
  const linhas = page.locator('.tab-comp tbody tr[data-comp-linha]');
  // item 1: Rio Juntas GO ganha → destaque no preço e na coluna Fornecedor; o GO da Via Peças não conta
  assert.equal(await linhas.nth(0).locator('td.demora').count(), 1);
  assert.equal(await linhas.nth(0).locator('.chip-demora').count(), 2, 'no preço e na coluna Fornecedor');
  // item 2: "SABO GO" da Rio Juntas também conta; "GOLD" não; quem ganha é a Via Peças (sem destaque na coluna Fornecedor)
  assert.equal(await linhas.nth(1).locator('td.demora').count(), 1);
  assert.equal(await linhas.nth(1).locator('.chip-demora').count(), 1);
  assert.match(await page.locator('.pill-aviso.demora').innerText(), /2 item\(ns\) GO da Rio Juntas/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('Comando: ganha até 5% acima do 1º lugar, com o detalhe; clicar no mais barato escolhe ele', async () => {
  const s = await abrirCot([
    forn('f1', 'KAIZEN', { 0: { preco: 100, marca: 'NGK' }, 1: { preco: 100, marca: 'CAR80' } }),
    forn('f2', 'COMANDO', { 0: { preco: 104.9, marca: 'NGK' }, 1: { preco: 106, marca: 'CAR80' } }), // item 1: +4,9%; item 2: +6%
  ]);
  const { page } = s;
  const r = await page.evaluate(() => comparar(db.cotacoes[0]).linhas.map(l => [l.vencedor, l.preferencia]));
  assert.deepEqual(r, [[1, true], [0, false]], 'até 5% a Comando ganha; acima de 5% não');
  const linha = page.locator('.tab-comp tbody tr[data-comp-linha]').first();
  assert.match(n(await linha.innerText()), /⭐ regra Comando · \+4,9% do 1º/);
  assert.match(n(await linha.innerText()), /COMANDO\s+pela regra dos 5% \(\+4,9% do 1º\)/);
  assert.match(n(await linha.innerText()), /\+4,9%[\s\S]*1º KAIZEN R\$ 100,00/, 'a Dif. mostra o mais barato de verdade');
  assert.match(await page.locator('.pill-aviso.regra').innerText(), /1 item\(ns\) da Comando ganhando pela regra dos 5%/);
  // escolher o mais barato (Kaizen) desfaz a regra neste item
  const kaizen = linha.locator('td.escolhivel', { hasText: '100,00' });
  const caixa = await kaizen.boundingBox();
  await kaizen.click({ position: { x: caixa.width - 14, y: 12 } });
  await page.click('.dlg button.primary'); // confirma a escolha
  assert.deepEqual(await page.evaluate(() => { const l = comparar(db.cotacoes[0]).linhas[0]; return [l.vencedor, l.preferencia]; }), [0, false]);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
