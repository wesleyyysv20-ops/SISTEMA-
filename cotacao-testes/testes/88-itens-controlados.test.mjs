import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, salvarDepois, n } from '../ajuda.mjs';

after(fechar);

const prod = (id, codigo, descricao) => ({ id, codigo, descricao, unidade: 'UN', marca: 'QUALQUER', categoria: '' });
const csv = linhas => ({ name: 'datacar.csv', mimeType: 'text/csv', buffer: Buffer.from('Código;Descrição;Fabricante;OBS\n' + linhas.join('\n'), 'utf8') });
const dados = () => base({
  produtos: [prod('p1', 'CAR80', 'DESCARBONIZANTE (CAR80)'), prod('p2', 'DOT4-500ML/BOSCH', 'FLUIDO PARA FREIO 500 ML (DOT 4)'), prod('p3', 'GP33264', 'AMORTECEDOR DIANT')],
  fornecedores: [{ id: 'f1', nome: 'KAIZEN' }],
});
async function carregar(page) {
  await page.click('nav [data-route=nova]');
  await page.setInputFiles('[data-import-datacar]', csv(['CAR80;DESCARBONIZANTE (CAR80);CAR80;01', 'DOT4-500ML/BOSCH;FLUIDO PARA FREIO DOT 4;BOSCH;01', 'GP33264;AMORTECEDOR DIANT;COFAP;01']));
  await page.waitForSelector('#dlgDataCar');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
}

test('itens controlados: alerta na hora com os itens que entraram, bloqueio e autorização do administrador', async () => {
  const s = await abrir(dados());
  const { page } = s;
  assert.equal(await page.evaluate(() => itensControlados().length), 7, 'a lista já vem com os 7 itens do orçamento');
  await carregar(page);
  const dlg = page.locator('.dlg', { hasText: 'Item controlado' });
  await dlg.waitFor();
  const txt = n(await dlg.innerText());
  assert.match(txt, /Estes 2 itens controlados entraram/);
  assert.match(txt, /CAR80 — DESCARBONIZANTE/);
  assert.match(txt, /DOT4-500ML\/BOSCH — FLUIDO PARA FREIO/);
  assert.doesNotMatch(txt, /GP33264/);
  await dlg.locator('button:text("Deixar bloqueado")').click();
  assert.equal(await page.locator('#tabItens tr.item-bloqueado').count(), 2);
  // não cria com item bloqueado
  await page.click('[data-act=criarCotacao]');
  assert.match(n(await page.locator('.dlg').innerText()), /não pode ser criada: 2 item\(ns\) controlado\(s\)/);
  await page.click('.dlg button.primary');
  assert.equal(await page.evaluate(() => db.cotacoes.length), 0);
  // o alerta não repete para os mesmos itens
  await page.evaluate(() => render());
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.dlg', { hasText: 'Item controlado' }).count(), 0);
  // administrador autoriza os dois e a cotação sai
  for (let k = 0; k < 2; k++) {
    await page.locator('[data-act=autorizarControlado]').first().click();
    await page.click('.dlg button.primary');
  }
  assert.equal(await page.locator('#tabItens tr.item-bloqueado').count(), 0);
  assert.equal(await page.locator('.selo-controlado.ok').count(), 2);
  await page.evaluate(() => { rascunho().fornecedorIds = ['f1']; salvar(); render(); });
  await salvarDepois(s, async () => { await page.click('[data-act=criarCotacao]'); if (await page.locator('.dlg button.primary').count()) await page.click('.dlg button.primary'); });
  const it = await page.evaluate(() => db.cotacoes[0].itens.filter(x => x.controladoAutorizado).map(x => x.codigo).sort());
  assert.deepEqual(it, ['CAR80', 'DOT4-500ML/BOSCH']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('itens controlados: quem não é administrador não autoriza; "tirar" remove da cotação', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.evaluate(() => { nuvem.usuario = 'compras@loja.com'; nuvem.admin = false; });
  await carregar(page);
  const dlg = page.locator('.dlg', { hasText: 'Item controlado' });
  await dlg.waitFor();
  assert.equal(await dlg.locator('button:text("Autorizar")').count(), 0, 'sem o botão de autorizar');
  await dlg.locator('button:text("Tirar todos da cotação")').click();
  assert.deepEqual(await page.evaluate(() => rascunho().itens.map(x => x.codigoArquivo)), ['GP33264']);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
