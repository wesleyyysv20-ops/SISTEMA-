import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { abrir, base, fechar } from '../ajuda.mjs';
import { supabaseFalso, abrirSite, entrar } from '../supabase-falso.mjs';

after(fechar);

/** Abre o site já logado e espera carregar. */
async function computador(sb) {
  const s = await abrirSite(sb);
  await entrar(s.page, 'wes@loja.com', '123456');
  await s.page.waitForSelector('#telaLogin', { state: 'hidden' });
  await esperarSalvo(s.page);
  return s;
}
const esperarSalvo = page => page.waitForFunction(() => document.querySelector('#statusNuvem')?.dataset.s === 'salvo' && !nuvem.gravando && !nuvem.timer, null, { timeout: 15000 });
/** Muda os dados na página e grava na nuvem na hora. */
async function mudar(page, fn, arg) {
  await page.evaluate(([f, a]) => { new Function('a', f)(a); salvar(); return sincronizar(); }, [fn, arg]);
  await esperarSalvo(page);
}
const produtosNaNuvem = sb => [...sb.docs].filter(([k]) => k.startsWith('produtos/')).flatMap(([, v]) => v.itens);
const prod = (id, codigo, marca) => ({ id, codigo, descricao: 'PECA ' + codigo, marca, similar: '', unidade: 'UN', categoria: '', obs: '' });

test('juntar versões: itens, campos e exclusões', async () => {
  const s = await abrir(base());
  const r = await s.page.evaluate(() => {
    const base = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }];
    const local = [{ id: 'a', v: 2 }, { id: 'b', v: 1 }, { id: 'd', v: 1 }]; // mudou a, excluiu c, incluiu d
    const remoto = [{ id: 'a', v: 1 }, { id: 'b', v: 3 }, { id: 'c', v: 1 }, { id: 'e', v: 1 }]; // mudou b, incluiu e
    return {
      itens: mesclarItens(base, local, remoto).map(x => `${x.id}${x.v}`).sort(),
      obj: mesclarObjeto({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 3, z: 9 }),
      ordemChaves: mesclarItens([{ id: 'a', p: 1, q: 2 }], [{ id: 'a', q: 2, p: 1 }], [{ id: 'a', p: 5, q: 2 }]),
      excluidaLaAlteradaAqui: mesclarDoc('cotacoes/c1', { t: 1 }, { t: 2 }, undefined),
      excluidaAquiIntactaLa: mesclarDoc('cotacoes/c1', { t: 1 }, undefined, { t: 1 }),
    };
  });
  assert.deepEqual(r.itens, ['a2', 'b3', 'd1', 'e1']);
  assert.deepEqual(r.obj, { x: 2, y: 3, z: 9 });
  assert.deepEqual(r.ordemChaves, [{ id: 'a', p: 5, q: 2 }], 'ordem das chaves não conta como alteração');
  assert.deepEqual(r.excluidaLaAlteradaAqui, { t: 2 }, 'não perde a alteração');
  assert.equal(r.excluidaAquiIntactaLa, undefined);
  await s.fechar();
});

test('dois computadores gravando ao mesmo tempo: nada se perde', async () => {
  // dois produtos no mesmo balde (mesmo documento), para forçar o conflito
  const sb = supabaseFalso({ docs: new Map([['sistema/config', { loja: 'DISPPAR' }]]) });
  const A = await computador(sb);
  const [id1, id2] = await A.page.evaluate(() => {
    const alvo = baldeDe('produtos', 'p-1');
    for (let k = 2; ; k++) if (baldeDe('produtos', 'p-' + k) === alvo) return ['p-1', 'p-' + k];
  });
  await mudar(A.page, 'db.produtos.push(...a)', [prod(id1, 'X1', 'SÓ COFAP'), prod(id2, 'X2', 'SÓ NGK')]);
  const B = await computador(sb);
  assert.equal(await B.page.evaluate(() => db.produtos.length), 2);

  // A muda o produto 1 e a loja; B (sem saber) muda o produto 2 e o backup
  await mudar(A.page, "db.produtos.find(p => p.id === a).marca = 'SÓ MONROE'; db.config.loja = 'LOJA A';", id1);
  await mudar(B.page, "db.produtos.find(p => p.id === a).marca = 'SÓ BOSCH'; db.config.backupDias = 3;", id2);

  const nuvem = Object.fromEntries(produtosNaNuvem(sb).map(p => [p.codigo, p.marca]));
  assert.deepEqual(nuvem, { X1: 'SÓ MONROE', X2: 'SÓ BOSCH' }, 'as duas alterações de produto ficaram');
  assert.equal(sb.docs.get('sistema/config').loja, 'LOJA A');
  assert.equal(sb.docs.get('sistema/config').backupDias, 3);
  assert.match(await B.page.locator('#toast').innerText(), /as alterações de todos são juntadas, nada se perde/);
  // B já tem a alteração de A; A recebe a de B ao voltar para a aba
  assert.equal(await B.page.evaluate(i => db.produtos.find(p => p.id === i).marca, id1), 'SÓ MONROE');
  await A.page.evaluate(() => puxarNuvem());
  await A.page.waitForFunction(i => db.produtos.find(p => p.id === i).marca === 'SÓ BOSCH', id2);
  assert.equal(await A.page.evaluate(() => db.config.backupDias), 3);

  // excluir num computador: o outro fica sabendo
  await mudar(A.page, 'db.produtos = db.produtos.filter(p => p.id !== a);', id1);
  await B.page.evaluate(() => puxarNuvem());
  await B.page.waitForFunction(() => db.produtos.length === 1);
  assert.deepEqual(A.erros, []);
  assert.deepEqual(B.erros, []);
  await A.context.close();
  await B.context.close();
});

test('aba fechada antes de enviar: a alteração vai para a nuvem na próxima abertura, junto com o que mudou lá', async () => {
  const sb = supabaseFalso({ docs: new Map([['sistema/config', { loja: 'DISPPAR' }]]) });
  const A = await computador(sb);
  await mudar(A.page, 'db.produtos.push(...a)', [prod('q1', 'Q1', 'SÓ COFAP')]);
  // altera e "fecha" antes de enviar: grava só no navegador
  await A.page.evaluate(() => {
    db.produtos[0].marca = 'SÓ SACHS';
    db.config.duvidasCabecalho = 'Itens em dúvida:';
    salvar();
    clearTimeout(nuvem.timer); nuvem.timer = null; // não deu tempo de enviar
    gravarLocal();
  });
  assert.ok(await A.page.evaluate(() => localStorage.getItem('sistemaCotacao.pendentes')), 'anotou o que falta enviar');
  // enquanto isso, outro computador mudou a loja
  sb.docs.set('sistema/config', { ...sb.docs.get('sistema/config'), loja: 'OUTRA' });
  sb.vers.set('sistema/config', '2026-12-31T00:00:00.000001+00:00');
  await A.page.reload();
  await esperarSalvo(A.page);
  await A.page.waitForFunction(() => !localStorage.getItem('sistemaCotacao.pendentes'));
  assert.equal(produtosNaNuvem(sb)[0].marca, 'SÓ SACHS', 'a alteração não se perdeu');
  assert.equal(sb.docs.get('sistema/config').duvidasCabecalho, 'Itens em dúvida:');
  assert.equal(sb.docs.get('sistema/config').loja, 'OUTRA', 'e a do outro computador também ficou');
  assert.deepEqual(A.erros, []);
  await A.context.close();
});

test('lotes antigos viram baldes: nenhum produto se perde nem se repete', async () => {
  const antigos = Array.from({ length: 450 }, (_, k) => prod('old-' + String(k).padStart(4, '0'), 'C' + k, 'QUALQUER'));
  const sb = supabaseFalso({ docs: new Map([
    ['sistema/config', { loja: 'DISPPAR' }],
    ['produtos/lote-00', { itens: antigos.slice(0, 200) }], ['produtos/lote-01', { itens: antigos.slice(200, 400) }], ['produtos/lote-02', { itens: antigos.slice(400) }],
  ]) });
  const A = await computador(sb);
  assert.equal(await A.page.evaluate(() => db.produtos.length), 450);
  await mudar(A.page, "db.produtos[0].marca = 'SÓ COFAP';");
  const chaves = [...sb.docs.keys()].filter(k => k.startsWith('produtos/'));
  assert.ok(chaves.every(k => /\/b-\d\d$/.test(k)), 'só baldes');
  const naNuvem = produtosNaNuvem(sb);
  assert.equal(naNuvem.length, 450);
  assert.equal(new Set(naNuvem.map(p => p.id)).size, 450);
  // depois disso, mudar um produto regrava só o balde dele
  const antes = sb.log.length;
  await mudar(A.page, "db.produtos[5].marca = 'SÓ NGK';");
  assert.deepEqual(sb.log.slice(antes).filter(l => l.startsWith('SET')).length, 1);
  assert.deepEqual(A.erros, []);
  await A.context.close();
});
