import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar } from '../ajuda.mjs';

after(fechar);

test('versão nova publicada: a aba aberta mostra a faixa "Atualizar agora" e recarrega', async () => {
  const s = await abrir(base({ config: { loja: 'DISPPAR' } }));
  const { page } = s;
  // simula o app.js do site: primeira assinatura, depois outra (publicaram de novo)
  await page.evaluate(async () => {
    let v = 'etag-1';
    assinaturaApp = async () => v;
    await verificarVersaoNova();
    window.__trocar = () => { v = 'etag-2'; };
  });
  assert.equal(await page.locator('#faixaVersao').count(), 0, 'mesma versão: nada');
  await page.evaluate(async () => { __trocar(); await verificarVersaoNova(); });
  assert.match(await page.locator('#faixaVersao').innerText(), /versão nova do sistema/);
  await page.evaluate(() => { window.__antes = 1; });
  await Promise.all([page.waitForEvent('load'), page.click('#faixaVersao [data-act=atualizarSistema]')]);
  assert.equal(await page.evaluate(() => window.__antes ?? null), null, 'recarregou');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
