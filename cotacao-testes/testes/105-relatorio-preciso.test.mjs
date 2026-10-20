import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n } from '../ajuda.mjs';

after(fechar);

test('relatórios precisos: preço digitado errado, cotação sem quantidade e aberta não distorcem; total = soma dos fornecedores', async () => {
  const its = [item('A', 'CORREIA', 'GATES', { codigo: 'C-1', quantidade: 2 }), item('B', 'VELA', 'NGK', { codigo: 'V-1', quantidade: 10 })];
  const semQtd = [item('A', 'CORREIA', 'GATES', { codigo: 'C-1', quantidade: null })];
  const s = await abrir(base({
    cotacoes: [
      // 34028 no lugar de 34,03: fica fora da economia
      cotacao('c1', '0001', '2026-10-01', 'finalizada', its, [
        forn('f1', 'KAIZEN', { 0: { preco: 37.2, marca: 'GATES' }, 1: { preco: 10, marca: 'NGK' } }),
        forn('f2', 'ROLES', { 0: { preco: 34028, marca: 'GATES' }, 1: { preco: 12, marca: 'NGK' } }),
        forn('f3', 'RMP', { 0: { preco: 40, marca: 'GATES' } }),
      ]),
      cotacao('c2', '0002', '2026-10-02', 'finalizada', semQtd, [forn('f1', 'KAIZEN', { 0: { preco: 999 } }), forn('f2', 'ROLES', { 0: { preco: 1000 } })]),
      cotacao('c3', '0003', '2026-10-03', 'aberta', its, [forn('f1', 'KAIZEN', { 0: { preco: 500 } })]),
    ],
  }));
  const { page } = s;
  await irPara(page, 'relatorios');
  const resumo = n(await page.locator('.stats').innerText());
  assert.match(resumo, /Cotações finalizadas\s+1/);
  assert.match(resumo, /Total das compras\s+R\$ 174,40/, '2 × 37,20 + 10 × 10');
  // correia: média de 37,20 e 40 (sem o 34028) → 1,40 × 2 = 2,80 · vela: média 11 → 1 × 10 = 10
  assert.match(resumo, /Economia vs média dos preços\s+R\$ 12,80/);
  assert.match(resumo, /Economia vs preço mais caro\s+R\$ 25,60/, '(40 − 37,20) × 2 + (12 − 10) × 10');
  const aviso = n(await page.locator('.aviso-fora-rel').innerText());
  assert.match(aviso, /1 em andamento \(nº 0003\)/);
  assert.match(aviso, /1 finalizada\(s\) sem quantidade \(nº 0002\)/);
  assert.match(n(await page.locator('#app').innerText()), /1 item\(ns\) comprado\(s\) tinham algum preço mais de 3× acima/);
  // a soma do "Valor ganho" de cada fornecedor é o total das compras
  const valores = await page.locator('#relForn tbody tr td:nth-child(6)').allInnerTexts();
  const soma = valores.map(v => Number(n(v).replace(/[^\d,]/g, '').replace(',', '.'))).reduce((a, b) => a + b, 0);
  assert.equal(soma.toFixed(2), '174.40');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
