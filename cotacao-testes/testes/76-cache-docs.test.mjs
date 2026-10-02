import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fechar } from '../ajuda.mjs';
import { supabaseFalso, abrirSite, entrar } from '../supabase-falso.mjs';

after(fechar);

const cot = (id, n) => ({ id, numero: n, data: '2026-10-01', status: 'aberta', itens: [], fornecedores: [] });

test('ao abrir de novo, só baixa do Supabase o que mudou (cópia neste computador)', async () => {
  const sb = supabaseFalso({ docs: new Map([
    ['sistema/config', { loja: 'DISPPAR' }],
    ['cotacoes/c1', cot('c1', '0001')],
    ['cotacoes/c2', cot('c2', '0002')],
  ]) });
  const { page, context, erros } = await abrirSite(sb);
  await entrar(page, 'wes@loja.com', '123456');
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo');
  await page.waitForTimeout(3500); // a cópia é gravada depois de uma pausa
  // outro computador muda a c2 (nova versão no banco)
  sb.docs.set('cotacoes/c2', { ...cot('c2', '0002'), titulo: 'MUDOU' });
  sb.vers.set('cotacoes/c2', '2026-02-01T00:00:00.000001+00:00');
  sb.log.length = 0;
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo');
  const gets = sb.log.filter(l => l.startsWith('GET'));
  assert.ok(!gets.some(l => /^GET (sistema|cotacoes)$/.test(l)), 'não baixou as coleções inteiras: ' + gets.join(' | '));
  assert.deepEqual(gets.filter(l => l !== 'GET *'), ['GET cotacoes/c2'], 'só a cotação que mudou');
  assert.equal(await page.evaluate(() => db.cotacoes.map(c => c.numero).sort().join()), '0001,0002');
  assert.equal(await page.evaluate(() => db.cotacoes.find(c => c.id === 'c2').titulo), 'MUDOU');
  // salvar depois de abrir pela cópia continua funcionando (versão certa)
  await page.evaluate(() => { db.cotacoes.find(c => c.id === 'c1').titulo = 'NOVO'; salvar(); });
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo' && !nuvem.gravando && !nuvem.timer);
  await page.waitForTimeout(1500);
  assert.equal(sb.docs.get('cotacoes/c1').titulo, 'NOVO');
  assert.deepEqual(erros, []);
  await context.close();
});

test('quantidades num documento próprio: migra as cotações antigas sem perder nada', async () => {
  const sb = supabaseFalso({ docs: new Map([
    ['sistema/config', { loja: 'DISPPAR' }],
    ['cotacoes/c1', { ...cot('c1', '0001'), qtds: { 0: { paranoa: 5 } } }], // gravada pela versão antiga
  ]) });
  const { page, context, erros } = await abrirSite(sb);
  await entrar(page, 'wes@loja.com', '123456');
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo');
  assert.deepEqual(await page.evaluate(() => db.cotacoes[0].qtds), { 0: { paranoa: 5 } }, 'leu as quantidades de dentro da cotação');
  await page.evaluate(() => { db.cotacoes[0].qtds[1] = { paranoa: 2 }; salvar(); });
  await page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo' && !nuvem.gravando && !nuvem.timer);
  await page.waitForTimeout(1500);
  assert.deepEqual(sb.docs.get('qtds/c1'), { qtds: { 0: { paranoa: 5 }, 1: { paranoa: 2 } } });
  assert.equal(sb.docs.get('cotacoes/c1').qtds, undefined);
  // uma versão antiga em outro computador apaga o documento das quantidades: ele volta e nada se perde
  sb.docs.delete('qtds/c1'); sb.vers.delete('qtds/c1');
  await page.evaluate(() => puxarNuvem());
  await page.waitForFunction(() => !nuvem.gravando && !nuvem.timer);
  await page.waitForTimeout(2000);
  assert.deepEqual(await page.evaluate(() => db.cotacoes[0].qtds), { 0: { paranoa: 5 }, 1: { paranoa: 2 } });
  assert.deepEqual(sb.docs.get('qtds/c1'), { qtds: { 0: { paranoa: 5 }, 1: { paranoa: 2 } } }, 'gravou de novo');
  assert.deepEqual(erros, []);
  await context.close();
});
