import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar } from '../ajuda.mjs';

after(fechar);
const prod = (id, codigo, descricao, marca = '') => ({ id, codigo, descricao, unidade: 'UN', marca, categoria: '' });
const dados = () => base({
  produtos: [prod('p1', 'A1', 'PECA A'), prod('p2', 'B2', 'PECA B'), prod('p3', 'C3', 'PECA C', 'NGK'), prod('p4', 'D4', 'PECA D')],
  rascunho: { titulo: 'X', itens: ['p1', 'p2', 'p3', 'p4'].map((id, k) => ({ produtoId: id, quantidade: 1, codigoArquivo: ['A1', 'B2', 'C3', 'D4'][k], novoCadastro: true })), fornecedorIds: [] },
});

test('✕ funciona com UM clique mesmo se a tela redesenhar e as linhas mudarem de lugar no meio do clique', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=nova]');
  const bt = page.locator('[data-item-linha="2"] [data-act=removerItem]');
  const caixa = await bt.boundingBox();
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
  await page.mouse.down();
  // no meio do clique: a lista é redesenhada e um aviso no topo cresce (as linhas descem)
  await page.evaluate(() => { render(); document.getElementById('app').insertAdjacentHTML('afterbegin', '<div style="height:37px"></div>'); });
  await page.mouse.up();
  await page.waitForSelector('.dlg', { timeout: 3000 });
  assert.match(await page.locator('.dlg').innerText(), /Tirar este item da cotação\?[\s\S]*C3/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('"Próximo sem marca" fica sempre visível na barra de baixo e anda pelos itens sem marca', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=nova]');
  const bt = page.locator('#barraCriar [data-act=irNovoSemMarca]');
  assert.match(await bt.innerText(), /Próximo sem marca\s*3/);
  await bt.click();
  assert.equal(await bt.isVisible(), true, 'continua visível depois de clicar');
  const primeiro = await page.evaluate(() => ui.cursorItem);
  await bt.click();
  const segundo = await page.evaluate(() => ui.cursorItem);
  assert.notEqual(primeiro, segundo, 'vai para o próximo');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
