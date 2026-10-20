import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n } from '../ajuda.mjs';

after(fechar);

const LOJAS = [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }];
const dados = (extra = {}) => base({
  config: { loja: 'DISPPAR', lojas: LOJAS },
  fornecedores: [{ id: 'f1', nome: 'KAIZEN' }, { id: 'f2', nome: 'VIA PEÇAS' }],
  cotacoes: [
    cotacao('c0', '0001', '2026-09-01', 'finalizada', [item('A', 'PASTILHA FREIO', 'QUALQUER', { codigo: 'PD1' })], [forn('f1', 'KAIZEN', { 0: { preco: 100, marca: 'FRAS LE' } })], { qtds: { 0: { paranoa: 1 } } }),
    cotacao('c1', '0002', '2026-10-10', 'aberta', [
      item('A', 'PASTILHA FREIO', 'QUALQUER', { codigo: 'PD1' }), item('B', 'LONA FREIO', 'QUALQUER', { codigo: 'LN2' }), item('C', 'DISCO FREIO', 'QUALQUER', { codigo: 'DF3' }),
    ], [
      forn('f1', 'KAIZEN', { 0: { preco: 120, marca: 'FRAS LE' }, 1: { preco: 30, marca: 'FRAS LE' }, 2: { preco: 80, marca: 'FREMAX' } }),
      forn('f2', 'VIA PEÇAS', { 0: { preco: 130, marca: 'FRA' }, 1: { preco: 31, marca: 'FRA' }, 2: { preco: 85, marca: 'HIPPER' } }),
    ], extra),
  ],
});

test('comparativo sem quantidade: o total mostra o preço de 1 un.; quantidade vazia é diferente de 0', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'cotacao', 'c1');
  assert.match(n(await page.locator('#tot-0').innerText()), /R\$ 120,00\/un\.\s*sem qtd\./);
  assert.equal(await page.locator('[data-qtd-loja="paranoa"][data-i="0"]').getAttribute('placeholder'), '');
  // variação contra o último preço pago (100 → 120)
  assert.match(n(await page.locator('tr[data-comp-linha="0"] .ult-preco').innerText()), /último R\$ 100,00 ▲ 20,0%/);
  // ações todas juntas na última linha da célula do preço escolhido
  const acoes = await page.locator('tr[data-comp-linha="0"] td.col-escolhido > :last-child').evaluate(el => [el.className, [...el.querySelectorAll('button')].map(b => b.dataset.act)]);
  assert.deepEqual(acoes, ['esc-acoes', ['duvidaItem', 'removerPreco', 'dividirCompra', 'marcarComprado']]);
  assert.match(await page.locator('.legenda-comp').innerText(), /sem preço[\s\S]*dividir compra/);
  assert.equal(await page.locator('.filtro-venc-rot').first().isVisible(), true);
  // digitar a quantidade: o total do item passa a ser o valor do pedido
  await page.fill('[data-qtd-loja="paranoa"][data-i="0"]', '2');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /240,00/.test(document.getElementById('tot-0').innerText));
  assert.match(n(await page.locator('#tot-1').innerText()), /sem qtd/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('dicionário de marcas: sugere FRA = FRAS LE, junta e o filtro conta tudo junto', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'cotacao', 'c1');
  const opcoes = () => page.locator('#filtroMarca option').allInnerTexts();
  assert.ok((await opcoes()).includes('FRA (2)'));
  await page.click('.ajuda-comp summary'); // o atalho fica em "mais opções"
  await page.click('[data-act=irDicionarioMarcas]');
  const sug = page.locator('.dic-sug-item', { hasText: 'FRA' }).first();
  assert.match(n(await sug.innerText()), /FRA \(2×\) → FRAS LE \(3×\)/);
  await sug.locator('[data-act=juntarDicMarca]').click();
  assert.deepEqual(await page.evaluate(() => db.config.dicionarioMarcas), { FRA: 'FRAS LE' });
  assert.match(await page.locator('#dicMarcas table').innerText(), /FRAS LE[\s\S]*FRA/);
  await irPara(page, 'cotacao', 'c1');
  const ops = await opcoes();
  assert.ok(ops.includes('FRAS LE (2)'), ops.join(' | '));
  assert.ok(!ops.some(o => /^FRA \(/.test(o)), 'FRA não aparece mais separado');
  // a resposta continua guardada como o fornecedor escreveu
  assert.equal(await page.evaluate(() => db.cotacoes[1].fornecedores[1].respostas[0].marca), 'FRA');
  assert.equal(await page.locator('[data-act=irDicionarioMarcas]').count(), 0, 'sem sugestões, o atalho some');
  // separar de novo
  await page.evaluate(() => acoes.irDicionarioMarcas());
  await page.click('[data-act=tirarDicMarca][data-k=FRA]');
  assert.deepEqual(await page.evaluate(() => db.config.dicionarioMarcas), {});
  // juntar pelo formulário
  await page.fill('[data-form=dicMarca] [name=marca]', 'Hipper Freios');
  await page.fill('[data-form=dicMarca] [name=formas]', 'hipper, hipper fre');
  await page.click('[data-form=dicMarca] button');
  assert.deepEqual(await page.evaluate(() => db.config.dicionarioMarcas), { HIPPER: 'HIPPER FREIOS', 'HIPPER FRE': 'HIPPER FREIOS' });
  assert.equal(await page.evaluate(() => normMarca('Hipper')), 'HIPPER FREIOS');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
