import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }] },
  fornecedores: [{ id: 'f1', nome: 'ENVIA PEÇAS' }, { id: 'f2', nome: 'KAIZEN' }],
  cotacoes: [cotacao('c1', '0040', '2026-10-02', 'aberta', [
    item('A', 'AMORTECEDOR DIANT', 'QUALQUER', { codigo: 'GP33264' }),
    item('B', 'AMORTECEDOR TRAS', 'QUALQUER', { codigo: 'GP33265' }),
    item('C', 'VELA', 'QUALQUER', { codigo: 'BKR6E' }),
  ], [
    forn('f1', 'ENVIA PEÇAS', { 0: { preco: 105, marca: 'PERFECT' }, 1: { preco: 90, marca: 'PERFECT' }, 2: { preco: 9, marca: 'NGK' } }),
    forn('f2', 'KAIZEN', { 0: { preco: 100, marca: 'COFAP' }, 1: { preco: 95, marca: 'COFAP' }, 2: { preco: 8, marca: 'NGK' } }),
  ], { qtds: { 0: { paranoa: 2 }, 1: { paranoa: 1 } } })],
});

test('campanha de marca: mostra onde há preço dela, sem escolher sozinho', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const venc = () => page.evaluate(() => comparar(db.cotacoes[0]).linhas.map(l => l.vencedor));
  assert.deepEqual(await venc(), [1, 0, 1]);

  // nova campanha: outubro, ENVIA PEÇAS com PERFECT (o período já vem com o mês da cotação)
  await page.click('[data-act=novaCampanha]');
  const dlg = page.locator('.dlg-campanha');
  assert.equal(await dlg.locator('[name=de]').inputValue(), '2026-10-01');
  assert.equal(await dlg.locator('[name=ate]').inputValue(), '2026-10-31');
  await dlg.locator('[name=marca]').fill('perfect');
  await dlg.locator('[name=forn]').selectOption('f1');
  await dlg.locator('[name=meta]').fill('1.000,00');
  await dlg.locator('button.primary').click();

  assert.deepEqual(await venc(), [1, 0, 1], 'não muda o vencedor sozinho');
  const card = n(await page.locator('#campanhasCot').innerText());
  assert.match(card, /Campanha PERFECT · ENVIA PEÇAS/);
  assert.match(card, /Nesta cotação: R\$ 90,00 1 item/);
  assert.match(card, /de R\$ 1\.000,00 · faltam R\$ 910,00/);
  assert.match(card, /1 item tem preço da campanha e não está escolhido/);
  assert.match(n(await page.locator('.pill-aviso.campanha').innerText()), /2 com campanha · 1 fora/);
  assert.equal(await page.locator('.tab-comp tbody tr').nth(0).locator('.chip-campanha').count(), 1);
  assert.equal(await page.locator('.tab-comp tbody tr').nth(2).locator('.chip-campanha').count(), 0, 'NGK não é da campanha');

  // você decide: clicar no aviso da campanha escolhe a ENVIA PEÇAS
  await page.click('.tab-comp tbody tr >> nth=0 >> .camp-mini');
  if (await page.locator('.dlg button.primary').count()) await page.click('.dlg button.primary');
  await page.waitForFunction(() => comparar(db.cotacoes[0]).linhas[0].vencedor === 0);
  assert.match(n(await page.locator('#campanhasCot').innerText()), /Nesta cotação: R\$ 300,00 2 itens/);
  assert.doesNotMatch(n(await page.locator('#campanhasCot').innerText()), /não está escolhido/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
