import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { abrir, base, fechar, salvarDepois, lerXlsx, item, forn, cotacao, n, ns } from '../ajuda.mjs';

after(fechar);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cotacao-'));

const dados = () => base({
  fornecedores: [{ id: 'f1', nome: 'Auto Mix' }, { id: 'f2', nome: 'Via Peças' }],
  cotacoes: [cotacao('c1', '0007', '2026-09-20', 'aberta',
    [item('A1', 'ROLAMENTO', 'NSK'), item('B2', 'PASTILHA'), item('C3', 'FILTRO')],
    [forn('f1', 'Auto Mix')])],
});

async function planilhaDoFornecedor(s, fi) {
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return salvarDepois(s, () => s.page.click(`details.menu-acoes:has([data-act=baixarPlanilha][data-f="${fi}"]) > summary`).then(() => s.page.click(`[data-act=baixarPlanilha][data-f="${fi}"]`)));
}

test('importa a planilha devolvida pelo fornecedor (VALOR e MARCA)', async () => {
  const s = await abrir(dados());
  const arq = await planilhaDoFornecedor(s, 0);
  const wb = await lerXlsx(arq.buffer);
  const ws = wb.getWorksheet('Cotação');
  ws.getCell('G3').value = 99.9; ws.getCell('H3').value = 'SKF';
  ws.getCell('G4').value = '45,50'; // H4 fica "INFORMAR MARCA"
  const f = path.join(tmp, 'resposta.xlsx');
  await wb.xlsx.writeFile(f);
  await s.page.setInputFiles('[data-import="0"]', f);
  await s.page.waitForFunction(() => /importado/.test(document.querySelector('#toast')?.innerText || ''));
  const cel = await s.page.locator('.tab-comp tbody tr').first().innerText().then(n);
  assert.match(cel, /99,90/);
  assert.match(cel, /SKF/);
  assert.match(await s.page.locator('#toast').innerText().then(n), /2 preço\(s\) importado\(s\) de Auto Mix/);
  const marcas = await s.page.evaluate(() => Object.values(cotAtual().fornecedores[0].respostas).map(r => r.marca));
  assert.deepEqual(marcas, ['SKF', ''], '"INFORMAR MARCA" não preenchido vira marca vazia');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('planilha geral sem nome de fornecedor pergunta de quem é', async () => {
  const s = await abrir(dados());
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  const arq = await salvarDepois(s, () => s.page.click('[data-act=baixarGeral]'));
  const wb = await lerXlsx(arq.buffer);
  wb.getWorksheet('Cotação').getCell('G3').value = 10;
  const f = path.join(tmp, 'geral.xlsx');
  await wb.xlsx.writeFile(f);
  await s.page.setInputFiles('[data-import-cot]', f);
  await s.page.waitForSelector('#dlgCampo');
  await s.page.fill('#dlgCampo', 'Via Peças');
  await s.page.keyboard.press('Enter');
  await s.page.waitForFunction(() => /Via Peças/.test(document.querySelector('#toast')?.innerText || ''));
  const nomes = await s.page.locator('section.card table').first().locator('tbody tr td:nth-child(2) b').allInnerTexts().then(ns);
  assert.deepEqual(nomes, ['Auto Mix', 'Via Peças']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('planilha sem a aba de controle é reconhecida pelo cabeçalho', async () => {
  const s = await abrir(dados());
  const arq = await planilhaDoFornecedor(s, 0);
  const wb = await lerXlsx(arq.buffer);
  wb.removeWorksheet(wb.getWorksheet('_dados').id);
  wb.getWorksheet('Cotação').getCell('G5').value = 7.5;
  const f = path.join(tmp, 'sem-controle.xlsx');
  await wb.xlsx.writeFile(f);
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.setInputFiles('[data-import-geral]', f);
  await s.page.waitForSelector('.dlg select#dlgCampo');
  await s.page.click('.dlg button.primary');
  // o modelo DISPPAR não tem o nome do fornecedor na planilha: sem a aba de controle, o sistema pergunta
  await s.page.waitForSelector('.dlg input#dlgCampo');
  await s.page.fill('#dlgCampo', 'Auto Mix');
  await s.page.keyboard.press('Enter');
  await s.page.waitForFunction(() => /importado/.test(document.querySelector('#toast')?.innerText || ''));
  const linhas = await s.page.locator('.tab-comp tbody tr').allInnerTexts().then(ns);
  assert.match(linhas[2], /7,50/, 'o preço cai na linha certa (item 3)');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('arquivo .xls antigo mostra mensagem explicando como salvar em .xlsx', async () => {
  const s = await abrir(dados());
  const f = path.join(tmp, 'antigo.xls');
  fs.writeFileSync(f, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]));
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.setInputFiles('[data-import-geral]', f);
  await s.page.waitForSelector('.dlg p');
  assert.match(await s.page.locator('.dlg p').innerText().then(n), /formato antigo \.xls/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('resposta no modelo anterior (Item … VALOR, MARCA na linha 11) continua sendo importada', async () => {
  const s = await abrir(dados());
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cotação');
  ws.getCell('A7').value = 'Fornecedor:';
  ws.getCell('C7').value = 'Auto Mix';
  ws.getRow(11).values = ['Item', 'Código', 'Similar', 'QTD', 'Marca', 'Descrição', 'VALOR', 'MARCA'];
  ws.getRow(12).values = [1, 'A1', '', 1, 'NSK', 'ROLAMENTO', 55, 'NSK'];
  ws.getRow(14).values = [3, 'C3', '', 1, '', 'FILTRO', 9.9, 'MANN'];
  const f = path.join(tmp, 'modelo-antigo.xlsx');
  await wb.xlsx.writeFile(f);
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  await s.page.setInputFiles('[data-import-cot]', f);
  await s.page.waitForFunction(() => /importado/.test(document.querySelector('#toast')?.innerText || ''));
  const r = await s.page.evaluate(() => cotAtual().fornecedores[0].respostas);
  assert.deepEqual([r[0].preco, r[0].marca, r[2].preco, r[2].marca], [55, 'NSK', 9.9, 'MANN']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('preço 0,00 ou sem valor é desconsiderado, mesmo com a marca preenchida', async () => {
  const s = await abrir(dados());
  const arq = await planilhaDoFornecedor(s, 0);
  const wb = await lerXlsx(arq.buffer);
  const ws = wb.getWorksheet('Cotação');
  ws.getCell('G3').value = 0; ws.getCell('H3').value = 'SKF'; // marca com preço 0,00
  ws.getCell('G4').value = 45.5; ws.getCell('H4').value = 'COBREQ';
  ws.getCell('H5').value = 'TECFIL'; // marca sem valor
  const f = path.join(tmp, 'resposta-zero.xlsx');
  await wb.xlsx.writeFile(f);
  await s.page.setInputFiles('[data-import="0"]', f);
  await s.page.waitForFunction(() => /importado/.test(document.querySelector('#toast')?.innerText || ''));
  assert.match(await s.page.locator('#toast').innerText().then(n), /1 preço\(s\) importado\(s\) de Auto Mix\. 2 item\(ns\) com preço 0,00 ou sem valor foram desconsiderados/);
  assert.deepEqual(await s.page.evaluate(() => Object.keys(cotAtual().fornecedores[0].respostas)), ['1'], 'só o item com preço fica como resposta');
  // resposta antiga já gravada com 0,00: a célula mostra só "—" (sem a marca)
  await s.page.evaluate(() => { const c = cotAtual(); c.fornecedores[0].respostas[0] = { preco: 0, marca: 'SKF' }; salvar(); render(); });
  const primeira = s.page.locator('.tab-comp tbody tr').first();
  assert.equal(await primeira.locator('.chip-marca').count(), 0);
  assert.doesNotMatch(n(await primeira.innerText()), /SKF/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

/* ---- resposta em .ods (LibreOffice) ---- */
function zipStored(arquivos) {
  const partes = [], central = [];
  let pos = 0;
  for (const [nome, conteudo] of arquivos) {
    const nb = Buffer.from(nome), db = Buffer.from(conteudo);
    const crc = zlib.crc32(db);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(db.length, 18); loc.writeUInt32LE(db.length, 22);
    loc.writeUInt16LE(nb.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(db.length, 20); cd.writeUInt32LE(db.length, 24);
    cd.writeUInt16LE(nb.length, 28); cd.writeUInt32LE(pos, 42);
    partes.push(loc, nb, db); central.push(cd, nb);
    pos += 30 + nb.length + db.length;
  }
  const cdBuf = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(cdBuf.length, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, cdBuf, fim]);
}
const celTxt = t => `<table:table-cell office:value-type="string"><text:p>${t}</text:p></table:table-cell>`;
const celNum = (v, exibido) => `<table:table-cell office:value-type="float" office:value="${v}"><text:p>${exibido}</text:p></table:table-cell>`;
const celVazia = '<table:table-cell/>';
const linhaOds = cels => `<table:table-row>${cels.join('')}</table:table-row>`;
const abaOds = (nome, corpo) => `<table:table table:name="${nome}">${corpo}</table:table>`;
function montarOds(abas) {
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet>${abas.join('')}</office:spreadsheet></office:body></office:document-content>`;
  return zipStored([['mimetype', 'application/vnd.oasis.opendocument.spreadsheet'], ['content.xml', content]]);
}
const cabecalhoOds = linhaOds([celTxt('Item'), celTxt('Código'), celTxt('Similar'), celTxt('QTD'), celTxt('Marca'), celTxt('Descrição'), celTxt('VALOR'), celTxt('MARCA')]);
const linhasVaziasOds = '<table:table-row table:number-rows-repeated="10"><table:table-cell table:number-columns-repeated="8"/></table:table-row>';
const itemOds = (i, cod, preco, exibido, marca) => linhaOds([celNum(i, i), celTxt(cod), celVazia, celNum(1, 1), celVazia, celTxt('X'), preco == null ? celVazia : celNum(preco, exibido), marca ? celTxt(marca) : celVazia]);

async function irParaCotacao(s) {
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
}

test('importa resposta em .ods: linhas vazias repetidas, preço pelo office:value e marca', async () => {
  const s = await abrir(dados());
  const corpo = linhasVaziasOds + cabecalhoOds
    + itemOds(1, 'A1', 55.5, 'R$ 55,50', 'NSK')
    + itemOds(2, 'B2', null, '', '')
    + itemOds(3, 'C3', 9.9, 'R$ 9,90', 'MANN');
  const f = path.join(tmp, 'resposta.ods');
  fs.writeFileSync(f, montarOds([abaOds('Cotação', corpo)]));
  await irParaCotacao(s);
  await s.page.setInputFiles('[data-import="0"]', f);
  await s.page.waitForFunction(() => /importado/.test(document.querySelector('#toast')?.innerText || ''));
  assert.match(await s.page.locator('#toast').innerText().then(n), /2 preço\(s\) importado\(s\) de Auto Mix/);
  const r = await s.page.evaluate(() => { const o = cotAtual().fornecedores[0].respostas; return Object.keys(o).map(k => [k, o[k].preco, o[k].marca]); });
  assert.deepEqual(r, [['0', 55.5, 'NSK'], ['2', 9.9, 'MANN']]);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('importa resposta em .ods com a aba oculta _dados (posição das linhas exata)', async () => {
  const s = await abrir(dados());
  const dadosAba = abaOds('_dados', [
    'sistema-cotacao', 'c1', 'f1', 11, 12, 3, 0, '0007', 4,
  ].map(v => linhaOds([typeof v === 'number' ? celNum(v, v) : celTxt(v)])).join(''));
  const corpo = linhasVaziasOds + cabecalhoOds
    + itemOds(1, 'A1', 12.34, '12,34', '')
    + itemOds(2, 'B2', 20, '20', 'SKF')
    + itemOds(3, 'C3', null, '', '');
  const f = path.join(tmp, 'resposta-meta.ods');
  fs.writeFileSync(f, montarOds([abaOds('Cotação', corpo), dadosAba]));
  await irParaCotacao(s);
  await s.page.setInputFiles('[data-import="0"]', f);
  await s.page.waitForFunction(() => /importado/.test(document.querySelector('#toast')?.innerText || ''));
  const r = await s.page.evaluate(() => { const o = cotAtual().fornecedores[0].respostas; return Object.keys(o).map(k => [k, o[k].preco, o[k].marca]); });
  assert.deepEqual(r, [['0', 12.34, ''], ['1', 20, 'SKF']]);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
