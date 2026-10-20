import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n } from '../ajuda.mjs';

after(fechar);

const LOJAS = [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }];
const fs = ['KAIZEN', 'VIA PEÇAS', 'RMP', 'DPK', 'SAMA'];
const dados = () => base({
  config: { loja: 'DISPPAR', lojas: LOJAS },
  cotacoes: [cotacao('c1', '0013', '2026-10-13', 'aberta', [item('A', 'VELA', 'QUALQUER', { codigo: 'V1' }), item('B', 'FILTRO', 'QUALQUER', { codigo: 'F1' })],
    fs.map((nome, k) => forn('f' + k, nome, k < 4 ? { 0: { preco: 10 + k }, 1: { preco: 20 + k } } : null)),
    { prazoResposta: '2026-10-01' })],
});

test('cabeçalho: sem quantidade não mostra estimativa como pedido; prazo com quantos responderam; status no menu', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'cotacao', 'c1');
  const resumo = n(await page.locator('#resumoCot').innerText());
  assert.match(resumo, /Total do pedido\s*aguardando quantidades\s*estimativa R\$ 30,00/);
  assert.match(resumo, /Economia vs média\s*—/);
  assert.doesNotMatch(n(await page.locator('#fornPendCot').innerText()), /R\$/, 'sem quantidade, as etiquetas não mostram valor');
  assert.match(n(await page.locator('#secForn .corpo-recolhe thead').innerText()), /PROPOSTA|Proposta/);
  // 4 de 5 responderam: prazo vencido em amarelo (falta pouca gente)
  const prazo = page.locator('.aviso-prazo');
  assert.match(n(await prazo.innerText()), /4 de 5 responderam · falta 1 fornecedor responder: SAMA/);
  assert.equal(await prazo.evaluate(el => el.className), 'aviso-prazo vencido-poucos');
  // barra de seções só navega (os números estão no cabeçalho)
  assert.doesNotMatch(n(await page.locator('.secoes-cot').innerText()), /Comparativo\s*\d/);
  // cartão "Itens com quantidade" leva ao item sem quantidade
  await page.click('.rc-kpi[data-act=irSemQtdCot]');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.qtdLoja), 'paranoa');
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Total do pedido\s*R\$/.test(document.getElementById('resumoCot').innerText));
  assert.match(n(await page.locator('#fornPendCot').innerText()), /R\$ 20,00/);
  // status: só o atual à mostra; os outros no menu
  assert.match(n(await page.locator('.status-cot > summary').innerText()), /Aberta/);
  assert.equal(await page.locator('.status-cot [data-status=finalizada]').isVisible(), false);
  await page.click('.status-cot > summary');
  assert.deepEqual(await page.locator('.status-cot .menu-pop button').allInnerTexts(), ['✓ Finalizar a cotação', '✕ Cancelar a cotação']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
