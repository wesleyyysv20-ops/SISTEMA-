import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, exemplo, base, fechar, salvarDepois, lerXlsx, valor, n, ns } from '../ajuda.mjs';

after(fechar);

test('arquivo do DataCar: conferência por grupo leva só os grupos marcados', async () => {
  const s = await abrir(base());
  const { page } = s;
  await page.click('nav [data-route=nova]');
  await page.setInputFiles('[data-import-datacar]', exemplo('datacar.csv'));
  await page.waitForSelector('#dlgDataCar');
  assert.equal(await page.locator('.conf-grupo').count(), 5, '4 grupos (08, 17, 23, sem OBS) + linha Concluir');
  await page.keyboard.press('ArrowRight'); // grupo 08 vai
  await page.keyboard.press('ArrowLeft'); // grupo 17 não vai
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // Enter 2x adiciona
  const linhas = await page.locator('[data-item-linha]').allInnerTexts().then(ns);
  assert.equal(linhas.length, 2);
  assert.match(linhas[0], /GP30562[\s\S]*AMORTECEDOR DIANT/);
  assert.match(linhas[1], /PR9125STD[\s\S]*ANEIS PISTAO STD/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('itens repetidos (mesmo código) aparecem no painel e dá para tirar só um', async () => {
  const s = await abrir(base());
  const { page } = s;
  await page.click('nav [data-route=nova]');
  await page.setInputFiles('[data-import-datacar]', exemplo('repetidos.csv'));
  await page.waitForSelector('#dlgDataCar');
  for (let k = 0; k < 5; k++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-item-linha]').count(), 5);
  const painel = await page.locator('.painel-dup').innerText().then(n);
  assert.match(painel, /2527/);
  assert.match(painel, /UB152/);
  await page.click('.painel-dup [data-act=removerItem] >> nth=0');
  assert.equal(await page.locator('[data-item-linha]').count(), 4, 'tira só o item escolhido');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('criar cotação salva a planilha no modelo COTAÇÃO GERAL DISPPAR', async () => {
  const s = await abrir(base({ fornecedores: [{ id: 'f1', nome: 'Auto Mix', email: 'a@x.com' }] }));
  const { page } = s;
  await page.click('nav [data-route=nova]');
  await page.setInputFiles('[data-import-datacar]', exemplo('repetidos.csv'));
  await page.waitForSelector('#dlgDataCar');
  for (let k = 0; k < 5; k++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const arq = await salvarDepois(s, () => page.click('[data-act=criarCotacao]'));
  assert.match(arq.nome, /^Cotacao_\d{4}\.xlsx$/);
  const wb = await lerXlsx(arq.buffer);
  const ws = wb.getWorksheet('Cotação');
  assert.equal(valor(ws.getCell('A1')), 'COTAÇÃO GERAL DISPPAR');
  assert.equal(valor(ws.getCell('F1')), 'QTDE DE ITENS:');
  assert.equal(valor(ws.getCell('G1')), 5);
  assert.ok(ws.getCell('H1').value instanceof Date);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(c => valor(ws.getRow(2).getCell(c))),
    ['SEQ', 'CÓDIGO DO PRODUTO', 'SIMILAR', 'MARCA EXIGIDA', 'QTD', 'DESCRIÇÃO', 'VALOR', 'MARCA']);
  for (let r = 3; r < 8; r++) {
    assert.equal(valor(ws.getCell(`A${r}`)), String(r - 2));
    assert.equal(valor(ws.getCell(`E${r}`)), 1, 'QTD sempre 1');
    assert.equal(valor(ws.getCell(`H${r}`)), 'INFORMAR MARCA');
  }
  assert.equal(ws.getCell('A1').fill.fgColor.argb, 'FFA6CAEC');
  assert.equal(ws.getCell('F1').fill.fgColor.argb, 'FFC04F15');
  assert.equal(ws.getCell('G3').fill.fgColor.argb, 'FFE8E8E8', 'VALOR em cinza claro');
  assert.equal(ws.getCell('H3').fill.fgColor.argb, 'FFAEAEAE');
  assert.equal(ws.getCell('H3').font.bold, true);
  const meta = wb.getWorksheet('_dados');
  assert.equal(valor(meta.getCell('A1')), 'sistema-cotacao');
  // a cotação foi criada
  await page.click('nav [data-route=cotacoes]');
  assert.equal(await page.locator('#tbCot tr').count(), 1);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
