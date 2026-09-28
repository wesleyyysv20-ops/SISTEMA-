import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { abrir, base, fechar, exemplo, item, forn, cotacao, irPara, n, ns } from '../ajuda.mjs';

after(fechar);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disppar-'));

test('marca exigida no padrão do DISPPAR: QUALQUER, SÓ X e listas com hífen', async () => {
  const s = await abrir(base());
  const casos = [
    ['QUALQUER', 'BOSCH', null], ['KIT CIA QUALQUER', 'X', null], ['APLIC QUALQUER', 'Y', null],
    ['SÓ COFAP', 'COFAP', 'ok'], ['SÓ COFAP', 'COF', 'abrev'], ['SÓ COFAP', 'MONROE', 'errada'],
    ['ALB-NAK-KAY-PERF-MONR', 'NAKATA', 'abrev'], ['ALB-NAK-KAY-PERF-MONR', 'MONROE', 'abrev'], ['ALB-NAK-KAY-PERF-MONR', 'COFAP', 'errada'],
    ['CONT-DAY-GAT', 'GATES', 'abrev'], ['WAHLER-.MTE', 'MTE-THOMSON', 'abrev'], ['VISCONDE - VALEO', 'VALEO', 'ok'],
    ['AX-TRW-NAK-SKF-COF', 'AXIOS', 'abrev'], ['AX-TRW-NAK-SKF-COF', 'SABO', 'errada'], ['SÓ NGK', 'NGK', 'ok'],
  ];
  const r = await s.page.evaluate(cs => cs.map(([p, x]) => statusMarca(p, x)), casos);
  assert.deepEqual(r, casos.map(c => c[2]));
  // no pedido vai a marca por extenso, sem o "SÓ"
  assert.equal(await s.page.evaluate(() => marcaPedido('SÓ COFAP', 'COF', 'abrev')), 'COFAP');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('DataCar: sugestão pela OBS (CORTAR, OK, VERIFICAR) e aplicar sugestões', async () => {
  const s = await abrir(base());
  const { page } = s;
  await page.click('nav [data-route=nova]');
  await page.setInputFiles('[data-import-datacar]', exemplo('obs-regras.csv'));
  await page.waitForSelector('#dlgDataCar');
  const sugs = await page.locator('.conf-grupo .cg-obs').allInnerTexts();
  assert.ok(sugs.some(t => /08 CORTAR[\s\S]*sugestão: não vai/.test(t)));
  assert.ok(sugs.some(t => /OK 12[\s\S]*sugestão: vai/.test(t)));
  assert.ok(sugs.some(t => /VERIFICAR PRECO[\s\S]*revisar/.test(t)));
  await page.click('[data-act=dcSugestoes]');
  assert.match(await page.locator('.conf-numeros').innerText(), /1 itens? vão?|✓ 1/);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const linhas = await page.locator('[data-item-linha]').allInnerTexts();
  assert.equal(linhas.length, 1);
  assert.match(linhas[0], /A-2/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('colar lista de códigos (aba MONTAGEM) e importar a aba BANCO DE DADOS', async () => {
  // banco no formato da planilha COTAÇÃO COMPLETA: título na linha 1, cabeçalho na 2
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('PLANILHA').getCell('A1').value = 'outra aba';
  const ws = wb.addWorksheet('BANCO DE DADOS');
  ws.addRow(['BANCO DE DADOS']);
  ws.addRow(['CÓDIGO', 'SIMILAR', 'MARCA EXIGIDA', 'DESCRIÇÃO']);
  ws.addRow(['27321/HG33036', 'ALB9144', 'SÓ NAKATA', 'AMORTECEDOR DIANTEIRO']);
  ws.addRow(['GB48167', '', 'SÓ COFAP', 'AMORTECEDOR TRASEIRO']);
  const f = path.join(tmp, 'COTACAO COMPLETA.xlsx');
  await wb.xlsx.writeFile(f);
  const s = await abrir(base());
  const { page } = s;
  await irPara(page, 'produtos');
  await page.setInputFiles('[data-import-produtos]', f);
  await page.waitForFunction(() => db.produtos.length === 2);
  assert.deepEqual(await page.evaluate(() => db.produtos.map(p => [p.codigo, p.similar, p.marca, p.descricao])), [
    ['27321/HG33036', 'ALB9144', 'SÓ NAKATA', 'AMORTECEDOR DIANTEIRO'], ['GB48167', '', 'SÓ COFAP', 'AMORTECEDOR TRASEIRO']]);
  await irPara(page, 'nova');
  await page.click('.colar-codigos summary');
  await page.fill('#colarCodigos', 'CÓDIGO DO PRODUTO\n27321/HG33036\ngb48167\t1\nNOVO-9\n27321/HG33036');
  await page.click('[data-act=colarCodigos]');
  assert.match(n(await page.locator('.dlg p').innerText()), /2 encontrado\(s\) no banco[\s\S]*1 novo\(s\) cadastrado\(s\) sem descrição: NOVO-9[\s\S]*1 já estava/);
  await page.click('.dlg button');
  assert.equal(await page.locator('[data-item-linha]').count(), 3);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('dúvidas: do comparativo para a fila, texto no formato do WhatsApp', async () => {
  const s = await abrir(base({
    cotacoes: [cotacao('c1', '0012', '2026-09-20', 'aberta', [item('P1', 'AMORTECEDOR', 'SÓ COFAP', { codigo: 'GP30562' })], [
      forn('f1', 'Auto Mix', { 0: { preco: 120.5, marca: 'MONROE' } })], { qtds: { 0: { 'sao-sebastiao': 2, paranoa: 1 } } })],
  }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.click('[data-act=duvidaItem][data-i="0"]');
  assert.match(await page.locator('#nav a[data-route=duvidas]').innerText(), /Dúvidas\s*2/);
  await irPara(page, 'duvidas');
  await page.click('[data-act=editarDuvida] >> nth=1');
  await page.fill('[data-form=duvida] [name=obs]', 'marca diferente');
  await page.click('[data-form=duvida] button.primary');
  const texto = n(await page.locator('#textoDuvidas').innerText());
  assert.equal(texto, [
    'Segue a relação dos itens em dúvida para avaliação:',
    '- *GP30562*\nR$ 120,50 - MONROE\n*PEDE 2 DSS ?*',
    '- *GP30562. MARCA DIFERENTE*\nR$ 120,50 - MONROE\n*PEDE 1 DPR ?*',
  ].join('\n\n'));
  // item manual
  await page.selectOption('[data-form=duvida] [name=empresa]', 'N/A');
  await page.fill('[data-form=duvida] [name=codigo]', 'x-9');
  await page.fill('[data-form=duvida] [name=valor]', '10');
  await page.click('[data-form=duvida] button.primary');
  assert.match(n(await page.locator('#textoDuvidas').innerText()), /- \*X-9\*\nR\$ 10,00 - -\n\*PEDE 1 \?\*$/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('início: pendências de todas as cotações com atalho para cada uma', async () => {
  const s = await abrir(base({
    cotacoes: [
      cotacao('c1', '0013', '2026-09-20', 'aberta', [item('P1', 'X')], [forn('f1', 'Auto Mix')]),
      cotacao('c2', '0014', '2026-09-21', 'aberta', [item('P1', 'X')], [forn('f1', 'Auto Mix', { 0: { preco: 10 } })]),
    ],
  }));
  const { page } = s;
  await irPara(page, 'inicio');
  const pend = await page.locator('.lista-pend li').allInnerTexts().then(ns);
  assert.ok(pend.some(t => /Cotação nº 0013: 1 fornecedor\(es\) ainda sem a planilha/.test(t)));
  assert.ok(pend.some(t => /Cotação nº 0014: respostas chegaram, faltam as quantidades das lojas/.test(t)));
  await page.click('.lista-pend li:has-text("0014") a');
  assert.match(await page.locator('#app h2').first().innerText(), /Cotação nº 0014/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
