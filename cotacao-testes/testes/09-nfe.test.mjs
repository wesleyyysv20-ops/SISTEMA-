import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrir, base, fechar, salvarDepois, lerXlsx, item, forn, cotacao, irPara, n, ns } from '../ajuda.mjs';

after(fechar);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-'));

/** NF-e de exemplo no leiaute oficial (nfeProc > NFe > infNFe). */
function xmlNFe({ numero = '4521', destCnpj = '11111111000111', itens }) {
  const det = itens.map((x, k) => `
      <det nItem="${k + 1}"><prod><cProd>${x.cProd}</cProd><cEAN>SEM GTIN</cEAN><xProd>${x.xProd}</xProd><NCM>87083090</NCM><CFOP>5405</CFOP>
        <uCom>PC</uCom><qCom>${x.q.toFixed(4)}</qCom><vUnCom>${x.vUn.toFixed(10)}</vUnCom><vProd>${(x.q * x.vUn).toFixed(2)}</vProd>${x.vDesc ? `<vDesc>${x.vDesc.toFixed(2)}</vDesc>` : ''}<indTot>1</indTot></prod>
        <imposto><ICMS><ICMS60><orig>0</orig><CST>60</CST></ICMS60></ICMS></imposto></det>`).join('');
  const total = itens.reduce((s, x) => s + x.q * x.vUn - (x.vDesc || 0), 0);
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe53260912345678000199550010000${numero}1000${numero}" versao="4.00">
    <ide><cUF>53</cUF><nNF>${numero}</nNF><serie>1</serie><dhEmi>2026-09-24T10:30:00-03:00</dhEmi></ide>
    <emit><CNPJ>12345678000199</CNPJ><xNome>AUTO MIX DISTRIBUIDORA DE PECAS LTDA</xNome><xFant>AUTO MIX</xFant></emit>
    <dest><CNPJ>${destCnpj}</CNPJ><xNome>LOJA SAO SEBASTIAO</xNome></dest>
    ${det}
    <total><ICMSTot><vProd>${total.toFixed(2)}</vProd><vFrete>0.00</vFrete><vNF>${total.toFixed(2)}</vNF></ICMSTot></total>
  </infNFe></NFe></nfeProc>`;
}

const itensCot = [
  item('P1', 'AMORTECEDOR DIANT', 'COFAP', { codigo: 'GP30562' }),
  item('P2', 'ANEIS PISTAO STD', 'ML', { codigo: 'PR9125STD' }),
  item('P3', 'BOMBA DAGUA', '', { codigo: 'UB152' }),
  item('P4', 'RADIADOR AGUA', '', { codigo: '2527/GR12527' }),
  item('P5', 'CORREIA', '', { codigo: 'K060' }),
];
const dados = () => base({
  config: { loja: 'Loja Teste', lojas: [
    { id: 'sao-sebastiao', nome: 'São Sebastião', cnpj: '11.111.111/0001-11', endereco: '' },
    { id: 'paranoa', nome: 'Paranoá', cnpj: '22.222.222/0001-22', endereco: '' }] },
  fornecedores: [{ id: 'f1', nome: 'Auto Mix Distribuidora' }, { id: 'f2', nome: 'Via Peças' }],
  cotacoes: [cotacao('c1', '0009', '2026-09-20', 'aberta', itensCot, [
    forn('f1', 'Auto Mix Distribuidora', { 0: { preco: 100, marca: 'COFAP' }, 1: { preco: 50 }, 2: { preco: 30 }, 3: { preco: 200 }, 4: { preco: 20 } }),
    forn('f2', 'Via Peças', { 4: { preco: 15 } }),
  ], { qtds: { 0: { 'sao-sebastiao': 3 }, 1: { 'sao-sebastiao': 2 }, 2: { 'sao-sebastiao': 1 }, 3: { 'sao-sebastiao': 1, paranoa: 1 }, 4: { 'sao-sebastiao': 5 } } })],
});

const NOTA = {
  itens: [
    { cProd: 'GP30562', xProd: 'AMORTECEDOR DIANT GOL COFAP', q: 3, vUn: 105 }, // preço acima: 3 × R$ 5
    { cProd: 'ML-PR9125STD', xProd: 'JOGO ANEIS STD', q: 1, vUn: 50 }, // código parecido, veio 1 de 2
    { cProd: '99999', xProd: 'BOMBA DAGUA UB-152', q: 1, vUn: 32, vDesc: 2 }, // pela descrição, com desconto
    { cProd: 'PAL-22', xProd: 'PALHETA LIMPADOR 22', q: 2, vUn: 18 }, // não pedido
    { cProd: 'K060', xProd: 'CORREIA DENTADA', q: 1, vUn: 15 }, // item que outro fornecedor ganhou
  ],
};

async function importar(s, xml, nome = 'nota.xml') {
  const f = path.join(tmp, nome);
  fs.writeFileSync(f, xml);
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.setInputFiles('[data-import-nfe-geral]', f);
  await s.page.waitForSelector('#painelNFe');
}

test('NF-e: acha fornecedor, cotação e loja sozinho e mostra as divergências', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await importar(s, xmlNFe(NOTA));
  const titulo = await page.locator('#painelNFe h3').innerText().then(n);
  assert.equal(titulo, 'Conferência da NF-e nº 4521 · São Sebastião');
  const stats = await page.locator('#painelNFe .stats').innerText().then(n);
  assert.match(stats, /Itens conferidos\s+4\s+1 OK/);
  assert.match(stats, /Preço acima do cotado\s+1\s+a cobrar R\$ 15,00/);
  assert.match(stats, /Quantidade diferente\s+1/);
  assert.match(stats, /Não vieram\s+1/);
  assert.match(stats, /Na nota, mas não pedidos\s+2/);
  const linhas = await page.locator('.tab-nfe tbody tr').allInnerTexts().then(ns);
  assert.match(linhas[0], /preço acima[\s\S]*GP30562[\s\S]*pelo código[\s\S]*R\$ 100,00\s+R\$ 105,00[\s\S]*R\$ 15,00/);
  assert.match(linhas[1], /veio menos[\s\S]*código parecido/);
  assert.match(linhas[2], /OK[\s\S]*pela descrição[\s\S]*R\$ 30,00\s+R\$ 30,00/, 'desconto considerado');
  assert.match(linhas[3], /não veio[\s\S]*RADIADOR/);
  assert.ok(linhas.some(l => /item de outro fornecedor[\s\S]*K060/.test(l)));
  assert.ok(linhas.some(l => /não pedido[\s\S]*PAL-22/.test(l)));
  // o CNPJ do fornecedor fica salvo
  await page.click('[data-act=fecharNFe]');
  assert.match(await page.locator('#secPedidos').innerText().then(n), /São Sebastião: ⚠ divergência cobrar R\$ 15,00/);
  await irPara(page, 'fornecedores');
  await page.click('[data-act=editarForn][data-id=f1]');
  assert.equal(await page.inputValue('[name=cnpj]'), '12.345.678/0001-99');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('NF-e: vincular na mão é lembrado na próxima nota; texto e Excel de divergências', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await importar(s, xmlNFe(NOTA));
  // palheta foi entregue no lugar do radiador: liga na mão
  await page.selectOption('[data-vincular-nfe="3"]', '3');
  const texto = await page.evaluate(() => { const c = cotAtual(); return textoCobranca(c, c.recebimentos[0]); });
  assert.match(texto, /- GP30562 AMORTECEDOR DIANT: cotado a R\$\s100,00, faturado a R\$\s105,00 \(3 un\., diferença de R\$\s15,00\)/);
  assert.match(texto, /- PR9125STD ANEIS PISTAO STD: pedimos 2, vieram 1/);
  assert.match(texto, /Total cobrado acima do cotado: R\$\s15,00/);
  const xl = await salvarDepois(s, () => page.click('[data-act=exportarDivergencias]'));
  assert.match(xl.nome, /^Divergencias_NF4521_auto_mix_distribuidora\.xlsx$/);
  const ws = (await lerXlsx(xl.buffer)).worksheets[0];
  let totalCobrar = null;
  ws.eachRow(r => { if (r.getCell(7).value === 'Total a cobrar') totalCobrar = r.getCell(8).value; });
  assert.equal(totalCobrar, 15);
  // importa de novo a mesma nota: confirma e o vínculo aprendido já vem feito
  const f = path.join(tmp, 'nota2.xml');
  fs.writeFileSync(f, xmlNFe(NOTA));
  await page.click('nav [data-route=cotacoes]');
  await page.setInputFiles('[data-import-nfe-geral]', f);
  await page.click('.dlg button.primary');
  await page.waitForSelector('#painelNFe');
  const palheta = await page.locator('.tab-nfe tbody tr', { hasText: 'PAL-22' }).innerText();
  assert.match(palheta, /vínculo salvo/);
  assert.equal(await page.evaluate(() => cotAtual().recebimentos.length), 1, 'substituiu, não duplicou');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('NF-e: pergunta a loja quando o CNPJ de destino não é conhecido; nota inválida avisa', async () => {
  const s = await abrir(dados());
  const { page } = s;
  const f = path.join(tmp, 'outra-loja.xml');
  fs.writeFileSync(f, xmlNFe({ numero: '777', destCnpj: '99999999000199', itens: [{ cProd: '2527/GR12527', xProd: 'RADIADOR', q: 1, vUn: 200 }] }));
  await page.click('nav [data-route=cotacoes]');
  await page.setInputFiles('[data-import-nfe-geral]', f);
  await page.waitForSelector('.dlg select#dlgCampo');
  await page.selectOption('#dlgCampo', 'paranoa');
  await page.click('.dlg button.primary');
  await page.waitForSelector('#painelNFe');
  assert.match(await page.locator('#painelNFe h3').innerText().then(n), /nº 777 · Paranoá/);
  assert.match(await page.locator('#painelNFe .stats').innerText().then(n), /Itens conferidos\s+1\s+1 OK/);
  assert.match(await page.locator('#secPedidos').innerText().then(n), /Paranoá: ✓ recebido/);

  const ruim = path.join(tmp, 'ruim.xml');
  fs.writeFileSync(ruim, '<?xml version="1.0"?><qualquer><coisa/></qualquer>');
  await page.click('nav [data-route=cotacoes]');
  await page.setInputFiles('[data-import-nfe-geral]', ruim);
  await page.waitForSelector('.dlg p');
  assert.match(await page.locator('.dlg p').innerText(), /não é o XML de uma NF-e/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
