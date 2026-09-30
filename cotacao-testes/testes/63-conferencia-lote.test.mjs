import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrir, base, fechar } from '../ajuda.mjs';

after(fechar);

// 8 grupos de 1 item cada (como o arquivo real: quase todo grupo tem 1 item)
const linhas = [['A1', 'SENSOR OXIGENIO', '01'], ['A2', 'TERMINAL DIRECAO', '02'], ['B1', 'CILINDRO RODA', '08'], ['B2', 'CILINDRO RODA TRAS', '09'],
  ['C1', 'HIGIENIZADOR AR', '11'], ['C2', 'HIGIENIZADOR AR LIMAO', '12'], ['D1', 'BICO INJETOR', '15'], ['D2', 'FLEXIVEL FREIO', '16']];
const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dc-')), 'lote.csv');
fs.writeFileSync(arq, 'Código;Descrição;OBS\n' + linhas.map(l => l.join(';')).join('\n'));

async function abrirConf() {
  const s = await abrir(base());
  await s.page.click('nav [data-route=nova]');
  await s.page.setInputFiles('[data-import-datacar]', arq);
  await s.page.waitForSelector('#dlgDataCar');
  return s;
}
const decisoes = page => page.evaluate(() => todosDataCar().map(l => l.decisao || '-').join(''));

test('conferência: Shift+↓ seleciona vários e → decide todos; Ctrl+A e "todos os sem decisão"', async () => {
  const s = await abrirConf();
  const { page } = s;
  assert.equal(await page.locator('.conf-grupo[data-g-idx]:not(.conf-concluir)').count(), 8);
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  assert.match(await page.locator('.conf-lote').innerText(), /3 grupo\(s\) selecionado\(s\) · 3 item/);
  await page.keyboard.press('ArrowRight');
  assert.equal(await decisoes(page), 'vaivaivai-----');
  // Shift+clique: faixa
  await page.locator('.conf-grupo[data-g-idx="4"] .cg-amostra').click();
  await page.locator('.conf-grupo[data-g-idx="5"] .cg-amostra').click({ modifiers: ['Shift'] });
  await page.click('[data-act=dcSelNao]');
  assert.equal(await decisoes(page), 'vaivaivai-naonao--');
  // os que faltam: todos vão (com confirmação)
  await page.click('[data-act=dcRestVai]');
  assert.match(await page.locator('.dlg-fundo:not(#dlgDataCar) .dlg').innerText(), /3 grupo\(s\) sem decisão, 3 item/);
  await page.click('.dlg-fundo:not(#dlgDataCar) .dlg button.primary');
  assert.equal(await decisoes(page), 'vaivaivaivainaonaovaivai');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('conferência: busca por OBS/descrição/código e filtro "só sem decisão"', async () => {
  const s = await abrirConf();
  const { page } = s;
  const vis = () => page.locator('.conf-grupo[data-g-idx]:not(.conf-concluir)').count();
  // digitar na lista vai para a busca
  await page.keyboard.type('higien');
  assert.equal(await page.inputValue('#dcBusca'), 'higien');
  assert.equal(await vis(), 2);
  // Enter vai para a lista; Ctrl+A seleciona só os que aparecem
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await decisoes(page), '----naonao--');
  // busca por código
  await page.fill('#dcBusca', 'd2');
  assert.equal(await vis(), 1);
  await page.fill('#dcBusca', '');
  assert.equal(await vis(), 8);
  await page.check('#dcSoPend');
  assert.equal(await vis(), 6, 'os 2 já decididos somem');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
