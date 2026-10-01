import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  fornecedores: [{ id: 'f1', nome: 'KAIZEN', contato: 'João', telefone: '61 9999' }, { id: 'f2', nome: 'RIO JUNTAS' }],
  cotacoes: [
    cotacao('c1', '0020', '2026-09-20', 'aberta', [item('A', 'VELA', 'NGK', { codigo: 'V-1' }), item('B', 'FILTRO', 'SÓ TECFIL', { codigo: 'F-1' }), item('C', 'CORREIA', 'GATES', { codigo: 'C-1' })], [
      forn('f1', 'KAIZEN', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 30, marca: 'WEGA' }, 2: { preco: 50, marca: 'GATES' } }, { enviadoEm: '2026-09-20T10:00:00Z', respondidoEm: '2026-09-20T14:00:00Z' }),
      forn('f2', 'RIO JUNTAS', { 0: { preco: 12, marca: 'NGK' }, 1: { preco: 20, marca: 'TECFIL' }, 2: { preco: 51, marca: 'GATES' } }, { enviadoEm: '2026-09-20T10:00:00Z', respondidoEm: '2026-09-21T10:00:00Z' }),
    ]),
    cotacao('c2', '0021', '2026-09-25', 'aberta', [item('A', 'VELA', 'NGK', { codigo: 'V-1' })], [
      forn('f1', 'KAIZEN', null, { enviadoEm: '2026-09-25T10:00:00Z' }),
      forn('f2', 'RIO JUNTAS', { 0: { preco: 9, marca: 'NGK' } }, { enviadoEm: '2026-09-25T10:00:00Z', respondidoEm: '2026-09-25T12:00:00Z' }),
    ]),
  ],
});

test('clicar no fornecedor da nota abre a análise detalhada', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'relatorios');
  await page.click('#notaFornecedores tbody tr:has-text("KAIZEN") [data-act=analiseForn]');
  const dlg = page.locator('.dlg-analise-forn');
  await dlg.waitFor();
  const t = n(await dlg.innerText());
  assert.match(t, /KAIZEN[\s\S]*João · 📞 61 9999/);
  assert.match(t, /Itens ganhos\s*2\s*67% dos cotados · média \d+%/);
  assert.match(t, /Pedidos exportados\s*0\/1\s*falta exportar/, 'mesmo critério da seção Pedidos da cotação');
  assert.match(t, /Cotações respondidas\s*1\/2\s*50%/);
  assert.match(t, /Itens ganhos\s*2\s*67% dos cotados/); // vela e correia (o filtro WEGA é marca errada)
  assert.match(t, /Ficou em 2º\s*0/); // o filtro WEGA (marca errada) nem entra na disputa
  assert.match(t, /Marca errada: 1/);
  assert.match(t, /WEGA 1/);
  assert.match(t, /Onde ficou mais caro[\s\S]*F-1[\s\S]*R\$ 30,00[\s\S]*R\$ 20,00[\s\S]*\+50,0%[\s\S]*RIO JUNTAS/i);
  // histórico: a mais nova primeiro, com "não respondeu"
  const hist = await dlg.locator('section:has(h4:text-matches("hist", "i")) tbody tr').allInnerTexts();
  assert.equal(hist.length, 2);
  assert.match(n(hist[0]), /nº 0021[\s\S]*não respondeu/);
  assert.match(n(hist[1]), /nº 0020[\s\S]*3\/3\s+2/);
  // abrir a cotação pelo histórico fecha a análise
  await dlg.locator('.af-abrir:has-text("0020")').click();
  assert.equal(await page.locator('.dlg-analise-forn').count(), 0);
  assert.match(await page.locator('#app h2').first().innerText(), /0020/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
