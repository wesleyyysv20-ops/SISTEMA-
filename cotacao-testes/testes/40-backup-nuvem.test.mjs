import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fechar, n } from '../ajuda.mjs';
import { supabaseFalso, abrirSite, entrar } from '../supabase-falso.mjs';

after(fechar);

const esperarSalvo = page => page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo' && !nuvem.gravando && !nuvem.timer, null, { timeout: 15000 });

test('backup no Supabase: administrador faz cópia, baixa e restaura (guardando o estado atual antes)', async () => {
  const sb = supabaseFalso({
    admins: ['wes@loja.com'],
    docs: new Map([['sistema/config', { loja: 'DISPPAR' }], ['fornecedores/b-00', { itens: [{ id: 'f1', nome: 'KAIZEN' }] }]]),
  });
  const { page, context, erros } = await abrirSite(sb);
  await entrar(page, 'wes@loja.com', '123456');
  await page.waitForSelector('#telaLogin', { state: 'hidden' });
  await esperarSalvo(page);
  await page.waitForFunction(() => nuvem.admin === true);
  // sem lembrete de backup em arquivo: no Supabase é automático
  assert.equal(await page.locator('.aviso-backup').count(), 0);
  await page.evaluate(() => { ui.abaConfig = 'backup'; ir('config'); });
  await page.waitForSelector('[data-act=backupNuvemAgora]');
  assert.match(n(await page.locator('#app').innerText()), /Cópias automáticas[\s\S]*duas vezes por dia[\s\S]*Nenhuma cópia ainda/);

  // cópia agora (com o KAIZEN)
  await page.click('[data-act=backupNuvemAgora]');
  await page.waitForSelector('[data-act=restaurarBackupNuvem]');
  assert.match(n(await page.locator('#app table').last().innerText()), /mais nova\s+manual \(wes@loja\.com\)\s+2/);

  // muda os dados: outro fornecedor, e o KAIZEN sai
  await page.evaluate(() => { db.fornecedores = [{ id: 'f2', nome: 'VIA PEÇAS' }]; salvar(); return sincronizar(); });
  await esperarSalvo(page);
  const fornsNuvem = () => [...sb.docs].filter(([k]) => k.startsWith('fornecedores/')).flatMap(([, v]) => v.itens.map(f => f.nome));
  assert.deepEqual(fornsNuvem(), ['VIA PEÇAS']);

  // baixar a cópia: arquivo no formato do backup do sistema
  await page.evaluate(() => { window.__salvos = []; window.showSaveFilePicker = async o => ({ name: o.suggestedName, createWritable: async () => ({ write: async blob => window.__salvos.push({ nome: o.suggestedName, txt: await blob.text() }), close: async () => {} }) }); });
  await page.click('[data-act=baixarBackupNuvem]');
  await page.waitForFunction(() => window.__salvos.length === 1);
  const arq = await page.evaluate(() => window.__salvos[0]);
  assert.match(arq.nome, /^backup_cotacoes_\d{4}-\d\d-\d\d_\d\dh\d\d\.json$/);
  assert.deepEqual(JSON.parse(arq.txt).fornecedores.map(f => f.nome), ['KAIZEN']);

  // restaurar: pede confirmação; antes guarda o estado atual
  await page.click('[data-act=restaurarBackupNuvem]');
  assert.match(n(await page.locator('.dlg').innerText()), /Voltar os dados para a cópia[\s\S]*1 fornecedores[\s\S]*guarda uma cópia do estado atual/);
  await page.click('.dlg button.primary');
  await page.waitForFunction(() => db.fornecedores.map(f => f.nome).join() === 'KAIZEN');
  await esperarSalvo(page);
  assert.equal(sb.backups[0].motivo, 'antes de restaurar (wes@loja.com)');
  assert.deepEqual(Object.values(sb.backups[0].dados).flatMap(v => v.itens || []).map(f => f.nome), ['VIA PEÇAS'], 'o estado de antes ficou guardado');
  assert.deepEqual(fornsNuvem(), ['KAIZEN'], 'na nuvem voltou');
  assert.deepEqual(erros, []);
  await context.close();
});

test('backup no Supabase: quem não é administrador só vê o aviso', async () => {
  const sb = supabaseFalso({ docs: new Map([['sistema/config', { loja: 'DISPPAR' }]]) });
  const { page, context, erros } = await abrirSite(sb);
  await entrar(page, 'wes@loja.com', '123456');
  await page.waitForSelector('#telaLogin', { state: 'hidden' });
  await esperarSalvo(page);
  await page.evaluate(() => { ui.abaConfig = 'backup'; ir('config'); });
  assert.match(n(await page.locator('#app').innerText()), /Cópias automáticas[\s\S]*Um administrador pode baixar ou restaurar/);
  assert.equal(await page.locator('[data-act=backupNuvemAgora]').count(), 0);
  assert.deepEqual(erros, []);
  await context.close();
});
