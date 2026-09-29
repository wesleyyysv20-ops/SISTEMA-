import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, irPara, n } from '../ajuda.mjs';

after(fechar);

const origem = { cotId: 'c1', numero: '0001', fornecedor: 'ENVIA PEÇAS', marcaExigida: 'DELPHI-MARELLI' };
const d = (id, empresa, codigo, qtd, valor, marca, obs) => ({ id, empresa, codigo, qtd, valor, marca, obs, origem });
const fila = [
  d('a1', 'DPR', 'BI0023MM', 2, 100.92, 'DELPHI', '--> TEMOS DELPHI'),
  d('a2', 'DSS', 'BI0023MM', 5, 100.92, 'DELPHI', '--> TEMOS DELPHI'),
  d('b1', 'DPR', 'F000ZS0213', 1, 129.82, 'MAGNETI MARELLI', '--> AUMENTOU!'),
  d('c1', 'DSS', 'SP11064-4', 1, 67.36, 'MANN HUMMEL', '--> TEMOS OUTRA MARCA!'),
];

test('dúvidas: itens iguais numa linha só ("2 DPR e 5 DSS") e filtro por empresa', async () => {
  const s = await abrir(base({ duvidas: fila }));
  const { page } = s;
  await irPara(page, 'duvidas');
  const linhas = () => page.locator('.duvidas-grid tbody tr');
  assert.equal(await linhas().count(), 3);
  assert.equal(n(await linhas().first().locator('.pede-duv').innerText()), '2 DPR e 5 DSS');
  const texto = async () => n(await page.locator('#textoDuvidas').innerText());
  assert.match(await texto(), /- \*BI0023MM\. --> TEMOS DELPHI\*\nR\$ 100,92 - DELPHI\n\*PEDE 2 DPR E 5 DSS \?\*/);

  // filtro DPR: só as dúvidas do Paranoá (na fila e no texto do WhatsApp)
  assert.deepEqual((await page.locator('.filtro-duv button').allInnerTexts()).map(t => n(t).replace(/\s+/g, ' ')), ['Todas 4', 'DPR 2', 'DSS 2']);
  await page.click('.filtro-duv button[data-emp=DPR]');
  assert.equal(await linhas().count(), 2);
  assert.equal(n(await linhas().first().locator('.pede-duv').innerText()), '2 DPR');
  assert.match(await texto(), /\*PEDE 2 DPR \?\*/);
  assert.doesNotMatch(await texto(), /DSS|SP11064/);
  assert.match(await page.locator('[data-act=copiarDuvidas]').innerText(), /\(DPR\)/);
  await page.click('.filtro-duv button[data-emp=""]');
  assert.equal(await linhas().count(), 3);

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
