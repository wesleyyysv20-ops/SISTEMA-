import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, item, forn, cotacao, irPara, n, hoje } from '../ajuda.mjs';

after(fechar);

test('prazo de resposta com hora: vence no mesmo dia depois da hora e conta na nota do fornecedor', async () => {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0030', '2026-09-20', 'aberta', [item('P1', 'VELA', 'NGK')], [
    forn('f1', 'KAIZEN', { 0: { preco: 10 } }, { respondidoEm: '2026-09-29T11:30:00-03:00' }), // depois das 09:00
    forn('f2', 'VIA PEÇAS', { 0: { preco: 12 } }, { respondidoEm: '2026-09-29T08:45:00-03:00' }), // antes das 09:00
    forn('f3', 'COBRA'),
  ], { prazoResposta: '2026-09-29', prazoHora: '09:00' })] }));
  const { page } = s;
  // nota dos fornecedores: só a Via Peças respondeu dentro do prazo (data e hora)
  const r = await page.evaluate(() => { const c = db.cotacoes[0]; return c.fornecedores.map(f => respondeuNoPrazo(c, f)); });
  assert.deepEqual(r, [false, true, false]);
  const semHora = await page.evaluate(() => { const c = { ...db.cotacoes[0], prazoHora: '' }; return respondeuNoPrazo(c, c.fornecedores[0]); });
  assert.equal(semHora, true, 'sem hora: vale até o fim do dia');

  // prazo hoje, com a hora já passada: "venceu hoje"; hora ainda por vir: "vence hoje às"
  const txt = await page.evaluate(d => {
    const c = db.cotacoes[0];
    c.prazoResposta = d; c.prazoHora = '00:01';
    const a = textoPrazo(diasAtePrazo(c), c.prazoHora);
    c.prazoHora = '23:59';
    const b = textoPrazo(diasAtePrazo(c), c.prazoHora);
    return [a, b, textoDataPrazo(c)];
  }, hoje());
  assert.equal(txt[0], 'venceu hoje às 00:01');
  assert.equal(txt[1], 'vence hoje às 23:59');
  assert.match(txt[2], /^\d\d\/\d\d\/\d{4} às 23:59$/);

  // campo de hora na cotação
  await page.evaluate(() => render());
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  await page.fill('[data-change=prazoHoraCot]', '10:30');
  await page.locator('[data-change=prazoHoraCot]').dispatchEvent('change');
  assert.equal(await page.evaluate(() => db.cotacoes[0].prazoHora), '10:30');
  // nova cotação: a hora vai junto
  await irPara(page, 'nova');
  assert.equal(await page.locator('[data-draft=prazoHora]').count(), 1);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('Dif. 1º × 2º: escolhido o mais barato mostra o 2º; escolhido outro mostra o mais barato', async () => {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0031', '2026-09-28', 'aberta', [item('P1', 'VELA', 'NGK')], [
    forn('f1', 'KAIZEN', { 0: { preco: 13.78 } }),
    forn('f2', 'RMP', { 0: { preco: 11.34 } }),
  ])] }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const dif = () => page.locator('.tab-comp tbody tr').first().locator('.dif-seg').locator('xpath=..').innerText().then(n);
  assert.match(await dif(), /\+21,5%\s+o 2º é mais caro\s+2º KAIZEN R\$ 13,78/);
  // escolhe a Kaizen (2º lugar): mostra quem tem o menor preço
  await page.locator('.tab-comp tbody tr').first().locator('td.escolhivel', { hasText: '13,78' }).click();
  assert.match(await dif(), /\+21,5%\s+1º RMP R\$ 11,34/);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('empate de preço: quem respondeu primeiro ganha e o outro é o 2º; marca do vencedor no preço escolhido', async () => {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0032', '2026-09-28', 'aberta', [item('P1', 'VELA', 'QUALQUER')], [
    forn('f1', 'KAIZEN', { 0: { preco: 16.96, marca: 'NGK' } }, { respondidoEm: '2026-09-28T15:00:00Z' }),
    forn('f2', 'RMP', { 0: { preco: 16.96, marca: 'BOSCH' } }, { respondidoEm: '2026-09-28T09:00:00Z' }), // respondeu antes
    forn('f3', 'VIA PEÇAS', { 0: { preco: 20 } }, { respondidoEm: '2026-09-28T08:00:00Z' }),
  ])] }));
  const { page } = s;
  const r = await page.evaluate(() => { const l = comparar(db.cotacoes[0]).linhas[0]; return [l.vencedor, l.segundoIdx, l.difSegundo]; });
  assert.deepEqual(r, [1, 0, 0], 'RMP (respondeu primeiro) ganha; KAIZEN é o 2º');
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const linha = page.locator('.tab-comp tbody tr').first();
  assert.match(n(await linha.innerText()), /2º KAIZEN R\$ 16,96/);
  assert.equal(await linha.locator('.marca-venc').innerText(), 'BOSCH', 'marca de quem ganhou, embaixo do preço escolhido');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('diferença acima de 100% entre o 1º e o 2º: alerta de possível preço errado', async () => {
  const s = await abrir(base({ cotacoes: [cotacao('c1', '0034', '2026-09-28', 'aberta', [item('P1', 'VELA', 'QUALQUER'), item('P2', 'BOBINA', 'QUALQUER')], [
    forn('f1', 'KAIZEN', { 0: { preco: 18.55 }, 1: { preco: 40 } }),
    forn('f2', 'RMP', { 0: { preco: 25.36 }, 1: { preco: 95 } }), // 2º item: 137,5% mais caro
  ])] }));
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  await page.click('[data-route=cotacao][data-id=c1]');
  const linhas = page.locator('.tab-comp tbody tr[data-comp-linha]');
  assert.equal(await linhas.nth(0).locator('.chip-alerta-dif').count(), 0, '36,7%: sem alerta');
  assert.equal(await linhas.nth(1).locator('.chip-alerta-dif').innerText(), '⚠ confira o preço');
  assert.equal(await linhas.nth(1).locator('.dif-seg.suspeita').count(), 1);
  assert.match(n(await page.locator('.aviso-dif').innerText()), /1 item\(ns\) com mais de 100% de diferença/);
  // escolhido o mais caro: continua avisando (o escolhido está mais de 100% acima do menor)
  await linhas.nth(1).locator('td.escolhivel', { hasText: '95,00' }).click();
  assert.equal(await page.locator('.tab-comp tbody tr[data-comp-linha]').nth(1).locator('.chip-alerta-dif').count(), 1);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
