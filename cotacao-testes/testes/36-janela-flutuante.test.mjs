import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const itens = ['A', 'B', 'C'].map(x => item('P' + x, 'PECA ' + x, 'SÓ NGK', { codigo: 'COD-' + x }));
const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
  cotacoes: [cotacao('c1', '0036', '2026-09-29', 'aberta', itens, [
    forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK', estoque: 5 }, 1: { preco: 20, marca: 'NGK' }, 2: { preco: 5, marca: 'NGK' } }),
  ])],
});

/**
 * A janela flutuante nos testes é um iframe (o navegador de teste não abre janelas de verdade).
 * `modo`: 'pip' (Chrome/Edge: documentPictureInPicture) ou 'popup' (Firefox: window.open).
 */
async function abrirComJanela(modo) {
  const s = await abrir(dados());
  const { page } = s;
  await page.evaluate(m => {
    const criar = () => { const f = document.createElement('iframe'); f.id = 'janelaTeste'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:470px;z-index:99999;background:#fff'; document.body.appendChild(f); return f.contentWindow; };
    if (m === 'pip') {
      // como a janela do Chrome/Edge: já vem com um documento pronto
      // (o navegador de teste tem a janela de verdade: troca pela de teste)
      Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: {
        requestWindow: async () => {
          const w = criar();
          w.document.open();
          w.document.write('<!doctype html><html><head></head><body></body></html>');
          w.document.close();
          return w;
        },
      } });
    }
    else { Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined }); window.open = () => criar(); }
  }, modo);
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  return s;
}

for (const modo of ['pip', 'popup']) {
  test(`janela flutuante (${modo === 'pip' ? 'Chrome/Edge' : 'Firefox'}): item atual, quantidades e navegação pelo teclado`, async () => {
    const s = await abrirComJanela(modo);
    const { page } = s;
    // a linha marcada no comparativo é a que abre
    await page.locator('.tab-comp tbody tr[data-comp-linha="1"] td').nth(1).click();
    await page.click('[data-act=abrirPip]');
    const j = page.frameLocator('#janelaTeste');
    await j.locator('#pip .pip-cod').waitFor();
    assert.match(n(await j.locator('#pip').innerText()), /Item #2 · 2 de 3[\s\S]*COD-B[\s\S]*PECA B[\s\S]*R\$ 20,00\s*NGK\s*🏆 KAIZEN/);
    assert.equal(await j.locator('#pip .pip-ajuda b').count(), modo === 'pip' ? 0 : 1, 'no Firefox: dica do Win+Ctrl+T');

    // digita a quantidade: grava e aparece no comparativo
    await page.keyboard.type('4');
    assert.equal(await page.evaluate(() => db.cotacoes[0].qtds[1].paranoa), 4);
    assert.equal(await page.inputValue('.tab-comp [data-qtd-loja=paranoa][data-i="1"]'), '4');
    // → São Sebastião, Enter: próximo item (mesma loja); o comparativo acompanha
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    assert.match(n(await j.locator('.pip-topo').innerText()), /Item #3/);
    assert.equal(await j.locator('input:focus').getAttribute('data-qtd-loja'), 'sao-sebastiao');
    assert.match(await page.locator('.tab-comp tr[data-comp-linha="2"]').getAttribute('class'), /linha-atual/);
    assert.deepEqual(await page.evaluate(() => db.cotacoes[0].qtds[1]), { paranoa: 4, 'sao-sebastiao': 2 });

    // ↑ volta dois itens; o estoque do Kaizen (5) limita a soma das lojas
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    assert.match(n(await j.locator('.pip-topo').innerText()), /Item #1 · 1 de 3/);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('9');
    assert.equal(await j.locator('input[data-qtd-loja=paranoa]').inputValue(), '5');
    assert.equal(await page.evaluate(() => db.cotacoes[0].qtds[0].paranoa), 5);

    // digitado no comparativo aparece na janela
    await page.fill('.tab-comp [data-qtd-loja=sao-sebastiao][data-i="0"]', '0');
    assert.equal(await j.locator('input[data-qtd-loja=sao-sebastiao]').inputValue(), '0');
    // clicar noutra linha do comparativo leva a janela junto
    await page.locator('.tab-comp tbody tr[data-comp-linha="2"] td').nth(1).click();
    assert.match(n(await j.locator('.pip-cod').innerText()), /COD-C/);
    // redesenhar o sistema (alteração vinda de outro computador) atualiza a janela
    await page.evaluate(() => { db.cotacoes[0].qtds[2] = { paranoa: 7 }; salvar(); render(); });
    assert.equal(await j.locator('input[data-qtd-loja=paranoa]').inputValue(), '7');
    assert.deepEqual(s.erros, []);
    await s.fechar();
  });
}

test('janela flutuante: escolher o fornecedor mostra só os itens que ele ganhou (e o comparativo acompanha)', async () => {
  const s = await abrir(base({
    config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
    cotacoes: [cotacao('c1', '0036', '2026-09-29', 'aberta', ['A', 'B', 'C', 'D'].map(x => item('P' + x, 'PECA ' + x, 'SÓ NGK', { codigo: 'COD-' + x })), [
      forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 30, marca: 'NGK' }, 2: { preco: 5, marca: 'NGK' }, 3: { preco: 9, marca: 'NGK' } }),
      forn('f2', 'VIA PEÇAS', { 0: { preco: 12, marca: 'NGK' }, 1: { preco: 20, marca: 'NGK' }, 2: { preco: 6, marca: 'NGK' }, 3: { preco: 8, marca: 'NGK' } }),
    ])],
  }));
  const { page } = s;
  await page.evaluate(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { requestWindow: async () => {
      const f = document.createElement('iframe'); f.id = 'janelaTeste'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:520px;z-index:99999;background:#fff'; document.body.appendChild(f);
      const w = f.contentWindow; w.document.open(); w.document.write('<!doctype html><html><head></head><body></body></html>'); w.document.close(); return w;
    } } });
  });
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.click('[data-act=abrirPip]');
  const j = page.frameLocator('#janelaTeste');
  await j.locator('#pipForn').waitFor();
  assert.deepEqual((await j.locator('#pipForn option').allInnerTexts()).map(t => t.trim()), ['Todos os itens (4)', 'KAIZEN (2)', 'VIA PEÇAS (2)']);
  await j.locator('#pipForn').selectOption({ label: 'VIA PEÇAS (2)' });
  assert.match(n(await j.locator('.pip-topo').innerText()), /Item #2 · 1 de 2/);
  assert.match(n(await j.locator('.pip-forn').innerText()), /VIA PEÇAS/);
  assert.equal(await page.inputValue('#filtroVencedor'), 'f2', 'o comparativo mostra os mesmos itens');
  assert.equal(await page.locator('.tab-comp tbody tr[data-comp-linha]:not([hidden])').count(), 2);
  // o cursor fica na quantidade: Enter vai para o próximo item da Via Peças
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  assert.match(n(await j.locator('.pip-topo').innerText()), /Item #4 · 2 de 2/);
  assert.equal(await page.evaluate(() => db.cotacoes[0].qtds[1].paranoa), 3);
  // escolher no comparativo também muda a janela
  await page.selectOption('#filtroVencedor', 'f1');
  assert.equal(await j.locator('#pipForn').inputValue(), 'f1');
  assert.match(n(await j.locator('.pip-topo').innerText()), /Item #1 · 1 de 2/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
