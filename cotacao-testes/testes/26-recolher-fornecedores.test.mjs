import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

test('cotação: quadro Fornecedores recolhível (começa fechado, abre e fecha no clique, lembra a escolha)', async () => {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0026', '2026-09-28', 'aberta', [item('P1', 'VELA', 'NGK')], [
    forn('f1', 'KAIZEN', { 0: { preco: 10 } }, { enviadoEm: '2026-09-28T10:00:00Z' }),
    forn('f2', 'Via Peças'),
  ])] }));
  const { page } = s;
  // sem escolha guardada: começa fechado
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.evaluate(() => { localStorage.removeItem('cotacao.fornAberto'); render(); });
  const titulo = page.locator('h3.recolhe');
  const corpo = page.locator('.corpo-recolhe');
  assert.match(n(await titulo.innerText()), /▸\s+Fornecedores\s+2 fornecedor\(es\) · 1 responderam · 1 enviadas/);
  assert.equal(await corpo.isVisible(), false);

  await titulo.click();
  assert.equal(await corpo.isVisible(), true);
  assert.match(await titulo.innerText(), /▾\s+Fornecedores/);
  assert.equal(await page.locator('.corpo-recolhe [data-act=baixarPlanilha]').count(), 2);

  // continua aberto depois de redesenhar e de recarregar
  await page.evaluate(() => render());
  assert.equal(await corpo.isVisible(), true);
  await page.reload();
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  assert.equal(await page.locator('.corpo-recolhe').isVisible(), true);

  // clicar de novo fecha; Enter no título também alterna
  await page.locator('h3.recolhe').click();
  assert.equal(await page.locator('.corpo-recolhe').isVisible(), false);
  await page.locator('h3.recolhe').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.corpo-recolhe').isVisible(), true);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
