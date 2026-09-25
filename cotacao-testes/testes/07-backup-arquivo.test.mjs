import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar, salvarDepois, cotacao, n, ns } from '../ajuda.mjs';

after(fechar);

const dados = () => base({
  produtos: [{ id: 'p1', codigo: 'A', descricao: 'X' }],
  ultimoBackup: new Date(Date.now() - 20 * 86400000).toISOString(),
  cotacoes: [cotacao('a', '0001', '2026-06-01', 'cancelada', [], []), cotacao('b', '0002', '2026-06-10', 'finalizada', [], []),
    cotacao('c', '0003', new Date().toISOString().slice(0, 10), 'finalizada', [], []), cotacao('d', '0004', new Date().toISOString().slice(0, 10), 'aberta', [], [])],
});

test('lembrete de backup: aparece, adia e some depois do backup', async () => {
  const s = await abrir(dados());
  const { page } = s;
  assert.match(await page.locator('.aviso-backup').innerText().then(n), /Último backup há 20 dia/);
  await page.click('[data-act=adiarBackup]');
  assert.equal(await page.locator('.aviso-backup').count(), 0);
  await page.click('nav [data-route=config]');
  const arq = await salvarDepois(s, () => page.click('[data-act=backup]'));
  assert.match(arq.nome, /^backup_cotacoes_\d{4}-\d{2}-\d{2}\.json$/);
  const copia = JSON.parse(arq.buffer.toString('utf8'));
  assert.equal(copia.cotacoes.length, 4);
  assert.deepEqual(s.erros, []);
  await s.fechar();
});

test('arquivar: sugere canceladas e finalizadas antigas; desarquivar traz de volta', async () => {
  const s = await abrir(dados());
  const { page } = s;
  await page.click('nav [data-route=cotacoes]');
  assert.match(await page.locator('.sugestao-arquivar').innerText().then(n), /2 cotação\(ões\) podem ser arquivadas[\s\S]*nº 0001, nº 0002/);
  await page.click('[data-act=arquivarSugeridas]');
  await page.click('.dlg button.primary');
  const lista = () => page.locator('#tbCot tr td:first-child').allInnerTexts();
  assert.deepEqual(await lista(), ['0004', '0003']);
  await page.check('#verArquivadas');
  assert.deepEqual(await lista(), ['0002', '0001']);
  await page.click('[data-route=cotacao][data-id=b]');
  await page.click('[data-act=arquivarCot]');
  await page.click('nav [data-route=cotacoes]');
  await page.uncheck('#verArquivadas');
  assert.deepEqual(await lista(), ['0004', '0003', '0002']);
  assert.equal(await page.locator('.sugestao-arquivar').count(), 0, 'desarquivada na mão não é sugerida de novo');
  assert.deepEqual(s.erros, []);
  await s.fechar();
});
