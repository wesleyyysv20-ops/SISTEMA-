import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  cotacoes: [cotacao('c1', '0066', '2026-10-01', 'aberta', [item('A', 'VELA', 'NGK', { codigo: 'V1' }), item('B', 'FILTRO', 'TECFIL', { codigo: 'F1' })], [
    forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 20, marca: 'TECFIL' } }),
    forn('f2', 'VIA PEÇAS', { 0: { preco: 11, marca: 'NGK' }, 1: { preco: 19, marca: 'TECFIL' } }),
  ])],
});
async function abrirCot() {
  const s = await abrir(dados());
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return s;
}

test('seção aberta ("Como usar") continua aberta depois de a tela ser redesenhada', async () => {
  const s = await abrirCot();
  const { page } = s;
  await page.click('.ajuda-comp summary');
  assert.equal(await page.locator('.ajuda-comp').getAttribute('open'), '');
  await page.evaluate(() => render());
  assert.equal(await page.locator('.ajuda-comp').getAttribute('open'), '', 'não fechou');
  // e fechada continua fechada
  await page.click('.ajuda-comp summary');
  await page.evaluate(() => render());
  assert.equal(await page.locator('.ajuda-comp').getAttribute('open'), null);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('mudança vinda da nuvem não redesenha com a lista suspensa aberta nem com janela aberta (espera)', async () => {
  const s = await abrirCot();
  const { page } = s;
  // lista "Itens de" com o foco (aberta): um colega muda o título da cotação
  await page.focus('#filtroVencedor');
  await page.evaluate(() => { window.__sel = document.getElementById('filtroVencedor'); db.cotacoes[0].titulo = 'MUDOU'; renderSeguro(['cotacoes/c1']); });
  assert.equal(await page.evaluate(() => document.getElementById('filtroVencedor') === window.__sel), true, 'a lista não foi trocada (não fecha)');
  // saiu da lista: a tela atualiza
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForFunction(() => /MUDOU/.test(document.querySelector('.titulo-cot').innerText), null, { timeout: 5000 });
  // janela de confirmação aberta: espera fechar
  await page.click('.status-cot [data-status=finalizada]');
  await page.evaluate(() => { window.__cab = document.querySelector('.card-cab-cot'); db.cotacoes[0].titulo = 'DE NOVO'; renderSeguro(['cotacoes/c1']); });
  assert.equal(await page.evaluate(() => document.querySelector('.card-cab-cot') === window.__cab), true);
  await page.click('.dlg button:text("Cancelar")');
  await page.waitForFunction(() => /DE NOVO/.test(document.querySelector('.titulo-cot').innerText), null, { timeout: 5000 });
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
