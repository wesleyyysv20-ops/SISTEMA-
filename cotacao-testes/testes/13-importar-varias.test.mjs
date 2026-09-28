import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrir, base, fechar, salvarDepois, lerXlsx, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'varias-'));

test('importa várias planilhas respondidas de uma vez e mostra o resumo', async () => {
  const s = await abrir(base({
    cotacoes: [cotacao('c1', '0016', '2026-09-26', 'aberta', [item('A', 'AMORTECEDOR'), item('B', 'BOBINA')], [
      forn('f1', 'Auto Mix'), forn('f2', 'Via Peças'), forn('f3', 'Dist Sul')])],
  }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const precos = { 0: [10, 20], 1: [11, 19], 2: [12, null] };
  const arquivos = [];
  for (const fi of [0, 1, 2]) {
    const arq = await salvarDepois(s, () => page.click(`[data-act=baixarPlanilha][data-f="${fi}"]`));
    const wb = await lerXlsx(arq.buffer);
    const ws = wb.getWorksheet('Cotação');
    precos[fi].forEach((v, k) => { if (v != null) { ws.getCell(`G${3 + k}`).value = v; ws.getCell(`H${3 + k}`).value = 'MARCA' + fi; } });
    const f = path.join(tmp, arq.nome);
    await wb.xlsx.writeFile(f);
    arquivos.push(f);
  }
  const ruim = path.join(tmp, 'foto.xlsx');
  fs.writeFileSync(ruim, 'isto não é uma planilha');
  arquivos.push(ruim);

  await page.click('nav [data-route=cotacoes]');
  await page.setInputFiles('[data-import-geral]', arquivos);
  await page.waitForSelector('.dlg p');
  const resumo = n(await page.locator('.dlg p').innerText());
  assert.match(resumo, /^3 de 4 planilha\(s\) importada\(s\):/);
  assert.match(resumo, /✓ Auto Mix: 2 preço\(s\)/);
  assert.match(resumo, /✓ Via Peças: 2 preço\(s\)/);
  assert.match(resumo, /✓ Dist Sul: 1 preço\(s\)/);
  assert.match(resumo, /✗ foto\.xlsx: O arquivo "foto\.xlsx" não está no formato Excel/);
  await page.click('.dlg button');
  assert.match(await page.locator('#app h2').first().innerText(), /Cotação nº 0016/, 'abre a cotação importada');
  const menores = await page.locator('.tab-comp tbody tr').evaluateAll(rs => rs.slice(0, 2).map(r => r.querySelector('td.best')?.innerText.split('\n')[0].replace(/ /g, ' ')));
  assert.deepEqual(menores, ['R$ 10,00', 'R$ 19,00']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
