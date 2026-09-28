import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

const dados = (qtds = {}) => base({
  cotacoes: [cotacao('c1', '0020', '2026-09-28', 'aberta',
    [item('P1', 'KIT CORREIA DENTADA', 'SÓ CONTITECH', { codigo: 'CT1045K1' }), item('P2', 'VELA IGNICAO', 'NGK', { codigo: 'BKR6E' })],
    [forn('f1', 'Auto Mix', { 0: { preco: 189.26, marca: 'KAIZEN' }, 1: { preco: 20, marca: 'NGK' } })], { qtds })],
});

async function abrirCot(qtds) {
  const s = await abrir(dados(qtds));
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return s;
}
const duvidas = page => page.evaluate(() => db.duvidas.map(d => [d.empresa, d.qtd, d.obs, d.codigo, d.marca]));

test('❓ pergunta a loja, a quantidade e a observação; dá para marcar as duas lojas', async () => {
  const s = await abrirCot({ 0: { 'sao-sebastiao': 2 } });
  const { page } = s;
  await page.click('[data-act=duvidaItem][data-i="0"]');
  const dlg = page.locator('.dlg-duvida');
  assert.match(await dlg.innerText(), /CT1045K1 · KIT CORREIA DENTADA[\s\S]*Auto Mix · R\$\s189,26 · marca KAIZEN \(exigida SÓ CONTITECH\)/);
  // a loja com quantidade na cotação já vem marcada, com a quantidade
  // Paranoá vem primeiro; São Sebastião (com quantidade) já vem marcada
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-duv-loja]')].map(x => x.checked)), [false, true]);
  assert.equal(await page.inputValue('[data-duv-qtd="1"]'), '2');

  // marcar também a outra loja digitando a quantidade; observação; Enter confirma
  await page.fill('[data-duv-qtd="0"]', '3');
  assert.equal(await page.locator('[data-duv-loja="0"]').isChecked(), true, 'digitar a quantidade marca a loja');
  await page.fill('#duvObs', 'marca diferente');
  await page.keyboard.press('Enter');
  assert.deepEqual(await duvidas(page), [['DPR', 3, 'marca diferente', 'CT1045K1', 'KAIZEN'], ['DSS', 2, 'marca diferente', 'CT1045K1', 'KAIZEN']]);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('❓ só uma loja, Esc cancela e sem loja marcada não deixa confirmar', async () => {
  const s = await abrirCot({});
  const { page } = s;

  // Esc cancela sem pôr nada
  await page.click('[data-act=duvidaItem][data-i="1"]');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.dlg-duvida').count(), 0);
  assert.deepEqual(await duvidas(page), []);

  // sem quantidade na cotação: primeira loja marcada com 1; trocar para só a outra loja
  await page.click('[data-act=duvidaItem][data-i="1"]');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-duv-loja]')].map(x => x.checked)), [true, false]);
  await page.uncheck('[data-duv-loja="0"]');
  await page.click('.dlg-duvida button.primary');
  assert.equal(await page.locator('#duvErro').isVisible(), true, 'precisa de pelo menos uma loja');
  await page.check('[data-duv-loja="1"]');
  await page.fill('[data-duv-qtd="1"]', '4');
  await page.click('.dlg-duvida button.primary');
  assert.deepEqual(await duvidas(page), [['DSS', 4, '', 'BKR6E', 'NGK']]);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('lojas: Paranoá primeiro; configuração salva na ordem antiga é invertida, ordem personalizada fica', async () => {
  const ss = { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS', cnpj: '1', endereco: 'Rua 1' };
  const pa = { id: 'paranoa', nome: 'Paranoá', sigla: 'DPR', cnpj: '2', endereco: 'Quadra 2' };
  const outra = { id: 'centro', nome: 'Centro', sigla: 'DCE', cnpj: '', endereco: '' };
  const s = await abrir(base({ config: { loja: 'Loja Teste', lojas: [ss, pa] } }));
  assert.deepEqual(await s.page.evaluate(() => lojas().map(l => [l.id, l.endereco])), [['paranoa', 'Quadra 2'], ['sao-sebastiao', 'Rua 1']]);
  assert.deepEqual(await s.page.evaluate(d => normalizar(d).config.lojas.map(l => l.id), base({ config: { lojas: [ss, outra, pa] } })),
    ['sao-sebastiao', 'centro', 'paranoa'], 'ordem personalizada não muda');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
