import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { navegador, fechar } from '../ajuda.mjs';

// Servidor local da Central DISPPAR: o mesmo sistema, com os dados no computador da loja (sem Supabase)
const aqui = path.dirname(fileURLToPath(import.meta.url));
const PASTA_SERVIDOR = path.resolve(aqui, '..', '..', 'cotacao-servidor');
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'cotacao-local-'));
const PORTA = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORTA}`;
const env = { ...process.env, PASTA_DADOS: dados, PORTA: String(PORTA), SEM_LINK: '1' };
let srv;

before(async () => {
  const r = spawnSync(process.execPath, ['--no-warnings', 'criar-admin.js', 'chefe@disppar.com', 'senha123', 'Chefe'], { cwd: PASTA_SERVIDOR, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  srv = spawn(process.execPath, ['--no-warnings', 'index.js'], { cwd: PASTA_SERVIDOR, env, stdio: 'pipe' });
  for (let k = 0; k < 50; k++) {
    try { if ((await fetch(BASE + '/api/status')).ok) return; } catch { /* ainda ligando */ }
    await new Promise(r2 => setTimeout(r2, 200));
  }
  throw new Error('o servidor local não ligou');
});
after(async () => { srv?.kill(); await fechar(); fs.rmSync(dados, { recursive: true, force: true }); });

async function entrar(email, senha) {
  const b = await navegador();
  const context = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await context.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await page.goto(BASE + '/');
  await page.waitForSelector('#telaLogin form');
  await page.fill('#telaLogin [name=email]', email);
  await page.fill('#telaLogin [name=senha]', senha);
  await page.click('#telaLogin button[type=submit]');
  return { page, context, erros };
}
const salvo = page => page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo' && !nuvem.gravando && !nuvem.timer);

test('servidor local: login, gravar, recarregar e outro computador vendo a mudança', async () => {
  const st = await (await fetch(BASE + '/api/status')).json();
  assert.equal(st.sistema, 'cotacao');
  // senha errada
  const A = await entrar('chefe@disppar.com', 'errada');
  await A.page.waitForFunction(() => /incorretos/.test(document.querySelector('#telaLogin .login-msg')?.textContent || ''));
  await A.page.fill('#telaLogin [name=senha]', 'senha123');
  await A.page.click('#telaLogin button[type=submit]');
  await A.page.waitForSelector('#telaLogin', { state: 'hidden' });
  await salvo(A.page);
  assert.equal(await A.page.evaluate(() => nuvem.local), true, 'modo servidor local');
  // configura a loja e cadastra um produto: vai para o banco do servidor
  await A.page.evaluate(() => {
    db.config.loja = 'DISPPAR';
    db.produtos.push({ id: 'p1', codigo: 'GP33264', descricao: 'AMORTECEDOR DIANT', unidade: 'UN', marca: 'SÓ COFAP', categoria: '' });
    salvar();
  });
  await salvo(A.page);
  await A.page.waitForTimeout(1500);
  // no banco do servidor (o arquivo cotacao.db)
  const { DatabaseSync } = await import('node:sqlite');
  const banco = new DatabaseSync(path.join(dados, 'cotacao.db'), { readOnly: true });
  const prods = banco.prepare("SELECT dados FROM documentos WHERE colecao = 'produtos'").all().flatMap(l => JSON.parse(l.dados).itens);
  banco.close();
  assert.deepEqual(prods.map(p => p.codigo), ['GP33264']);
  // recarregar: continua logado e os dados vêm do servidor
  await A.page.evaluate(() => localStorage.removeItem('sistemaCotacao.v1'));
  await A.page.reload();
  await salvo(A.page);
  assert.equal(await A.page.locator('#telaLogin:not([hidden])').count(), 0, 'sessão lembrada');
  assert.equal(await A.page.evaluate(() => db.produtos[0]?.codigo), 'GP33264');
  // o administrador cadastra outra pessoa
  await A.page.evaluate(() => nuvem.supabase.rpc('cotacao_adicionar_usuario', { p_email: 'compras@disppar.com', p_senha: 'compras1', p_nome: 'Compras', p_admin: false }));
  // outro computador entra e vê o produto; o que ele grava chega no primeiro em poucos segundos
  const Bc = await entrar('compras@disppar.com', 'compras1');
  await Bc.page.waitForSelector('#telaLogin', { state: 'hidden' });
  await salvo(Bc.page);
  assert.equal(await Bc.page.evaluate(() => db.produtos[0]?.codigo), 'GP33264');
  assert.equal(await Bc.page.evaluate(() => nuvem.admin), false, 'não é administrador');
  await Bc.page.evaluate(() => { db.produtos.push({ id: 'p2', codigo: 'BKR6E', descricao: 'VELA', unidade: 'UN', marca: 'NGK', categoria: '' }); salvar(); });
  await salvo(Bc.page);
  await A.page.waitForFunction(() => db.produtos.some(p => p.codigo === 'BKR6E'), null, { timeout: 15000 });
  // backups pelo servidor
  const lista = await A.page.evaluate(async () => { await nuvem.supabase.rpc('cotacao_backup_agora', { p_motivo: 'manual' }); return (await nuvem.supabase.rpc('cotacao_listar_backups')).data; });
  assert.ok(lista.length >= 1 && /manual \(chefe@disppar\.com\)/.test(lista[0].motivo));
  assert.deepEqual(A.erros, []);
  assert.deepEqual(Bc.erros, []);
  await A.context.close();
  await Bc.context.close();
});

test('servidor local: sem login não lê nem grava nada', async () => {
  const r = await fetch(BASE + '/rest/v1/cotacao_documentos?select=caminho');
  assert.deepEqual(await r.json(), []);
  const w = await fetch(BASE + '/rest/v1/cotacao_documentos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caminho: 'sistema/x', dados: {} }) });
  assert.equal(w.status, 403);
  const adm = await fetch(BASE + '/rest/v1/rpc/cotacao_listar_usuarios', { method: 'POST', body: '{}' });
  assert.equal(adm.status, 401);
  const fora = await fetch(BASE + '/../../banco.js');
  assert.notEqual(fora.status, 200);
});
