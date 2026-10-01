import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrir, base, fechar, item, forn, cotacao, salvarDepois, lerXlsx } from '../ajuda.mjs';

after(fechar);

test('preço corrigido no fornecedor: o aviso "confira o preço" do item fica aceito', async () => {
  const s = await abrir(base({
    cotacoes: [cotacao('c1', '0058', '2026-09-30', 'aberta', [item('A', 'LAMPADA', 'QUALQUER', { codigo: 'H4' }), item('B', 'FUSIVEL', 'QUALQUER', { codigo: 'F10' })], [
      forn('f1', 'KAIZEN', { 0: { preco: 1.2, marca: 'PHILIPS' }, 1: { preco: 1, marca: 'X' } }),
      forn('f2', 'ENVIA PEÇAS', { 0: { preco: 3.69, marca: 'OSRAM' }, 1: { preco: 2.5, marca: 'X' } }),
    ])],
  }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const chip = i => page.locator(`.chip-alerta-dif[data-i="${i}"]`);
  assert.equal(await chip(0).count(), 1);
  assert.equal(await chip(1).count(), 1);
  // corrige o preço da KAIZEN (1,20 → 1,60): ainda passa de 100%, mas foi você que corrigiu
  const feito = page.evaluate(() => alterarPrecoResposta(db.cotacoes[0], 0, 0));
  await page.fill('#dlgCampo', '1,60');
  await page.click('.dlg button.primary');
  await feito;
  assert.equal(await page.evaluate(() => db.cotacoes[0].fornecedores[0].respostas[0].preco), 1.6);
  assert.equal(await chip(0).count(), 0, 'o item corrigido não fica pendente');
  assert.equal(await page.evaluate(() => comparar(db.cotacoes[0]).linhas[0].difConferida), true);
  assert.equal(await chip(1).count(), 1, 'o outro item continua pedindo conferência');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('planilha nova do fornecedor com o preço corrigido: o aviso do item também fica aceito', async () => {
  const s = await abrir(base({
    fornecedores: [{ id: 'f1', nome: 'KAIZEN' }, { id: 'f2', nome: 'ENVIA PEÇAS' }],
    cotacoes: [cotacao('c1', '0058', '2026-09-30', 'aberta', [item('A', 'LAMPADA', 'QUALQUER', { codigo: 'H4' }), item('B', 'FUSIVEL', 'QUALQUER', { codigo: 'F10' })], [
      forn('f1', 'KAIZEN', { 0: { preco: 1.2, marca: 'PHILIPS' }, 1: { preco: 1, marca: 'X' } }),
      forn('f2', 'ENVIA PEÇAS', { 0: { preco: 3.69, marca: 'OSRAM' }, 1: { preco: 2.5, marca: 'X' } }),
    ])],
  }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const arq = await salvarDepois(s, () => page.click('details.menu-acoes:has([data-act=baixarPlanilha][data-f="0"]) > summary').then(() => page.click('[data-act=baixarPlanilha][data-f="0"]')));
  const wb = await lerXlsx(arq.buffer);
  const ws = wb.getWorksheet('Cotação');
  ws.getCell('G3').value = 1.6; ws.getCell('H3').value = 'PHILIPS'; // corrigido (ainda +130%)
  ws.getCell('G4').value = 1; ws.getCell('H4').value = 'X'; // igual
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dif-')), 'kaizen.xlsx');
  await wb.xlsx.writeFile(f);
  await page.setInputFiles('[data-import="0"]', f);
  await page.click('.dlg:has-text("Substituir") button.primary'); // já tinha preços: substituir pelos da planilha
  await page.waitForFunction(() => db.cotacoes[0].fornecedores[0].respostas[0]?.preco === 1.6);
  assert.equal(await page.locator('.chip-alerta-dif[data-i="0"]').count(), 0, 'preço corrigido: aceito');
  assert.equal(await page.locator('.chip-alerta-dif[data-i="1"]').count(), 1, 'preço igual: continua pedindo conferência');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
