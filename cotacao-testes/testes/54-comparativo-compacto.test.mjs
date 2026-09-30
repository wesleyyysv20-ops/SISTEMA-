import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const LOJAS = [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }];
const itens = ['A', 'B', 'C'].map(x => item('P' + x, 'PECA ' + x, 'NGK', { codigo: 'COD-' + x }));
const dados = () => base({ config: { loja: 'DISPPAR', lojas: LOJAS }, cotacoes: [cotacao('c1', '0054', '2026-09-29', 'aberta', itens, [
  forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 20, marca: 'NGK' }, 2: { preco: 7, marca: 'NGK' } }),
  forn('f2', 'VIA PEÇAS', { 0: { preco: 12, marca: 'NGK' }, 1: { preco: 18, marca: 'NGK' }, 2: { preco: 9, marca: 'NGK' } }, { concluidoEm: '2026-09-29T10:00:00Z' }),
], { qtds: { 0: { paranoa: 1 } }, escolhas: { 2: 'f2' } })] });

test('comparativo: modo compacto, andamento na lista de fornecedores, etiquetas curtas e desfazer escolhas com confirmação', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  // andamento de cada fornecedor em "Mostrar itens de"
  const opcoes = (await page.locator('#filtroVencedor option').allInnerTexts()).map(t => n(t).trim());
  assert.ok(opcoes.includes('KAIZEN (1) · ✓ completo'), opcoes.join(' | '));
  assert.ok(opcoes.includes('VIA PEÇAS (2) · ✓ exportado'), opcoes.join(' | '));

  // completo: uma coluna por fornecedor
  assert.equal(await page.locator('.tab-comp thead th', { hasText: 'KAIZEN' }).count(), 1);
  await page.click('[data-act=alternarCompacto]');
  assert.match(await page.locator('.tab-comp').getAttribute('class'), /compacto/);
  assert.equal(await page.locator('.tab-comp thead th', { hasText: 'KAIZEN' }).count(), 0, 'sem as colunas dos fornecedores');
  assert.match(n(await page.locator('.tab-comp tbody tr[data-comp-linha="0"]').innerText()), /R\$ 10,00[\s\S]*KAIZEN[\s\S]*R\$ 12,00\s*\+20,0%\s*VIA PEÇAS/);
  // no compacto dá para trocar pelo 2º lugar
  await page.locator('.tab-comp tbody tr[data-comp-linha="0"] .escolhe-dif').click();
  await page.click('.dlg button.primary');
  assert.equal(await page.evaluate(() => comparar(db.cotacoes[0]).linhas[0].vencedor), 1);
  // fica guardado ao recarregar
  await page.reload();
  await page.evaluate(() => ir('cotacao', 'c1'));
  assert.match(await page.locator('.tab-comp').getAttribute('class'), /compacto/);

  // desfazer as escolhas: dentro de "mais opções", com a lista do que volta
  await page.click('.ajuda-comp summary');
  await page.click('[data-act=limparEscolhas]');
  assert.match(n(await page.locator('.dlg').innerText()), /Desfazer 2 escolha\(s\)[\s\S]*COD-A: VIA PEÇAS R\$ 12,00[\s\S]*COD-C: VIA PEÇAS R\$ 9,00/);
  await page.click('.dlg button.primary');
  assert.deepEqual(await page.evaluate(() => db.cotacoes[0].escolhas), {});
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
