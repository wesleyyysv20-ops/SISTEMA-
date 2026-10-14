import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

// Ação numa linha do comparativo troca só as linhas que mudaram (o resto da tabela fica como está),
// e a tela fica igual à que seria desenhada do zero.
const N = 30;
const itens = Array.from({ length: N }, (_, i) => item('P' + i, 'PECA ' + i, 'QUALQUER', { codigo: 'COD-' + i }));
const resp = d => Object.fromEntries(itens.map((_, i) => [i, { preco: 10 + i + d, marca: 'COFAP' }]));
const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sobradinho', nome: 'São Sebastião', sigla: 'DSS' }] },
  cotacoes: [cotacao('c1', '0001', '2026-10-14', 'aberta', itens, [forn('f1', 'KAIZEN', resp(0)), forn('f2', 'VIA PEÇAS', resp(1)), forn('f3', 'DPK', resp(2))])],
});

test('comparativo: ação numa linha redesenha só o que mudou e fica igual ao desenho completo', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.locator('tr[data-comp-linha="0"]').waitFor();
  // linhas alternadas pela classe .par (2ª, 4ª…), como era o :nth-child(even)
  assert.deepEqual(await page.$$eval('.tab-comp tbody tr[data-comp-linha]', trs => trs.slice(0, 4).map(tr => tr.classList.contains('par'))), [false, true, false, true]);
  const igualAoCompleto = () => page.evaluate(() => {
    const limpo = h => h.replace(/ data-label="[^"]*"| data-rot="1"/g, '');
    const rapido = limpo(document.getElementById('app').innerHTML);
    telaDesenhada = null; // força o desenho completo
    render();
    return rapido === limpo(document.getElementById('app').innerHTML);
  });
  const marcar = () => page.evaluate(() => { document.querySelectorAll('.tab-comp tbody tr[data-comp-linha]').forEach(tr => { tr.__antigo = true; }); });
  const trocadas = () => page.$$eval('.tab-comp tbody tr[data-comp-linha]', trs => trs.filter(tr => !tr.__antigo).map(tr => +tr.dataset.compLinha));

  // já comprado: só a linha do item muda
  await marcar();
  await page.click('tr[data-comp-linha="5"] [data-act=marcarComprado]');
  assert.deepEqual(await trocadas(), [5]);
  assert.ok(await page.locator('tr[data-comp-linha="5"]').evaluate(tr => tr.classList.contains('linha-comprada')));
  assert.ok(await page.locator('.pill-aviso.comprado').isVisible(), 'etiqueta "já comprado" aparece');
  assert.ok(await igualAoCompleto());

  // escolher outro fornecedor (com confirmação)
  await marcar();
  await page.click('tr[data-comp-linha="7"] td[data-act=escolherVencedor][data-f="1"]');
  await page.click('.dlg button.primary');
  await page.locator('tr[data-comp-linha="7"] .tag-escolha').waitFor();
  assert.deepEqual(await trocadas(), [5, 7], 'a 7 e a 5 (que deixou de ser a linha atual)');
  assert.ok(await igualAoCompleto());

  // quantidade digitada continua no campo e o foco fica nele depois do redesenho
  const q = page.locator('tr[data-comp-linha="9"] input.qtd-loja').first();
  await q.click();
  await page.keyboard.type('4');
  await page.evaluate(() => render());
  assert.equal(await page.locator('tr[data-comp-linha="9"] input.qtd-loja').first().inputValue(), '4');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('tr')?.dataset.compLinha), '9');

  // Ctrl+Z desfaz a quantidade e depois a escolha; a tela continua igual ao desenho completo
  await page.click('h3');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => document.querySelector('tr[data-comp-linha="9"] input.qtd-loja').value === '');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => !document.querySelector('tr[data-comp-linha="7"] .tag-escolha'));
  assert.ok(await igualAoCompleto());

  // filtro "Itens de" esconde as linhas dos outros e volta
  await page.evaluate(() => { ui.filtroVenc = { cotId: 'c1', valor: 'f2' }; render(); });
  assert.ok(await page.locator('tr[data-comp-linha="0"]').evaluate(tr => tr.hidden));
  assert.ok(await igualAoCompleto());
  await page.evaluate(() => { ui.filtroVenc = null; render(); });
  assert.equal(await page.locator('.tab-comp tbody tr[data-comp-linha][hidden]').count(), 0);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
