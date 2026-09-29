import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, irPara, n } from '../ajuda.mjs';

after(fechar);

const origem = { cotId: 'c1', numero: '0001', fornecedor: 'ENVIA PEÇAS', marcaExigida: 'DELPHI-MARELLI' };
const d = (id, empresa, codigo, qtd, valor, marca, obs, fornecedor = 'ENVIA PEÇAS') => ({ id, empresa, codigo, qtd, valor, marca, obs, origem: { ...origem, fornecedor } });
const fila = [
  d('a1', 'DPR', 'BI0023MM', 2, 100.92, 'DELPHI', '--> TEMOS DELPHI'),
  d('a2', 'DSS', 'BI0023MM', 5, 100.92, 'DELPHI', '--> TEMOS DELPHI'),
  d('b1', 'DPR', 'F000ZS0213', 1, 129.82, 'MAGNETI MARELLI', '--> AUMENTOU!'),
  d('c1', 'DSS', 'SP11064-4', 1, 67.36, 'MANN HUMMEL', '--> TEMOS OUTRA MARCA!', 'KAIZEN'),
  { id: 'm1', empresa: 'DPR', codigo: 'X-9', qtd: 1, valor: 10, marca: '', obs: '' }, // digitada à mão
];

test('dúvidas: itens iguais numa linha só ("2 DPR e 5 DSS") e filtro por fornecedor', async () => {
  const s = await abrir(base({ duvidas: fila }));
  const { page } = s;
  await irPara(page, 'duvidas');
  const linhas = () => page.locator('.duvidas-grid tbody tr');
  assert.equal(await linhas().count(), 4);
  assert.equal(n(await linhas().first().locator('.pede-duv').innerText()), '2 DPR e 5 DSS');
  const texto = async () => n(await page.locator('#textoDuvidas').innerText());
  assert.match(await texto(), /- \*BI0023MM\. --> TEMOS DELPHI\*\nR\$ 100,92 - DELPHI\n\*PEDE 2 DPR E 5 DSS \?\*/);

  // filtro por fornecedor (conta os itens da fila); as digitadas à mão ficam no fim
  assert.deepEqual((await page.locator('.filtro-duv button').allInnerTexts()).map(t => n(t).replace(/\s+/g, ' ')), ['Todos 4', 'ENVIA PEÇAS 2', 'KAIZEN 1', 'Digitadas à mão 1']);
  await page.click('.filtro-duv button[data-forn="ENVIA PEÇAS"]');
  assert.equal(await linhas().count(), 2);
  assert.equal(n(await linhas().first().locator('.pede-duv').innerText()), '2 DPR e 5 DSS');
  assert.match(await texto(), /\*PEDE 2 DPR E 5 DSS \?\*/);
  assert.doesNotMatch(await texto(), /SP11064|X-9/);
  assert.match(await page.locator('[data-act=copiarDuvidas]').innerText(), /\(ENVIA PEÇAS\)/);
  await page.click('.filtro-duv button[data-forn=KAIZEN]');
  assert.equal(await linhas().count(), 1);
  assert.match(await texto(), /SP11064-4/);
  await page.click('.filtro-duv button[data-forn=""]');
  assert.equal(await linhas().count(), 4);

  // editar a linha: quantidade de cada loja; vazio tira a loja
  await linhas().first().locator('[data-act=editarDuvida]').click();
  assert.equal(await page.inputValue('[data-form=duvida] [name=qtd_DPR]'), '2');
  assert.equal(await page.inputValue('[data-form=duvida] [name=qtd_DSS]'), '5');
  await page.fill('[data-form=duvida] [name=qtd_DSS]', '');
  await page.fill('[data-form=duvida] [name=qtd_DPR]', '3');
  await page.click('[data-form=duvida] button.primary');
  assert.deepEqual(await page.evaluate(() => db.duvidas.filter(x => x.codigo === 'BI0023MM').map(x => [x.id, x.empresa, x.qtd, x.origem?.cotId])), [['a1', 'DPR', 3, 'c1']]);

  // ✕ numa linha agrupada tira as duas lojas
  await page.evaluate(() => { db.duvidas.push({ ...db.duvidas[0], id: 'a3', empresa: 'DSS', qtd: 4 }); salvar(); render(); });
  assert.equal(n(await linhas().first().locator('.pede-duv').innerText()), '3 DPR e 4 DSS');
  await linhas().first().locator('[data-act=removerDuvida]').click();
  assert.equal(await page.evaluate(() => db.duvidas.filter(x => x.codigo === 'BI0023MM').length), 0);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
