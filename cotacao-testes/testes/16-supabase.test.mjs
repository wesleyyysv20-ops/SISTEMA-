import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fechar } from '../ajuda.mjs';
import { supabaseFalso, abrirSite, entrar } from '../supabase-falso.mjs';

after(fechar);

test('Supabase: login, dados salvos na nuvem e sessão lembrada', async () => {
  const sb = supabaseFalso({ docs: new Map([['sistema/config', { loja: 'DISPPAR' }], ['fornecedores/lote-00', { itens: [{ id: 'f1', nome: 'Auto Mix' }] }]]) });
  const { page, context, erros } = await abrirSite(sb);
  await entrar(page, 'wes@loja.com', 'errada');
  await page.waitForFunction(() => /incorretos/.test(document.querySelector('#telaLogin .login-msg')?.textContent || ''));
  await entrar(page, 'wes@loja.com', '123456');
  await page.waitForSelector('#telaLogin', { state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo');
  assert.equal(await page.evaluate(() => db.fornecedores.map(f => f.nome).join()), 'Auto Mix', 'carregou os dados do Supabase');
  // cadastra um produto: vai para o Supabase
  await page.evaluate(() => ir('produtos'));
  await page.click('details.form-novo > summary'); // + Adicionar produto
  await page.fill('[data-form=produto] [name=codigo]', 'GB48167');
  await page.fill('[data-form=produto] [name=descricao]', 'AMORTECEDOR TRASEIRO');
  await page.fill('[data-form=produto] [name=marca]', 'SÓ COFAP');
  await page.click('[data-form=produto] button.primary');
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo' && !nuvem.gravando);
  await page.waitForTimeout(1600);
  const noBanco = [...sb.docs].filter(([k]) => k.startsWith('produtos/')).flatMap(([, v]) => v.itens);
  assert.deepEqual(noBanco.map(p => p.codigo), ['GB48167']);
  // recarrega sem o cache do navegador: continua logado e os dados vêm do Supabase
  await page.evaluate(() => localStorage.removeItem('sistemaCotacao.v1'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo');
  assert.equal(await page.locator('#telaLogin:not([hidden])').count(), 0, 'sessão lembrada');
  assert.equal(await page.evaluate(() => db.produtos[0]?.codigo), 'GB48167');
  // conta em Configurações e sair
  await page.evaluate(() => { ui.abaConfig = 'conta'; ir('config'); });
  assert.match(await page.locator('#app').innerText(), /Conectado como wes@loja\.com/);
  await page.click('[data-act=sairSupabase]');
  await page.waitForSelector('#telaLogin:not([hidden]) form');
  assert.equal(await page.evaluate(() => localStorage.getItem('sistemaCotacao.v1')), null, 'ao sair, apaga a cópia local');
  assert.deepEqual(erros, []);
  await context.close();
});

test('Supabase: e-mail que não está liberado não entra', async () => {
  const sb = supabaseFalso({ docs: new Map([['sistema/config', { loja: 'DISPPAR' }]]) });
  const { page, context, erros } = await abrirSite(sb);
  await entrar(page, 'intruso@x.com', '123456');
  await page.waitForFunction(() => /não tem acesso/.test(document.querySelector('#telaLogin .login-msg')?.textContent || ''));
  assert.equal(await page.locator('#telaLogin:not([hidden])').count(), 1);
  assert.ok(!sb.log.some(l => l.startsWith('SET')), 'nada foi gravado');
  assert.deepEqual(erros, []);
  await context.close();
});

test('Supabase: link do convite abre "crie sua senha" e já entra no sistema', async () => {
  const sb = supabaseFalso({ docs: new Map([['sistema/config', { loja: 'DISPPAR' }]]) });
  const hash = '#access_token=tk-wes@loja.com&refresh_token=rf&expires_in=3600&expires_at=' + (Math.floor(Date.now() / 1000) + 3600) + '&token_type=bearer&type=invite';
  const { page, context, erros } = await abrirSite(sb, hash);
  await page.waitForSelector('#telaLogin h1:text("Bem-vindo! Crie sua senha")');
  await page.fill('#telaLogin [name=senha]', 'senhaNova123');
  await page.fill('#telaLogin [name=senha2]', 'outra-coisa');
  await page.click('#telaLogin button[type=submit]');
  await page.waitForFunction(() => /não são iguais/.test(document.querySelector('#telaLogin .login-msg')?.textContent || ''));
  await page.fill('#telaLogin [name=senha2]', 'senhaNova123');
  await page.click('#telaLogin button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo');
  assert.ok(sb.log.includes('SENHA senhaNova123'), 'senha salva no Supabase');
  assert.equal(await page.locator('#telaLogin:not([hidden])').count(), 0);
  assert.equal(await page.evaluate(() => location.hash), '', 'o token some do endereço');
  assert.deepEqual(erros, []);
  await context.close();
});
