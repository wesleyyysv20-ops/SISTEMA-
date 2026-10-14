import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara } from '../ajuda.mjs';

after(fechar);

// cotação parecida com a real: muitos fornecedores, campanha, marca pedida, nomes compridos
const NOMES = ['KAIZEN', 'RMP', 'COMANDO', 'RIO JUNTAS', 'PELLEGRINO', 'ENVIA PEÇAS', 'COBRA ROLAMENTOS', 'DPK', 'KAMPEAO', 'SAMA', 'ROLES', 'ELETROPAR'];
const itens = Array.from({ length: 30 }, (_, k) => item('P' + k, `AMORTECEDOR DIANTEIRO LADO DIREITO TURBOGAS ${k}`, k % 3 ? 'ALB-NAK-KAY-PERF-MONR' : 'QUALQUER', { codigo: `GP3${k}868/AMD0${k}125` }));
const dados = () => base({
  config: { loja: 'DISPPAR AUTOPEÇAS', lojas: [{ id: 'paranoa', nome: 'Paranoá', sigla: 'DPR' }, { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS' }], campanhas: [{ id: 'k1', marca: 'PERFECT', fornecedorId: 'f5', de: '2026-10-01', ate: '2026-10-31' }] },
  produtos: itens.map(x => ({ id: x.produtoId, codigo: x.codigo, descricao: x.descricao, marca: x.marca, unidade: 'UN', similar: '' })),
  fornecedores: NOMES.map((nome, k) => ({ id: 'f' + k, nome, email: `vendas@${nome.toLowerCase().replace(/\W/g, '')}.com.br`, contato: 'PEDRO' })),
  cotacoes: [cotacao('c1', '0013', '2026-10-13', 'aberta', itens, NOMES.map((nome, k) => forn('f' + k, nome, k < 9
    ? Object.fromEntries(itens.map((_, i) => [i, { preco: 100 + ((i * 7 + k * 13) % 90) + 0.37, marca: ['PERFECT', 'NAKATA', 'COFAP', 'FRA', 'FRAS LE'][(i + k) % 5] }]))
    : null)), { prazoResposta: '2026-10-01', qtds: { 0: { paranoa: 2 } } })],
});

const TELAS = [['inicio'], ['nova'], ['cotacoes'], ['cotacao', 'c1'], ['produtos'], ['fornecedores'], ['duvidas'], ['relatorios'], ['config']];

/** Problemas de alinhamento na tela: página mais larga que a janela, coisas saindo da caixa, números cortados. */
function problemas() {
  const res = [];
  const W = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > W + 1) res.push(`página mais larga que a tela (${document.documentElement.scrollWidth} > ${W})`);
  const nome = el => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''} "${(el.innerText || el.value || '').trim().slice(0, 30)}"`;
  const visivel = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  // nada sai do cartão (menos dentro das tabelas com rolagem e dos menus abertos)
  for (const card of document.querySelectorAll('#app .card, #app .secoes-cot')) {
    const rc = card.getBoundingClientRect();
    for (const el of card.querySelectorAll('button, a, input, select, label, .badge, .pill-aviso, .rc-kpi, h2, h3, .chip-forn-pend')) {
      if (!visivel(el) || el.closest('.table-wrap, .menu-pop, details:not([open]) > :not(summary), .dlg-fundo, [hidden]')) continue;
      // barra que rola para o lado de propósito (no celular)
      let rola = false;
      for (let x = el.parentElement; x && x !== card.parentElement; x = x.parentElement) if (/auto|scroll/.test(getComputedStyle(x).overflowX)) { rola = true; break; }
      if (rola) continue;
      const r = el.getBoundingClientRect();
      if (r.right > rc.right + 1 || r.left < rc.left - 1) res.push(`sai do cartão: ${nome(el)}`);
    }
  }
  // números e rótulos dos cartões de resumo não ficam cortados
  for (const el of document.querySelectorAll('#app .rc-kpi b, #app .rc-kpi .rc-sub, #app .stat b')) {
    if (visivel(el) && el.scrollWidth > el.clientWidth + 1) res.push(`cortado: ${nome(el)}`);
  }
  // grupos de botões lado a lado: mesma altura e mesmo topo (menus "⋯ Mais" e status iguais aos botões)
  for (const grupo of document.querySelectorAll('#app .cab-cot-acoes')) {
    const bts = [...grupo.querySelectorAll(':scope > .sm, :scope > details > summary')].filter(visivel).map(b => b.getBoundingClientRect());
    // na mesma linha (as caixas se sobrepõem na vertical): mesmo topo e mesma altura; em linhas diferentes (celular) tudo bem
    const torto = bts.some(a => bts.some(b => a !== b && Math.abs(a.top - b.top) < Math.min(a.height, b.height) && (Math.abs(a.top - b.top) > 1 || Math.abs(a.height - b.height) > 1)));
    if (torto) res.push(`botões desalinhados: ${nome(grupo)}`);
  }
  // padrão de tamanhos: ações do topo da página 36px; filtros e etiquetas clicáveis 28px
  if (W > 760) {
    const alturas = (sel, h, papel) => {
      for (const b of document.querySelectorAll(sel)) if (visivel(b) && Math.abs(b.getBoundingClientRect().height - h) > 1) res.push(`${papel} com ${Math.round(b.getBoundingClientRect().height)}px (padrão ${h}px): ${nome(b)}`);
    };
    alturas('#app .cab-pagina .row > .btn, #app .cab-cot-acoes > .sm, #app .cab-cot-acoes > details > summary', 36, 'botão do topo');
    alturas('#app .chip-status, #app .pill-aviso', 28, 'filtro');
  }
  // barras de ferramentas: tudo na mesma altura (uma linha só) quando há espaço
  if (W >= 1000) {
    for (const barra of document.querySelectorAll('#secComp > .row-between > .row')) {
      const tops = [...barra.children].filter(visivel).map(x => Math.round(x.getBoundingClientRect().top));
      if (tops.length && Math.max(...tops) - Math.min(...tops) > 8) res.push(`barra quebrou em mais de uma linha: ${nome(barra)}`);
    }
  }
  return [...new Set(res)];
}

for (const [larg, alt] of [[1366, 820], [1060, 820], [390, 844]]) {
  test(`alinhamento: nenhuma tela vaza, corta ou desalinha em ${larg}px`, async () => {
    const s = await abrir(dados(), { largura: larg, altura: alt });
    const { page } = s;
    const achados = [];
    for (const [rota, id] of TELAS) {
      await irPara(page, rota, id);
      await page.waitForTimeout(150);
      for (const p of await page.evaluate(problemas)) achados.push(`${rota}: ${p}`);
    }
    assert.deepEqual(achados, []);
    assert.deepEqual(s.erros, []);
    await s.fechar();
  });
}
