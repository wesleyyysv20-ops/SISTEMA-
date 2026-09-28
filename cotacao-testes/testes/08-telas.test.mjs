import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara } from '../ajuda.mjs';

after(fechar);

const itens = [item('A1', 'AMORTECEDOR DIANTEIRO', 'COFAP'), item('B2', 'BOBINA IGNICAO', 'MAGNETI MARELLI')];
const dados = () => base({
  produtos: itens.map(i => ({ id: i.produtoId, codigo: i.codigo, descricao: i.descricao, marca: i.marca })),
  fornecedores: [{ id: 'f1', nome: 'Auto Mix' }, { id: 'f2', nome: 'Via Peças' }],
  cotacoes: [cotacao('c1', '0001', '2026-09-20', 'aberta', itens, [
    forn('f1', 'Auto Mix', { 0: { preco: 100, marca: 'COF' }, 1: { preco: 50 } }),
    forn('f2', 'Via Peças', { 0: { preco: 90, marca: 'MONROE' }, 1: { preco: 55 } })], { qtds: { 0: { 'sao-sebastiao': 2 } } })],
});

const telas = [['inicio'], ['duvidas'], ['cotacoes'], ['cotacao', 'c1'], ['nova'], ['produtos'], ['fornecedores'], ['relatorios'], ['config']];

for (const largura of [1366, 1024]) {
  test(`todas as telas abrem sem erro e sem rolagem lateral (${largura}px)`, async () => {
    const s = await abrir(dados(), { largura, altura: 800 });
    for (const [rota, id] of telas) {
      await irPara(s.page, rota, id);
      const titulo = await s.page.locator('#app h2').first().innerText();
      assert.doesNotMatch(titulo, /Não foi possível/, `tela ${rota}`);
      const { largo, janela } = await s.page.evaluate(() => ({ largo: document.documentElement.scrollWidth, janela: document.documentElement.clientWidth }));
      assert.ok(largo <= janela, `tela ${rota} mais larga que a janela (${largo} > ${janela})`);
    }
    assert.deepEqual(s.erros, []);
    await s.fechar();
  });
}
