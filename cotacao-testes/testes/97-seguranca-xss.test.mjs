import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara } from '../ajuda.mjs';

after(fechar);

// Texto malicioso em todos os campos que vêm de fora (planilhas, fornecedores, outras pessoas):
// nenhuma tela pode transformar isso em código. Se escapar, a imagem quebrada roda o onerror.
const X = n => `${n}"><img src=x data-xss onerror="window.__xss=(window.__xss||[]).concat('${n}')">'<b data-xss>`;

const dados = () => base({
  config: { loja: X('loja'), lojas: [{ id: 'paranoa', nome: X('lojaNome'), sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
  produtos: [{ id: 'p1', codigo: X('pcod'), descricao: X('pdesc'), unidade: 'UN', marca: X('pmarca'), categoria: X('pcat') }],
  fornecedores: [{ id: 'f1', nome: X('fnome'), email: 'a@b.com', contato: X('fcontato'), telefone: X('ftel'), obs: X('fobs') }, { id: 'f2', nome: 'OUTRO' }],
  cotacoes: [
    cotacao('c0', '0001', '2026-09-01', 'finalizada', [item(X('icod0'), X('idesc0'), X('imarca0'))], [forn('f1', X('cfnome0'), { 0: { preco: 100, marca: X('rmarca0') } })], { qtds: { 0: { paranoa: 1 } } }),
    cotacao('c1', '0002', '2026-10-10', 'aberta', [
      item(X('icod'), X('idesc'), X('imarca'), { obs: X('iobs'), similar: X('isim') }),
      item('B', 'LONA', 'QUALQUER'),
    ], [
      forn('f1', X('cfnome'), { 0: { preco: 120, marca: X('rmarca'), obs: X('robs') }, 1: { preco: 30, marca: 'FRAS LE' } }, { contato: X('cfcontato') }),
      forn('f2', 'OUTRO', { 0: { preco: 130, marca: 'FRA' }, 1: { preco: 31, marca: X('rmarca2') } }),
    ], { titulo: X('titulo'), obs: X('cobs') }),
  ],
});

test('XSS: texto malicioso nos dados não vira código em nenhuma tela', async () => {
  const s = await abrir(dados());
  const { page } = s;
  for (const [rota, id] of [['inicio'], ['nova'], ['cotacoes'], ['cotacao', 'c1'], ['cotacao', 'c0'], ['produtos'], ['fornecedores'], ['duvidas'], ['relatorios'], ['config']]) {
    await irPara(page, rota, id);
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => ({ xss: window.__xss || [], tags: document.querySelectorAll('#app [data-xss], body > :not(#app) [data-xss]').length }));
    assert.deepEqual(r, { xss: [], tags: 0 }, `tela ${rota}${id ? ' ' + id : ''}`);
  }
  // o texto aparece como texto (escapado), não some
  await irPara(page, 'cotacao', 'c1');
  assert.match(await page.locator('#app').innerText(), /idesc"><img/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
