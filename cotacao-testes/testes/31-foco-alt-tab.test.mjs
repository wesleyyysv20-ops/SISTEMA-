import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

const itens = ['A', 'B', 'C'].map(x => item('P' + x, 'PECA ' + x, 'QUALQUER', { codigo: 'COD-' + x }));

test('quantidade: o cursor continua no campo ao sair e voltar para a janela (Alt+Tab) e ao redesenhar', async () => {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0031', '2026-09-28', 'aberta', itens, [forn('f1', 'KAIZEN', { 0: { preco: 10 }, 1: { preco: 20 }, 2: { preco: 5 } })])] }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const campo = '.qtd-loja[data-i="1"][data-qtd-loja="sao-sebastiao"]';
  await page.click(campo);
  await page.keyboard.type('12');
  const focado = () => page.evaluate(() => { const a = document.activeElement; return a?.matches('.qtd-loja') ? `${a.dataset.i}/${a.dataset.qtdLoja}/${a.selectionStart}` : a?.tagName; });
  assert.equal(await focado(), '1/sao-sebastiao/2');

  // chega alteração da nuvem enquanto a tela é redesenhada: o cursor fica onde estava
  await page.evaluate(() => render());
  assert.equal(await focado(), '1/sao-sebastiao/2');

  // Alt+Tab: a janela perde o foco (o campo recebe "blur") e depois volta
  await page.evaluate(() => {
    document.hasFocus = () => false;
    document.activeElement.dispatchEvent(new FocusEvent('blur'));
    renderSeguro();
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => { delete document.hasFocus; window.dispatchEvent(new FocusEvent('focus')); });
  await page.waitForTimeout(50);
  assert.equal(await focado(), '1/sao-sebastiao/2');
  await page.keyboard.type('3');
  assert.equal(await page.evaluate(() => db.cotacoes[0].qtds[1]['sao-sebastiao']), 123);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
