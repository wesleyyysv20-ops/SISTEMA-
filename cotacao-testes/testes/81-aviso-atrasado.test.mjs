import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fechar } from '../ajuda.mjs';
import { supabaseFalso, abrirSite, entrar } from '../supabase-falso.mjs';

after(fechar);

const cot = { id: 'c1', numero: '0001', data: '2026-10-06', status: 'aberta', itens: [], fornecedores: [] };

test('tempo real: aviso atrasado (eco de gravação antiga) não desfaz as quantidades digitadas', async () => {
  const sb = supabaseFalso({ docs: new Map([['sistema/config', { loja: 'DISPPAR' }], ['cotacoes/c1', cot], ['qtds/c1', { qtds: {} }]]) });
  const { page, context, erros } = await abrirSite(sb);
  await entrar(page, 'wes@loja.com', '123456');
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo');
  const esperarSalvo = () => page.waitForFunction(() => !nuvem.gravando && !nuvem.timer && document.querySelector('#statusNuvem')?.dataset.s === 'salvo');
  // 1ª gravação (item 1) e 2ª (item 2): guarda a versão da 1ª para simular o eco atrasado
  await page.evaluate(() => { db.cotacoes[0].qtds = { 0: { paranoa: 1 } }; salvar(); });
  await esperarSalvo();
  const v1 = await page.evaluate(() => nuvem.versao['qtds/c1']);
  await page.evaluate(() => { db.cotacoes[0].qtds = { 0: { paranoa: 1 }, 1: { paranoa: 2 } }; salvar(); });
  await esperarSalvo();
  // chega o eco da 1ª gravação, atrasado: não pode voltar para { 0: 1 }
  await page.evaluate(v => { nuvem.recebidos = { 'qtds/c1': { existe: true, dados: { qtds: { 0: { paranoa: 1 } } }, versao: v } }; return puxarNuvem(true); }, v1);
  assert.deepEqual(await page.evaluate(() => db.cotacoes[0].qtds), { 0: { paranoa: 1 }, 1: { paranoa: 2 } });
  // um aviso realmente mais novo (outro computador) vale
  await page.evaluate(() => { nuvem.recebidos = { 'qtds/c1': { existe: true, dados: { qtds: { 0: { paranoa: 1 }, 1: { paranoa: 2 }, 2: { paranoa: 5 } } }, versao: '2099-01-01T00:00:00.000001+00:00' } }; return puxarNuvem(true); });
  assert.deepEqual(await page.evaluate(() => db.cotacoes[0].qtds[2]), { paranoa: 5 });
  assert.deepEqual(erros, []);
  await context.close();
});
