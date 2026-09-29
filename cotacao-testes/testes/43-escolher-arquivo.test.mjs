import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, exemplo } from '../ajuda.mjs';

after(fechar);

test('escolher arquivo do DataCar: uma vez basta, mesmo se a tela for redesenhada com a janela do Windows aberta', async () => {
  const s = await abrir(base());
  const { page } = s;
  await page.click('nav [data-route=nova]');

  // 1) chegam alterações de outro computador com a janela de arquivo aberta: não redesenha agora
  let escolha = page.waitForEvent('filechooser');
  await page.click('label:has([data-import-datacar])');
  let chooser = await escolha;
  await page.evaluate(() => { document.querySelector('[data-import-datacar]').dataset.marca = 'antes'; renderSeguro(['sistema/config']); });
  assert.equal(await page.evaluate(() => document.querySelector('[data-import-datacar]').dataset.marca), 'antes', 'não trocou o campo');
  await chooser.setFiles(exemplo('sem-marca.csv'));
  await page.waitForSelector('#dlgDataCar');
  await page.evaluate(() => { ui.datacar = null; document.getElementById('dlgDataCar')?.remove(); render(); });

  // 2) mesmo se a tela for redesenhada à força, o arquivo escolhido chega
  escolha = page.waitForEvent('filechooser');
  await page.click('label:has([data-import-datacar])');
  chooser = await escolha;
  await page.evaluate(() => render()); // o campo antigo sai da tela
  await chooser.setFiles(exemplo('sem-marca.csv'));
  await page.waitForSelector('#dlgDataCar');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
