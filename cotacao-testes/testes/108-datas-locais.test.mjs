import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

// 22h30 em Brasília já é o dia seguinte em UTC (toISOString): as datas de calendário têm de ser as daqui.
test('datas de calendário no horário de Brasília, mesmo depois das 21h', async () => {
  const s = await abrir(base({
    config: { loja: 'DISPPAR', arquivarDias: 60 },
    cotacoes: [
      cotacao('c1', '0001', '2026-10-01', 'finalizada', [item('A', 'PECA A')], [forn('f1', 'KAIZEN')]), // mês atual: fica na lista
      cotacao('c2', '0002', '2026-09-30', 'finalizada', [item('A', 'PECA A')], [forn('f1', 'KAIZEN')]), // mês anterior: sugere arquivar
    ],
  }));
  const { page } = s;
  await page.clock.setFixedTime(new Date('2026-10-15T22:30:00-03:00'));
  assert.equal(await page.evaluate(() => new Date().toISOString().slice(0, 10)), '2026-10-16', 'em UTC já é o dia seguinte');
  assert.equal(await page.evaluate(() => hojeISO()), '2026-10-15');
  assert.equal(await page.evaluate(() => dataISOLocal(new Date())), '2026-10-15');

  // adiar o backup: amanhã (16), não depois de amanhã
  await page.evaluate(() => acoes.adiarBackup());
  assert.equal(await page.evaluate(() => db.backupAdiadoAte), '2026-10-16');

  // arquivar: finalizadas dos meses anteriores ao mês de hoje (pelo horário daqui)
  assert.deepEqual(await page.evaluate(() => paraArquivar().map(c => c.id)), ['c2']);

  // relatórios "últimos 7 dias": desde 08/10
  assert.equal(await page.evaluate(() => { ui.periodoRel = '7'; return inicioPeriodo(); }), '2026-10-08');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
