import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const cods = ['A', 'B', 'C', 'D'];
const dados = (qtds = {}) => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
  cotacoes: [cotacao('c1', '0055', '2026-09-30', 'aberta', cods.map(x => item('P' + x, 'PECA ' + x, 'NGK', { codigo: 'COD-' + x })), [
    forn('f1', 'KAIZEN', Object.fromEntries(cods.map((_, i) => [i, { preco: 10, marca: 'NGK' }]))),
    forn('f2', 'VIA PEÇAS', Object.fromEntries(cods.map((_, i) => [i, { preco: 11, marca: 'NGK' }]))),
  ], { qtds })],
});

/** Abre a cotação com a janela flutuante num iframe (o "Salvar como" dela é contado à parte). */
async function comJanela(qtds) {
  const s = await abrir(dados(qtds));
  const { page } = s;
  await page.evaluate(() => {
    window.__pipSalvou = 0;
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { requestWindow: async () => {
      const f = document.createElement('iframe'); f.id = 'janelaTeste'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:600px;z-index:99999;background:#fff'; document.body.appendChild(f);
      const w = f.contentWindow; w.document.open(); w.document.write('<!doctype html><html><head></head><body></body></html>'); w.document.close();
      w.showSaveFilePicker = o => { window.__pipSalvou++; return window.showSaveFilePicker(o); };
      return w;
    } } });
  });
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.click('[data-act=abrirPip]');
  const j = page.frameLocator('#janelaTeste');
  await j.locator('#pip .pip-cod').waitFor();
  return { s, page, j };
}

test('janela flutuante: fornecedor completo → exportar o pedido sem sair da janela', async () => {
  const { s, page, j } = await comJanela({ 0: { paranoa: 1 }, 1: { paranoa: 2 }, 2: { 'sao-sebastiao': 1 }, 3: { paranoa: 3 } });
  await j.locator('#pipForn').selectOption('f1');
  assert.match(n(await j.locator('.pip-concluido').innerText()), /Todos os itens de KAIZEN/);
  await j.locator('[data-pip=exportar]').click();
  // formato e checklist abrem na própria janela
  await j.locator('.dlg-formato').waitFor();
  assert.equal(await page.locator('.dlg-formato').count(), 0, 'não abriu na tela principal');
  await j.locator('.dlg-formato .formato-opcao').first().click();
  const antes = await page.evaluate(() => window.__salvos.length);
  await j.locator('.dlg-formato button[data-r="1"]').click();
  await page.waitForFunction(k => window.__salvos.length > k, antes);
  // se forem duas planilhas (uma por loja), a confirmação da segunda também aparece na janela
  if (await j.locator('.dlg button.primary').count()) await j.locator('.dlg button.primary').click();
  await page.waitForFunction(() => db.cotacoes[0].fornecedores[0].concluidoEm);
  assert.ok(await page.evaluate(() => window.__pipSalvou) >= 1, '"Salvar como" aberto pela janela flutuante');
  await j.locator('text=✓ pedido exportado').waitFor();
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('janela flutuante: atalhos C, D, S e / (busca pelo código)', async () => {
  const { s, page, j } = await comJanela();
  await page.evaluate(() => { window.__copiado = null; Object.defineProperty(pip.win.navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copiado = t; } } }); });
  const barra = async () => n(await j.locator('.pip-barra').innerText());
  // letras no campo de quantidade viram atalhos
  await j.locator('input[data-qtd-loja=paranoa]').focus();
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__copiado === 'COD-A');
  assert.equal(await j.locator('input[data-qtd-loja=paranoa]').inputValue(), '', 'a letra não foi para a quantidade');

  // / → vai para o item pelo código
  await page.keyboard.press('/');
  await j.locator('#dlgCampo').fill('cod-c');
  await page.keyboard.press('Enter');
  assert.match(await barra(), /#3/);

  // S → 2º lugar (com confirmação na janela)
  await page.keyboard.press('s');
  await j.locator('.dlg button.primary').click();
  assert.equal(await page.evaluate(() => comparar(db.cotacoes[0]).linhas[2].vencedor), 1);

  // "2" no campo de quantidade continua sendo quantidade
  await j.locator('#pipForn').selectOption('');
  await page.keyboard.press('/');
  await j.locator('#dlgCampo').fill('COD-B');
  await page.keyboard.press('Enter');
  await j.locator('input[data-qtd-loja=paranoa]').focus();
  await page.keyboard.type('2');
  assert.equal(await page.evaluate(() => db.cotacoes[0].qtds[1].paranoa), 2);

  // D → Dúvida na própria janela
  await page.keyboard.press('d');
  await j.locator('.dlg-duvida').waitFor();
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('janela flutuante: "só os que faltam" faz o Enter pular os itens que já têm quantidade', async () => {
  const { s, page, j } = await comJanela({ 1: { paranoa: 1 }, 2: { paranoa: 2 } });
  const barra = async () => n(await j.locator('.pip-barra').innerText());
  assert.match(await barra(), /#1/);
  await j.locator('[data-pip-sofaltam]').check();
  await j.locator('input[data-qtd-loja=paranoa]').focus();
  await page.keyboard.press('Enter');
  assert.match(await barra(), /#4/, 'pulou o #2 e o #3');
  await page.keyboard.press('ArrowUp');
  assert.match(await barra(), /#1/);
  assert.equal(await page.evaluate(() => localStorage.getItem('cotacao.pipSoFaltam')), '1', 'lembra a escolha');
  // desligado: passa por todos
  await j.locator('[data-pip-sofaltam]').uncheck();
  await j.locator('input[data-qtd-loja=paranoa]').focus();
  await page.keyboard.press('Enter');
  assert.match(await barra(), /#2/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
