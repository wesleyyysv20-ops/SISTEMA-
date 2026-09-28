import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, irPara } from '../ajuda.mjs';

after(fechar);

// a lista da nova cotação fica em ordem de descrição
const prod = (id, codigo, descricao, marca, similar = '') => ({ id, codigo, descricao, marca, similar, unidade: 'UN', categoria: '', obs: '' });
const dados = () => base({
  produtos: [
    prod('p1', 'OZA663-GM28', 'SENSOR OXIGENIO (SONDA LAMBDA) PRE-CAT', 'SÓ NGK'),
    prod('p2', 'TS3980/TDI1072', 'TERMINAL DIRECAO DIR', 'QUALQUER'),
    prod('p3', 'TS3981/TDI1073', 'TERMINAL DIRECAO ESQ', 'QUALQUER', 'VIEMAR 555'),
    prod('p4', 'VL100', 'VELA IGNICAO', 'NGK'),
  ],
  rascunho: { titulo: '', prazoResposta: '', obs: '', fornecedorIds: [], itens: ['p1', 'p2', 'p3', 'p4'].map(produtoId => ({ produtoId, quantidade: 1, marca: '' })) },
});
const visiveis = page => page.locator('[data-item-linha]:not([hidden])').evaluateAll(trs => trs.map(tr => tr.querySelector('td:nth-child(2)').innerText.split('\n')[0]));

test('lista da cotação: procurar por código, similar, marca ou descrição', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'nova');

  await page.fill('#filtroItens', 'oza663gm28'); // sem traço e minúsculo
  assert.deepEqual(await visiveis(page), ['OZA663-GM28']);
  assert.equal(await page.locator('#contaFiltroItens').innerText(), '1 de 4 itens');

  await page.fill('#filtroItens', 'terminal');
  assert.deepEqual(await visiveis(page), ['TS3980/TDI1072', 'TS3981/TDI1073']);
  await page.fill('#filtroItens', 'terminal esq');
  assert.deepEqual(await visiveis(page), ['TS3981/TDI1073'], 'todas as palavras');
  await page.fill('#filtroItens', 'viemar');
  assert.deepEqual(await visiveis(page), ['TS3981/TDI1073'], 'similar');
  await page.fill('#filtroItens', 'ngk');
  assert.deepEqual(await visiveis(page), ['OZA663-GM28', 'VL100'], 'marca');
  await page.fill('#filtroItens', 'xyz');
  assert.equal(await page.locator('#contaFiltroItens').innerText(), 'Nenhum item encontrado');

  // setas só passam pelos encontrados; Enter na busca vai para o primeiro
  await page.fill('#filtroItens', 'ngk');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => [ui.cursorItem, document.activeElement.id].join()), '0,tabItens');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => ui.cursorItem), 3, 'pula os terminais escondidos');

  // Esc na busca mostra tudo de novo
  await page.click('#filtroItens');
  await page.keyboard.press('Escape');
  assert.equal((await visiveis(page)).length, 4);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('lista da cotação: tirar item pede confirmação (✕ e Ctrl+Delete)', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'nova');
  const codigos = () => page.evaluate(() => db.rascunho.itens.map(x => db.produtos.find(p => p.id === x.produtoId).codigo));

  // ✕ e Cancelar: não tira nada
  await page.fill('#filtroItens', 'TS3980');
  await page.click('[data-item-linha="1"] [data-act=removerItem]');
  assert.match(await page.locator('.dlg').innerText(), /Tirar este item da cotação\?[\s\S]*TS3980\/TDI1072 · TERMINAL DIRECAO DIR[\s\S]*continua no cadastro/);
  await page.click('.dlg button:text("Cancelar")');
  assert.equal((await codigos()).length, 4);

  // ✕ e confirmar: tira só ele; a busca continua valendo
  await page.click('[data-item-linha="1"] [data-act=removerItem]');
  await page.click('.dlg button.primary');
  assert.deepEqual(await codigos(), ['OZA663-GM28', 'TS3981/TDI1073', 'VL100']);
  assert.equal(await page.inputValue('#filtroItens'), 'TS3980');
  assert.equal(await page.locator('#contaFiltroItens').innerText(), 'Nenhum item encontrado');
  assert.equal(await page.evaluate(() => db.produtos.length), 4, 'o produto continua no cadastro');

  // teclado: Ctrl+Delete na linha, Esc no diálogo cancela, Enter confirma
  await page.fill('#filtroItens', 'vela');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Delete');
  await page.keyboard.press('Escape');
  assert.equal((await codigos()).length, 3);
  await page.keyboard.press('Control+Delete');
  await page.keyboard.press('Enter');
  assert.deepEqual(await codigos(), ['OZA663-GM28', 'TS3981/TDI1073']);

  // Delete sem Ctrl continua apagando só a marca (não tira o item)
  await page.click('#filtroItens');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Delete');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.marcaItem), '0');
  assert.equal((await codigos()).length, 2);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('lista da cotação: item que não está na lista pode ser incluído do cadastro', async () => {
  const d = dados();
  d.produtos.push(prod('p5', 'GB48167', 'AMORTECEDOR TRASEIRO', 'SÓ COFAP'), prod('p6', 'GB48168', 'AMORTECEDOR DIANTEIRO', 'SÓ COFAP'));
  const s = await abrir(d);
  const { page } = s;
  await irPara(page, 'nova');
  const naCotacao = () => page.evaluate(() => db.rascunho.itens.map(x => db.produtos.find(p => p.id === x.produtoId).codigo));

  // já está na lista: não oferece de novo
  await page.fill('#filtroItens', 'OZA663');
  assert.match(await page.locator('#foraDaLista').innerText(), /Nenhum produto/);

  // fora da lista: aparece com "+ Incluir", código igual primeiro
  await page.fill('#filtroItens', 'gb48167');
  assert.equal(await page.locator('#contaFiltroItens').innerText(), 'Nenhum item encontrado');
  assert.match(await page.locator('#foraDaLista').innerText(), /No cadastro, fora da lista[\s\S]*GB48167\s+AMORTECEDOR TRASEIRO/);
  await page.click('[data-act=incluirDaBusca][data-id=p5]');
  assert.ok((await naCotacao()).includes('GB48167'));
  assert.equal(await page.locator('#contaFiltroItens').innerText(), '1 de 5 itens', 'o incluído aparece na lista');
  assert.equal(await page.evaluate(() => db.rascunho.itens[ui.cursorItem].produtoId), 'p5', 'cursor no item incluído');
  assert.equal(await page.locator('[data-act=incluirDaBusca][data-id=p5]').count(), 0);

  // Enter na busca sem nada na lista: inclui o primeiro do cadastro; depois é só digitar a marca
  await page.fill('#filtroItens', 'GB48168');
  await page.keyboard.press('Enter');
  assert.ok((await naCotacao()).includes('GB48168'));
  await page.keyboard.type('MONROE');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => db.rascunho.itens.find(x => x.produtoId === 'p6').marca), 'MONROE');

  // já está na lista: não oferece cadastrar
  await page.fill('#filtroItens', 'OZA663');
  assert.equal(await page.locator('[data-act=cadastrarDaBusca]').count(), 0);

  // não está no cadastro: oferece cadastrar no banco e incluir; Esc cancela
  await page.fill('#filtroItens', 'kx-900');
  assert.match(await page.locator('#foraDaLista').innerText(), /Nenhum produto com “kx-900” no cadastro[\s\S]*Cadastrar “KX-900” no banco e incluir/);
  await page.keyboard.press('Enter');
  assert.match(await page.locator('.dlg').innerText(), /Cadastrar o produto KX-900/);
  await page.keyboard.press('Escape');
  assert.equal((await naCotacao()).length, 6);
  assert.equal(await page.evaluate(() => db.produtos.length), 6, 'cancelado: nada cadastrado');

  // Enter, descrição, Enter: cadastra no banco e inclui; o cursor fica nele para digitar a marca
  await page.click('#filtroItens');
  await page.keyboard.press('Enter');
  await page.keyboard.type('suporte motor');
  await page.keyboard.press('Enter');
  // depois da descrição, a marca exigida (obrigatória): vazia não cadastra
  assert.match(await page.locator('.dlg').innerText(), /KX-900 · SUPORTE MOTOR[\s\S]*Marca exigida/);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => db.produtos.some(p => p.codigo === 'KX-900')), false, 'sem marca não entra no banco');
  await page.click('#filtroItens');
  await page.keyboard.press('Enter');
  await page.keyboard.type('suporte motor');
  await page.keyboard.press('Enter');
  await page.keyboard.type('só sampel');
  await page.keyboard.press('Enter');
  const novo = await page.evaluate(() => db.produtos.find(p => p.codigo === 'KX-900'));
  assert.deepEqual([novo.descricao, novo.marca], ['SUPORTE MOTOR', 'SÓ SAMPEL']);
  assert.ok((await naCotacao()).includes('KX-900'));
  assert.equal(await page.evaluate(() => db.rascunho.itens[ui.cursorItem].produtoId), novo.id);

  // busca com espaço (descrição) não vira código novo
  await page.fill('#filtroItens', 'bomba agua');
  assert.equal(await page.locator('[data-act=cadastrarDaBusca]').count(), 0);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('lista da cotação vazia: a busca aparece e inclui do cadastro', async () => {
  const d = dados();
  d.rascunho.itens = [];
  const s = await abrir(d);
  const { page } = s;
  await irPara(page, 'nova');
  await page.fill('#filtroItens', 'vela');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-item-linha]').count(), 1);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
