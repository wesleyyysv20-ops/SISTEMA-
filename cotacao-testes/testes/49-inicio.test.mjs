import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const LOJAS = [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }];
const itens = ['A', 'B', 'C', 'D'].map(x => item('P' + x, 'PECA ' + x, 'NGK', { codigo: 'COD-' + x }));
const daqui = min => { const d = new Date(Date.now() + min * 60000); const p = x => String(x).padStart(2, '0'); return [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, `${p(d.getHours())}:${p(d.getMinutes())}`]; };

test('início: andamento de cada cotação aberta, prazo com cobrar, continuar de onde parei e quem está trabalhando', async () => {
  const [dia, hora] = daqui(90);
  const s = await abrir(base({ config: { loja: 'DISPPAR', lojas: LOJAS }, cotacoes: [
    cotacao('c1', '0001', '2026-09-28', 'aberta', itens, [
      forn('f1', 'KAIZEN', { 0: { preco: 10 }, 1: { preco: 5 }, 2: { preco: 7 } }, { concluidoEm: '2026-09-29T10:00:00Z' }),
      forn('f2', 'COMANDO', { 3: { preco: 9 } }), forn('f3', 'RMP'), forn('f4', 'SPK'),
    ], { titulo: 'GERAL', qtds: { 0: { paranoa: 2 }, 1: { paranoa: 1 }, 3: { 'sao-sebastiao': 1 } }, prazoResposta: dia, prazoHora: hora }),
  ] }));
  const { page } = s;
  // estava trabalhando na cotação 0001, no KAIZEN
  await page.evaluate(() => { ir('cotacao', 'c1'); definirFiltroVencedor(db.cotacoes[0], 'f1'); presenca.outros = [{ email: 'maria@x.com', nome: 'Maria', cotId: 'c1', forn: 'COMANDO', tela: 'cotacao' }]; ir('inicio'); });
  const cartao = n(await page.locator('.cartao-cot').innerText());
  assert.match(cartao, /Cotação nº 0001[\s\S]*faltam 1 h 29 min|Cotação nº 0001[\s\S]*faltam 1 h 30 min/);
  assert.match(cartao, /Cobrar quem falta \(2\)/);
  assert.match(cartao, /Respostas\s*2\/4[\s\S]*falta: RMP, SPK/);
  assert.match(cartao, /Quantidades\s*3\/4[\s\S]*1 item\(ns\) sem quantidade/);
  assert.match(cartao, /Pedidos exportados\s*1\/2[\s\S]*falta: COMANDO/);
  assert.match(n(await page.locator('#presencaInicio').innerText()), /Maria\s*·\s*cotação nº 0001\s*· COMANDO/);
  assert.match(n(await page.locator('.continuar').innerText()), /Continuar de onde parei[\s\S]*Cotação nº 0001 · GERAL · KAIZEN/);

  // "Quantidades" leva ao primeiro item sem quantidade, com o cursor na quantidade
  await page.click('.andamento[data-parte=comparativo]');
  assert.equal(await page.evaluate(() => [rota().nome, document.activeElement.dataset.i].join()), 'cotacao,2');
  // continuar: volta na cotação com o mesmo fornecedor escolhido
  await page.evaluate(() => { ui.filtroVenc = null; ir('inicio'); });
  await page.click('.continuar');
  assert.equal(await page.inputValue('#filtroVencedor'), 'f1');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('cotação finalizada: fica concluída, sem pendências em nenhuma tela (nem dúvidas dela)', async () => {
  const [dia, hora] = daqui(30);
  const s = await abrir(base({ config: { loja: 'DISPPAR', lojas: LOJAS },
    duvidas: [
      { id: 'd1', empresa: 'DPR', codigo: 'COD-A', qtd: 1, valor: 10, marca: 'NGK', obs: '', origem: { cotId: 'c1', numero: '0001', i: 0, fornecedor: 'KAIZEN' } },
      { id: 'd2', empresa: 'DSS', codigo: 'X-9', qtd: 1, valor: 5, marca: '', obs: '' },
    ],
    cotacoes: [cotacao('c1', '0001', '2026-09-28', 'aberta', itens, [forn('f1', 'KAIZEN', { 0: { preco: 10 } }), forn('f2', 'COMANDO')], { qtds: { 0: { paranoa: 2 } }, prazoResposta: dia, prazoHora: hora })],
  }));
  const { page } = s;
  await page.evaluate(() => ir('inicio'));
  assert.ok(await page.locator('.lista-pend li').count() >= 2, 'aberta: tem pendências');
  assert.equal(await page.locator('.cartao-cot').count(), 1);
  assert.match(await page.locator('#nav a[data-route=duvidas]').innerText(), /2/);

  // finaliza a cotação
  await page.evaluate(() => { db.cotacoes[0].status = 'finalizada'; salvar(); render(); });
  const pend = n(await page.locator('main').innerText());
  assert.doesNotMatch(pend, /Cotação nº 0001/, 'nada da cotação finalizada no Início');
  assert.equal(await page.locator('.cartao-cot').count(), 0);
  assert.match(await page.locator('#nav a[data-route=duvidas]').innerText(), /Dúvidas\s*1$/, 'só a dúvida que não é dela');
  assert.equal(await page.locator('#nav a[data-route=cotacoes] .nav-alerta').count(), 0, 'sem aviso de prazo');
  // na tela de Dúvidas as dela ficam ocultas (dá para mostrar)
  await page.click('nav [data-route=duvidas]');
  assert.equal(await page.locator('.duvidas-grid tbody tr').count(), 1);
  assert.match(n(await page.locator('#app').innerText()), /Ocultas: 1 dúvida\(s\) de cotações finalizadas/);
  await page.click('[data-act=alternarDuvFinal]');
  assert.equal(await page.locator('.duvidas-grid tbody tr').count(), 2);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
