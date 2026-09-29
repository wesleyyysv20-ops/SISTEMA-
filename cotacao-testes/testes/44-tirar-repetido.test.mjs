import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, n } from '../ajuda.mjs';

after(fechar);

test('repetidos: "Tirar" no painel tira só aquele item e a tela não pula para a lista', async () => {
  const prods = [
    ...Array.from({ length: 300 }, (_, k) => ({ id: 'q' + k, codigo: 'X' + k, descricao: 'PECA ' + String(k).padStart(3, '0'), marca: 'QUALQUER' })),
    { id: 'p3', codigo: 'BKR6E', descricao: 'PECA 170 VELA', marca: 'NGK' },
    { id: 'p4', codigo: 'BKR6E', descricao: 'PECA 171 VELA IGNICAO', marca: 'NGK' },
  ];
  const s = await abrir(base({ produtos: prods, rascunho: { itens: prods.map(p => ({ produtoId: p.id, quantidade: 1 })), fornecedorIds: [] } }), { largura: 1300, altura: 800 });
  const { page } = s;
  await page.click('nav [data-route=nova]');
  const botao = page.locator('.dup-item [data-act=removerItem]').first();
  await botao.scrollIntoViewIfNeeded();
  const antes = await page.evaluate(() => scrollY);
  await botao.click();
  assert.match(n(await page.locator('.dlg').innerText()), /Tirar este item da cotação\?\s*BKR6E · PECA 170 VELA/);
  await page.click('.dlg button.primary');
  assert.deepEqual(await page.evaluate(() => rascunho().itens.filter(x => x.produtoId.startsWith('p')).map(x => x.produtoId)), ['p4'], 'saiu só o escolhido');
  assert.equal(await page.locator('.painel-dup').count(), 0, 'sem repetidos, o painel some');
  assert.ok(Math.abs((await page.evaluate(() => scrollY)) - antes) < 200, 'a tela ficou onde estava');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
