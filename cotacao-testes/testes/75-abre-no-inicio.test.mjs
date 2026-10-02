import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar } from '../ajuda.mjs';

after(fechar);

test('ao abrir o sistema, a tela é o Início', async () => {
  const s = await abrir(base({}));
  assert.equal(await s.page.evaluate(() => navegacao.nome), 'inicio');
  assert.match(await s.page.locator('nav [data-route=inicio]').getAttribute('class'), /active/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
