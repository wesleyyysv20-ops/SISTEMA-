import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, irPara } from '../ajuda.mjs';

after(fechar);

// a lista da nova cotação fica em ordem de descrição: A100, F200, V300
const prod = (id, codigo, descricao, marca) => ({ id, codigo, descricao, marca, similar: '', unidade: 'UN', categoria: '', obs: '' });
const dados = () => base({
  produtos: [prod('p1', 'A100', 'AMORTECEDOR DIANTEIRO', 'QUALQUER'), prod('p2', 'F200', 'FILTRO OLEO', 'TECFIL'), prod('p3', 'V300', 'VELA IGNICAO', 'NGK')],
  rascunho: { titulo: '', prazoResposta: '', obs: '', fornecedorIds: [], itens: [
    { produtoId: 'p1', quantidade: 1, marca: '' },
    { produtoId: 'p2', quantidade: 1, marca: '' },
    { produtoId: 'p3', quantidade: 1, marca: '' },
  ] },
});
const marca = i => `[data-marca-item="${i}"]`;
const cadastro = (page, id) => page.evaluate(i => db.produtos.find(p => p.id === i).marca, id);
const naCotacao = (page, i) => page.evaluate(j => db.rascunho.itens[j].marca, i);
const cursor = page => page.evaluate(() => ui.cursorItem);

test('nova cotação: Enter salva e vai para o próximo; Enter duas vezes grava o item salvo no cadastro', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await irPara(page, 'nova');

  // Enter uma vez: vale só nesta cotação e desce para o item de baixo
  await page.click(marca(0));
  await page.fill(marca(0), 'COFAP');
  await page.keyboard.press('Enter');
  assert.equal(await cursor(page), 1);
  await page.waitForTimeout(1700); // passou o tempo do segundo Enter
  assert.equal(await cadastro(page, 'p1'), 'QUALQUER');
  assert.equal(await naCotacao(page, 0), 'COFAP');

  // já no item de baixo, é só digitar: a marca é trocada sem precisar de Enter antes
  await page.keyboard.type('MANN');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // segundo Enter: o item salvo (F200) vira padrão; o cursor continua no V300
  assert.equal(await cadastro(page, 'p2'), 'MANN');
  assert.equal(await naCotacao(page, 1), '');
  assert.equal(await page.inputValue(marca(1)), 'MANN');
  assert.equal(await cursor(page), 2);
  assert.equal(await cadastro(page, 'p3'), 'NGK', 'o item de baixo não é mexido');
  assert.match(await page.locator('#toast').innerText(), /agora é o padrão no cadastro de F200 \(antes: "TECFIL"\)/);

  // último item: Enter fica nele, e Enter duas vezes grava no cadastro
  await page.keyboard.type('BOSCH');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  assert.equal(await cadastro(page, 'p3'), 'BOSCH');

  // marca já trocada nesta cotação: abrir (F2), Enter, Enter também grava no cadastro
  await page.keyboard.press('Home');
  assert.equal(await cursor(page), 0);
  await page.keyboard.press('F2');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  assert.equal(await cadastro(page, 'p1'), 'COFAP');
  assert.equal(await cursor(page), 1);

  // depois do tempo, Enter na lista volta a abrir o campo da marca (não grava nada)
  await page.waitForTimeout(1700);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.marcaItem), '1');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('nova cotação: ao digitar a marca, sugere a mais usada do cadastro', async () => {
  const s = await abrir(base({
    produtos: [
      prod('p1', 'A100', 'AMORTECEDOR', 'QUALQUER'), prod('p2', 'B200', 'BOBINA', 'SÓ NGK'), prod('p3', 'C300', 'CABO VELA', 'SÓ NGK'),
      prod('p4', 'D400', 'DISCO', 'SÓ NAKATA'), prod('p5', 'E500', 'ESCAPE', 'SABO'),
    ],
    rascunho: { titulo: '', prazoResposta: '', obs: '', fornecedorIds: [], itens: [{ produtoId: 'p1', quantidade: 1, marca: '' }, { produtoId: 'p5', quantidade: 1, marca: '' }] },
  }));
  const { page } = s;
  await irPara(page, 'nova');
  const campo = () => page.evaluate(() => {
    const x = document.activeElement;
    return { valor: x.value, sugerido: x.value.slice(x.selectionStart, x.selectionEnd) };
  });

  // digitando direto na lista (sem acento): completa com a mais usada
  await page.locator('#tabItens').focus();
  await page.keyboard.type('so');
  assert.deepEqual(await campo(), { valor: 'SÓ NGK', sugerido: ' NGK' });
  await page.keyboard.type(' na');
  assert.deepEqual(await campo(), { valor: 'SÓ NAKATA', sugerido: 'KATA' });

  // Delete apaga a sugestão e fica só o digitado
  await page.keyboard.press('Delete');
  assert.deepEqual(await campo(), { valor: 'SÓ NA', sugerido: '' });
  await page.keyboard.press('Backspace');
  assert.equal((await campo()).valor, 'SÓ N', 'apagando, não completa de novo');

  // Enter aceita a sugestão
  await page.keyboard.type('g');
  assert.equal((await campo()).valor, 'SÓ NGK');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => db.rascunho.itens[0].marca), 'SÓ NGK');

  // marca que não existe no cadastro: não sugere nada
  await page.keyboard.type('xyz');
  assert.deepEqual(await campo(), { valor: 'xyz', sugerido: '' });
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('nova cotação: KIT CORREIA e KIT TENSOR têm o código editável só na cotação', async () => {
  const s = await abrir(base({
    produtos: [
      prod('k1', 'CT1000', 'KIT CORREIA DENTADA', 'CONTITECH'), prod('k2', 'TB200', 'KIT TENSOR CORREIA', 'SKF'),
      prod('p3', 'P300', 'PASTILHA FREIO', 'COBREQ'),
    ],
    rascunho: { titulo: '', prazoResposta: '', obs: '', fornecedorIds: [], itens: [
      { produtoId: 'k1', quantidade: 1, marca: '' }, { produtoId: 'k2', quantidade: 1, marca: '' }, { produtoId: 'p3', quantidade: 1, marca: '' },
    ] },
  }));
  const { page } = s;
  await irPara(page, 'nova');
  const cod = i => `[data-codigo-item="${i}"]`;
  assert.equal(await page.locator('[data-codigo-item]').count(), 2, 'só os KIT CORREIA / KIT TENSOR');
  assert.equal(await page.locator('[data-item-linha="2"] [data-codigo-item]').count(), 0);

  await page.click(cod(0));
  await page.fill(cod(0), 'CT1000K1');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => db.rascunho.itens[0].codigoArquivo), 'CT1000K1');
  assert.equal(await page.evaluate(() => db.produtos.find(p => p.id === 'k1').codigo), 'CT1000', 'cadastro não muda');
  assert.equal(await page.evaluate(() => ui.cursorItem), 1, 'Enter vai para o item de baixo');
  assert.match(await page.locator('[data-item-linha="0"]').innerText(), /cadastro: CT1000/);

  // voltar ao código do cadastro
  await page.click(cod(0));
  await page.fill(cod(0), 'CT1000');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => db.rascunho.itens[0].codigoArquivo), '');

  // seta para baixo no código: a linha de baixo sem campo de código só recebe o cursor
  await page.click(cod(1));
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => [ui.cursorItem, document.activeElement.id]).then(x => x.join()), '2,tabItens');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
