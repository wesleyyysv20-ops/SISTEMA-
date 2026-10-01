import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const dados = status => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
  cotacoes: [cotacao('c1', '0059', '2026-09-30', status, ['A', 'B', 'C'].map(x => item('P' + x, 'PECA ' + x + ' COM UMA DESCRICAO BEM COMPRIDA PARA TESTAR', 'NGK', { codigo: 'COD-' + x })), [
    forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 20, marca: 'NGK' }, 2: { preco: 40, marca: 'NGK' } }, { concluidoEm: '2026-09-30T12:00:00Z' }),
    forn('f2', 'VIA PEÇAS', { 0: { preco: 12, marca: 'NGK' }, 1: { preco: 30, marca: 'NGK' }, 2: { preco: 30, marca: 'NGK' } }),
    forn('f3', 'RIO JUNTAS', { 0: { preco: 14, marca: 'NGK' } }),
  ], { prazoResposta: '2026-10-01', qtds: { 0: { paranoa: 2 }, 2: { paranoa: 1, 'sao-sebastiao': 1 } } })],
});

async function abrirCot(status = 'aberta') {
  const s = await abrir(dados(status));
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return s;
}

test('cotação: resumo no cabeçalho e quem falta exportar no quadro Fornecedores', async () => {
  const s = await abrirCot();
  const { page } = s;
  const resumo = n(await page.locator('#resumoCot').innerText());
  // pedido: KAIZEN 2×10 + VIA PEÇAS 2×30 = 80; economia vs média: item 1 (12-10)*2 = 4, item 3 (35-30)*2 = 10
  assert.match(resumo, /Total do pedido\s*R\$ 80,00\s*2 itens/);
  assert.match(resumo, /Economia vs média\s*R\$ 14,00/);
  assert.match(resumo, /Pedidos exportados\s*1 de 2\s*faltam 1/);
  assert.match(resumo, /Itens com quantidade\s*2 de 3/);
  assert.match(resumo, /Dúvidas abertas\s*0/);
  assert.match(n(await page.locator('.resumo-recolhe').innerText()), /3 fornecedor\(es\) · 3 de 3 responderam · 1 de 2 pedidos exportados · faltam 1/);
  // digitar quantidade atualiza o resumo
  await page.fill('.tab-comp [data-qtd-loja=paranoa][data-i="1"]', '1');
  await page.waitForFunction(() => /3 de 3/.test(document.querySelector('#resumoCot').innerText));
  assert.match(n(await page.locator('#resumoCot').innerText()), /Total do pedido\s*R\$ 100,00/);
  // chip de quem falta: filtra o comparativo
  await page.click('.chip-forn-pend:has-text("VIA PEÇAS")');
  assert.equal(await page.inputValue('#filtroVencedor'), 'f2');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('cotação finalizada: sem o prazo e sem pendência de exportar', async () => {
  const s = await abrirCot('finalizada');
  const { page } = s;
  assert.equal(await page.locator('[data-change=prazoCot]').count(), 0);
  assert.equal(await page.locator('.chip-forn-pend').count(), 0);
  assert.doesNotMatch(await page.locator('.resumo-recolhe').innerText(), /faltam/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('comparativo: preço escolhido, quantidades e total presos à direita; descrição numa linha', async () => {
  const s = await abrirCot();
  const { page } = s;
  // tela larga: a tabela (3 fornecedores) cabe inteira → nada fica preso nem coberto
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.evaluate(() => { ui.colFixas = null; render(); });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelector('.tab-comp').classList.contains('fixa-dir')), false, 'cabe inteira: sem colunas presas');
  // tela estreita: não cabe → preço escolhido, quantidades e total ficam presos à direita
  await page.setViewportSize({ width: 900, height: 800 });
  await page.evaluate(() => { localStorage.setItem('cotacao.compacto', '0'); ui.colFixas = null; render(); });
  await page.waitForFunction(() => document.querySelector('.tab-comp')?.classList.contains('fixa-dir'));
  assert.equal(await page.locator('.tab-comp thead th:text-is("Fornecedor")').count(), 0, 'o vencedor fica junto do preço escolhido');
  // rolando a tabela, o total continua na borda direita
  const wrap = page.locator('.painel-comp');
  await wrap.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await wrap.evaluate(el => { el.scrollLeft = 0; });
  const pos = await page.evaluate(() => {
    const w = document.querySelector('.painel-comp').getBoundingClientRect();
    const tot = document.getElementById('tot-0').getBoundingClientRect();
    return Math.abs(w.right - tot.right) < 20;
  });
  assert.ok(pos, 'o total fica encostado à direita');
  const desc = await page.locator('.desc-comp').first().evaluate(el => [getComputedStyle(el).whiteSpace, el.title]);
  assert.equal(desc[0], 'nowrap');
  assert.match(desc[1], /DESCRICAO BEM COMPRIDA/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
