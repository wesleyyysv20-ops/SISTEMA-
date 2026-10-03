import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, irPara } from '../ajuda.mjs';

after(fechar);

test('janelas: título, ✕ que fecha como Cancelar e campos com a mesma altura', async () => {
  const s = await abrir(base({}));
  const { page } = s;
  // pergunta curta no 1º parágrafo vira título
  const r = page.evaluate(() => confirmar('Excluir a cotação nº 0059?\n\nIsso não pode ser desfeito.', 'Excluir'));
  await page.waitForSelector('.dlg .dlg-x');
  assert.equal(await page.locator('.dlg .dlg-tit').innerText(), 'Excluir a cotação nº 0059?');
  assert.match(await page.locator('.dlg p').innerText(), /não pode ser desfeito/);
  await page.click('.dlg .dlg-x');
  assert.equal(await r, false, 'o ✕ responde como Cancelar');
  assert.equal(await page.locator('.dlg-fundo').count(), 0);
  // pedirValor: o ✕ devolve null
  const v = page.evaluate(() => pedirValor('Qual é a marca?', { valor: 'X' }));
  await page.click('.dlg .dlg-x');
  assert.equal(await v, null);
  // campos e botões com a altura do padrão
  await irPara(page, 'produtos');
  const alt = await page.evaluate(() => [...document.querySelectorAll('#app input:not([type=checkbox]):not([type=file]), #app button.primary:not(.sm)')].filter(e => e.offsetParent).map(e => Math.round(e.getBoundingClientRect().height)));
  assert.ok(alt.length && alt.every(h => h === 36), 'campos e botões principais com 36px: ' + alt.join(','));
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
