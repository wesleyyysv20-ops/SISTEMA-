import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrir, base, fechar, salvarDepois } from '../ajuda.mjs';

after(fechar);

// "XX" na OBS = cotar para São Sebastião
const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xx-')), 'xx.csv');
fs.writeFileSync(arq, 'Código;Descrição;Fabricante;OBS\n' + [
  ['A1', 'SENSOR OXIGENIO', 'BOSCH', '01'], ['A2', 'TERMINAL DIRECAO', 'NAKATA', '01 XX'], ['B1', 'CILINDRO RODA', 'TRW', '08 XX'], ['A1', 'SENSOR OXIGENIO', 'BOSCH', '01 XX'],
].map(l => l.join(';')).join('\n'));

test('XX na OBS: "01" e "01 XX" no mesmo grupo; o item leva a etiqueta DSS até o comparativo (só informação)', async () => {
  const s = await abrir(base({ config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] } }));
  const { page } = s;
  await page.click('nav [data-route=nova]');
  await page.setInputFiles('[data-import-datacar]', arq);
  await page.waitForSelector('#dlgDataCar');
  const grupos = await page.locator('.conf-grupo[data-g-idx]:not(.conf-concluir) .cg-obs').allInnerTexts();
  assert.equal(grupos.length, 2, '01 + 01 XX juntos; 08 XX');
  assert.match(grupos[0], /^01\s*3 itens\s*📍 2 DSS/);
  assert.match(grupos[1], /^08\s*1 item\s*📍 DSS/);
  await page.click('[data-act=dcRestVai]');
  await page.click('.dlg-fundo:not(#dlgDataCar) .dlg button.primary');
  await page.click('[data-act=dcAdicionar]');
  // A1 veio com e sem XX: para as duas lojas (não é "repetido"); A2 e B1 só DSS
  const tags = await page.evaluate(() => [...document.querySelectorAll('[data-item-linha]')].map(tr => [tr.querySelector('td:nth-child(2)').innerText.split('\n')[0], tr.querySelector('.tag-loja')?.innerText || '', !!tr.querySelector('.badge.warn')]));
  const porCod = Object.fromEntries(tags.map(([c, t, rep]) => [c.split(' ')[0], [t, rep]]));
  assert.deepEqual(porCod.A1, ['📍 DPR + DSS', false]);
  assert.deepEqual(porCod.A2, ['📍 DSS', false]);
  assert.deepEqual(porCod.B1, ['📍 DSS', false]);
  // cria a cotação: a etiqueta vai para o item
  await page.evaluate(() => { rascunho().prazoResposta = '2099-12-31'; });
  await salvarDepois(s, async () => {
    await page.click('[data-act=criarCotacao]');
    if (await page.locator('.dlg button.primary').count()) await page.click('.dlg button.primary');
  });
  const itens = await page.evaluate(() => db.cotacoes[0].itens.map(it => [it.codigo, it.lojaObs || '']));
  assert.deepEqual(Object.fromEntries(itens), { A1: 'ambas', A2: 'dss', B1: 'dss' });
  assert.equal(await page.evaluate(() => Object.keys(db.cotacoes[0].qtds || {}).length), 0, 'nenhuma quantidade preenchida');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('nova cotação: filtros rápidos da lista (sem marca, São Sebastião)', async () => {
  const s = await abrir(base({
    config: { loja: 'DISPPAR', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }] },
    produtos: [{ id: 'p1', codigo: 'A1', descricao: 'SENSOR', marca: 'BOSCH' }, { id: 'p2', codigo: 'B1', descricao: 'BOMBA', marca: '' }, { id: 'p3', codigo: 'C1', descricao: 'CILINDRO', marca: 'TRW' }],
    rascunho: { titulo: 'X', prazoResposta: '', obs: '', fornecedorIds: [], itens: [{ produtoId: 'p1', obsArquivo: ['01'] }, { produtoId: 'p2', obsArquivo: ['02'] }, { produtoId: 'p3', obsArquivo: ['08 XX'] }] },
  }));
  const { page } = s;
  await page.click('nav [data-route=nova]');
  const vis = () => page.locator('[data-item-linha]:not([hidden])').count();
  assert.match(await page.locator('#tiposItens').innerText(), /Todos\s*3[\s\S]*Sem marca\s*1[\s\S]*São Sebastião\s*1/);
  await page.click('[data-act=tipoItens][data-tipo=semMarca]');
  assert.equal(await vis(), 1);
  assert.equal(await page.locator('#contaFiltroItens').innerText(), '1 de 3 itens');
  await page.click('[data-act=tipoItens][data-tipo=dss]');
  assert.equal(await vis(), 1);
  assert.match(await page.locator('[data-item-linha]:not([hidden])').innerText(), /C1/);
  await page.click('[data-act=tipoItens][data-tipo=""]');
  assert.equal(await vis(), 3);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
