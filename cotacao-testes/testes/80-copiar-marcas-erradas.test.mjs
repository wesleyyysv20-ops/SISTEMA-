import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara } from '../ajuda.mjs';

after(fechar);

test('análise do fornecedor: copia TODAS as marcas erradas, separadas por cotação', async () => {
  const itens = Array.from({ length: 20 }, (_, i) => item('P' + i, 'PECA ' + i, 'SÓ COFAP', { codigo: 'COD' + i }));
  const resp = Object.fromEntries(itens.map((_, i) => [i, { preco: 10 + i, marca: 'PARAFLU' }]));
  const s = await abrir(base({
    fornecedores: [{ id: 'f1', nome: 'KAIZEN' }, { id: 'f2', nome: 'VIA' }],
    cotacoes: [
      cotacao('c1', '0008', '2026-10-01', 'aberta', itens, [forn('f1', 'KAIZEN', resp), forn('f2', 'VIA', null)]),
      cotacao('c2', '0009', '2026-10-02', 'aberta', itens.slice(0, 3), [forn('f1', 'KAIZEN', resp), forn('f2', 'VIA', null)]),
    ],
  }));
  const { page } = s;
  await page.evaluate(() => { window.copiado = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.copiado = t; } } }); });
  await irPara(page, 'relatorios');
  await page.click('#notaFornecedores tbody tr:has-text("KAIZEN") [data-act=analiseForn]');
  await page.click('.dlg-analise-forn .af-copiar-erradas');
  const txt = await page.waitForFunction(() => window.copiado).then(h => h.jsonValue());
  assert.match(txt, /\*KAIZEN — itens com marca diferente da pedida \(23\)\*/);
  assert.equal((txt.match(/^• /gm) || []).length, 23, 'todas, não só as 15 primeiras');
  assert.match(txt, /\*Cotação nº 0008\*[\s\S]*COD19 — PECA 19\n   pedida: SÓ COFAP \| enviada: PARAFLU/);
  assert.match(txt, /\*Cotação nº 0009\*/);
  assert.equal(await page.locator('.dlg-analise-forn .af-mini li').count(), 23, 'a lista na tela também mostra todas');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
