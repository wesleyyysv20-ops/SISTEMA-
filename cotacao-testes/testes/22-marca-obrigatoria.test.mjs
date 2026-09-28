import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { abrir, base, fechar, irPara, exemplo } from '../ajuda.mjs';

after(fechar);

const prod = (id, codigo, descricao, marca) => ({ id, codigo, descricao, marca, similar: '', unidade: 'UN', categoria: '', obs: '' });
const dados = () => base({
  produtos: [
    prod('p1', 'A1', 'AMORTECEDOR', 'SÓ COFAP'), prod('p2', 'B2', 'PASTA DE ESMERILAR', ''), prod('p3', 'C3', 'RELE AUXILIAR', '  '),
    prod('p4', 'D4', 'DISCO FREIO', 'SÓ FREEMAX'), prod('p5', 'E5', 'PASTILHA', 'FREEMAX-COBREQ'), prod('p6', 'F6', 'TAMBOR', 'FREEMAXX'),
  ],
  rascunho: { titulo: '', prazoResposta: '', obs: '', fornecedorIds: [], itens: [{ produtoId: 'p1', quantidade: 1 }, { produtoId: 'p2', quantidade: 1 }] },
});
const codigos = page => page.evaluate(() => db.produtos.map(p => p.codigo));

test('produtos sem marca exigida: aviso e exclusão com confirmação (tira também da cotação em montagem)', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'produtos');
  assert.match(await page.locator('.aviso-recusa').innerText(), /2 produto\(s\) sem marca exigida[\s\S]*B2[\s\S]*C3/);

  await page.click('[data-act=excluirSemMarca]');
  assert.match(await page.locator('.dlg').innerText(), /Excluir do banco 2 produto\(s\)[\s\S]*B2 · PASTA DE ESMERILAR/);
  await page.click('.dlg button:text("Cancelar")');
  assert.equal((await codigos(page)).length, 6);

  await page.click('[data-act=excluirSemMarca]');
  await page.click('.dlg button.danger');
  assert.deepEqual(await codigos(page), ['A1', 'D4', 'E5', 'F6']);
  assert.deepEqual(await page.evaluate(() => db.rascunho.itens.map(x => x.produtoId)), ['p1']);
  assert.match(await page.locator('section:has(h3:text("Limpeza do cadastro"))').innerText(), /Todos os produtos têm marca exigida/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('trocar marca: FREEMAX por FREMAX só como palavra inteira', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'produtos');
  await page.fill('[data-form=trocarMarca] [name=de]', 'freemax');
  await page.fill('[data-form=trocarMarca] [name=para]', 'fremax');
  await page.click('[data-form=trocarMarca] button');
  assert.match(await page.locator('.dlg').innerText(), /Trocar "freemax" por "FREMAX" em 2 produto\(s\)[\s\S]*D4: SÓ FREEMAX → SÓ FREMAX[\s\S]*E5: FREEMAX-COBREQ → FREMAX-COBREQ/);
  await page.click('.dlg button.primary');
  assert.deepEqual(await page.evaluate(() => db.produtos.filter(p => /D4|E5|F6/.test(p.codigo)).map(p => p.marca)), ['SÓ FREMAX', 'FREMAX-COBREQ', 'FREEMAXX']);

  await page.fill('[data-form=trocarMarca] [name=de]', 'freemax');
  await page.fill('[data-form=trocarMarca] [name=para]', 'fremax');
  await page.click('[data-form=trocarMarca] button');
  assert.match(await page.locator('.dlg').innerText(), /Nenhum produto com a marca "freemax"/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('não entra produto novo sem marca: formulário e planilha', async () => {
  const s = await abrir(base());
  const { page } = s;
  await irPara(page, 'produtos');
  await page.fill('[data-form=produto] [name=codigo]', 'X1');
  await page.fill('[data-form=produto] [name=descricao]', 'CORREIA');
  assert.equal(await page.locator('[data-form=produto] [name=marca]').getAttribute('required'), '');
  await page.evaluate(() => document.querySelector('[data-form=produto] [name=marca]').removeAttribute('required'));
  await page.click('[data-form=produto] button.primary');
  assert.match(await page.locator('.dlg').innerText(), /Informe a marca exigida/);
  await page.click('.dlg button');
  assert.equal((await codigos(page)).length, 0);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'marca-'));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BANCO DE DADOS');
  ws.addRow(['CÓDIGO', 'SIMILAR', 'MARCA EXIGIDA', 'DESCRIÇÃO']);
  ws.addRow(['G7', '', 'SÓ NGK', 'VELA']);
  ws.addRow(['H8', '', '', 'LAMPADA']);
  const f = path.join(tmp, 'banco.xlsx');
  await wb.xlsx.writeFile(f);
  await page.setInputFiles('[data-import-produtos]', f);
  await page.waitForSelector('.dlg');
  assert.match(await page.locator('.dlg').innerText(), /1 produto\(s\) novo\(s\)[\s\S]*1 produto\(s\) novo\(s\) sem marca exigida NÃO entraram no banco:\s*H8/);
  assert.deepEqual(await codigos(page), ['G7']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('DataCar: código novo sem marca exigida não entra no banco', async () => {
  const s = await abrir(base());
  const { page } = s;
  await page.click('nav [data-route=nova]');
  await page.setInputFiles('[data-import-datacar]', exemplo('sem-marca.csv'));
  await page.waitForSelector('#dlgDataCar');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const aviso = page.locator('.dlg-fundo:not(#dlgDataCar) .dlg');
  await aviso.waitFor();
  assert.match(await aviso.innerText(), /1 código\(s\) novo\(s\) sem marca exigida: SM-1/);
  assert.deepEqual(await codigos(page), [], 'nada entrou no banco');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
