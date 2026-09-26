import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { abrir, base, fechar, salvarDepois, lerXlsx, valor, item, forn, cotacao, diasAtras, n, ns } from '../ajuda.mjs';

after(fechar);

const dados = (prazo = diasAtras(1)) => base({
  config: { loja: 'Loja Teste', email: 'loja@x.com' },
  cotacoes: [cotacao('c1', '0005', '2026-09-01', 'aberta', [item('p1', 'ROLAMENTO')], [
    forn('f1', 'Auto Mix', null, { email: 'auto@x.com' }),
    forn('f2', 'Via Peças', null, { email: 'via@x.com' }),
    forn('f3', 'Dist Sul'),
    forn('f4', 'Resp OK', { 0: { preco: 10 } }, { email: 'ok@x.com' }),
  ], { prazoResposta: prazo })],
});

const estado = page => page.locator('.tab-lote tbody tr').evaluateAll(rs => rs.map(r => (r.classList.contains('feito') ? '✓' : r.classList.contains('atual') ? '▶' : '·') + r.cells[1].innerText.split('\n')[0]));

async function abrirCotacao(d) {
  const s = await abrir(d);
  await s.page.click('nav [data-route=cotacoes]');
  await s.page.click('[data-route=cotacao][data-id=c1]');
  return s;
}

test('envio em sequência: abre o e-mail do fornecedor da vez e avança', async () => {
  const s = await abrirCotacao(dados());
  const { page } = s;
  await page.uncheck('[data-sel-forn=f4]');
  assert.equal(await page.locator('#qtdSel').innerText().then(n), '3 de 4 marcado(s)');
  await page.click('[data-act=envioLote]');
  assert.deepEqual(await estado(page), ['▶Auto Mix', '·Via Peças', '·Dist Sul']);
  const href = await page.locator('.tab-lote tr.atual a:text("Gmail")').getAttribute('href');
  assert.match(href, /to=auto%40x\.com/);
  await page.click('.tab-lote tr.atual a:text("Gmail")');
  await page.waitForFunction(() => document.querySelector('.tab-lote tr.feito'));
  assert.deepEqual(await estado(page), ['✓Auto Mix', '▶Via Peças', '·Dist Sul']);
  const grupo = decodeURIComponent(await page.locator('[data-marca-grupo]').last().getAttribute('href'));
  assert.match(grupo, /bcc=auto@x\.com,via@x\.com/, 'e-mail único com cópia oculta');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('planilhas dos marcados num .zip, cada uma com o nome do fornecedor', async () => {
  const s = await abrirCotacao(dados());
  await s.page.uncheck('[data-sel-forn=f4]');
  const arq = await salvarDepois(s, () => s.page.click('[data-act=zipMarcados]'));
  assert.equal(arq.nome, 'Cotacao_0005_planilhas.zip');
  const zip = await JSZip.loadAsync(arq.buffer);
  const nomes = Object.keys(zip.files).sort();
  assert.deepEqual(nomes, ['Cotacao_0005_auto_mix.xlsx', 'Cotacao_0005_dist_sul.xlsx', 'Cotacao_0005_via_pecas.xlsx']);
  const wb = await lerXlsx(await zip.file('Cotacao_0005_via_pecas.xlsx').async('nodebuffer'));
  assert.equal(valor(wb.getWorksheet('_dados').getCell('A3')), 'f2', 'a planilha sabe de qual fornecedor é');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('prazo vencido: avisos, cobrança e prazo editável', async () => {
  const s = await abrirCotacao(dados());
  const { page } = s;
  assert.match(await page.locator('#nav a[data-route=cotacoes]').innerText().then(n), /Cotações\s*1/);
  assert.match(await page.locator('p.aviso-prazo').innerText().then(n), /venceu ontem[\s\S]*Auto Mix, Via Peças, Dist Sul/);
  await page.click('[data-act=cobrarPendentes]');
  assert.match(await page.locator('#painelLote h3').innerText().then(n), /Cobrar resposta · 3/);
  const href = await page.locator('.tab-lote tr.atual a:text("Gmail")').getAttribute('href');
  assert.match(decodeURIComponent(href), /Lembrete: cotação nº 0005/);
  await page.click('[data-act=fecharLote]');
  const futuro = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await page.fill('[data-change=prazoCot]', futuro);
  await page.dispatchEvent('[data-change=prazoCot]', 'change');
  assert.equal(await page.locator('p.aviso-prazo').count(), 0);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
