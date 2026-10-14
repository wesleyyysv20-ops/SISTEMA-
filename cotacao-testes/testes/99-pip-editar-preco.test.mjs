import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }] },
  cotacoes: [cotacao('c1', '0001', '2026-10-14', 'aberta', [item('PA', 'ADITIVO', 'QUALQUER', { codigo: '1622-ADITIVO' })], [
    forn('f1', 'PELLEGRINO', { 0: { preco: 21.74, marca: 'FLU' } }),
    forn('f2', 'KAIZEN', { 0: { preco: 25 } }),
  ])],
});

test('janela flutuante: ✎ corrige o preço do vencedor com as perguntas dentro da própria janela', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.evaluate(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined });
    window.open = () => { const f = document.createElement('iframe'); f.id = 'janelaTeste'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:520px;z-index:99999;background:#fff'; document.body.appendChild(f); return f.contentWindow; };
  });
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.locator('.tab-comp tbody tr[data-comp-linha="0"] td').nth(1).click();
  await page.click('[data-act=abrirPip]');
  const j = page.frameLocator('#janelaTeste');
  await j.locator('#pip .pip-cod').waitFor();
  assert.equal(await j.locator('.pip-btn-edit').getAttribute('aria-label'), 'Editar o preço ou a marca de PELLEGRINO');
  await j.locator('.pip-btn-edit').click();
  // a pergunta abre na janela flutuante (não atrás dela)
  await j.locator('.dlg').waitFor();
  assert.match(n(await j.locator('.dlg').innerText()), /Editar o preço de PELLEGRINO[\s\S]*R\$ 21,74 · marca FLU/);
  await j.locator('.dlg button', { hasText: 'Corrigir o valor' }).click();
  await j.locator('.dlg input').fill('19,90');
  await j.locator('.dlg button.primary').click();
  await page.waitForFunction(() => db.cotacoes[0].fornecedores[0].respostas[0].preco === 19.9);
  assert.equal(await page.evaluate(() => db.cotacoes[0].fornecedores[0].respostas[0].precoOriginal), 21.74);
  await page.waitForFunction(() => /19,90/.test(document.getElementById('janelaTeste').contentDocument.querySelector('.pip-preco').textContent));
  assert.equal(await page.locator('.dlg').count(), 0, 'nada abriu na tela de trás');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
