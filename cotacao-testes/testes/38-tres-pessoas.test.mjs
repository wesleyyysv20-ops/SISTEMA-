import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fechar, item, forn, cotacao } from '../ajuda.mjs';
import { supabaseFalso, abrirSite, entrar } from '../supabase-falso.mjs';

after(fechar);

const esperarSalvo = page => page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo' && !nuvem.gravando && !nuvem.timer, null, { timeout: 15000 });
async function computador(sb, email) {
  const s = await abrirSite(sb);
  await entrar(s.page, email, '123456');
  await s.page.waitForSelector('#telaLogin', { state: 'hidden' });
  await esperarSalvo(s.page);
  return s;
}
const itens = ['A', 'B', 'C'].map(x => item('P' + x, 'PECA ' + x, 'NGK', { codigo: 'COD-' + x }));
const cot = (id, numero) => cotacao(id, numero, '2026-09-29', 'aberta', itens, [forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 20, marca: 'NGK' }, 2: { preco: 5, marca: 'NGK' } })]);

test('3 pessoas ao mesmo tempo: quem digita não é interrompido, recebe os números dos outros e nada se perde', async () => {
  const sb = supabaseFalso({
    liberados: ['wes@loja.com', 'ana@loja.com', 'bia@loja.com'],
    docs: new Map([
      ['sistema/config', { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] }],
      ['cotacoes/c1', cot('c1', '0001')], ['cotacoes/c2', cot('c2', '0002')],
    ]),
  });
  const A = await computador(sb, 'wes@loja.com');
  const B = await computador(sb, 'ana@loja.com');
  const C = await computador(sb, 'bia@loja.com');
  for (const [s, id] of [[A, 'c1'], [B, 'c1'], [C, 'c2']]) await s.page.evaluate(i => ir('cotacao', i), id);

  // A está digitando a quantidade do item 1 (Paranoá)
  await A.page.click('.tab-comp [data-qtd-loja=paranoa][data-i="0"]');
  await A.page.keyboard.type('5');
  await A.page.evaluate(() => { document.querySelector('.tab-comp').dataset.marca = 'antes'; });
  await esperarSalvo(A.page);
  // B digita outro item e grava
  await B.page.fill('.tab-comp [data-qtd-loja=sao-sebastiao][data-i="2"]', '7');
  await esperarSalvo(B.page);
  // C, em outra cotação, grava algo também (não deve redesenhar a tela de A)
  await C.page.fill('.tab-comp [data-qtd-loja=paranoa][data-i="1"]', '3');
  await esperarSalvo(C.page);

  // A continua digitando; o aviso em tempo real chega enquanto o salvamento dele está na fila
  await A.page.keyboard.type('0'); // 50
  await A.page.evaluate(() => puxarNuvem());
  // ao salvar, junta com o que B gravou e mostra o número de B sem redesenhar a tela
  await A.page.waitForFunction(() => document.querySelector('.tab-comp [data-qtd-loja=sao-sebastiao][data-i="2"]').value === '7', null, { timeout: 5000 });
  assert.equal(await A.page.evaluate(() => document.querySelector('.tab-comp').dataset.marca), 'antes', 'não redesenhou a tabela no meio da digitação');
  assert.equal(await A.page.evaluate(() => document.activeElement.dataset.i + '/' + document.activeElement.value), '0/50', 'o cursor e o número de A continuam lá');
  assert.match(await A.page.locator('#tot-2').innerText(), /R\$\s35,00/, 'total do item de B já atualizado');

  // só mudaram quantidades: nem depois da pausa precisa redesenhar a tabela; o cursor continua
  await A.page.waitForTimeout(3000);
  assert.equal(await A.page.evaluate(() => document.querySelector('.tab-comp').dataset.marca), 'antes');
  assert.equal(await A.page.evaluate(() => document.activeElement.dataset.i + '/' + document.activeElement.value), '0/50');
  await esperarSalvo(A.page);

  // no banco: tudo junto, nada perdido
  assert.deepEqual(sb.docs.get('qtds/c1').qtds, { 0: { paranoa: 50 }, 2: { 'sao-sebastiao': 7 } });
  assert.deepEqual(sb.docs.get('qtds/c2').qtds, { 1: { paranoa: 3 } });
  assert.equal(sb.docs.get('cotacoes/c1').qtds, undefined, 'as quantidades não vão mais dentro da cotação');
  // B recebe o que A digitou
  await B.page.evaluate(() => puxarNuvem());
  await B.page.waitForFunction(() => document.querySelector('.tab-comp [data-qtd-loja=paranoa][data-i="0"]').value === '50');
  for (const s of [A, B, C]) { assert.deepEqual(s.erros, []); await s.context.close(); }
});

test('juntar: quantidades, respostas de fornecedores e dúvidas de duas pessoas ao mesmo tempo', async () => {
  const { abrir, base } = await import('../ajuda.mjs');
  const s = await abrir(base());
  const r = await s.page.evaluate(() => {
    const baseCot = { id: 'c1', qtds: { 0: { paranoa: 1 } }, fornecedores: [{ fornecedorId: 'f1', respostas: {} }, { fornecedorId: 'f2', respostas: {} }], escolhas: {} };
    const local = structuredClone(baseCot);
    const remoto = structuredClone(baseCot);
    local.qtds[1] = { paranoa: 4 };                  // A digita o item 2
    remoto.qtds[2] = { 'sao-sebastiao': 7 };         // B digita o item 3
    remoto.qtds[0] = { paranoa: 1, 'sao-sebastiao': 2 }; // B completa o item 1
    local.fornecedores[0].respostas = { 0: { preco: 10 } }; // A importa a resposta do f1
    remoto.fornecedores[1].respostas = { 0: { preco: 12 } }; // B importa a do f2
    local.escolhas = { 0: 'f2' };
    const cot = mesclarDoc('cotacoes/c1', baseCot, local, remoto);
    const baseExtra = { duvidas: [{ id: 'd1', codigo: 'X' }] };
    const extra = mesclarDoc('sistema/extra', baseExtra,
      { duvidas: [{ id: 'd1', codigo: 'X' }, { id: 'd2', codigo: 'A' }] },
      { duvidas: [{ id: 'd3', codigo: 'B' }] }); // B resolveu a d1 e pôs a d3
    return { cot, extra };
  });
  assert.deepEqual(r.cot.qtds, { 0: { paranoa: 1, 'sao-sebastiao': 2 }, 1: { paranoa: 4 }, 2: { 'sao-sebastiao': 7 } });
  assert.deepEqual(r.cot.fornecedores.map(f => f.respostas), [{ 0: { preco: 10 } }, { 0: { preco: 12 } }]);
  assert.deepEqual(r.cot.escolhas, { 0: 'f2' });
  assert.deepEqual(r.extra.duvidas.map(d => d.id), ['d2', 'd3'], 'a resolvida por B sai; as novas dos dois ficam');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('outro computador só digitou quantidades: a tabela não é redesenhada (só os números e totais); outras mudanças redesenham', async () => {
  const sb = supabaseFalso({
    docs: new Map([
      ['sistema/config', { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] }],
      ['cotacoes/c1', cotacao('c1', '0001', '2026-09-29', 'aberta', itens, [forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 20, marca: 'NGK' }, 2: { preco: 5, marca: 'NGK' } }), forn('f2', 'VIA PEÇAS', { 0: { preco: 12, marca: 'NGK' } })])],
    ]),
  });
  const A = await computador(sb, 'wes@loja.com');
  const B = await computador(sb, 'wes@loja.com');
  for (const s of [A, B]) await s.page.evaluate(() => ir('cotacao', 'c1'));
  await A.page.evaluate(() => { document.querySelector('.tab-comp').dataset.marca = 'antes'; });
  // B digita uma quantidade
  await B.page.fill('.tab-comp [data-qtd-loja=paranoa][data-i="1"]', '6');
  await esperarSalvo(B.page);
  await A.page.evaluate(() => puxarNuvem());
  await A.page.waitForFunction(() => document.querySelector('.tab-comp [data-qtd-loja=paranoa][data-i="1"]').value === '6');
  assert.equal(await A.page.evaluate(() => document.querySelector('.tab-comp').dataset.marca), 'antes', 'só quantidades: a tabela ficou');
  assert.match(await A.page.locator('#tot-1').innerText(), /R\$\s120,00/);
  // B escolhe outro fornecedor para o item 1: aí a tabela é redesenhada
  await B.page.evaluate(() => { db.cotacoes[0].escolhas = { 0: 'f2' }; salvar(); render(); });
  await esperarSalvo(B.page);
  await A.page.evaluate(() => puxarNuvem());
  await A.page.waitForFunction(() => !document.querySelector('.tab-comp').dataset.marca);
  assert.equal(await A.page.evaluate(() => comparar(db.cotacoes[0]).linhas[0].vencedor), 1);
  for (const s of [A, B]) { assert.deepEqual(s.erros, []); await s.context.close(); }
});
