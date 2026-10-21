import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao } from '../ajuda.mjs';

after(fechar);

// Defeito: ao clicar em "Compacto" (e depois voltar ao normal) a caixa da tabela, que tem rolagem própria, ficava
// cortada embaixo da tela (só ~2 linhas à vista, com barra de rolagem). Agora ela continua aparecendo inteira.
const LOJAS = [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }];
const itens = Array.from({ length: 60 }, (_, i) => item('P' + i, 'PECA ' + i, 'NGK', { codigo: 'COD-' + i }));
const precos = k => Object.fromEntries(itens.map((_, i) => [i, { preco: 10 + i + k, marca: 'NGK' }]));
const dados = () => base({ config: { loja: 'DISPPAR', lojas: LOJAS }, cotacoes: [cotacao('c1', '0122', '2026-09-29', 'aberta', itens, [
  forn('f1', 'KAIZEN', precos(0)), forn('f2', 'VIA PEÇAS', precos(2)),
], { qtds: { 0: { paranoa: 1 } } })] });

const medir = page => page.evaluate(() => {
  const p = document.querySelector('.painel-comp');
  const r = p.getBoundingClientRect();
  return { altura: Math.round(r.height), visivel: Math.round(Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)), estilo: p.getAttribute('style') };
});

for (const [largura, altura] of [[1366, 800], [830, 800]]) {
  test(`comparativo: compacto e depois normal deixa a caixa da tabela inteira à vista (${largura} px)`, async () => {
    const s = await abrir(dados(), { largura, altura });
    const { page } = s;
    await page.evaluate(() => { try { localStorage.setItem('cotacao.compacto', '0'); } catch (e) { /* */ } });
    await page.click('nav [data-route=cotacoes]');
    await page.click('[data-route=cotacao][data-id=c1]');
    await page.waitForSelector('.painel-comp tbody tr');
    await page.waitForTimeout(500);
    const antes = await medir(page);
    for (const modo of [/compacto/, /^(?!.*compacto)/]) {
      // como o usuário: com o cabeçalho do quadro (onde fica o botão) à vista
      await page.evaluate(() => document.getElementById('secComp').scrollIntoView({ block: 'start' }));
      await page.click('[data-act=alternarCompacto]');
      await page.waitForTimeout(600);
      assert.match(await page.locator('.tab-comp').getAttribute('class'), modo);
      const m = await medir(page);
      assert.equal(m.estilo, null, 'sem altura gravada na caixa');
      assert.equal(m.altura, antes.altura, 'a caixa mantém a altura');
      assert.ok(m.visivel >= m.altura - 2, `a caixa não pode ficar cortada pela tela: ${JSON.stringify(m)}`);
    }
    assert.deepEqual(s.erros, []);
    await s.fechar();
  });
}
