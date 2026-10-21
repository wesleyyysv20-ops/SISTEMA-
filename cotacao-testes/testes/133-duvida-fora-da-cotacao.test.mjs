import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const itens = ['A', 'B', 'C'].map(x => item('P' + x, 'PECA ' + x, 'QUALQUER', { codigo: 'COD-' + x }));
const dados = () => base({
  config: { loja: 'DISPPAR', lojas: [
    { id: 'paranoa', nome: 'Paranoá', sigla: 'DPR', cnpj: '11.111.111/0001-11', endereco: 'Quadra 2' },
    { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS', cnpj: '22.222.222/0001-22', endereco: 'Rua 1' },
  ] },
  fornecedores: [{ id: 'f1', nome: 'KAIZEN' }],
  cotacoes: [cotacao('c1', '0133', '2026-10-21', 'aberta', itens, [
    forn('f1', 'KAIZEN', { 0: { preco: 10 }, 1: { preco: 30 }, 2: { preco: 5 } }),
  ], { qtds: { 0: { paranoa: 2, 'sao-sebastiao': 3 }, 1: { paranoa: 1, 'sao-sebastiao': 1 }, 2: { paranoa: 4, 'sao-sebastiao': 4 } } })],
});
const itensPedido = page => page.evaluate(() => pedidosPorFornecedor(db.cotacoes[0]).find(p => p.fi === 0)?.itens.map(x => x.it.codigo) ?? []);

async function abrirCot() {
  const s = await abrir(dados());
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  await s.page.waitForSelector('.tab-comp tbody tr');
  return s;
}
/** Edita a quantidade de uma loja no formulário de Dúvidas e salva. */
async function editarQtd(page, sigla, valor) {
  await page.evaluate(([sg, v]) => { const f = document.querySelector('form[data-form=duvida]'); f.elements['qtd_' + sg].value = v; f.requestSubmit(); }, [sigla, valor]);
}
async function paraDuvida(page, i, lojasBotao) {
  await page.locator(`.tab-comp tbody tr[data-comp-linha="${i}"] [data-act=duvidaItem]`).click();
  await page.click(`.dlg button[data-r="${lojasBotao}"]`);
  await page.waitForFunction(k => !!db.cotacoes[0].foraDuvida?.[k], i);
}

test('dúvida tira o item da cotação: limpar as dúvidas não devolve e não avisa "Pedido mudou"; ✕ tirar devolve', async () => {
  const s = await abrirCot();
  const { page } = s;
  await paraDuvida(page, 0, 1); // as duas lojas
  assert.deepEqual(await page.evaluate(() => db.cotacoes[0].foraDuvida), { 0: { paranoa: true, 'sao-sebastiao': true } });
  assert.deepEqual(await itensPedido(page), ['COD-B', 'COD-C']);
  // exporta e marca como enviado, com o item A fora
  await page.evaluate(() => { const c = db.cotacoes[0]; anotarPedidoExportado(c, 0); c.fornecedores[0].pedidoEnviadoEm = new Date().toISOString(); render(); });
  assert.match(await page.locator('.corpo-recolhe .exp-forn').innerText(), /Enviado/);
  // limpa a fila de Dúvidas
  await page.click('nav [data-route=duvidas]');
  await page.click('[data-act=limparDuvidas]');
  await page.click('.dlg button:has-text("Remover")');
  assert.equal(await page.evaluate(() => db.duvidas.length), 0);
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  assert.deepEqual(await itensPedido(page), ['COD-B', 'COD-C'], 'o item segue fora do pedido');
  assert.match(await page.locator('.tab-comp tbody tr[data-comp-linha="0"]').getAttribute('class'), /sit-duvida/);
  const txt = n(await page.locator('.corpo-recolhe .exp-forn').innerText());
  assert.doesNotMatch(txt, /Pedido mudou/);
  assert.match(txt, /Enviado/);
  // os totais (por loja, do comparativo e do resumo) batem com a soma dos pedidos: o item em dúvida fica de fora
  const tot = await page.evaluate(() => {
    const c = db.cotacoes[0], comp = comparar(c), peds = pedidosPorFornecedor(c);
    return { melhor: comp.melhor, porLoja: comp.porLojaTotal, ped: peds.reduce((t, p) => t + p.total, 0),
      pedDPR: pedidosPorFornecedor(c, 'paranoa').reduce((t, p) => t + p.total, 0), pedDSS: pedidosPorFornecedor(c, 'sao-sebastiao').reduce((t, p) => t + p.total, 0), forn: comp.totais[0].total };
  });
  assert.equal(tot.ped, 50 + 50);
  assert.equal(tot.melhor, tot.ped);
  assert.equal(tot.forn, tot.ped);
  assert.equal(tot.porLoja.paranoa, tot.pedDPR);
  assert.equal(tot.porLoja['sao-sebastiao'], tot.pedDSS);
  assert.match(n(await page.locator('#secPedidos tr.total').innerText()), /R\$ 50,00\s+R\$ 50,00\s+R\$ 100,00/);
  assert.match(n(await page.locator('.resumo-cot').innerText()), /Total do pedido\s+R\$ 100,00/);
  await page.screenshot({ path: 'C:/Users/BALCAO/AppData/Local/Temp/claude/C--Users-BALCAO-Desktop-SISTEMA-COTA--O-WEB/0842de55-740c-47ad-bb81-1d7bee283500/scratchpad/fotos/duvida-limpa-pagina.png' });
  await page.locator('#secForn').screenshot({ path: 'C:/Users/BALCAO/AppData/Local/Temp/claude/C--Users-BALCAO-Desktop-SISTEMA-COTA--O-WEB/0842de55-740c-47ad-bb81-1d7bee283500/scratchpad/fotos/duvida-limpa.png' });
  // ✕ tirar da dúvida: desfaz de verdade
  await page.locator('.tab-comp tbody tr[data-comp-linha="0"] [data-act=tirarDuvidaItem]').click();
  await page.click('.dlg button:has-text("Tirar das Dúvidas")');
  await page.waitForFunction(() => !db.cotacoes[0].foraDuvida);
  assert.deepEqual(await itensPedido(page), ['COD-A', 'COD-B', 'COD-C']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('janela flutuante: item em dúvida (todas as lojas com quantidade) sai da janela; só uma loja em dúvida, continua', async () => {
  const s = await abrirCot();
  const { page } = s;
  await page.evaluate(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: undefined });
    window.open = () => { const f = document.createElement('iframe'); f.id = 'janelaTeste'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:560px;z-index:99999;background:#fff'; document.body.appendChild(f); return f.contentWindow; };
  });
  await page.click('[data-act=abrirPip]');
  const j = page.frameLocator('#janelaTeste');
  await j.locator('#pip .pip-cod').waitFor();
  const pos = async () => (await j.locator('.pip-pos').innerText()).replace(/\s+/g, ' ');
  assert.match(await pos(), /1 de 3/);
  // item aberto (A) vai para a dúvida nas duas lojas: a janela passa para o B
  await j.locator('[data-pip=duvida]').click();
  await j.locator('.dlg button[data-r="1"]').click();
  await j.locator('.pip-cod-txt', { hasText: 'COD-B' }).waitFor();
  assert.match(await pos(), /1 de 2/);
  assert.match(await j.locator('#pipForn option').first().innerText(), /Todos os itens \(2\)/);
  // limpar as dúvidas não traz o A de volta
  await page.evaluate(() => { db.duvidas = []; salvar(); render(); desenharPip(true); });
  assert.match(await pos(), /1 de 2/);
  // C em dúvida só na DSS, mas a DPR já digitou: sai da janela
  await page.evaluate(() => { const c = db.cotacoes[0]; c.foraDuvida = { ...c.foraDuvida, 2: { 'sao-sebastiao': true } }; salvar(); render(); desenharPip(true); });
  assert.match(await pos(), /1 de 1/);
  // a DPR ainda não digitou: o item continua na janela para ela
  await page.evaluate(() => { const c = db.cotacoes[0]; c.qtds = { ...c.qtds, 2: { 'sao-sebastiao': 4 } }; salvar(); render(); desenharPip(true); });
  assert.match(await pos(), /1 de 2/);
  // a DPR digitou 0: também vale como digitado
  await page.evaluate(() => { const c = db.cotacoes[0]; c.qtds = { ...c.qtds, 2: { paranoa: 0, 'sao-sebastiao': 4 } }; salvar(); render(); desenharPip(true); });
  assert.match(await pos(), /1 de 1/);
  await page.evaluate(() => { const c = db.cotacoes[0]; c.qtds = { ...c.qtds, 2: { 'sao-sebastiao': 4 } }; salvar(); render(); desenharPip(true); });
  // sem o "✕" a janela volta a mostrar o A
  await page.evaluate(() => { const c = db.cotacoes[0]; delete c.foraDuvida[0]; salvar(); render(); desenharPip(true); });
  assert.match(await pos(), /2 de 3/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('a marca de dúvida da cotação junta quando dois computadores gravam ao mesmo tempo', async () => {
  const s = await abrirCot();
  const r = await s.page.evaluate(() => mesclarValor({}, { 0: { paranoa: true } }, { 0: { 'sao-sebastiao': true }, 2: { paranoa: true } }));
  assert.deepEqual(r, { 0: { paranoa: true, 'sao-sebastiao': true }, 2: { paranoa: true } });
  await s.fechar();
});

test('tela Dúvidas: o ✕ da linha devolve o item; "Limpar dúvidas" mantém fora; editar acerta a marca', async () => {
  const s = await abrirCot();
  const { page } = s;
  await paraDuvida(page, 0, 1);
  await paraDuvida(page, 2, 1);
  assert.deepEqual(await itensPedido(page), ['COD-B']);
  // ✕ da linha do item A (as duas lojas): o item A volta; o C continua fora
  await page.click('nav [data-route=duvidas]');
  const idsA = await page.evaluate(() => db.duvidas.filter(d => d.origem.i === 0).map(d => d.id).join(','));
  await page.locator('[data-act=removerDuvida][data-id="' + idsA + '"]').click();
  assert.equal(await page.evaluate(() => db.cotacoes[0].foraDuvida[0]), undefined);
  assert.deepEqual(await itensPedido(page), ['COD-A', 'COD-B']);
  assert.ok(await page.evaluate(() => !!db.cotacoes[0].foraDuvida[2]));
  // editar o C: tira a DSS (zera) e fica só a DPR -> a marca acompanha
  await page.locator('[data-act=editarDuvida]').first().click();
  await editarQtd(page, 'DSS', '0');
  assert.deepEqual(await page.evaluate(() => db.cotacoes[0].foraDuvida[2]), { paranoa: true });
  // zerar todas as lojas: o item volta ao pedido
  await page.locator('[data-act=editarDuvida]').first().click();
  await editarQtd(page, 'DPR', '0');
  assert.equal(await page.evaluate(() => db.cotacoes[0].foraDuvida), undefined);
  assert.deepEqual(await itensPedido(page), ['COD-A', 'COD-B', 'COD-C']);
  // "Limpar dúvidas" mantém fora e a confirmação avisa
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await paraDuvida(page, 0, 1);
  await page.click('nav [data-route=duvidas]');
  await page.click('[data-act=limparDuvidas]');
  assert.match(n(await page.locator('.dlg').innerText()), /Eles continuam fora do pedido/);
  await page.click('.dlg button:has-text("Remover")');
  assert.deepEqual(await itensPedido(page), ['COD-B', 'COD-C']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
