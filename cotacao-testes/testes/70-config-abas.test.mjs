import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar } from '../ajuda.mjs';

after(fechar);

test('configurações em abas: uma de cada vez, salvar junta as abas Loja, E-mails e Marcas, lembra a aba', async () => {
  const s = await abrir(base());
  const { page } = s;
  await page.click('nav [data-route=config]');
  const visiveis = () => page.locator('[data-aba-cfg]:not([hidden]) h2').allInnerTexts();
  assert.deepEqual(await visiveis(), ['Aparência']);
  assert.equal(await page.locator('.barra-salvar-cfg').isVisible(), false, 'sem salvar na aba Aparência');
  await page.click('[data-act=abaConfig][data-aba=emails]');
  assert.deepEqual(await visiveis(), ['Modelo do e-mail']);
  await page.fill('[name=assuntoEmail]', 'COTAÇÃO {numero} - TESTE');
  await page.click('[data-act=abaConfig][data-aba=loja]');
  await page.fill('[name=loja]', 'DISPPAR TESTE');
  await page.click('.barra-salvar-cfg button.primary');
  assert.deepEqual(await page.evaluate(() => [db.config.loja, db.config.assuntoEmail]), ['DISPPAR TESTE', 'COTAÇÃO {numero} - TESTE']);
  await page.click('[data-act=abaConfig][data-aba=backup]');
  assert.deepEqual(await visiveis(), ['Backup dos dados']);
  await page.reload();
  await page.click('nav [data-route=config]');
  assert.deepEqual(await visiveis(), ['Backup dos dados'], 'lembra a última aba');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
