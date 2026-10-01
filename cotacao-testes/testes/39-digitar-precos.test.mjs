import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const itens = [item('P1', 'ADITIVO COMBUSTIVEL (GASOLINA)', 'QUALQUER', { codigo: 'ADT-01' }), item('P2', 'AMORTECEDOR DIANTEIRO', 'SÓ COFAP', { codigo: 'GP30562' }), item('P3', 'VELA', 'NGK', { codigo: 'BKR6E' })];

async function abrirDigitar() {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0039', '2026-09-29', 'aberta', itens, [forn('f1', 'KAIZEN', { 1: { preco: 189.26, marca: 'COFAP/12', estoque: 12 } })])] }));
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  await s.page.click('details.menu-acoes:has([data-act=digitar][data-f="0"]) > summary').then(() => s.page.click('[data-act=digitar][data-f="0"]'));
  return s;
}

test('digitar preços: código e marca pedida de cada item', async () => {
  const s = await abrirDigitar();
  const { page } = s;
  const painel = page.locator('#painelDigitar');
  assert.deepEqual((await painel.locator('thead th').allInnerTexts()).map(t => n(t).trim().toUpperCase()).slice(0, 4), ['#', 'CÓDIGO', 'MARCA PEDIDA', 'DESCRIÇÃO']);
  assert.deepEqual(await painel.locator('td.cod-digitar').allInnerTexts(), ['ADT-01', 'GP30562', 'BKR6E']);
  assert.match(n(await painel.locator('tbody tr').nth(1).innerText()), /2\s+GP30562\s+SÓ COFAP\s+AMORTECEDOR DIANTEIRO/);
  assert.equal(await page.inputValue('[name=m_1]'), 'COFAP/12', 'a marca que o fornecedor respondeu fica no campo Marca');
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
  await page.keyboard.press('ArrowRight'); // cursor no fim: vai para a marca
  assert.equal(await foco(), 'm_2');
  await page.keyboard.press('ArrowRight'); // marca vazia: vai para o prazo
  assert.equal(await foco(), 'z_2');
  await page.keyboard.type('2 dias');
  await page.keyboard.press('ArrowUp');
  assert.equal(await foco(), 'z_1');
  await page.keyboard.press('ArrowLeft'); // campo vazio: volta para a marca
  assert.equal(await foco(), 'm_1');
  await page.keyboard.press('ArrowLeft'); // marca selecionada inteira: volta para o preço
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

test('digitar preços: o que foi digitado não some quando a tela é redesenhada; marca digitada é salva', async () => {
  const s = await abrirDigitar();
  const { page } = s;
  await page.fill('[name=p_0]', '15,90');
  await page.fill('[name=m_0]', 'BOSCH');
  await page.fill('[name=p_2]', '7');
  // redesenho no meio da digitação (ex.: outra pessoa salvou algo)
  await page.evaluate(() => render());
  assert.equal(await page.inputValue('[name=p_0]'), '15,90', 'o preço digitado continua');
  assert.equal(await page.inputValue('[name=m_0]'), 'BOSCH');
  assert.equal(await page.inputValue('[name=p_2]'), '7');
  // mudança vinda da nuvem: espera o salvar
  await page.evaluate(() => { window.__painel = document.getElementById('painelDigitar'); renderSeguro(['cotacoes/c1']); });
  assert.equal(await page.evaluate(() => document.getElementById('painelDigitar') === window.__painel), true);
  await page.click('#painelDigitar button.primary');
  await page.waitForSelector('#painelDigitar', { state: 'detached' });
  const r = await page.evaluate(() => db.cotacoes[0].fornecedores[0].respostas);
  assert.equal(r[0].preco, 15.9);
  assert.equal(r[0].marca, 'BOSCH');
  assert.equal(r[2].preco, 7);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
