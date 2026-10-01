import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fechar, n } from '../ajuda.mjs';
import { supabaseFalso, abrirSite, entrar } from '../supabase-falso.mjs';

after(fechar);

const logado = async (page, email, senha) => {
  await entrar(page, email, senha);
  await page.waitForSelector('#telaLogin', { state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo');
};

test('usuários: administrador cadastra, troca a senha e tira o acesso; a pessoa entra com a senha definida', async () => {
  const sb = supabaseFalso({ docs: new Map([['sistema/config', { loja: 'DISPPAR' }]]), admins: ['wes@loja.com'] });
  const { page, context, erros } = await abrirSite(sb);
  await logado(page, 'wes@loja.com', '123456');
  await page.waitForFunction(() => nuvem.admin === true);
  await page.evaluate(() => { ui.abaConfig = 'conta'; ir('config'); });
  await page.waitForSelector('#cardConta table');
  assert.match(n(await page.locator('#cardConta').innerText()), /administrador[\s\S]*Vários computadores podem usar o sistema ao mesmo tempo/);

  // senha curta: avisa e não cadastra
  await page.fill('[data-form=usuario] [name=nome]', 'Maria');
  await page.fill('[data-form=usuario] [name=email]', 'Maria@Loja.com');
  await page.fill('[data-form=usuario] [name=senha]', '123');
  await page.evaluate(() => document.querySelector('[data-form=usuario] [name=senha]').removeAttribute('minlength'));
  await page.click('[data-form=usuario] button.primary');
  assert.match(await page.locator('.dlg').innerText(), /pelo menos 6 caracteres/);
  await page.click('.dlg button.primary');

  await page.fill('[data-form=usuario] [name=senha]', 'maria123');
  await page.click('[data-form=usuario] button.primary');
  await page.waitForSelector('.dlg');
  assert.match(n(await page.locator('.dlg').innerText()), /maria@loja\.com pode usar o sistema[\s\S]*e-mail: maria@loja\.com/);
  await page.click('.dlg button.primary');
  assert.ok(sb.liberados.includes('maria@loja.com'), 'e-mail em minúsculas na lista de acesso');
  assert.match(await page.locator('#cardConta tbody').innerText(), /maria@loja\.com/);
  assert.ok(sb.log.some(l => l.startsWith('RPC cotacao_adicionar_usuario') && l.includes('"p_nome":"Maria"') && l.includes('"p_admin":false')));

  // trocar a senha dela
  await page.locator('#cardConta tbody tr', { hasText: 'maria@loja.com' }).locator('[data-act=senhaUsuario]').click();
  await page.fill('#dlgCampo', 'nova4567');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Senha de maria@loja\.com trocada/.test(document.querySelector('#toast')?.textContent || ''));
  assert.equal(sb.senhas.get('maria@loja.com'), 'nova4567');
  // o próprio administrador não tem o botão de tirar o acesso
  assert.equal(await page.locator('#cardConta tbody tr', { hasText: 'wes@loja.com' }).locator('[data-act=removerUsuario]').count(), 0);

  // a Maria entra (outro computador) com a senha nova e não vê a lista de usuários
  const b = await abrirSite(sb);
  await logado(b.page, 'maria@loja.com', 'nova4567');
  await b.page.evaluate(() => { ui.abaConfig = 'conta'; ir('config'); });
  await b.page.waitForTimeout(300);
  assert.equal(await b.page.evaluate(() => nuvem.admin), false);
  assert.equal(await b.page.locator('[data-form=usuario]').count(), 0);
  // e troca a própria senha
  await b.page.click('.minha-senha summary');
  await b.page.fill('[data-form=minhaSenha] [name=senha]', 'minha999');
  await b.page.fill('[data-form=minhaSenha] [name=senha2]', 'outra999');
  await b.page.click('[data-form=minhaSenha] button.primary');
  assert.match(await b.page.locator('.dlg').innerText(), /não são iguais/);
  await b.page.click('.dlg button.primary');
  await b.page.fill('[data-form=minhaSenha] [name=senha2]', 'minha999');
  await b.page.click('[data-form=minhaSenha] button.primary');
  await b.page.waitForFunction(() => /Senha trocada/.test(document.querySelector('#toast')?.textContent || ''));
  assert.ok(sb.log.includes('SENHA minha999'));
  assert.deepEqual(b.erros, []);
  await b.context.close();

  // tirar o acesso
  await page.locator('#cardConta tbody tr', { hasText: 'maria@loja.com' }).locator('[data-act=removerUsuario]').click();
  await page.click('.dlg button.primary');
  await page.waitForFunction(() => !/maria@loja\.com/.test(document.querySelector('#cardConta tbody')?.textContent || ''));
  assert.ok(!sb.liberados.includes('maria@loja.com'));
  assert.deepEqual(erros, []);
  await context.close();
});

test('usuários: quem não é administrador não vê o cadastro; outro computador recebe a alteração', async () => {
  const sb = supabaseFalso({ docs: new Map([['sistema/config', { loja: 'DISPPAR' }]]) });
  const { page, context, erros } = await abrirSite(sb);
  await logado(page, 'wes@loja.com', '123456');
  await page.evaluate(() => { ui.abaConfig = 'conta'; ir('config'); });
  assert.match(n(await page.locator('#cardConta').innerText()), /Trocar a minha senha/);
  assert.equal(await page.locator('[data-form=usuario]').count(), 0);
  // outro computador grava; este puxa (o aviso em tempo real chama o mesmo puxarNuvem)
  sb.docs.set('sistema/config', { loja: 'DISPPAR MATRIZ' });
  sb.vers.set('sistema/config', '2026-02-01T00:00:00.000000+00:00');
  await page.evaluate(() => puxarNuvem());
  await page.waitForFunction(() => db.config.loja === 'DISPPAR MATRIZ');
  assert.deepEqual(erros, []);
  await context.close();
});
