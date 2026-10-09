import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, ns } from '../ajuda.mjs';

after(fechar);

const prod = (id, codigo, descricao, extra = {}) => ({ id, codigo, descricao, unidade: 'UN', marca: 'QUALQUER', categoria: '', ...extra });
const csv = linhas => ({ name: 'datacar.csv', mimeType: 'text/csv', buffer: Buffer.from('Código;Descrição;Fabricante;OBS\n' + linhas.join('\n'), 'utf8') });

test('a descrição respeita o código: similar de outra peça não liga; código igual com cadastro errado avisa', async () => {
  const s = await abrir(base({ produtos: [
    prod('p1', 'FA-100', 'FILTRO DE AR', { similar: 'PF8 PF9' }),   // similar "PF8" é a mesma sequência do código da porca
    prod('p2', 'VL-200', 'FILTRO DE AR CONDICIONADO'),             // cadastro errado: VL-200 é uma vela
    prod('p3', 'AM-300', 'AMORTECEDOR DIANT DIR', { similar: 'AMX300' }),
  ] }));
  const { page } = s;
  await page.click('nav [data-route=nova]');
  await page.setInputFiles('[data-import-datacar]', csv(['PF8;PORCA FLANGE M8;XYZ;01', 'VL-200;VELA IGNICAO;NGK;01', 'AMX300;AMORT DIANT;COFAP;01']));
  await page.waitForSelector('#dlgDataCar');
  const casou = await page.evaluate(() => Object.fromEntries(ui.datacar.linhas.map(l => [l.codigo, [l.produtoId, l.descDiverge]])));
  assert.deepEqual(casou.PF8, [null, ''], 'porca não vira filtro de ar (o similar é de outra peça)');
  assert.deepEqual(casou['VL-200'], ['p2', 'VELA IGNICAO'], 'código igual: liga, mas com o aviso');
  assert.deepEqual(casou.AMX300, ['p3', ''], 'similar da mesma peça continua valendo');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const linhas = await page.locator('[data-item-linha]').allInnerTexts().then(ns);
  assert.equal(linhas.length, 3);
  const txt = linhas.join('\n');
  assert.match(txt, /PF8[\s\S]*PORCA FLANGE M8/);
  assert.doesNotMatch(linhas.find(l => /PF8/.test(l)), /FILTRO/);
  assert.match(txt, /VL-200[\s\S]*VELA IGNICAO[\s\S]*⚠ cadastro: FILTRO DE AR CONDICIONADO/);
  // corrigir o cadastro com a descrição do DataCar
  await page.click('[data-act=corrigirDescCadastro]');
  assert.equal(await page.evaluate(() => db.produtos.find(p => p.id === 'p2').descricao), 'VELA IGNICAO');
  assert.equal(await page.locator('.desc-diverge').count(), 0);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('descricoesCombinam: mesma peça mesmo abreviada; peças diferentes não', async () => {
  const s = await abrir(base({}));
  const r = await s.page.evaluate(() => [
    descricoesCombinam('AMORT DIANT', 'AMORTECEDOR DIANT DIR (TURBOGAS)'),
    descricoesCombinam('PORCA FLANGE', 'FILTRO DE AR'),
    descricoesCombinam('', 'FILTRO DE AR'),
    descricoesCombinam('FILTRO AR', 'FILTRO DE AR MOTOR'),
  ]);
  assert.deepEqual(r, [true, false, true, true]);
  await s.fechar();
});

test('duas linhas com códigos diferentes que casam com o mesmo produto viram dois itens (nenhum código some)', async () => {
  const s = await abrir(base({ produtos: [prod('p1', 'GP30521', 'AMORTECEDOR DIANT ESQ')] }));
  const { page } = s;
  await page.click('nav [data-route=nova]');
  await page.setInputFiles('[data-import-datacar]', csv(['GP30521/AMD16637;AMORTECEDOR DIANT ESQ TURBOGAS;PERFECT;01', 'GP30521;AMORTECEDOR DIANT ESQ;COFAP;02']));
  await page.waitForSelector('#dlgDataCar');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const cods = await page.evaluate(() => rascunho().itens.map(x => x.codigoArquivo));
  assert.deepEqual(cods.sort(), ['GP30521', 'GP30521/AMD16637']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
