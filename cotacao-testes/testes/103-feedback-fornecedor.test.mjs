import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n } from '../ajuda.mjs';

after(fechar);

const itens = [item('A', 'VELA', 'NGK', { codigo: 'V-1' }), item('B', 'FILTRO', 'SÓ TECFIL', { codigo: 'F-1' }), item('C', 'CORREIA', 'GATES', { codigo: 'C-1' }), item('D', 'BOMBA', 'QUALQUER', { codigo: 'B-9' })];
const dados = () => base({
  config: { loja: 'DISPPAR AUTOPEÇAS' },
  fornecedores: [{ id: 'f1', nome: 'KAIZEN' }, { id: 'f2', nome: 'RIO JUNTAS' }],
  cotacoes: [
    cotacao('c1', '0020', '2026-09-20', 'finalizada', itens, [
      forn('f1', 'KAIZEN', { 0: { preco: 10.3, marca: 'NGK' }, 1: { preco: 30, marca: 'WEGA' }, 2: { preco: 50, marca: 'GATES' } }, { enviadoEm: '2026-09-20T10:00:00Z', respondidoEm: '2026-09-20T14:00:00Z' }),
      forn('f2', 'RIO JUNTAS', { 0: { preco: 10, marca: 'NGK' }, 1: { preco: 20, marca: 'TECFIL' }, 2: { preco: 51, marca: 'GATES' }, 3: { preco: 80 } }, { enviadoEm: '2026-09-20T10:00:00Z', respondidoEm: '2026-09-21T10:00:00Z' }),
    ], { prazoResposta: '2026-09-22' }),
    // aberta e ainda no prazo: o KAIZEN não respondeu, mas ainda pode (não é falta)
    cotacao('c2', '0021', '2099-01-01', 'aberta', [itens[0]], [forn('f1', 'KAIZEN', null, { enviadoEm: '2026-10-14T10:00:00Z' })], { prazoResposta: '2099-01-02' }),
  ],
});

test('nota: cotação ainda no prazo não conta como falta; feedback pronto para o vendedor', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'relatorios');
  const kaizen = n(await page.locator('#notaFornecedores tbody tr:has-text("KAIZEN")').innerText());
  assert.match(kaizen, /1\/1 \(100%\)\s+\+1 no prazo/, 'respondeu a única que já venceu; a outra ainda está no prazo');
  assert.match(kaizen, /\+1,5%/, 'preço: mediana de 0% (correia) e 3% (vela); o filtro de marca errada não entra');
  await page.click('#notaFornecedores tbody tr:has-text("KAIZEN") [data-act=analiseForn]');
  await page.locator('.dlg-analise-forn').waitFor();
  assert.match(n(await page.locator('.dlg-analise-forn').innerText()), /Itens que mais deixa de cotar[\s\S]*B-9 1×/i);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.evaluate(() => { window.__copiado = null; navigator.clipboard.writeText = async t => { window.__copiado = t; }; });
  await page.click('.af-feedback');
  const txt = n(await page.waitForFunction(() => window.__copiado).then(h => h.jsonValue()));
  assert.match(txt, /\*Avaliação de fornecedor — DISPPAR AUTOPEÇAS\*/);
  assert.match(txt, /Fornecedor: \*KAIZEN\*/);
  assert.match(txt, /1 cotação\(ões\) recebida\(s\) \(\+1 ainda no prazo\)/);
  assert.match(txt, /Nota: \*\d+,\d de 10\* \(\dº de 2 fornecedores\)/);
  assert.match(txt, /Respondeu 1 de 1 cotações \(100%\) · 1 de 1 no prazo/);
  assert.match(txt, /Perdeu por pouco \(até 5%\)[\s\S]*nº 0020 · V-1: seu R\$ 10,30 × melhor R\$ 10,00 \(\+3,0%\)/);
  assert.match(txt, /Marca diferente da pedida\* \(1\)[\s\S]*nº 0020 · F-1: pedimos SÓ TECFIL, veio WEGA/);
  assert.match(txt, /Itens que mais deixou de cotar\*[\s\S]*• B-9 BOMBA \(1×\)/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
