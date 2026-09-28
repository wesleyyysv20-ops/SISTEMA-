import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Supabase Management API + Cloudflare API + Auth do projeto, simulados num servidor local. */
function servidorFalso() {
  const estado = { projetos: [], statusChamadas: 0, queryTentativas: 0, sql: '', auth: null, convites: [], pages: null };
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', c => { corpo += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const r = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      const b = corpo ? JSON.parse(corpo) : null;
      const tokenOk = /Bearer (sb-token|cf-token|svc-key)/.test(req.headers.authorization || '');
      if (!tokenOk) return r(401, { message: 'token inválido' });
      const p = u.pathname;
      if (p === '/sb/v1/projects' && req.method === 'GET') return r(200, estado.projetos);
      if (p === '/sb/v1/organizations') return r(200, [{ id: 'org-1', name: 'Minha organização' }]);
      if (p === '/sb/v1/projects' && req.method === 'POST') {
        const proj = { id: 'refabc', name: b.name, region: b.region, org: b.organization_id };
        estado.projetos.push(proj);
        return r(201, proj);
      }
      if (p === '/sb/v1/projects/refabc') return r(200, { id: 'refabc', status: ++estado.statusChamadas < 2 ? 'COMING_UP' : 'ACTIVE_HEALTHY' });
      if (p === '/sb/v1/projects/refabc/api-keys') return r(200, [{ name: 'anon', api_key: 'anon-publica' }, { name: 'service_role', api_key: 'svc-key' }]);
      if (p === '/sb/v1/projects/refabc/database/query') {
        if (++estado.queryTentativas === 1) return r(503, { message: 'database starting' });
        estado.sql = b.query;
        return r(201, []);
      }
      if (p === '/sb/v1/projects/refabc/config/auth') { estado.auth = b; return r(200, b); }
      if (p === '/cf/accounts') return r(200, { result: [{ id: 'conta-1', name: 'Conta DISPPAR' }] });
      if (p === '/cf/accounts/conta-1/pages/projects/cotacoes-disppar') return estado.pages ? r(200, { result: estado.pages }) : r(404, { errors: [{ message: 'not found' }] });
      if (p === '/cf/accounts/conta-1/pages/projects' && req.method === 'POST') {
        estado.pages = { name: b.name, production_branch: b.production_branch, subdomain: 'cotacoes-disppar.pages.dev' };
        return r(200, { result: estado.pages });
      }
      if (p === '/proj/auth/v1/invite') {
        if (estado.convites.includes(b.email)) return r(422, { msg: 'A user with this email address has already been registered' });
        estado.convites.push(b.email);
        estado.redirect = u.searchParams.get('redirect_to');
        return r(200, { email: b.email });
      }
      return r(404, { message: 'não simulado: ' + req.method + ' ' + p });
    });
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ srv, estado, porta: srv.address().port })));
}

test('robô de publicação: cria Supabase e Pages separados, banco, login, convite e config.js; pode rodar de novo', async () => {
  const { srv, estado, porta } = await servidorFalso();
  // cópia isolada: o robô escreve cotacao/config.js ao lado da pasta dele
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publicar-'));
  fs.mkdirSync(path.join(tmp, 'cotacao-supabase'));
  fs.mkdirSync(path.join(tmp, 'cotacao'));
  for (const f of ['publicar.mjs', 'schema.sql']) fs.copyFileSync(path.join(raiz, 'cotacao-supabase', f), path.join(tmp, 'cotacao-supabase', f));
  fs.writeFileSync(path.join(tmp, 'cotacao-supabase', 'publicar.json'), JSON.stringify({ email: 'Wes@Loja.com' }));
  const saida = path.join(tmp, 'saida.txt');
  // assíncrono: o servidor simulado roda neste mesmo processo
  const rodar = () => new Promise(ok => {
    const p = spawn(process.execPath, [path.join(tmp, 'cotacao-supabase', 'publicar.mjs')], {
      env: {
        ...process.env,
        SUPABASE_ACCESS_TOKEN: 'sb-token', CLOUDFLARE_API_TOKEN: 'cf-token', BRANCH: 'minha-branch', ESPERA_MS: '10',
        SUPABASE_API_URL: `http://127.0.0.1:${porta}/sb`, CLOUDFLARE_API_URL: `http://127.0.0.1:${porta}/cf`,
        SUPABASE_PROJETO_URL: `http://127.0.0.1:${porta}/proj`, GITHUB_OUTPUT: saida,
      },
    });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => { stdout += d; });
    p.stderr.on('data', d => { stderr += d; });
    p.on('close', status => ok({ status, stdout, stderr }));
  });
  try {
    const r1 = await rodar();
    assert.equal(r1.status, 0, r1.stderr + r1.stdout);
    assert.deepEqual(estado.projetos.map(p => [p.name, p.region, p.org]), [['cotacoes-disppar', 'sa-east-1', 'org-1']]);
    assert.match(estado.sql, /create table if not exists public\.cotacao_documentos/);
    assert.match(estado.sql, /values \(lower\('wes@loja\.com'\)\)/, 'e-mail liberado no SQL');
    assert.equal(estado.pages.production_branch, 'minha-branch');
    assert.deepEqual(estado.auth, { site_url: 'https://cotacoes-disppar.pages.dev', uri_allow_list: 'https://cotacoes-disppar.pages.dev/**', disable_signup: true });
    assert.deepEqual(estado.convites, ['wes@loja.com']);
    assert.equal(estado.redirect, 'https://cotacoes-disppar.pages.dev');
    const cfg = fs.readFileSync(path.join(tmp, 'cotacao', 'config.js'), 'utf8');
    assert.match(cfg, new RegExp(`supabaseUrl: 'http://127\\.0\\.0\\.1:${porta}/proj'`));
    assert.match(cfg, /supabaseAnonKey: 'anon-publica'/);
    assert.doesNotMatch(cfg + r1.stdout.replace(/::add-mask::svc-key/, ''), /svc-key/, 'a chave service_role não aparece em lugar nenhum');
    assert.match(fs.readFileSync(saida, 'utf8'), /conta=conta-1\nsite=https:\/\/cotacoes-disppar\.pages\.dev/);

    // segunda vez: reaproveita tudo, não cria nada de novo
    const r2 = await rodar();
    assert.equal(r2.status, 0, r2.stderr + r2.stdout);
    assert.equal(estado.projetos.length, 1);
    assert.match(r2.stdout, /Já existe \(ref refabc\)\. Reaproveitando\./);
    assert.match(r2.stdout, /Projeto Pages já existe/);
    assert.match(r2.stdout, /já existe: entre com a sua senha/);
  } finally {
    srv.close();
  }
});

test('robô de publicação: sem os segredos, para com a explicação', () => {
  const r = spawnSync(process.execPath, [path.join(raiz, 'cotacao-supabase', 'publicar.mjs')], {
    encoding: 'utf8', env: { PATH: process.env.PATH },
  });
  // sem publicar.json no repositório ainda, ou sem token: nos dois casos para antes de chamar qualquer API
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SUPABASE_ACCESS_TOKEN|publicar\.json|ENOENT/);
});
