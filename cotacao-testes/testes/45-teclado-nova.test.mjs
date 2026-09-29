import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar } from '../ajuda.mjs';

after(fechar);

const prods = ['A', 'B', 'C'].map((x, k) => ({ id: 'p' + k, codigo: 'COD-' + x, descricao: 'PECA ' + x, marca: 'QUALQUER' }));

test('nova cotação: setas e letras funcionam mesmo com o cursor fora da lista; atualizar a tela não tira o cursor da lista', async () => {
  const s = await abrir(base({ produtos: prods, rascunho: { itens: prods.map(p => ({ produtoId: p.id, quantidade: 1 })), fornecedorIds: [] } }));
  const { page } = s;
  await page.click('nav [data-route=nova]');
  const atual = () => page.evaluate(() => ui.cursorItem);
  // clicou fora da lista (no título) e usou as setas
  await page.click('main h3 >> nth=0');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('ArrowDown');
  assert.equal(await atual(), 1);
  // a tela é atualizada (alteração de outro computador): a lista continua com o cursor
  await page.evaluate(() => render());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tabItens');
  await page.keyboard.press('ArrowDown');
  assert.equal(await atual(), 2);
  // qualquer letra começa a preencher a marca do item atual
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.type('SÓ NGK');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.marcaItem), '2');
  assert.equal(await page.evaluate(() => document.activeElement.value), 'SÓ NGK');
  // Enter duas vezes: grava como padrão no cadastro
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => db.produtos.find(p => p.id === 'p2').marca === 'SÓ NGK');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
