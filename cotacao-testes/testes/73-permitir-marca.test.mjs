import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const itens = [item('P1', 'LAMPADA H4', 'OSR-PHIL-GE-MAR', { codigo: 'H4-12V' })];

test('permitir marca: aceita a marca errada só nesta cotação, sem deixar de contar como errada', async () => {
  const s = await abrir(base({
    cotacoes: [
      cotacao('c1', '0030', '2026-10-01', 'aberta', itens, [
        forn('f1', 'ENVIA PEÇAS', { 0: { preco: 1.8, marca: 'BOSCH' } }),
        forn('f2', 'KAIZEN', { 0: { preco: 2.5, marca: 'OSRAM' } }),
      ]),
      cotacao('c2', '0031', '2026-10-02', 'aberta', itens, [forn('f1', 'ENVIA PEÇAS', { 0: { preco: 1.8, marca: 'BOSCH' } }), forn('f2', 'KAIZEN', { 0: { preco: 2.5, marca: 'OSRAM' } })]),
    ],
  }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const venc = () => page.evaluate(() => comparar(db.cotacoes[0]).linhas[0].vencedor);
  assert.equal(await venc(), 1, 'antes: a marca errada não ganha');

  await page.click('.chip-marca.errada');
  await page.click('.dlg button:text("Permitir marca")');
  assert.match(n(await page.locator('#toast').innerText()), /permitida só nesta cotação/);
  assert.equal(await venc(), 0, 'permitida: o preço mais barato ganha');
  const chip = page.locator('.chip-marca.errada.permitida');
  assert.match(n(await chip.innerText()), /BOSCH ≠ OSR-PHIL-GE-MAR · permitida/, 'continua marcada como errada');
  assert.equal(await page.evaluate(() => comparar(db.cotacoes[0]).linhas[0].marcas[0]), 'errada');
  assert.equal(await page.locator('td.marca-errada').count(), 0, 'o preço não fica riscado');

  // só nesta cotação: a outra continua sem permitir
  assert.equal(await page.evaluate(() => comparar(db.cotacoes[1]).linhas[0].vencedor), 1);

  // tirar a permissão
  await chip.click();
  assert.match(await page.locator('.dlg').innerText(), /PERMITIDA nesta cotação/);
  await page.click('.dlg button:text("Tirar a permissão")');
  assert.equal(await venc(), 1);
  assert.equal(await page.locator('.chip-marca.permitida').count(), 0);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
