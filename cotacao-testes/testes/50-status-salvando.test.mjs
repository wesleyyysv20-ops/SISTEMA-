import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fechar } from '../ajuda.mjs';
import { supabaseFalso, abrirSite, entrar } from '../supabase-falso.mjs';

after(fechar);

test('indicador de salvamento: salvar rápido não pisca "Salvando…"; só aparece se demorar', async () => {
  const sb = supabaseFalso({ docs: new Map([['sistema/config', { loja: 'DISPPAR' }]]) });
  const { page, context, erros } = await abrirSite(sb);
  await entrar(page, 'wes@loja.com', '123456');
  await page.waitForSelector('#telaLogin', { state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo' && !nuvem.gravando && !nuvem.timer);
  // anota todos os textos que o indicador mostrar
  await page.evaluate(() => { window.__textos = []; new MutationObserver(() => __textos.push(document.querySelector('#statusNuvem').textContent)).observe(document.querySelector('#statusNuvem'), { childList: true, characterData: true, subtree: true }); });
  await page.evaluate(() => { db.config.loja = 'DISPPAR 2'; salvar(); return sincronizar(); });
  await page.waitForFunction(() => !nuvem.gravando && !nuvem.timer);
  await page.waitForTimeout(1800);
  assert.deepEqual(await page.evaluate(() => __textos), [], 'não trocou o texto');
  // salvamento demorado (internet lenta): aí avisa
  await context.route('**/rest/v1/cotacao_documentos**', async route => { await new Promise(r => setTimeout(r, 2500)); return sb.handler(route); });
  await page.evaluate(() => { db.config.loja = 'DISPPAR 3'; salvar(); sincronizar(); });
  await page.waitForFunction(() => document.querySelector('#statusNuvem').textContent === 'Salvando…', null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('#statusNuvem').textContent === 'Salvo na nuvem', null, { timeout: 10000 });
  assert.deepEqual(erros, []);
  await context.close();
});
