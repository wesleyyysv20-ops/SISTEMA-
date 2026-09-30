import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const itens = [item('P1', 'ADITIVO COMBUSTIVEL (GASOLINA)', 'QUALQUER', { codigo: 'ADT-01' }), item('P2', 'AMORTECEDOR DIANTEIRO', 'SÓ COFAP', { codigo: 'GP30562' }), item('P3', 'VELA', 'NGK', { codigo: 'BKR6E' })];

async function abrirDigitar() {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0039', '2026-09-29', 'aberta', itens, [forn('f1', 'KAIZEN', { 1: { preco: 189.26, marca: 'COFAP/12', estoque: 12 } })])] }));
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  await s.page.click('[data-act=digitar][data-f="0"]');
  return s;
}

test('digitar preços: código e marca pedida de cada item', async () => {
  const s = await abrirDigitar();
  const { page } = s;
  const painel = page.locator('#painelDigitar');
  assert.deepEqual((await painel.locator('thead th').allInnerTexts()).map(t => n(t).trim().toUpperCase()).slice(0, 4), ['#', 'CÓDIGO', 'MARCA PEDIDA', 'DESCRIÇÃO']);
  assert.deepEqual(await painel.locator('td.cod-digitar').allInnerTexts(), ['ADT-01', 'GP30562', 'BKR6E']);
  assert.match(n(await painel.locator('tbody tr').nth(1).innerText()), /2\s+GP30562\s+SÓ COFAP\s+respondeu: COFAP\/12\s+AMORTECEDOR DIANTEIRO/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('digitar preços: setas e Enter mudam de item; salvar mantém a marca e o estoque que vieram da planilha', async () => {
  const s = await abrirDigitar();
  const { page } = s;
  const foco = () => page.evaluate(() => document.activeElement.name);
  await page.click('[name=p_0]');
  await page.keyboard.type('10,50');
  await page.keyboard.press('Enter'); // não salva: desce
  assert.equal(await foco(), 'p_1');
  assert.equal(await page.locator('#painelDigitar').count(), 1, 'o formulário continua aberto');
  await page.keyboard.press('ArrowDown');
  assert.equal(await foco(), 'p_2');
  await page.keyboard.type('22');
  await page.keyboard.press('ArrowRight'); // cursor no fim: vai para o prazo
  assert.equal(await foco(), 'z_2');
  await page.keyboard.type('2 dias');
  await page.keyboard.press('ArrowUp');
  assert.equal(await foco(), 'z_1');
  await page.keyboard.press('ArrowLeft'); // campo vazio: volta para o preço
  assert.equal(await foco(), 'p_1');
  // último item + Enter: vai para "Salvar preços"; Enter de novo salva
  await page.click('[name=p_2]');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Salvar preços');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#painelDigitar', { state: 'detached' });
  const r = await page.evaluate(() => db.cotacoes[0].fornecedores[0].respostas);
  assert.deepEqual(r[0], { preco: 10.5, prazo: '', obs: '' });
  assert.deepEqual(r[1], { preco: 189.26, marca: 'COFAP/12', estoque: 12, prazo: '', obs: '' }, 'marca e estoque continuam');
  assert.equal(r[2].preco, 22);
  assert.equal(r[2].prazo, '2 dias');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
