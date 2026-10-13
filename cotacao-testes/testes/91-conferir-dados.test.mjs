import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const P = (id, codigo, descricao, marca = 'QUALQUER', extra = {}) => ({ id, codigo, descricao, marca, unidade: 'UN', similar: '', ...extra });
const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }] },
  produtos: [P('vk', '113175/VKBC4221', 'ROLAMENTO RODA DIANTEIRA', 'SÓ SKF'), P('novoAd', '1622-ADITIVO', 'ADITIVO COMBUSTIVEL'), P('fs', 'G10243/FS15', 'FILTRO COMBUSTIVEL')],
  fornecedores: [{ id: 'f1', nome: 'KAIZEN', email: 'k@x.com' }],
  cotacoes: [
    // antiga: cadastro reimportado (id velho) e peça de outro código ligada ao 113175/VKBC4221
    cotacao('c1', '0001', '2026-09-28', 'finalizada', [
      item('velhoAd', 'ADITIVO COMBUSTIVEL', 'QUALQUER', { codigo: '1622-ADITIVO' }),
      item('vk', 'ROLAMENTO RODA DIANTEIRA', 'SÓ SKF', { codigo: '113175/50005', codigoArquivo: '113175/50005' }),
      item('fs', 'G10243/FS15', 'QUALQUER', { codigo: 'G10243/FS15' }),
    ], [forn('f1', 'KAIZEN', { 0: { preco: 30, marca: 'X' }, 1: { preco: 80, marca: 'SKF' }, 2: { preco: 20, marca: 'Y' }, 7: { preco: 5, marca: 'Z' } })],
    { qtds: { 0: { paranoa: 1 }, 1: { paranoa: 2 }, 2: { paranoa: 1 }, 9: { paranoa: 4 } }, escolhas: { 0: 'fx' } }),
  ],
});

test('conferir dados: acha as divergências e corrige sem perder nada', async () => {
  const s = await abrir(dados());
  const { page } = s;
  // o histórico já conta pela peça certa, mesmo antes de corrigir
  const h = await page.evaluate(() => { const m = historicoPrecos(); return { ad: (m.novoAd || []).length, vk: (m.vk || []).length, k50005: (m['cod:113175/50005'] || []).length }; });
  assert.deepEqual(h, { ad: 1, vk: 0, k50005: 1 }, 'aditivo pelo cadastro novo; o 50005 não conta como VKBC4221');
  // Início avisa o administrador
  assert.match(n(await page.locator('.aviso-integ').innerText()), /divergência\(s\) nos dados/);
  await page.click('[data-act=irConferirDados]');
  const txt = n(await page.locator('.integ').innerText());
  assert.match(txt, /ligados ao cadastro errado/);
  assert.match(txt, /113175\/50005 .*estava ligado a 113175\/VKBC4221/);
  assert.match(txt, /descrição vazia ou igual ao código/);
  assert.match(txt, /apontando para itens que não existem/);
  assert.match(txt, /Escolhas manuais/);
  for (const act of ['integReligar', 'integDescricao', 'integIndices']) {
    await page.locator(`.integ [data-act=${act}]`).first().click();
  }
  const r = await page.evaluate(() => {
    const c = db.cotacoes[0];
    const prod = Object.fromEntries(db.produtos.map(p => [p.id, p]));
    return {
      ids: c.itens.map(it => prod[it.produtoId]?.codigo || null), desc: c.itens[2].descricao,
      resp: Object.keys(c.fornecedores[0].respostas), qtds: Object.keys(c.qtds), escolhas: c.escolhas, nProd: db.produtos.length,
      novo: db.produtos.find(p => p.codigo === '113175/50005'),
    };
  });
  assert.deepEqual(r.ids, ['1622-ADITIVO', '113175/50005', 'G10243/FS15']);
  assert.equal(r.desc, 'FILTRO COMBUSTIVEL');
  assert.deepEqual(r.resp, ['0', '1', '2'], 'só a sobra do item 8 saiu');
  assert.deepEqual(r.qtds, ['0', '1', '2']);
  assert.deepEqual(r.escolhas, {});
  assert.equal(r.nProd, 4, 'o 113175/50005 ganhou cadastro próprio');
  assert.equal(r.novo.descricao, 'ROLAMENTO RODA DIANTEIRA');
  assert.equal(r.novo.marca, 'SÓ SKF');
  assert.match(n(await page.locator('.integ').innerText()), /Tudo confere|Nenhuma divergência grave/);
  assert.equal(await page.evaluate(() => db.produtos.find(p => p.id === 'vk').codigo), '113175/VKBC4221', 'o cadastro antigo não muda');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('produto em uso não sai do cadastro; editar o cadastro atualiza a cotação aberta', async () => {
  const s = await abrir(base({
    produtos: [P('a', 'AB1', 'AMORT', ''), P('b', 'BB2', 'VELA', ''), P('c', 'CC3', 'FILTRO OLEO', 'TECFIL')],
    rascunho: { titulo: 'X', prazoResposta: '2099-12-31', obs: '', fornecedorIds: [], itens: [{ produtoId: 'a', quantidade: 1 }] },
    cotacoes: [cotacao('k', '0002', '2026-10-10', 'aberta', [item('c', 'CC3', 'TECFIL', { codigo: 'CC3', unidade: 'UN', codigoCadastro: 'CC3' })], [])],
  }));
  const { page } = s;
  await page.click('nav [data-route=produtos]');
  await page.locator('details.limpeza-cad summary').click();
  await page.click('[data-act=excluirSemMarca]');
  await page.click('.dlg button.danger');
  const cods = await page.evaluate(() => ({ prod: db.produtos.map(p => p.codigo), rasc: rascunho().itens.length }));
  assert.deepEqual(cods, { prod: ['AB1', 'CC3'], rasc: 1 }, 'o AB1 está na nova cotação: fica');
  // excluir um a um também é bloqueado
  await page.evaluate(() => { acoes.excluirProd({ dataset: { id: 'c' } }); });
  assert.match(n(await page.locator('.dlg').innerText()), /cotação nº 0002, que ainda está aberta/);
  await page.click('.dlg button');
  // editar o cadastro: descrição placeholder do item vira a do cadastro
  await page.locator('[data-act=editarProd][data-id=c]').first().click();
  await page.locator('details.form-novo').evaluate(d => { d.open = true; });
  await page.fill('[data-form=produto] input[name=descricao]', 'FILTRO DE OLEO PSL55');
  await page.click('[data-form=produto] button.primary');
  assert.equal(await page.evaluate(() => db.cotacoes[0].itens[0].descricao), 'FILTRO DE OLEO PSL55');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
