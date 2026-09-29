/**
 * Supabase simulado para os testes (login, lista de acesso e a tabela cotacao_documentos com versões).
 */
import { navegador, URL_SISTEMA } from './ajuda.mjs';

export const URL_SB = 'https://teste-cotacao.supabase.co';

/**
 * Supabase simulado: login por senha, lista de acesso (cotacao_usuarios) e a tabela cotacao_documentos
 * (select por coleção, upsert e delete), respondendo como o PostgREST/GoTrue.
 */
export function supabaseFalso({ liberados = ['wes@loja.com'], senha = '123456', docs = new Map(), admins = [] } = {}) {
  const senhas = new Map(); // senhas dos usuários cadastrados pelo administrador
  const backups = []; // cópias do backup.sql (mais nova primeiro)
  const log = [];
  // versão (atualizado_em) de cada documento, como o gatilho do banco faz a cada gravação
  const vers = new Map();
  let relogio = 0;
  const novaVersao = () => `2026-01-01T00:00:00.${String(++relogio).padStart(6, '0')}+00:00`;
  for (const k of docs.keys()) vers.set(k, novaVersao());
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
  const json = (route, status, body, extra = {}) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: body === undefined ? '' : JSON.stringify(body) });
  const filtro = (url, campo) => {
    const v = url.searchParams.get(campo);
    if (!v) return null;
    if (v.startsWith('eq.')) return [v.slice(3)];
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(x => x.replace(/^"|"$/g, ''));
    return null;
  };
  const casa = (url, caminho) => {
    const col = filtro(url, 'colecao'), cam = filtro(url, 'caminho'), ver = filtro(url, 'atualizado_em');
    return (!col || col.includes(caminho.split('/')[0])) && (!cam || cam.includes(caminho)) && (!ver || ver.includes(vers.get(caminho)));
  };
  const linha = c => ({ caminho: c, dados: docs.get(c), atualizado_em: vers.get(c) });
  const handler = async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    const token = (req.headers().authorization || '').replace('Bearer ', '');
    const email = token.startsWith('tk-') ? token.slice(3) : null;
    if (url.pathname === '/auth/v1/token') {
      const b = JSON.parse(req.postData() || '{}');
      if (b.password !== (senhas.get(b.email) ?? senha)) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
      const user = { id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', role: 'authenticated', email: b.email };
      return json(route, 200, { access_token: 'tk-' + b.email, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'rf', user });
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/auth/v1/user') {
      const user = { id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', role: 'authenticated', email };
      if (req.method() === 'PUT') { log.push('SENHA ' + JSON.parse(req.postData()).password); }
      return json(route, 200, user);
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      // funções do usuarios.sql (só administradores, menos a que pergunta se é administrador)
      const fn = url.pathname.slice('/rest/v1/rpc/'.length);
      const b = JSON.parse(req.postData() || '{}');
      const admin = !!email && admins.includes(email) && liberados.includes(email);
      if (fn === 'cotacao_sou_admin') return json(route, 200, admin);
      if (!admin) return json(route, 400, { code: '42501', message: 'Só administradores podem cadastrar usuários.' });
      log.push(`RPC ${fn} ${JSON.stringify(b)}`);
      if (fn === 'cotacao_listar_usuarios') return json(route, 200, liberados.map(e => ({ email: e, nome: null, admin: admins.includes(e), criado_em: null, ultimo_acesso: null })));
      if (fn === 'cotacao_adicionar_usuario') {
        if ((b.p_senha || '').length < 6) return json(route, 400, { code: 'P0001', message: 'A senha precisa ter pelo menos 6 caracteres.' });
        if (!liberados.includes(b.p_email)) liberados.push(b.p_email);
        senhas.set(b.p_email, b.p_senha);
        if (b.p_admin && !admins.includes(b.p_email)) admins.push(b.p_email);
        return route.fulfill({ status: 204, headers: cors });
      }
      if (fn === 'cotacao_backup_agora') {
        backups.unshift({ id: backups.length + 1, criado_em: new Date(Date.UTC(2026, 8, 29, 12, backups.length)).toISOString(), motivo: `${b.p_motivo} (${email})`, dados: structuredClone(Object.fromEntries(docs)) });
        return json(route, 200, backups[0].id);
      }
      if (fn === 'cotacao_listar_backups') return json(route, 200, backups.map(x => ({ id: x.id, criado_em: x.criado_em, motivo: x.motivo, documentos: Object.keys(x.dados).length, tamanho: JSON.stringify(x.dados).length })));
      if (fn === 'cotacao_ler_backup') {
        const x = backups.find(y => y.id === b.p_id);
        return x ? json(route, 200, x.dados) : json(route, 400, { code: 'P0001', message: 'Backup não encontrado.' });
      }
      if (fn === 'cotacao_definir_senha') { senhas.set(b.p_email, b.p_senha); return route.fulfill({ status: 204, headers: cors }); }
      if (fn === 'cotacao_remover_usuario') {
        if (b.p_email === email) return json(route, 400, { code: 'P0001', message: 'Você não pode tirar o seu próprio acesso.' });
        liberados.splice(liberados.indexOf(b.p_email), 1);
        return route.fulfill({ status: 204, headers: cors });
      }
    }
    if (url.pathname === '/rest/v1/cotacao_usuarios') {
      return json(route, 200, email && liberados.includes(email) ? [{ email }] : []);
    }
    if (url.pathname === '/rest/v1/cotacao_documentos') {
      const pode = email && liberados.includes(email);
      const prefer = req.headers().prefer || '';
      const devolver = prefer.includes('return=representation');
      if (req.method() === 'GET') {
        const linhas = pode ? [...docs.keys()].filter(c => casa(url, c)).sort().map(linha) : [];
        log.push(`GET ${(filtro(url, 'colecao') || filtro(url, 'caminho') || ['*']).join(',')}`);
        return json(route, 200, linhas);
      }
      if (!pode) return json(route, 403, { code: '42501', message: 'new row violates row-level security policy' });
      if (req.method() === 'POST') {
        const b = [].concat(JSON.parse(req.postData()));
        const upsert = prefer.includes('merge-duplicates');
        if (!upsert && b.some(r => docs.has(r.caminho))) return json(route, 409, { code: '23505', message: 'duplicate key value violates unique constraint' });
        for (const r of b) { docs.set(r.caminho, r.dados); vers.set(r.caminho, novaVersao()); log.push(`SET ${r.caminho}`); }
        return devolver ? json(route, 201, b.map(r => linha(r.caminho))) : route.fulfill({ status: 201, headers: cors });
      }
      if (req.method() === 'PATCH') {
        const b = JSON.parse(req.postData());
        const alvo = [...docs.keys()].filter(c => casa(url, c));
        for (const c of alvo) { docs.set(c, b.dados); vers.set(c, novaVersao()); log.push(`SET ${c}`); }
        return devolver ? json(route, 200, alvo.map(linha)) : route.fulfill({ status: 204, headers: cors });
      }
      if (req.method() === 'DELETE') {
        const alvo = [...docs.keys()].filter(c => casa(url, c));
        const antes = alvo.map(linha);
        for (const c of alvo) { docs.delete(c); vers.delete(c); log.push(`DEL ${c}`); }
        return devolver ? json(route, 200, antes) : route.fulfill({ status: 204, headers: cors });
      }
    }
    return json(route, 404, { message: 'não simulado: ' + url.pathname });
  };
  return { handler, docs, vers, log, liberados, admins, senhas, backups };
}

export async function abrirSite(sb, sufixo = '') {
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

export async function entrar(page, email, senha) {
  await page.waitForSelector('#telaLogin:not([hidden]) form');
  await page.fill('#telaLogin [name=email]', email);
  await page.fill('#telaLogin [name=senha]', senha);
  await page.click('#telaLogin button[type=submit]');
}

