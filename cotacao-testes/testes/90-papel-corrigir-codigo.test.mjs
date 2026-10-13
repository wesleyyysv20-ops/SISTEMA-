import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, exemplo, n } from '../ajuda.mjs';

after(fechar);

test('papelzinhos: corrigir o código na conferência (F4) antes de entrar na cotação', async () => {
  const s = await abrir(base({
    produtos: [{ id: 'pa', codigo: 'TESTE-A1', descricao: 'BOMBA AGUA', marca: 'URBA' }, { id: 'pb', codigo: 'TESTE-B2', descricao: 'CORREIA', marca: 'GATES' }, { id: 'pc', codigo: 'SPRAY-300', descricao: 'SPRAY SELANTE 300ML', marca: 'TEKBOND' }],
    rascunho: { titulo: 'X', prazoResposta: '2099-12-31', obs: '', fornecedorIds: [], itens: [{ produtoId: 'pa', obsArquivo: ['15'] }] },
  }));
  const { page } = s;
  await page.click('nav [data-route=nova]');
  await page.setInputFiles('[data-import-papel]', exemplo('papelzinhos.ods'));
  await page.waitForSelector('#dlgDataCar');
  // "SPRAY TESTE" foi digitado errado no papel: o certo é SPRAY-300 (que está no cadastro)
  await page.locator('.conf-grupo:has-text("SPRAY TESTE") [data-act=dcGAbrir]').click();
  assert.match(n(await page.locator('.conf-card').innerText()), /não cadastrado/);
  await page.keyboard.press('F4');
  await page.fill('.dlg-fundo:not(#dlgDataCar) input', 'spray-300');
  await page.click('.dlg-fundo:not(#dlgDataCar) button.primary');
  const card = n(await page.locator('.conf-card').innerText());
  assert.match(card, /SPRAY-300/);
  assert.match(card, /Cadastro: SPRAY-300 · SPRAY SELANTE 300ML/);
  assert.match(card, /Corrigido — no arquivo estava SPRAY TESTE/);
  await page.click('[data-act=dcDecidir][data-d=vai]');
  await page.click('[data-act=dcRestVai]');
  await page.click('.dlg-fundo:not(#dlgDataCar) .dlg button.primary');
  await page.click('[data-act=dcAdicionar]');
  const r = await page.evaluate(() => {
    const prod = Object.fromEntries(db.produtos.map(p => [p.id, p]));
    return { itens: rascunho().itens.map(x => [prod[x.produtoId].codigo, x.codigoArquivo || '']), produtos: db.produtos.length };
  });
  assert.ok(r.itens.some(([c, a]) => c === 'SPRAY-300' && a === 'SPRAY-300'), JSON.stringify(r.itens));
  assert.equal(r.produtos, 3, 'não cadastrou um produto repetido');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
