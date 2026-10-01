import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

const nomes = ['COBRA ROLAMENTOS', 'COMANDO', 'KAIZEN', 'RIO JUNTAS', 'VIA PEÇAS', 'ENVIA PEÇAS'];
const itens = Array.from({ length: 6 }, (_, k) => item('P' + k, (k === 3 ? 'AMORTECEDOR DIANTEIRO' : 'VELA IGNICAO ') + k, k === 3 ? 'ALB-NAK-KAY-PERF-MONR' : 'NGK', { codigo: k === 3 ? 'GP30134/AMD30134' : 'COD-' + k }));
const dados = status => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
  cotacoes: [cotacao('c1', '0060', '2026-09-30', status, itens, nomes.map((nm, j) => forn('f' + j, nm, Object.fromEntries(itens.map((_, k) => [k, { preco: 10 + ((k * 7 + j * 3) % 11), marca: 'NGK' }])))),
    { qtds: { 0: { paranoa: 2 } } })],
});
async function abrirCot(status, largura = 1280) {
  const s = await abrir(dados(status));
  await s.page.setViewportSize({ width: largura, height: 900 });
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  await s.page.evaluate(() => { localStorage.setItem('cotacao.compacto', '0'); render(); });
  return s;
}

test('tela de ~950px: a decisão fica presa à direita (versão estreita, 2º lugar dentro do preço escolhido)', async () => {
  const s = await abrirCot('aberta', 960);
  const { page } = s;
  await page.waitForFunction(() => document.querySelector('.tab-comp')?.classList.contains('fixa-dir'));
  const cls = await page.locator('.tab-comp').getAttribute('class');
  assert.match(cls, /fixa-dir/);
  assert.match(cls, /estreita/);
  assert.equal(await page.locator('.tab-comp th.col-dif').isVisible(), false);
  const mini = page.locator('.tab-comp tbody tr').first().locator('.seg-mini');
  assert.equal(await mini.isVisible(), true);
  assert.match(await mini.innerText(), /^R\$\s[\d,]+ · .+ · \+[\d,]+%$/);
  // a marca pedida comprida fica numa linha só
  const mp = page.locator('tr[data-comp-linha="3"] .marca-pedida');
  assert.equal(await mp.evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
  assert.equal(await mp.getAttribute('title'), 'Marca pedida: ALB-NAK-KAY-PERF-MONR');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('cotação finalizada: comparativo só para consulta até "Editar mesmo assim"', async () => {
  const s = await abrirCot('finalizada');
  const { page } = s;
  assert.match(await page.locator('.aviso-travada').innerText(), /Finalizada[\s\S]*só para consulta/);
  const antes = await page.evaluate(() => comparar(db.cotacoes[0]).linhas[1].vencedor);
  // clicar num preço não troca o ganhador
  const outro = page.locator('tr[data-comp-linha="1"] > td:nth-child(3)'); // 1ª coluna de fornecedor (não é o ganhador)
  const cx = await outro.boundingBox();
  await outro.click({ position: { x: cx.width - 14, y: 12 } });
  assert.equal(await page.locator('.dlg').count(), 0);
  assert.equal(await page.evaluate(() => comparar(db.cotacoes[0]).linhas[1].vencedor), antes);
  assert.match(await page.locator('#toast').innerText(), /só para consulta/);
  // quantidade não muda
  const q = page.locator('.tab-comp [data-qtd-loja=paranoa][data-i="0"]');
  assert.equal(await q.getAttribute('readonly'), '');
  await page.evaluate(() => { const el = document.querySelector('.tab-comp [data-qtd-loja=paranoa][data-i="0"]'); el.value = '9'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.evaluate(() => db.cotacoes[0].qtds[0].paranoa), 2);
  // destravar: volta a editar (a cotação continua finalizada)
  await page.click('[data-act=destravarCot]');
  await outro.click({ position: { x: cx.width - 14, y: 12 } });
  await page.click('.dlg button.primary');
  assert.notEqual(await page.evaluate(() => comparar(db.cotacoes[0]).linhas[1].vencedor), antes);
  assert.equal(await page.evaluate(() => db.cotacoes[0].status), 'finalizada');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('comparativo: buscar item por código ou descrição filtra as linhas; Esc limpa', async () => {
  const s = await abrirCot('aberta');
  const { page } = s;
  const vis = () => page.locator('.tab-comp tbody tr[data-comp-linha]:not([hidden])').count();
  assert.equal(await vis(), 6);
  await page.fill('#buscaComp', 'gp30134amd');
  assert.equal(await vis(), 1);
  assert.match(await page.locator('#buscaCompCont').innerText(), /1 item/);
  await page.fill('#buscaComp', 'vela');
  assert.equal(await vis(), 5);
  // digitar números na busca não vai para a quantidade
  await page.fill('#buscaComp', '');
  await page.locator('#buscaComp').pressSequentially('cod-2');
  assert.equal(await vis(), 1);
  assert.equal(await page.evaluate(() => db.cotacoes[0].qtds[2]), undefined);
  await page.press('#buscaComp', 'Escape');
  assert.equal(await vis(), 6);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('status da cotação em botões, com confirmação (e aviso de pedido sem exportar)', async () => {
  const s = await abrirCot('aberta');
  const { page } = s;
  assert.match(await page.locator('.status-cot button.ativo').innerText(), /Aberta/);
  await page.click('.status-cot [data-status=finalizada]');
  assert.match(await page.locator('.dlg').innerText(), /Ainda falta exportar[\s\S]*Finalizar a cotação nº 0060 mesmo assim/);
  await page.click('.dlg button:text("Cancelar")');
  assert.equal(await page.evaluate(() => db.cotacoes[0].status), 'aberta');
  await page.click('.status-cot [data-status=finalizada]');
  await page.click('.dlg button.primary');
  assert.equal(await page.evaluate(() => db.cotacoes[0].status), 'finalizada');
  assert.match(await page.locator('.status-cot button.ativo').innerText(), /Finalizada/);
  assert.equal(await page.locator('.aviso-travada').count(), 1);
  // reabrir também pergunta
  await page.click('.status-cot [data-status=aberta]');
  assert.match(await page.locator('.dlg').innerText(), /Reabrir a cotação nº 0060/);
  await page.click('.dlg button.primary');
  assert.equal(await page.evaluate(() => db.cotacoes[0].status), 'aberta');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
