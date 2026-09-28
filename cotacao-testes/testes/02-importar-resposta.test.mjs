import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  return salvarDepois(s, () => s.page.click(`[data-act=baixarPlanilha][data-f="${fi}"]`));
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
