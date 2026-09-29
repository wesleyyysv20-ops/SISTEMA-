import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, salvarDepois, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const LOJAS = [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }];
const itens = ['A', 'B', 'C', 'D'].map(x => item('P' + x, 'PECA ' + x, 'NGK', { codigo: 'COD-' + x }));

async function abrirCot(qtds, extra = {}) {
  const s = await abrir(base({
    config: { loja: 'DISPPAR', lojas: LOJAS },
    cotacoes: [cotacao('c1', '0042', '2026-09-29', 'aberta', itens, [
      // KAIZEN ganha A, B e C; o C com marca diferente (única resposta, então ganha)
      forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 20, marca: 'NGK' }, 2: { preco: 5, marca: 'BOSCH' } }),
      forn('f2', 'VIA PEÇAS', { 0: { preco: 12, marca: 'NGK' }, 1: { preco: 25, marca: 'NGK' }, 3: { preco: 7, marca: 'NGK' } }),
    ], { qtds })],
    ...extra,
  }));
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return s;
}

test('checklist antes de exportar: mostra as pendências; "Revisar no comparativo" leva aos itens sem exportar', async () => {
  const s = await abrirCot({ 0: { paranoa: 2 }, 2: { paranoa: 1 } }, {
    duvidas: [{ id: 'd1', empresa: 'DPR', codigo: 'COD-A', qtd: 2, valor: 10, marca: 'NGK', obs: '', origem: { cotId: 'c1', numero: '0042', i: 0, fornecedor: 'KAIZEN' } }],
  });
  const { page } = s;
  await page.click('.corpo-recolhe [data-act=exportarPedidoForn][data-f="0"]');
  const ck = n(await page.locator('.dlg-formato .check-pedido').innerText());
  assert.match(ck, /Antes de exportar, confira:/);
  assert.match(ck, /1 sem quantidade \(nenhuma loja digitada\)\s*COD-B/);
  assert.match(ck, /1 marca diferente da pedida ou para conferir\s*COD-C/);
  assert.match(ck, /1 em Dúvidas: ficam fora deste pedido até sair da fila\s*COD-A/);
  assert.equal(await page.locator('.dlg-formato button.primary').innerText(), 'Exportar mesmo assim');

  await page.click('.dlg-formato button[data-r=revisar]');
  assert.equal(await page.locator('.dlg-formato').count(), 0);
  assert.equal((await s.salvos()).length, 0, 'não exportou');
  assert.equal(await page.inputValue('#filtroVencedor'), 'f1', 'mostrando os itens da KAIZEN');
  assert.match(await page.locator('.tab-comp tr[data-comp-linha="1"]').getAttribute('class'), /linha-atual/, 'no primeiro item com pendência');

  // exportar mesmo assim funciona
  await page.click('.corpo-recolhe [data-act=exportarPedidoForn][data-f="0"]');
  await page.check('input[name=formatoExport][value="somada:paranoa"]');
  const arq = await salvarDepois(s, () => page.click('.dlg-formato button.primary'));
  assert.match(arq.nome, /^Pedido_0042_kaizen_entrega_paranoa\.xlsx$/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('checklist antes de exportar: tudo certo mostra "Tudo conferido"', async () => {
  const s = await abrirCot({ 1: { paranoa: 1 }, 3: { paranoa: 3 } });
  const { page } = s;
  await page.click('.corpo-recolhe [data-act=exportarPedidoForn][data-f="1"]'); // VIA PEÇAS: ganha só o D
  assert.match(n(await page.locator('.dlg-formato .check-pedido.ok').innerText()), /Tudo conferido: 1 item\(ns\), nenhuma pendência/);
  assert.equal(await page.locator('.dlg-formato button[data-r=revisar]').count(), 0);
  assert.equal(await page.locator('.dlg-formato button.primary').innerText(), 'Exportar');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
