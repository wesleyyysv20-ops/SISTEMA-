import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
  cotacoes: [cotacao('c1', '0001', '2026-10-10', 'aberta', [item('A', 'VELA', 'QUALQUER', { codigo: 'V1' }), item('B', 'FILTRO', 'QUALQUER', { codigo: 'F1' })], [
    forn('f1', 'KAIZEN', { 0: { preco: 10 }, 1: { preco: 20 } }),
    forn('f2', 'VIA PEÇAS', { 0: { preco: 12 }, 1: { preco: 25 } }),
  ])],
});
const estado = page => page.evaluate(() => { const c = db.cotacoes[0]; return { esc: c.escolhas || {}, qtd: c.qtds || {} }; });

test('Ctrl+Z desfaz a escolha e a quantidade; Ctrl+Y refaz; o histórico registra quem mudou', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'cotacao', 'c1');
  assert.equal(await page.locator('#btnDesfazer').isVisible(), false, 'nada para desfazer ainda');
  // escolhe VIA PEÇAS no item 1 (confirma)
  await page.locator('.tab-comp tr[data-comp-linha="0"] td.escolhivel', { hasText: '12,00' }).click();
  if (await page.locator('.dlg').count()) await page.click('.dlg button.primary');
  assert.deepEqual((await estado(page)).esc, { 0: 'f2' });
  // digita 12 na quantidade (um passo só, não dois)
  await page.click('[data-qtd-loja="paranoa"][data-i="1"]');
  await page.keyboard.type('12');
  assert.deepEqual((await estado(page)).qtd, { 1: { paranoa: 12 } });
  assert.equal(await page.locator('#btnDesfazer').isVisible(), true);
  await page.click('h3');
  await page.keyboard.press('Control+z');
  assert.deepEqual((await estado(page)).qtd, {}, 'a quantidade voltou a ficar vazia (não para "1")');
  await page.keyboard.press('Control+z');
  assert.deepEqual((await estado(page)).esc, {}, 'a escolha foi desfeita');
  assert.match(n(await page.locator('#toast').innerText()), /Desfeito: item 1 \(V1\): escolhido VIA PEÇAS/);
  await page.keyboard.press('Control+y');
  assert.deepEqual((await estado(page)).esc, { 0: 'f2' }, 'refeito');
  // histórico no menu ⋯ Mais
  await page.click('.menu-acoes-cot:not(.status-cot) > summary');
  await page.click('[data-act=historicoCot]');
  const hist = n(await page.locator('.dlg-historico .hist-lista').innerText());
  assert.match(hist, /refez: item 1 \(V1\): escolhido VIA PEÇAS[\s\S]*desfez: item 1 \(V1\): escolhido VIA PEÇAS[\s\S]*item 1 \(V1\): escolhido VIA PEÇAS/);
  assert.doesNotMatch(hist, /qtd\./, 'quantidades não entram no histórico');
  await page.keyboard.press('Escape');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('o Ctrl+Z não desfaz o que outra pessoa mudou depois', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'cotacao', 'c1');
  await page.click('[data-qtd-loja="paranoa"][data-i="0"]');
  await page.keyboard.type('5');
  await page.click('h3');
  // outra pessoa troca a mesma quantidade para 7 (chega pela nuvem)
  await page.evaluate(() => { aplicarDoc('qtds/c1', { qtds: { 0: { paranoa: 7 } } }); render(); });
  await page.keyboard.press('Control+z');
  assert.deepEqual((await estado(page)).qtd, { 0: { paranoa: 7 } }, 'o 7 da outra pessoa fica');
  assert.match(n(await page.locator('#toast').innerText()), /alteradas depois \(por outra pessoa\) e ficaram como estão/);
  // e um item que só eu mudei volta normalmente
  await page.click('[data-qtd-loja="sao-sebastiao"][data-i="1"]');
  await page.keyboard.type('3');
  await page.click('h3');
  await page.keyboard.press('Control+z');
  assert.deepEqual((await estado(page)).qtd, { 0: { paranoa: 7 } });
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
