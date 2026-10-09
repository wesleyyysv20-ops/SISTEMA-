import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n } from '../ajuda.mjs';

after(fechar);

test('aba Fornecedores: incluir na cotação aberta, enviar e importar a resposta de lá; cotação com barra de seções', async () => {
  const s = await abrir(base({
    fornecedores: [{ id: 'f1', nome: 'KAIZEN', email: 'k@x.com' }, { id: 'f2', nome: 'VIA PEÇAS' }],
    cotacoes: [cotacao('c1', '0001', '2026-10-09', 'aberta', [item('A', 'VELA', 'QUALQUER', { codigo: 'BKR6E' })], [forn('f1', 'KAIZEN', null)])],
  }));
  const { page } = s;
  await irPara(page, 'fornecedores');
  assert.match(n(await page.locator('.barra-cot-forn').innerText()), /nº 0001/);
  const linha = nome => page.locator('#tbForn tr', { hasText: nome });
  assert.match(n(await linha('KAIZEN').locator('.acoes-cot-forn').innerText()), /não enviada[\s\S]*Enviar[\s\S]*Resposta/);
  await linha('VIA PEÇAS').locator('[data-act=incluirFornCot]').click();
  assert.deepEqual(await page.evaluate(() => db.cotacoes[0].fornecedores.map(f => f.nome)), ['KAIZEN', 'VIA PEÇAS']);
  // enviar leva à cotação com o painel de envio aberto
  await linha('KAIZEN').locator('[data-act=enviarDaAbaForn]').click();
  await page.waitForSelector('#painelEnvio');
  assert.match(await page.locator('#app h2').first().innerText(), /Cotação nº 0001/);
  // barra de seções e ações no cabeçalho
  assert.match(n(await page.locator('.secoes-cot').innerText()), /Fornecedores[\s\S]*Itens/);
  await page.click('.menu-acoes-cot > summary');
  assert.equal(await page.locator('.menu-acoes-cot [data-act=excluirCot]').isVisible(), true);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
