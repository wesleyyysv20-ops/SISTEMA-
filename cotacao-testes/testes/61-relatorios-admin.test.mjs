import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fechar } from '../ajuda.mjs';
import { supabaseFalso, abrirSite, entrar } from '../supabase-falso.mjs';

after(fechar);

const logado = async (page, email, senha) => {
  await entrar(page, email, senha);
  await page.waitForSelector('#telaLogin', { state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo');
};

test('relatórios: só administrador vê a aba; os outros não abrem nem pelo endereço', async () => {
  const sb = supabaseFalso({ docs: new Map([['sistema/config', { loja: 'DISPPAR' }]]), liberados: ['wes@loja.com', 'ana@loja.com'], admins: ['wes@loja.com'] });
  const { page } = await abrirSite(sb);
  await logado(page, 'ana@loja.com', '123456');
  await page.waitForFunction(() => nuvem.admin === false);
  assert.equal(await page.locator('#nav a[data-route=relatorios]').isVisible(), false);
  await page.evaluate(() => ir('relatorios'));
  assert.match(await page.locator('#app').innerText(), /só para administradores/);
  assert.equal(await page.locator('#notaFornecedores').count(), 0);
  // na busca rápida (Ctrl+K) também não aparece
  await page.keyboard.press('Control+k');
  await page.keyboard.type('relat');
  assert.doesNotMatch(await page.locator('#buscaRapida').innerText(), /Relatórios/);
  await page.close();
});

test('relatórios: administrador vê a aba normalmente', async () => {
  const sb = supabaseFalso({ docs: new Map([['sistema/config', { loja: 'DISPPAR' }]]), admins: ['wes@loja.com'] });
  const { page, erros } = await abrirSite(sb);
  await logado(page, 'wes@loja.com', '123456');
  await page.waitForFunction(() => nuvem.admin === true);
  assert.equal(await page.locator('#nav a[data-route=relatorios]').isVisible(), true);
  await page.click('#nav a[data-route=relatorios]');
  assert.doesNotMatch(await page.locator('#app').innerText(), /só para administradores/);
  assert.deepEqual(erros, []);
  await page.close();
});
