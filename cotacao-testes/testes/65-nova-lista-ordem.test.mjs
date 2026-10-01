import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, n } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  produtos: [{ id: 'p1', codigo: 'ZZ9', descricao: 'AMORTECEDOR', marca: 'COFAP' }, { id: 'p2', codigo: 'AA1', descricao: 'VELA', marca: 'NGK', similar: 'BKR6' }, { id: 'p3', codigo: 'MM5', descricao: 'BOMBA', marca: 'URBA' }],
  rascunho: { titulo: '', prazoResposta: '', obs: '', fornecedorIds: [], itens: [{ produtoId: 'p1', obsArquivo: ['24'] }, { produtoId: 'p2', obsArquivo: ['08 XX'] }, { produtoId: 'p3', obsArquivo: ['15'] }] },
});
const codigos = page => page.locator('[data-item-linha] td:nth-child(2)').evaluateAll(tds => tds.map(td => td.innerText.split('\n')[0].trim()));

test('nova cotação: "Preencher padrão" completa título e prazo sem perder os itens', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=nova]');
  await page.click('[data-act=preencherPadraoNova]');
  const r = await page.evaluate(() => rascunho());
  assert.match(r.titulo, /^COTAÇÃO \d+ DE /);
  assert.match(r.prazoResposta, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.itens.length, 3, 'itens continuam');
  assert.equal(await page.locator('[data-act=preencherPadraoNova]').count(), 0, 'nada mais a preencher (não há observação anterior para copiar)');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('nova cotação: ordem por descrição, OBS ou código; similar recolhido em "+ similar"', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=nova]');
  assert.deepEqual(await codigos(page), ['ZZ9', 'MM5', 'AA1'], 'descrição A→Z');
  await page.click('[data-act=ordemItens][data-ordem=obs]');
  assert.deepEqual(await codigos(page), ['AA1', 'MM5', 'ZZ9'], 'OBS 08, 15, 24');
  await page.click('[data-act=ordemItens][data-ordem=cod]');
  assert.deepEqual(await codigos(page), ['AA1', 'MM5', 'ZZ9']);
  // similar: sem coluna própria
  assert.equal(await page.locator('#tabItens thead th').count(), 5);
  assert.match(await page.locator('[data-item-linha="0"] .sim-item summary').innerText(), /^BKR6 ✎$/);
  await page.locator('[data-item-linha="1"] .sim-item summary').click();
  await page.fill('[data-item-linha="1"] [data-similar-prod]', 'UB629');
  await page.press('[data-item-linha="1"] [data-similar-prod]', 'Tab');
  assert.equal(await page.evaluate(() => db.produtos.find(p => p.id === 'p3').similar), 'UB629');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
