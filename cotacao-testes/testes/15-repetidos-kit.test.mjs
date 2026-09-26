import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, salvarDepois, lerXlsx, valor, item, forn, cotacao, irPara, n } from '../ajuda.mjs';

after(fechar);

const produtos = [
  { id: 'p1', codigo: '40123', descricao: 'ACOPLAMENTO VARAO CAMBIO', marca: 'COFAP' },
  { id: 'p2', codigo: '40123-KITCIA', descricao: 'ACOPLAMENTO VARAO CAMBIO (KIT)', marca: 'KIT CIA QUALQUER' },
  { id: 'p3', codigo: 'CT1234', descricao: 'KIT CORREIA DENTADA', marca: 'CONT-DAY-GAT' },
  { id: 'p4', codigo: 'GB48167', descricao: 'AMORTECEDOR TRASEIRO', marca: 'SÓ COFAP' },
];

test('regra do DISPPAR: sufixo de KIT não esconde o código repetido', async () => {
  const s = await abrir(base());
  const r = await s.page.evaluate(() => ({
    toks: tokensCodigo('40123-KITCIA'),
    parc: parceirosCodigo(['40123', '40123-KITCIA', 'GB48167', '2527/GR12527', '2527/RD45552']),
    kit: [ehKit('CT1234', 'KIT CORREIA DENTADA'), ehKit('40123-KITCIA', 'ACOPLAMENTO'), ehKit('GB48167', 'AMORTECEDOR'), ehKit('KITCHEN', 'X')],
  }));
  assert.ok(r.toks.includes('40123'));
  assert.deepEqual(r.parc, [[1], [0], [], [4], [3]]);
  assert.deepEqual(r.kit, [true, true, false, false]);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('nova cotação: etiqueta KIT e aviso de KIT com peça avulsa', async () => {
  const s = await abrir(base({ produtos }));
  const { page } = s;
  await irPara(page, 'nova');
  await page.click('.colar-codigos summary');
  await page.fill('#colarCodigos', '40123\n40123-KITCIA\nCT1234\nGB48167');
  await page.click('[data-act=colarCodigos]');
  await page.click('.dlg button');
  assert.equal(await page.locator('#tabItens .badge.kit, [data-item-linha] .badge.kit').count(), 2);
  const painel = n(await page.locator('.painel-dup').innerText());
  assert.match(painel, /Código em comum: 40123[\s\S]*KIT e peça avulsa com o mesmo código/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('planilha enviada: códigos repetidos em vermelho; comparativo marca KIT e repetido', async () => {
  const itens = produtos.map(p => item(p.id, p.descricao, p.marca, { codigo: p.codigo }));
  const s = await abrir(base({ produtos, cotacoes: [cotacao('c1', '0018', '2026-09-26', 'aberta', itens, [forn('f1', 'Auto Mix', { 0: { preco: 10 }, 1: { preco: 30 } })])] }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const arq = await salvarDepois(s, () => page.click('[data-act=baixarPlanilha][data-f="0"]'));
  const ws = (await lerXlsx(arq.buffer)).getWorksheet('Cotação');
  const vermelhos = [3, 4, 5, 6].map(r => [valor(ws.getCell(`B${r}`)), ws.getCell(`B${r}`).font?.color?.argb === 'FFFF0000']);
  assert.deepEqual(vermelhos, [['40123', true], ['40123-KITCIA', true], ['CT1234', false], ['GB48167', false]]);
  const linhas = await page.locator('.tab-comp tbody tr').evaluateAll(rs => rs.slice(0, 4).map(r => [...r.querySelectorAll('.badge')].map(b => b.innerText).join(',')));
  assert.deepEqual(linhas, ['repetido', 'KIT,repetido', 'KIT', '']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
