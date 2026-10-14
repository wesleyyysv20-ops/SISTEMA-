import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar } from '../ajuda.mjs';

after(fechar);

const P = (id, codigo, descricao) => ({ id, codigo, descricao, marca: 'QUALQUER', unidade: 'UN', similar: '' });
const dados = () => base({
  produtos: [P('pa', 'AAA1', 'AMORTECEDOR'), P('pb', 'BBB2', 'BOBINA'), P('pc', 'CCC3', 'CORREIA')],
  rascunho: { titulo: 'X', prazoResposta: '2099-12-31', obs: '', fornecedorIds: [], itens: [{ produtoId: 'pa', quantidade: 1 }, { produtoId: 'pb', quantidade: 1 }, { produtoId: 'pc', quantidade: 1 }] },
});

test('✕ da nova cotação funciona mesmo se a lista chegar de novo da nuvem com a pergunta aberta', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=nova]');
  const codigos = () => page.evaluate(() => rascunho().itens.map(x => x.produtoId));
  const linha = await page.evaluate(() => rascunho().itens.findIndex(x => x.produtoId === 'pb'));
  await page.click(`[data-act=removerItem][data-i="${linha}"]`);
  await page.locator('.dlg').waitFor();
  // um colega grava a lista (marca de outro item) enquanto a pergunta está aberta: a lista é trocada por uma cópia
  await page.evaluate(() => { const v = structuredClone({ rascunho: db.rascunho, duvidas: db.duvidas }); v.rascunho.itens[2].marca = 'SÓ GATES'; aplicarDoc('sistema/extra', v); });
  await page.click('.dlg button.primary');
  assert.deepEqual(await codigos(), ['pa', 'pc'], 'a BOBINA saiu (antes não saía nada)');
  assert.equal(await page.evaluate(() => rascunho().itens[1].marca), 'SÓ GATES', 'a mudança do colega ficou');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('duas pessoas na mesma lista: um tira um item, o outro muda outro — as duas mudanças ficam', async () => {
  const s = await abrir(dados());
  const { page } = s;
  const r = await page.evaluate(() => {
    const it = (id, extra = {}) => ({ produtoId: id, quantidade: 1, ...extra });
    const baseL = { titulo: 'X', itens: [it('pa'), it('pb'), it('pc')] };
    const local = { titulo: 'X', itens: [it('pa'), it('pc')] }; // aqui tirei a BOBINA
    const remoto = { titulo: 'X', itens: [it('pa'), it('pb'), it('pc', { marca: 'SÓ GATES' })] }; // lá mudaram a CORREIA
    const aqui = mesclarDoc('sistema/extra', { rascunho: baseL }, { rascunho: local }, { rascunho: remoto }).rascunho.itens;
    const la = mesclarDoc('sistema/extra', { rascunho: baseL }, { rascunho: remoto }, { rascunho: local }).rascunho.itens;
    // dois códigos compostos do mesmo produto são itens diferentes
    const comp = mesclarDoc('sistema/extra', { rascunho: { itens: [it('pa', { codigoArquivo: '113175/50005' }), it('pa', { codigoArquivo: '113175/VKBC4221' })] } },
      { rascunho: { itens: [it('pa', { codigoArquivo: '113175/50005' })] } },
      { rascunho: { itens: [it('pa', { codigoArquivo: '113175/50005' }), it('pa', { codigoArquivo: '113175/VKBC4221', marca: 'SKF' })] } }).rascunho.itens;
    return { aqui: aqui.map(x => x.produtoId + (x.marca ? ':' + x.marca : '')), la: la.map(x => x.produtoId + (x.marca ? ':' + x.marca : '')), comp: comp.map(x => x.codigoArquivo + (x.marca ? ':' + x.marca : '')) };
  });
  assert.deepEqual(r.aqui, ['pa', 'pc:SÓ GATES']);
  assert.deepEqual(r.la, ['pa', 'pc:SÓ GATES']);
  assert.deepEqual(r.comp, ['113175/50005'], 'o mesmo item tirado aqui e alterado lá: vale a remoção (o ✕ não "volta")');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
