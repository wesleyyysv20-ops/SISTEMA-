import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const itens = [item('P1', 'BOBINA IGNICAO', 'SÓ CAR80', { codigo: 'BI318' }), item('P2', 'VELA', 'NGK', { codigo: 'BKR6E' })];

async function abrirCot(fornecedores) {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0021', '2026-09-28', 'aberta', itens, fornecedores)] }));
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return s;
}
const linha = (page, i) => page.locator('.tab-comp tbody tr').nth(i);
const recusar = async page => {
  await page.click('.chip-marca.errada');
  await page.click('.dlg button:text("Não, é outra marca")');
};

test('marca recusada: único preço não ganha, item fica aguardando outro preço', async () => {
  const s = await abrirCot([forn('f1', 'Auto Mix', { 0: { preco: 8.67, marca: 'SUN ELETRI/318' }, 1: { preco: 20, marca: 'NGK' } })]);
  const { page } = s;
  // antes: marca errada, mas é o único preço
  assert.match(n(await linha(page, 0).innerText()), /Auto Mix/);

  await recusar(page);
  const txt = n(await linha(page, 0).innerText());
  assert.match(txt, /✗ SUN ELETRI\/318 — marca recusada/);
  assert.match(txt, /⏳ aguardando outro preço/);
  assert.match(await linha(page, 0).getAttribute('class'), /\blinha-aguardando\b.*\bsit-aguardando\b/, 'linha vermelha, com a faixa de aguardando');
  assert.equal(await linha(page, 0).locator('td.recusada').count(), 1);
  assert.match(n(await page.locator('.aviso-recusa').innerText()), /1 item\(ns\) com a marca recusada, aguardando outro preço/);
  assert.equal(await page.evaluate(() => comparar(db.cotacoes[0]).linhas[0].vencedor), -1);
  assert.match(n(await page.locator('#toast').innerText()), /O item fica aguardando outro preço/);

  // chega a resposta de outro fornecedor: ele passa a valer e a marca dele aparece para conferir
  await page.evaluate(() => {
    const c = db.cotacoes[0];
    c.fornecedores.push({ fornecedorId: 'f2', nome: 'Via Peças', email: '', contato: '', enviadoEm: null, respondidoEm: '2026-09-28T12:00:00Z', respostas: { 0: { preco: 12, marca: 'CAR80' } }, cond: {} });
    salvar(); render();
  });
  const depois = n(await linha(page, 0).innerText());
  assert.doesNotMatch(depois, /aguardando/);
  assert.equal(await page.evaluate(() => comparar(db.cotacoes[0]).linhas[0].vencedor), 1);
  assert.equal(await page.locator('.aviso-recusa').count(), 0);

  // desfazer: "Sim, é ..." na marca recusada
  await page.click('.chip-marca.recusada');
  assert.match(await page.locator('.dlg').innerText(), /Você recusou esta marca/);
  await page.click('.dlg button.primary');
  assert.equal(await page.locator('.chip-marca.recusada').count(), 0);
  assert.equal(await page.evaluate(() => comparar(db.cotacoes[0]).linhas[0].vencedor), 0, 'volta a valer o menor preço');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('marca recusada: o próximo preço vale; clicar no recusado não escolhe; nova marca do mesmo fornecedor tira a recusa', async () => {
  const s = await abrirCot([
    forn('f1', 'Auto Mix', { 0: { preco: 8.67, marca: 'SUN ELETRI' } }),
    forn('f2', 'Via Peças', { 0: { preco: 15, marca: 'SUN ELETRI' } }),
    forn('f3', 'Casa Peças', { 0: { preco: 18, marca: 'CAR80' } }),
  ]);
  const { page } = s;
  await page.click('.chip-marca.errada >> nth=0');
  await page.click('.dlg button:text("Não, é outra marca")');
  // a mesma marca do outro fornecedor, no mesmo item, também fica recusada; vale o CAR80
  assert.equal(await linha(page, 0).locator('td.recusada').count(), 2);
  assert.equal(await page.evaluate(() => comparar(db.cotacoes[0]).linhas[0].vencedor), 2);
  assert.match(n(await page.locator('#toast').innerText()), /Agora vale o preço de Casa Peças/);

  const cel = linha(page, 0).locator('td.recusada').first();
  const caixa = await cel.boundingBox();
  await cel.click({ position: { x: caixa.width - 14, y: 12 } }); // em cima do valor (não no ✕ nem na marca)
  assert.equal(await page.locator('.dlg').count(), 0, 'não abriu janela');
  assert.equal(await page.evaluate(() => comparar(db.cotacoes[0]).linhas[0].vencedor), 2, 'preço recusado não é escolhido');

  // Auto Mix manda de novo com a marca certa: a recusa cai sozinha
  await page.evaluate(() => { db.cotacoes[0].fornecedores[0].respostas[0].marca = 'CAR80'; salvar(); render(); });
  assert.equal(await linha(page, 0).locator('td.recusada').count(), 1);
  assert.equal(await page.evaluate(() => comparar(db.cotacoes[0]).linhas[0].vencedor), 0);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('preço errado do fornecedor: remover ou corrigir pelo ✕ do preço', async () => {
  const s = await abrirCot([forn('f1', 'KAIZEN', { 0: { preco: 2.5, marca: 'CAR80' } }), forn('f2', 'RMP', { 0: { preco: 30, marca: 'CAR80' } })]);
  const { page } = s;
  const venc = () => page.evaluate(() => comparar(db.cotacoes[0]).linhas[0].vencedor);
  // o ✕ aparece (e é criado) quando o mouse passa na célula do preço
  const rmPreco = async k => { const td = page.locator('.tab-comp tbody tr').first().locator('td[data-dica]').nth(k); await td.hover(); await td.locator('.rm-preco').click(); };
  assert.equal(await venc(), 0, 'o preço errado (2,50) estava ganhando');
  // Cancelar não muda nada
  await rmPreco(0);
  assert.match(await page.locator('.dlg').innerText(), /KAIZEN: R\$\s2,50[\s\S]*Este preço está errado\?/);
  await page.click('.dlg button:text("Cancelar")');
  assert.equal(await venc(), 0);
  // corrigir o valor: guarda o original
  await rmPreco(0);
  await page.click('.dlg button:text("Corrigir o valor…")');
  await page.fill('#dlgCampo', '35,00');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => { const o = db.cotacoes[0].fornecedores[0].respostas[0]; return [o.preco, o.precoOriginal]; }), [35, 2.5]);
  assert.equal(await venc(), 1, 'corrigido, a RMP passa a ganhar');
  // remover: fica como se não tivesse respondido
  await rmPreco(1);
  await page.click('.dlg button.danger');
  assert.equal(await page.evaluate(() => db.cotacoes[0].fornecedores[1].respostas[0] ?? null), null);
  assert.equal(await venc(), 0);
  assert.match(n(await page.locator('#toast').innerText()), /Preço de RMP \(R\$ 30,00\) removido do item BI318/);
  // o ✕ não entra no texto da célula
  assert.doesNotMatch(await page.locator('.tab-comp tbody tr').first().innerText(), /✕/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
