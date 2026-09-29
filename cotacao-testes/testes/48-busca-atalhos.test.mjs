import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const itens = [item('P1', 'BOBINA IGNICAO', 'DELPHI', { codigo: 'BI0023MM' }), item('P2', 'VELA IGNICAO', 'NGK', { codigo: 'BKR6E' }), item('P3', 'AMORTECEDOR', 'COFAP', { codigo: 'GP30562' })];
const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
  produtos: [{ id: 'P9', codigo: 'XYZ-77', descricao: 'FILTRO DE AR', marca: 'MANN' }],
  fornecedores: [{ id: 'f1', nome: 'KAIZEN', contato: 'PEDRO' }],
  cotacoes: [
    cotacao('c1', '0001', '2026-09-28', 'aberta', itens, [forn('f1', 'KAIZEN', { 0: { preco: 10 }, 1: { preco: 5 }, 2: { preco: 50 } })], { titulo: 'COTAÇÃO 28 DE SETEMBRO' }),
    cotacao('c2', '0002', '2026-09-29', 'aberta', itens, [forn('f1', 'KAIZEN')], { titulo: 'URGENTE' }),
  ],
});

test('busca rápida (Ctrl+K): cotações, itens da cotação aberta, produtos, fornecedores e telas', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#buscaRapida');
  // sem digitar: cotações recentes e telas
  assert.match(n(await page.locator('#buscaLista').innerText()), /COTAÇÕES[\s\S]*Cotação nº 0002[\s\S]*TELAS[\s\S]*Início/i);
  await page.keyboard.type('urgente');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => [rota().nome, rota().id]), ['cotacao', 'c2']);

  // na cotação 0001, procurar um item leva até a linha dele no comparativo, já na quantidade
  await page.evaluate(() => ir('cotacao', 'c1'));
  await page.click('[data-act=abrirBusca]');
  await page.keyboard.type('bkr6');
  assert.match(n(await page.locator('.busca-item.ativo').innerText()), /#2 BKR6E\s*VELA IGNICAO/);
  await page.keyboard.press('Enter');
  assert.match(await page.locator('.tab-comp tr[data-comp-linha="1"]').getAttribute('class'), /linha-atual/);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.i), '1');

  // produto do cadastro: abre Produtos já filtrado; ↓ escolhe o próximo resultado
  await page.keyboard.press('Control+k');
  await page.keyboard.type('xyz');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => rota().nome), 'produtos');
  assert.equal(await page.inputValue('#filtroProd'), 'XYZ-77');

  // fornecedor pelo contato
  await page.keyboard.press('Control+k');
  await page.keyboard.type('pedro');
  assert.match(n(await page.locator('.busca-item.ativo').innerText()), /KAIZEN/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#buscaRapida').count(), 0);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('atalhos (?): lista por tela; não abre quando se está digitando num campo', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=produtos]');
  await page.fill('#filtroProd', 'a?');
  assert.equal(await page.locator('.dlg-atalhos').count(), 0, 'digitar ? num campo não abre');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('?');
  const txt = n(await page.locator('.dlg-atalhos').innerText());
  assert.match(txt, /Atalhos do teclado[\s\S]*Ctrl\s*\+\s*K[\s\S]*Nova cotação[\s\S]*Enter duas vezes[\s\S]*Comparativo[\s\S]*Janela flutuante/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.dlg-atalhos').count(), 0);
  await page.click('[data-act=abrirAtalhos]');
  await page.waitForSelector('.dlg-atalhos');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
