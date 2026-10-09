import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fechar } from '../ajuda.mjs';
import { supabaseFalso, abrirSite, entrar } from '../supabase-falso.mjs';

after(fechar);
const aqui = path.dirname(fileURLToPath(import.meta.url));

test('exportar da nuvem para a Central e importar no servidor local: nada se perde', async () => {
  const docs = new Map([
    ['sistema/config', { loja: 'DISPPAR' }],
    ['produtos/b-00', { itens: [{ id: 'p1', codigo: 'GP33264', descricao: 'AMORTECEDOR', marca: 'SÓ COFAP' }] }],
    ['cotacoes/c1', { id: 'c1', numero: '0001', data: '2026-10-09', status: 'aberta', itens: [], fornecedores: [] }],
    ['qtds/c1', { qtds: { 0: { paranoa: 3 } } }],
  ]);
  const sb = supabaseFalso({ docs, admins: ['wes@loja.com'], liberados: ['wes@loja.com', 'compras@loja.com'] });
  const { page, context, erros } = await abrirSite(sb);
  await entrar(page, 'wes@loja.com', '123456');
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo' && nuvem.admin === true);
  await page.evaluate(() => { ui.abaConfig = 'backup'; ir('config'); });
  const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { window.showSaveFilePicker = undefined; }).then(() => page.click('[data-act=exportarParaCentral]'))]);
  const destino = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-')), 'exportacao-cotacao.json');
  await download.saveAs(destino);
  const exp = JSON.parse(fs.readFileSync(destino, 'utf8'));
  assert.deepEqual(Object.keys(exp.documentos).sort(), ['cotacoes/c1', 'produtos/b-00', 'qtds/c1', 'sistema/config']);
  assert.deepEqual(exp.usuarios.map(u => [u.email, u.admin]), [['wes@loja.com', true], ['compras@loja.com', false]]);
  // importa no servidor local
  const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
  const r = spawnSync(process.execPath, ['--no-warnings', 'importar.js', destino], { cwd: path.resolve(aqui, '..', '..', 'cotacao-servidor'), env: { ...process.env, PASTA_DADOS: dados }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const { DatabaseSync } = await import('node:sqlite');
  const banco = new DatabaseSync(path.join(dados, 'cotacao.db'), { readOnly: true });
  const qtds = JSON.parse(banco.prepare("SELECT dados FROM documentos WHERE caminho = 'qtds/c1'").get().dados);
  const us = banco.prepare('SELECT email, admin FROM usuarios ORDER BY email').all().map(u => [u.email, u.admin]);
  banco.close();
  assert.deepEqual(qtds, { qtds: { 0: { paranoa: 3 } } });
  assert.deepEqual(us, [['compras@loja.com', 0], ['wes@loja.com', 1]]);
  assert.deepEqual(erros, []);
  await context.close();
});
