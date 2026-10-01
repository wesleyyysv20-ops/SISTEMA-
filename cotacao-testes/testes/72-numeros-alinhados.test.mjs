import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

// item D em dúvida só em São Sebastião: fica fora do pedido dessa loja em TODAS as telas
const itens = [item('A', 'VELA', 'NGK', { codigo: 'V1' }), item('B', 'FILTRO', 'TECFIL', { codigo: 'F1' }), item('C', 'BOMBA', 'URBA', { codigo: 'B1' }), item('D', 'CORREIA', 'GATES', { codigo: 'C1' })];
const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
  fornecedores: [{ id: 'f1', nome: 'KAIZEN' }, { id: 'f2', nome: 'VIA PEÇAS' }],
  cotacoes: [
    cotacao('c1', '0001', '2026-09-20', 'finalizada', itens, [
      forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 30, marca: 'TECFIL' }, 2: { preco: 50, marca: 'URBA' }, 3: { preco: 70, marca: 'GATES' } }, { concluidoEm: '2026-09-21T10:00:00Z' }),
      forn('f2', 'VIA PEÇAS', { 0: { preco: 12, marca: 'NGK' }, 1: { preco: 20, marca: 'TECFIL' }, 2: { preco: 45, marca: 'URBA' }, 3: { preco: 75, marca: 'GATES' } }),
    ], { qtds: { 0: { paranoa: 2, 'sao-sebastiao': 1 }, 1: { paranoa: 1 }, 2: { 'sao-sebastiao': 3 }, 3: { paranoa: 1, 'sao-sebastiao': 1 } }, escolhas: { 2: 'f1' } }),
    cotacao('c9', '0009', '2026-09-22', 'cancelada', itens, [forn('f1', 'KAIZEN', { 0: { preco: 1, marca: 'NGK' } })], { qtds: { 0: { paranoa: 100 } } }),
  ],
  duvidas: [{ id: 'd1', origem: { cotId: 'c1', i: 3 }, empresa: 'DSS', codigo: 'C1', qtd: 1, valor: 70, marca: 'GATES', criadoEm: '2026-09-21T10:00:00Z' }],
});

test('o total do pedido e o valor ganho são os mesmos em todas as telas (dúvidas e canceladas fora)', async () => {
  const s = await abrir(dados());
  const { page } = s;
  const r = await page.evaluate(() => {
    const c = db.cotacoes.find(x => x.id === 'c1');
    const peds = pedidosPorFornecedor(c);
    const rel = dadosRelatorio();
    return {
      pedido: peds.reduce((t, p) => t + p.total, 0),
      pedKaizen: peds.find(p => p.f.nome === 'KAIZEN').total,
      cabecalho: (htmlResumoCot(c).match(/Total do pedido<\/span><b>([^<]+)/) || [])[1],
      relTotal: rel.res.total,
      relCot: rel.porCot.map(x => x.c.numero),
      relKaizen: rel.fornecedores.find(f => f.nome === 'KAIZEN').valor,
      analiseKaizen: analiseFornecedor('f1').valorGanho,
      inicio: (ultimasCotacoesInicio().match(/<b>(R\$[^<]+)<\/b>/) || [])[1],
    };
  });
  assert.equal(r.pedido, 270, 'R$ 340 menos a correia de São Sebastião (R$ 70) em dúvida');
  assert.match(r.cabecalho, /270,00/);
  assert.equal(r.relTotal, 270);
  assert.deepEqual(r.relCot, ['0001'], 'a cancelada não entra');
  assert.equal(r.relKaizen, r.pedKaizen);
  assert.equal(r.analiseKaizen, r.pedKaizen);
  assert.match(r.inicio, /270,00/);
  // lista de cotações
  await page.click('nav [data-route=cotacoes]');
  assert.match(await page.locator('#tbCot tr[data-abrir-cot=c1]').innerText(), /R\$\s270,00/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
