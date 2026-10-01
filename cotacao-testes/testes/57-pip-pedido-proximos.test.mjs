import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const cods = ['A', 'B', 'C', 'D', 'E'];

test('janela flutuante: pedido do fornecedor no topo e os próximos itens clicáveis', async () => {
  const s = await abrir(base({
    config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
    fornecedores: [{ id: 'f1', nome: 'KAIZEN', pedidoMinimo: 100 }, { id: 'f2', nome: 'VIA PEÇAS' }],
    cotacoes: [cotacao('c1', '0057', '2026-09-30', 'aberta', cods.map(x => item('P' + x, 'PECA ' + x, 'NGK', { codigo: 'COD-' + x })), [
      forn('f1', 'KAIZEN', Object.fromEntries(cods.map((_, i) => [i, { preco: 10, marca: 'NGK' }]))),
      forn('f2', 'VIA PEÇAS', Object.fromEntries(cods.map((_, i) => [i, { preco: 11, marca: 'NGK' }]))),
    ], { qtds: { 1: { paranoa: 2 } } })],
  }));
  const { page } = s;
  await page.evaluate(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { requestWindow: async () => {
      const f = document.createElement('iframe'); f.id = 'janelaTeste'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:600px;z-index:99999;background:#fff'; document.body.appendChild(f);
      const w = f.contentWindow; w.document.open(); w.document.write('<!doctype html><html><head></head><body></body></html>'); w.document.close(); return w;
    } } });
  });
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.click('[data-act=abrirPip]');
  const j = page.frameLocator('#janelaTeste');
  await j.locator('#pip .pip-cod').waitFor();
  // sem fornecedor escolhido: total da cotação
  assert.match(await j.locator('.pip-pedido').innerText(), /Total da cotação/);
  // próximos: B (já tem quantidade), C, D
  assert.deepEqual(await j.locator('.pip-prox').allInnerTexts(), ['COD-B', 'COD-C', 'COD-D']);
  assert.match(await j.locator('.pip-prox').first().getAttribute('class'), /feito/);

  await j.locator('#pipForn').selectOption('f1');
  assert.match(n(await j.locator('.pip-pedido').innerText()), /KAIZEN\s*R\$ 20,00\s*1 item\s*faltam R\$ 80,00 p\/ o mínimo/);
  // digitando: o total acompanha na hora
  await j.locator('input[data-qtd-loja=paranoa]').focus();
  await page.keyboard.type('9');
  assert.match(n(await j.locator('.pip-pedido').innerText()), /R\$ 110,00\s*2 itens/);
  // valor de cada loja no pedido e valor do item embaixo da quantidade
  assert.match(n(await j.locator('.pip-ped-lojas').innerText()), /DPR\s*R\$ 110,00\s*2 itens[\s\S]*DSS\s*R\$ 0,00\s*0 itens/);
  assert.equal(await j.locator('[data-sub-loja=paranoa]').innerText(), 'R$ 90,00');
  assert.doesNotMatch(await j.locator('.pip-pedido').innerText(), /mínimo/);

  // "só os que faltam": os próximos pulam os que já têm quantidade
  await j.locator('[data-pip-sofaltam]').check();
  // (o item atual já tem quantidade: vai para o COD-C)
  assert.match(n(await j.locator('.pip-barra').innerText()), /#3/);
  assert.deepEqual(await j.locator('.pip-prox').allInnerTexts(), ['COD-D', 'COD-E']);
  // clicar num próximo vai direto para ele
  await j.locator('.pip-prox:text("COD-D")').click();
  assert.match(n(await j.locator('.pip-barra').innerText()), /#4/);
  assert.match(await page.locator('.tab-comp tr[data-comp-linha="3"]').getAttribute('class'), /linha-atual/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
