import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { navegador, fechar, URL_SISTEMA } from '../ajuda.mjs';

after(fechar);

const URL_SB = 'https://teste-cotacao.supabase.co';

/**
 * Supabase simulado: login por senha, lista de acesso (cotacao_usuarios) e a tabela cotacao_documentos
 * (select por coleção, upsert e delete), respondendo como o PostgREST/GoTrue.
 */
function supabaseFalso({ liberados = ['wes@loja.com'], senha = '123456', docs = new Map() } = {}) {
  const log = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
  const json = (route, status, body, extra = {}) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: body === undefined ? '' : JSON.stringify(body) });
  const handler = async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    const token = (req.headers().authorization || '').replace('Bearer ', '');
    const email = token.startsWith('tk-') ? token.slice(3) : null;
    if (url.pathname === '/auth/v1/token') {
      const b = JSON.parse(req.postData() || '{}');
      if (b.password !== senha) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
      const user = { id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', role: 'authenticated', email: b.email };
      return json(route, 200, { access_token: 'tk-' + b.email, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'rf', user });
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/auth/v1/user') {
      const user = { id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', role: 'authenticated', email };
      if (req.method() === 'PUT') { log.push('SENHA ' + JSON.parse(req.postData()).password); }
      return json(route, 200, user);
    }
    if (url.pathname === '/rest/v1/cotacao_usuarios') {
      return json(route, 200, email && liberados.includes(email) ? [{ email }] : []);
    }
    if (url.pathname === '/rest/v1/cotacao_documentos') {
      const pode = email && liberados.includes(email);
      if (req.method() === 'GET') {
        const col = (url.searchParams.get('colecao') || '').replace('eq.', '');
        const linhas = pode ? [...docs.entries()].filter(([k]) => k.split('/')[0] === col).sort().map(([caminho, dados]) => ({ caminho, dados })) : [];
        log.push(`GET ${col}`);
        return json(route, 200, linhas);
      }
      if (!pode) return json(route, 403, { code: '42501', message: 'new row violates row-level security policy' });
      if (req.method() === 'POST') {
        const b = JSON.parse(req.postData());
        for (const r of [].concat(b)) { docs.set(r.caminho, r.dados); log.push(`SET ${r.caminho}`); }
        return route.fulfill({ status: 201, headers: cors });
      }
      if (req.method() === 'DELETE') {
        const c = (url.searchParams.get('caminho') || '').replace('eq.', '');
        docs.delete(c);
        log.push(`DEL ${c}`);
        return route.fulfill({ status: 204, headers: cors });
      }
    }
    return json(route, 404, { message: 'não simulado: ' + url.pathname });
  };
  return { handler, docs, log };
}

async function abrirSite(sb, sufixo = '') {
  const b = await navegador();
  const context = await b.newContext({ viewport: { width: 1300, height: 900 } });
  await context.route(URL_SB + '/**', sb.handler);
  await context.addInitScript(u => { window.COTACAO_CONFIG = { supabaseUrl: u, supabaseAnonKey: 'anon-teste' }; }, URL_SB);
  const page = await context.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await page.goto(URL_SISTEMA + sufixo);
  return { page, context, erros };
}

async function entrar(page, email, senha) {
  await page.waitForSelector('#telaLogin:not([hidden]) form');
  await page.fill('#telaLogin [name=email]', email);
  await page.fill('#telaLogin [name=senha]', senha);
  await page.click('#telaLogin button[type=submit]');
}

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
  await page.fill('[data-form=produto] [name=codigo]', 'GB48167');
  await page.fill('[data-form=produto] [name=descricao]', 'AMORTECEDOR TRASEIRO');
  await page.click('[data-form=produto] button.primary');
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo' && !nuvem.gravando);
  await page.waitForTimeout(1600);
  assert.equal(sb.docs.get('produtos/lote-00')?.itens?.[0]?.codigo, 'GB48167');
  // recarrega sem o cache do navegador: continua logado e os dados vêm do Supabase
  await page.evaluate(() => localStorage.removeItem('sistemaCotacao.v1'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo');
  assert.equal(await page.locator('#telaLogin:not([hidden])').count(), 0, 'sessão lembrada');
  assert.equal(await page.evaluate(() => db.produtos[0]?.codigo), 'GB48167');
  // conta em Configurações e sair
  await page.evaluate(() => ir('config'));
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
