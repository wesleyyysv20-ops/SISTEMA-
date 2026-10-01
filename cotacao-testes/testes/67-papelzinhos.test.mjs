import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, exemplo } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  produtos: [{ id: 'pa', codigo: 'TESTE-A1', descricao: 'BOMBA AGUA', marca: 'URBA' }, { id: 'pb', codigo: 'TESTE-B2', descricao: 'CORREIA', marca: 'GATES' }],
  rascunho: { titulo: 'X', prazoResposta: '2099-12-31', obs: '', fornecedorIds: [], itens: [{ produtoId: 'pa', obsArquivo: ['15'] }] },
});

test('papelzinhos (.ods): o que já está na cotação não entra; o resto entra com a etiqueta; item novo é cadastrado', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=nova]');
  assert.match(await page.locator('.papel-box').innerText(), /Papelzinhos de São Sebastião[\s\S]*opcional · ainda não importado/);
  await page.setInputFiles('[data-import-papel]', exemplo('papelzinhos.ods'));
  await page.waitForSelector('#dlgDataCar');
  assert.match(await page.locator('#dcTitulo').innerText(), /Papelzinhos de São Sebastião/);
  // TESTE-A1 já está na cotação: decidido como "não vai" e escondido
  const grupos = await page.locator('.conf-grupo[data-g-idx]:not(.conf-concluir) .cg-obs b').allInnerTexts();
  assert.deepEqual(grupos, ['SPRAY TESTE', 'TESTE-B2']);
  assert.match(await page.locator('.conf-lote').innerText(), /1 já estão na cotação/);
  assert.match(await page.locator('.conf-grupo:has-text("TESTE-B2")').innerText(), /CORREIA · GATES · URGENTE/);
  assert.match(await page.locator('.conf-grupo:has-text("SPRAY TESTE")').innerText(), /não cadastrado/);
  // item sem cadastro: abre, dá a descrição e manda
  await page.locator('.conf-grupo:has-text("SPRAY TESTE") [data-act=dcGAbrir]').click();
  await page.fill('[data-dc-desc]', 'SPRAY SELANTE 300ML');
  await page.press('[data-dc-desc]', 'Tab');
  await page.click('[data-act=dcDecidir][data-d=vai]');
  await page.click('[data-act=dcRestVai]');
  await page.click('.dlg-fundo:not(#dlgDataCar) .dlg button.primary');
  await page.click('[data-act=dcAdicionar]');
  const r = await page.evaluate(() => {
    const prod = Object.fromEntries(db.produtos.map(p => [p.id, p]));
    return rascunho().itens.map(x => [prod[x.produtoId].codigo, prod[x.produtoId].descricao, !!x.papelzinho]);
  });
  assert.deepEqual(r.sort(), [['SPRAY TESTE', 'SPRAY SELANTE 300ML', true], ['TESTE-A1', 'BOMBA AGUA', false], ['TESTE-B2', 'CORREIA', true]].sort());
  assert.equal(await page.locator('#tabItens .tag-papel').count(), 2);
  assert.match(await page.locator('.papel-box').innerText(), /papelzinhos\.ods · 2 acrescentado\(s\) · 1 já estava\(m\) na cotação/);
  assert.match(await page.locator('#tiposItens').innerText(), /Papelzinhos\s*2/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
