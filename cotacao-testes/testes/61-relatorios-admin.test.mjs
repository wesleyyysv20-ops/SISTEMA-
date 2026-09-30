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

test('cotação finalizada: quem não é administrador não destrava nem reabre', async () => {
  const cot = { id: 'c1', numero: '0061', data: '2026-09-30', status: 'finalizada', itens: [{ codigo: 'A', descricao: 'X', marca: 'NGK', quantidade: 1 }],
    fornecedores: [{ fornecedorId: 'f1', nome: 'KAIZEN', respostas: { 0: { preco: 10, marca: 'NGK' } } }, { fornecedorId: 'f2', nome: 'VIA', respostas: { 0: { preco: 12, marca: 'NGK' } } }] };
  const sb = supabaseFalso({ docs: new Map([['sistema/config', { loja: 'DISPPAR' }], ['cotacoes/c1', cot]]), liberados: ['wes@loja.com', 'ana@loja.com'], admins: ['wes@loja.com'] });
  const { page } = await abrirSite(sb);
  await logado(page, 'ana@loja.com', '123456');
  await page.waitForFunction(() => nuvem.admin === false);
  await page.evaluate(() => ir('cotacao', 'c1'));
  await page.waitForSelector('.aviso-travada');
  assert.equal(await page.locator('[data-act=destravarCot]').count(), 0);
  assert.match(await page.locator('.aviso-travada').innerText(), /peça a um administrador/);
  await page.click('.status-cot [data-status=aberta]');
  assert.match(await page.locator('.dlg').innerText(), /Só um administrador pode reabrir/);
  await page.click('.dlg button.primary');
  assert.equal(await page.evaluate(() => db.cotacoes[0].status), 'finalizada');
  await page.close();
});
