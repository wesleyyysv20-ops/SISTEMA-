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
  // TESTE-A1 já está na cotação: nem aparece
  const grupos = await page.locator('.conf-grupo[data-g-idx]:not(.conf-concluir) .cg-obs b').allInnerTexts();
  assert.deepEqual(grupos, ['SPRAY TESTE', 'TESTE-B2']);
  assert.match(await page.locator('.conf-lote').innerText(), /1 já estava\(m\) na cotação \(não aparecem aqui\)/);
  assert.equal(await page.evaluate(() => ui.datacar.linhas.length), 2, 'o que já está na cotação nem entra na lista');
  assert.match(await page.locator('.conf-numeros').innerText(), /de 2\b/);
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

test('papelzinhos: se tudo já está na cotação, avisa e não abre a conferência', async () => {
  const s = await abrir(base({
    produtos: [{ id: 'pa', codigo: 'TESTE-A1', descricao: 'BOMBA', marca: 'URBA' }, { id: 'pb', codigo: 'TESTE-B2', descricao: 'CORREIA', marca: 'GATES' }, { id: 'pc', codigo: 'SPRAY TESTE', descricao: 'SPRAY', marca: 'X' }],
    rascunho: { titulo: 'X', prazoResposta: '2099-12-31', obs: '', fornecedorIds: [], itens: [{ produtoId: 'pa' }, { produtoId: 'pb' }, { produtoId: 'pc' }] },
  }));
  const { page } = s;
  await page.click('nav [data-route=nova]');
  await page.setInputFiles('[data-import-papel]', exemplo('papelzinhos.ods'));
  assert.match(await page.locator('.dlg').innerText(), /Todos os 3 item\(ns\) dos papelzinhos já estão na cotação/);
  await page.click('.dlg button.primary');
  assert.equal(await page.locator('#dlgDataCar').count(), 0);
  assert.match(await page.locator('.papel-box').innerText(), /0 acrescentado\(s\) · 3 já estava\(m\)/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('papelzinhos: código editável; a correção vai para o cadastro e não repete o que já existe', async () => {
  const s = await abrir(base({
    produtos: [
      { id: 'pe', codigo: 'GP30313/AMD30313', descricao: 'AMORTECEDOR DIANTEIRO', marca: 'COFAP' },
      { id: 'pf', codigo: 'F990', descricao: 'FILTRO AR', marca: 'TECFIL' },
      { id: 'n1', codigo: '7092DA5', descricao: '7092DA5', marca: '' },
      { id: 'n2', codigo: 'GP3031', descricao: 'GP3031', marca: '' },
      { id: 'n3', codigo: 'F99', descricao: 'F99', marca: '' },
    ],
    rascunho: { titulo: 'X', prazoResposta: '2099-12-31', obs: '', fornecedorIds: [], papelzinhos: { arquivo: 'p.ods', adicionados: 3, jaEstavam: 0 }, itens: [
      { produtoId: 'pf', obsArquivo: ['10'] },
      { produtoId: 'n1', papelzinho: true, novoCadastro: true },
      { produtoId: 'n2', papelzinho: true, novoCadastro: true },
      { produtoId: 'n3', papelzinho: true, novoCadastro: true },
    ] },
  }));
  const { page } = s;
  await page.click('nav [data-route=nova]');
  assert.equal(await page.locator('[data-codigo-papel]').count(), 3, 'só os papelzinhos têm o código editável');
  // 1) código incompleto, que não existe: corrige o próprio cadastro
  await page.fill('[data-codigo-papel][value="7092DA5"]', '7092da50');
  await page.press('[data-codigo-papel][value="7092DA5"]', 'Tab');
  assert.equal(await page.evaluate(() => db.produtos.find(p => p.id === 'n1').codigo), '7092DA50');
  // 2) o código certo já existe no cadastro: o item vira o produto de lá e o cadastro provisório sai
  await page.fill('[data-codigo-papel][value="GP3031"]', 'GP30313');
  await page.press('[data-codigo-papel][value="GP3031"]', 'Tab');
  let r = await page.evaluate(() => ({ ids: rascunho().itens.map(x => x.produtoId), temN2: db.produtos.some(p => p.id === 'n2') }));
  assert.ok(r.ids.includes('pe'));
  assert.equal(r.temN2, false, 'não repete o cadastro');
  // 3) o código certo já está na cotação: junta (o item some da lista)
  await page.fill('[data-codigo-papel][value="F99"]', 'F990');
  await page.press('[data-codigo-papel][value="F99"]', 'Tab');
  r = await page.evaluate(() => ({ ids: rascunho().itens.map(x => x.produtoId), temN3: db.produtos.some(p => p.id === 'n3') }));
  assert.deepEqual(r.ids.filter(id => id === 'pf').length, 1);
  assert.equal(r.ids.length, 3);
  assert.equal(r.temN3, false);
  assert.match(await page.locator('#toast').innerText(), /F990 já estava na cotação/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
