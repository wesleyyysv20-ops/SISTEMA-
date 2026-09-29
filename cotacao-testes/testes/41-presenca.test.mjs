import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, n } from '../ajuda.mjs';

after(fechar);

const itens = ['A', 'B'].map(x => item('P' + x, 'PECA ' + x, 'NGK', { codigo: 'COD-' + x }));
const dados = () => base({ cotacoes: [
  cotacao('c1', '0001', '2026-09-29', 'aberta', itens, [forn('f1', 'KAIZEN', { 0: { preco: 10 } }), forn('f2', 'VIA PEÇAS', { 1: { preco: 5 } })]),
  cotacao('c2', '0002', '2026-09-29', 'aberta', itens, [forn('f1', 'KAIZEN', { 0: { preco: 10 } })]),
] });

test('presença: quem está na cotação aparece no cabeçalho, na lista e avisa quando está no mesmo fornecedor', async () => {
  const s = await abrir(dados());
  const { page } = s;
  // outras pessoas (o canal do Supabase entrega isto; aqui simulado)
  const chegam = outros => page.evaluate(o => { presenca.outros = o; atualizarPresencaTela(); }, outros);
  await page.click('nav [data-route=cotacoes]');
  await chegam([{ email: 'maria@loja.com', nome: 'Maria', cotId: 'c1', forn: 'KAIZEN' }, { email: 'joao@loja.com', nome: '', cotId: 'c2', forn: '' }]);
  assert.equal(await page.locator('.presenca-lista[data-cot=c1] .presenca-mini').innerText(), 'M');
  assert.equal(await page.locator('.presenca-lista[data-cot=c2] .presenca-mini').getAttribute('title'), 'joao está nesta cotação');

  await page.click('[data-route=cotacao][data-id=c1]');
  assert.match(n(await page.locator('#presencaCot').innerText()), /Nesta cotação agora:\s*Maria\s*· KAIZEN/);
  assert.equal(await page.locator('#presencaCot .presenca-aviso').count(), 0);
  // eu escolho KAIZEN também: aviso para não digitarmos o mesmo fornecedor
  await page.selectOption('#filtroVencedor', 'f1');
  await page.waitForSelector('#presencaCot .presenca-aviso');
  assert.match(n(await page.locator('#presencaCot .presenca-aviso').innerText()), /Maria também está em KAIZEN/);
  assert.match(await page.locator('#presencaCot .presenca-chip').getAttribute('class'), /conflito/);
  // Maria saiu
  await chegam([]);
  assert.equal(await page.locator('#presencaCot').isHidden(), true);
  // meu estado anunciado
  assert.deepEqual(await page.evaluate(() => { const e = meuEstadoPresenca(); return [e.tela, e.cotId, e.forn]; }), ['cotacao', 'c1', 'KAIZEN']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
