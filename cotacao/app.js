'use strict';

/* ============================================================
 * Sistema de Cotação — cadastro de produtos, fornecedores e
 * cotações. Tudo fica salvo no navegador (localStorage).
 * ============================================================ */

const STORAGE_KEY = 'sistemaCotacao.v1';

const DEFAULT_DB = {
  config: {
    loja: '',
    cnpj: '',
    endereco: '',
    telefone: '',
    email: '',
    comprador: '',
    proxNumero: 1,
    protegerPlanilha: true,
    assuntoEmail: 'Solicitação de cotação nº {numero} - {loja}',
    corpoEmail:
      'Olá, {fornecedor}!\n\n' +
      'Segue em anexo a planilha da cotação nº {numero}.\n' +
      'Por favor, preencha as colunas VALOR (preço unitário) e MARCA e nos devolva a planilha por e-mail até {prazo}.\n\n' +
      'Obrigado,\n{comprador}\n{loja}\n{telefone}',
    diasAviso: 1,
    tituloPlanilha: 'COTAÇÃO GERAL DISPPAR',
    duvidasCabecalho: 'Segue a relação dos itens em dúvida para avaliação:',
    backupDias: 7, // lembrar do backup a cada N dias (0 = não lembrar)
    arquivarDias: 60, // sugerir arquivar finalizadas com mais de N dias
    assuntoPedido: 'Pedido de compra - cotação nº {numero} - {loja}',
    corpoPedido:
      'Olá, {fornecedor}!\n\n' +
      'Segue em anexo o nosso pedido de compra da cotação nº {numero}: {itensPedido} item(ns), total de {totalPedido}.\n\n' +
      '{entrega}\n\n' +
      'Por favor, confirme o recebimento do pedido e o prazo de entrega.\n\n' +
      'Obrigado,\n{comprador}\n{loja}\n{telefone}',
    marcaErradaNaoGanha: true,
    marcasEquivalentes: {}, // marca pedida (normalizada) → abreviações aceitas
    marcasDiferentes: {}, // marca pedida (normalizada) → respostas que NÃO são a mesma marca
    lojas: [
      { id: 'paranoa', nome: 'Paranoá', sigla: 'DPR', cnpj: '', endereco: '' },
      { id: 'sao-sebastiao', nome: 'São Sebastião', sigla: 'DSS', cnpj: '', endereco: '' },
    ],
    assuntoCobranca: 'Lembrete: cotação nº {numero} - {loja}',
    corpoCobranca:
      'Olá, {fornecedor}!\n\n' +
      'Ainda não recebemos a sua resposta da cotação nº {numero}, com prazo até {prazo}.\n' +
      'Consegue nos devolver a planilha preenchida? Se precisar, reenviamos o arquivo.\n\n' +
      'Obrigado,\n{comprador}\n{loja}\n{telefone}',
  },
  produtos: [],
  fornecedores: [],
  cotacoes: [],
  rascunho: null,
  duvidas: [],
};

const COND_CAMPOS = [
  ['pagamento', 'Condição de pagamento'],
  ['prazo', 'Prazo de entrega'],
  ['frete', 'Frete (CIF/FOB)'],
  ['validade', 'Validade da proposta'],
  ['vendedor', 'Vendedor / contato'],
];

const STATUS = {
  aberta: ['Aberta', 'blue'],
  finalizada: ['Finalizada', 'ok'],
  cancelada: ['Cancelada', 'danger'],
};

let db = carregar();
let versaoDados = 0; // muda a cada gravação (invalida caches)
let cacheHist = null;
const ui = { digitando: null, enviando: null, datacar: null, cursorItem: 0, enterPadrao: null, filtroItens: '', editProd: null, editForn: null, filtroProd: '', filtroForn: '', filtroCot: '', statusCot: '', histProd: null, soComPreco: false, periodoRel: '', sel: null, lote: null, verArquivadas: false, conferindo: null };

/* ---------------- persistência ---------------- */

function carregar() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizar(JSON.parse(raw));
  } catch (e) {
    console.error(e);
    // não abre vazio por cima dos dados: guarda a cópia que não deu para ler e avisa
    try { if (raw) localStorage.setItem(STORAGE_KEY + '.nao-lida', raw); } catch (e2) { /* sem espaço */ }
    setTimeout(() => avisar('Não consegui ler os dados guardados neste navegador. Uma cópia foi guardada à parte (nada foi apagado). Se estiver usando o Supabase, os dados vêm de lá normalmente; senão, restaure um backup em Configurações.'), 0);
  }
  return structuredClone(DEFAULT_DB);
}

/** Ordem das lojas: Paranoá primeiro. Só inverte a ordem antiga (São Sebastião, Paranoá); ordem personalizada fica. */
function ordenarLojas(config) {
  const l = config.lojas;
  if (Array.isArray(l) && l.map(x => x && x.id).join() === 'sao-sebastiao,paranoa') config.lojas = [l[1], l[0]];
  return config;
}

/*
 * Kaizen informa a marca junto com o estoque: "NGK/685" = marca NGK, 685 no estoque.
 * Só para a Kaizen: a marca fica "NGK" (conferida normalmente) e o estoque vira limite de quantidade.
 */
function ehKaizen(f) {
  return /\bkaizen\b/.test(semAcento(f?.nome));
}
function separarEstoque(marca) {
  const m = /^(.*\S)\s*\/\s*(\d+)\s*$/.exec(String(marca || ''));
  return m ? { marca: m[1].trim(), estoque: Number(m[2]) } : null;
}

/** Comando: ganha o item quando o preço dela está até 5% acima do 1º lugar (só para a Comando). */
const PREFERENCIA = { teste: f => /\bcomando\b/.test(semAcento(f?.nome)), ate: 0.05 };

/** Rio Juntas: item com a marca "GO" demora mais para chegar (só para a Rio Juntas). */
function entregaDemorada(f, o) {
  return !!o && /\brio\s*juntas\b/.test(semAcento(f?.nome)) && normMarca(o.marca).split(' ').includes('GO');
}
const chipDemora = '<span class="chip-demora" title="Rio Juntas: os itens com marca GO demoram mais para chegar. Considere o prazo antes de fechar o pedido.">🐢 GO · demora para chegar</span>';

/** Separa marca e estoque nas respostas da Kaizen (e mantém as marcas já recusadas). */
function ajustarKaizen(c) {
  let mudou = false;
  for (const f of c.fornecedores || []) {
    if (!ehKaizen(f)) continue;
    for (const [i, o] of Object.entries(f.respostas || {})) {
      if (!o || o.estoque != null) continue;
      const sep = separarEstoque(o.marca);
      if (!sep) continue;
      const rec = c.recusadas?.[i];
      if (rec && rec[f.fornecedorId] === normMarca(o.marca)) rec[f.fornecedorId] = normMarca(sep.marca);
      f.respostas[i] = { ...o, marca: sep.marca, estoque: sep.estoque, marcaOriginal: o.marcaOriginal || o.marca };
      mudou = true;
    }
  }
  return mudou;
}

function normalizar(d) {
  const base = structuredClone(DEFAULT_DB);
  return {
    ...base,
    ...d,
    config: ordenarLojas({ ...base.config, ...(d.config || {}) }),
    produtos: d.produtos || [],
    fornecedores: d.fornecedores || [],
    cotacoes: (d.cotacoes || []).map(c => { ajustarKaizen(c); return c; }),
    duvidas: Array.isArray(d.duvidas) ? d.duvidas : [],
  };
}

let timerLocal = null;
let cacheLocalOk = true; // a cópia no navegador está em dia? (falha quando passa do limite de espaço)

function gravarLocal() {
  clearTimeout(timerLocal);
  timerLocal = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    cacheLocalOk = true;
  } catch (e) {
    cacheLocalOk = false;
    // sem a cópia local em dia, a lista do que falta enviar apontaria para dados velhos: descarta
    try { localStorage.removeItem(CHAVE_PENDENTES); } catch (e2) { /* sem acesso */ }
    if (!nuvem.db) avisar('Não foi possível salvar os dados no navegador. Faça um backup em Configurações.\n\n' + e.message);
    return;
  }
  anotarPendentes();
}

/** Salva sem travar a digitação: grava depois de uma pequena pausa. */
function salvar() {
  cacheBusca = null;
  versaoDados++;
  clearTimeout(timerLocal);
  timerLocal = setTimeout(gravarLocal, 400);
  agendarSincronia();
}

window.addEventListener('pagehide', () => { if (timerLocal) gravarLocal(); if (nuvem.timer) sincronizar(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (timerLocal) gravarLocal();
    if (nuvem.timer) sincronizar(); // saiu da aba: envia agora, sem esperar
  } else puxarNuvem(); // voltou: traz o que mudou em outro computador
});

try {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
} catch (e) { /* sem suporte */ }

/* ---------------- nuvem (quando aberto como página do Claude) ----------------
 * Os dados ficam em documentos: produtos e fornecedores em lotes,
 * uma cotação por documento e as configurações em "sistema/*". */

const nuvem = { db: null, downloads: null, supabase: null, usuario: null, enviado: {}, versao: {}, timer: null, gravando: false, pendente: false, status: 'local' };

/*
 * Produtos e fornecedores ficam em "baldes" fixos: cada item cai sempre no mesmo balde (pelo id).
 * Assim, incluir ou excluir um produto regrava só o balde dele (e não todos os lotes seguintes),
 * e duas pessoas mexendo em produtos diferentes quase nunca gravam o mesmo documento.
 */
const BALDES = { produtos: 64, fornecedores: 4 };
function baldeDe(col, id) {
  let h = 2166136261; // FNV-1a
  for (let k = 0; k < id.length; k++) { h ^= id.charCodeAt(k); h = Math.imul(h, 16777619); }
  return `${col}/b-${pad((h >>> 0) % BALDES[col])}`;
}

/** Documentos que representam um estado (objetos, ainda não convertidos em texto). */
function docsDe(estado) {
  const docs = {
    'sistema/config': estado.config,
    'sistema/extra': { rascunho: estado.rascunho || null, ultimoBackup: estado.ultimoBackup || null, backupAdiadoAte: estado.backupAdiadoAte || null, duvidas: estado.duvidas || [] },
  };
  for (const col of ['produtos', 'fornecedores']) {
    const baldes = {};
    for (const x of estado[col]) (baldes[baldeDe(col, x.id)] ||= []).push(x);
    for (const [caminho, itens] of Object.entries(baldes)) docs[caminho] = { itens: itens.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
  }
  for (const c of estado.cotacoes) docs[`cotacoes/${c.id}`] = c;
  return docs;
}

function docsDoEstado() {
  return Object.fromEntries(Object.entries(docsDe(db)).map(([k, v]) => [k, JSON.stringify(v)]));
}

/* ---------- juntar alterações feitas em dois lugares (este navegador e outro computador) ---------- */

/** Texto estável de um valor (chaves em ordem), para comparar sem depender da ordem das chaves. */
function chaveEstavel(v) {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(chaveEstavel).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + chaveEstavel(v[k])).join(',') + '}';
}

/** Junta listas de itens {id}: o que este navegador mudou vale; o resto vem do outro lado. */
function mesclarItens(base = [], local = [], remoto = []) {
  const B = new Map(base.map(x => [x.id, chaveEstavel(x)]));
  const L = new Map(local.map(x => [x.id, x]));
  const R = new Map(remoto.map(x => [x.id, x]));
  const saida = [];
  for (const id of new Set([...B.keys(), ...L.keys(), ...R.keys()])) {
    const l = L.get(id), r = R.get(id);
    const mudouAqui = (l === undefined ? undefined : chaveEstavel(l)) !== B.get(id);
    if (mudouAqui) { if (l !== undefined) saida.push(l); } // alterado ou excluído aqui
    else if (r !== undefined) saida.push(r); // sem mudança aqui: vale o outro lado (inclusive exclusão)
  }
  return saida;
}

/**
 * Junta objetos campo a campo, descendo nos campos que os dois lados mudaram (ex.: as quantidades de
 * itens diferentes digitadas por duas pessoas ao mesmo tempo). Onde os dois mudaram a mesma coisa, vale este navegador.
 */
function mesclarObjeto(base = {}, local = {}, remoto = {}) {
  const saida = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remoto)])) {
    const v = mesclarValor(base[k], local[k], remoto[k]);
    if (v !== undefined) saida[k] = v;
  }
  return saida;
}

const ehObjeto = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Junta um valor qualquer (3 versões: base comum, este navegador e o outro lado). */
function mesclarValor(base, local, remoto) {
  const kb = chaveEstavel(base), kl = chaveEstavel(local), kr = chaveEstavel(remoto);
  if (kl === kb) return remoto; // não mudou aqui: vale o outro lado
  if (kr === kb || kr === kl) return local; // só mudou aqui (ou os dois igual)
  if (ehObjeto(local) && ehObjeto(remoto)) return mesclarObjeto(ehObjeto(base) ? base : {}, local, remoto);
  if (Array.isArray(local) && Array.isArray(remoto)) {
    // listas de registros com identificação (dúvidas, fornecedores da cotação…): junta registro a registro
    const todos = [...local, ...remoto];
    const chave = ['id', 'fornecedorId'].find(k => todos.every(x => ehObjeto(x) && x[k] != null));
    if (chave) return mesclarLista(Array.isArray(base) ? base : [], local, remoto, chave);
  }
  return local;
}

function mesclarLista(base, local, remoto, chave) {
  const mapa = l => new Map(l.filter(ehObjeto).map(x => [x[chave], x]));
  const B = mapa(base), L = mapa(local), R = mapa(remoto);
  // ordem deste navegador; o que só existe do outro lado entra no fim
  const ids = [...new Set([...local.map(x => x[chave]), ...remoto.map(x => x[chave]).filter(id => !L.has(id))])];
  const saida = [];
  for (const id of ids) {
    const v = mesclarValor(B.get(id), L.get(id), R.get(id));
    if (v !== undefined) saida.push(v);
  }
  return saida;
}

/** Junta um documento (undefined = não existe). */
function mesclarDoc(caminho, base, local, remoto) {
  const col = caminho.split('/')[0];
  if (col === 'produtos' || col === 'fornecedores') {
    const itens = mesclarItens(base?.itens, local?.itens, remoto?.itens);
    return itens.length ? { itens } : undefined;
  }
  const mudouAqui = chaveEstavel(local) !== chaveEstavel(base);
  const mudouLa = chaveEstavel(remoto) !== chaveEstavel(base);
  if (!mudouAqui) return remoto;
  if (!mudouLa) return local;
  // os dois mudaram: excluído de um lado e alterado do outro fica o alterado (não perde nada)
  if (local === undefined) return remoto;
  if (remoto === undefined) return local;
  return mesclarObjeto(base, local, remoto);
}

/** Põe no estado atual (db) o valor juntado de um documento. */
function aplicarDoc(caminho, valor, antes = []) {
  const [col, id] = caminho.split(/\/(.*)/s);
  if (col === 'produtos' || col === 'fornecedores') {
    // tira os itens que este documento tinha (em qualquer versão) e põe os juntados
    const ids = new Set([...antes.flatMap(d => (d?.itens || []).map(x => x.id)), ...(valor?.itens || []).map(x => x.id)]);
    db[col] = db[col].filter(x => !ids.has(x.id)).concat(structuredClone(valor?.itens || []));
  } else if (col === 'cotacoes') {
    const i = db.cotacoes.findIndex(c => c.id === id);
    const cot = valor === undefined ? undefined : structuredClone(valor);
    if (cot) ajustarKaizen(cot);
    if (cot === undefined) { if (i >= 0) db.cotacoes.splice(i, 1); } else if (i >= 0) db.cotacoes[i] = cot;
    else db.cotacoes.push(cot);
  } else if (caminho === 'sistema/config') {
    db.config = ordenarLojas({ ...structuredClone(DEFAULT_DB.config), ...structuredClone(valor || {}) });
  } else if (caminho === 'sistema/extra') {
    const v = structuredClone(valor || {});
    Object.assign(db, { rascunho: v.rascunho || null, ultimoBackup: v.ultimoBackup || null, backupAdiadoAte: v.backupAdiadoAte || null, duvidas: v.duvidas || [] });
  }
}

/** Busca a versão do Supabase de um documento e junta com o que este navegador tem. */
async function juntarComRemoto(caminho, remotoLido) {
  const rem = remotoLido || await nuvem.db.doc(caminho).get();
  const base = nuvem.enviado[caminho] != null ? JSON.parse(nuvem.enviado[caminho]) : undefined;
  const localJson = docsDoEstado()[caminho];
  const local = localJson != null ? JSON.parse(localJson) : undefined;
  const remoto = rem.existe ? rem.dados : undefined;
  aplicarDoc(caminho, mesclarDoc(caminho, base, local, remoto), [base, local, remoto]);
  if (rem.existe) { nuvem.enviado[caminho] = JSON.stringify(rem.dados); nuvem.versao[caminho] = rem.versao; }
  else { delete nuvem.enviado[caminho]; delete nuvem.versao[caminho]; }
  cacheBusca = null;
  versaoDados++;
}

/* ---------- o que ainda não foi para a nuvem (sobrevive a fechar a aba) ---------- */

const CHAVE_PENDENTES = 'sistemaCotacao.pendentes';

/** Guarda, para cada documento alterado e ainda não enviado, a versão da nuvem em que ele se baseou. */
function anotarPendentes() {
  if (!nuvem.db) return;
  try {
    if (!cacheLocalOk) { localStorage.removeItem(CHAVE_PENDENTES); return; }
    const atual = docsDoEstado();
    const pend = JSON.parse(localStorage.getItem(CHAVE_PENDENTES) || '{}');
    for (const caminho of new Set([...Object.keys(atual), ...Object.keys(nuvem.enviado)])) {
      if (atual[caminho] === nuvem.enviado[caminho]) delete pend[caminho];
      else if (!(caminho in pend)) pend[caminho] = nuvem.enviado[caminho] ?? null;
    }
    if (Object.keys(pend).length) localStorage.setItem(CHAVE_PENDENTES, JSON.stringify(pend));
    else localStorage.removeItem(CHAVE_PENDENTES);
  } catch (e) { /* cópia local é opcional */ }
}

function lerPendentes() {
  try { return JSON.parse(localStorage.getItem(CHAVE_PENDENTES) || 'null'); } catch (e) { return null; }
}

function agendarSincronia() {
  if (!nuvem.db) return;
  clearTimeout(nuvem.timer);
  nuvem.timer = setTimeout(sincronizar, 1200);
}

async function sincronizar() {
  if (!nuvem.db) return;
  clearTimeout(nuvem.timer);
  nuvem.timer = null;
  if (nuvem.gravando) { nuvem.pendente = true; return; }
  nuvem.gravando = true;
  mostrarStatus('salvando');
  let juntou = false;
  const juntados = [];
  try {
    for (let rodada = 0; ; rodada++) {
      const atual = docsDoEstado();
      const conflitos = [];
      for (const [caminho, json] of Object.entries(atual)) {
        if (nuvem.enviado[caminho] === json) continue;
        const r = await comRetentativa(() => gravarDoc(caminho, JSON.parse(json)));
        if (r.ok) { nuvem.enviado[caminho] = json; if (r.versao) nuvem.versao[caminho] = r.versao; } else conflitos.push(caminho);
      }
      for (const caminho of Object.keys(nuvem.enviado)) {
        if (caminho in atual) continue;
        const r = await comRetentativa(() => apagarDoc(caminho));
        if (r.ok) { delete nuvem.enviado[caminho]; delete nuvem.versao[caminho]; } else conflitos.push(caminho);
      }
      if (!conflitos.length) break;
      // alguém gravou antes (outro computador ou aba): junta as duas versões e grava de novo
      if (rodada >= 4) throw new Error('Os dados estão sendo alterados em outro lugar ao mesmo tempo. Tente de novo.');
      for (const caminho of conflitos) await juntarComRemoto(caminho);
      juntados.push(...conflitos);
      juntou = true;
    }
    anotarPendentes();
    mostrarStatus('salvo');
    if (nuvem.puxarDepois && !nuvem.timer) setTimeout(puxarNuvem, 0);
    if (juntou) {
      renderSeguro(juntados);
      // com várias pessoas ao mesmo tempo isso é normal: avisa só na primeira vez
      if (!nuvem.avisouJuncao) toast('Outras pessoas estão mexendo ao mesmo tempo: as alterações de todos são juntadas, nada se perde.', 6000);
      nuvem.avisouJuncao = true;
    }
  } catch (e) {
    console.error(e);
    mostrarStatus('erro');
    toast(e.code === 'quota_exceeded'
      ? 'O limite de armazenamento na nuvem foi atingido. Exclua cotações antigas.'
      : 'Não foi possível salvar na nuvem agora. Vou tentar de novo na próxima alteração.', 6000);
  } finally {
    nuvem.gravando = false;
    if (nuvem.pendente) { nuvem.pendente = false; agendarSincronia(); }
  }
}

/** Grava um documento só se ninguém o alterou desde a versão que temos ({ ok:false } = conflito). */
async function gravarDoc(caminho, dados) {
  const d = nuvem.db.doc(caminho);
  if (!d.gravar) { await d.set(dados); return { ok: true }; }
  return d.gravar(dados, nuvem.versao[caminho]);
}

async function apagarDoc(caminho) {
  const d = nuvem.db.doc(caminho);
  if (!d.apagar) { await d.delete(); return { ok: true }; }
  return d.apagar(nuvem.versao[caminho]);
}

/**
 * Traz as alterações feitas em outro computador (ao voltar para a aba e a cada minuto).
 * Não mexe na tela enquanto a pessoa está digitando: tenta de novo depois.
 */
async function puxarNuvem() {
  if (!nuvem.db?.versoes || document.hidden) return;
  // salvando agora: puxa logo depois (o aviso em tempo real não se perde)
  if (nuvem.gravando || nuvem.timer) { nuvem.puxarDepois = true; return; }
  nuvem.puxarDepois = false;
  try {
    const remotas = await nuvem.db.versoes();
    const mudaram = Object.keys(remotas).filter(c => remotas[c] !== nuvem.versao[c]);
    const sumiram = Object.keys(nuvem.versao).filter(c => !(c in remotas));
    if (!mudaram.length && !sumiram.length) return;
    if (nuvem.gravando || nuvem.timer) return; // começou a salvar: o salvamento junta
    const lidos = mudaram.length ? await nuvem.db.buscar(mudaram) : {};
    for (const c of mudaram) await juntarComRemoto(c, lidos[c] || { existe: false });
    for (const c of sumiram) await juntarComRemoto(c, { existe: false });
    renderSeguro([...mudaram, ...sumiram]);
    if (docsMudaramAqui()) agendarSincronia();
  } catch (e) {
    console.error(e);
  }
}

const docsMudaramAqui = () => { const a = docsDoEstado(); return Object.keys(a).some(c => a[c] !== nuvem.enviado[c]) || Object.keys(nuvem.enviado).some(c => !(c in a)); };

/* Várias pessoas ao mesmo tempo: o que outro computador salva chega aqui sem atrapalhar quem está digitando. */
let ultimaTecla = 0;
function marcarTecla() { ultimaTecla = Date.now(); }
document.addEventListener('keydown', marcarTecla, true);
document.addEventListener('input', marcarTecla, true);
const PAUSA_DIGITACAO = 2500; // ms sem digitar para redesenhar a tela inteira

/** A alteração que chegou (caminhos dos documentos) muda o que está na tela? */
function afetaTela(caminhos) {
  const { nome, id } = rota();
  if (nome !== 'cotacao') return true;
  const abertas = new Set([id, pip.win && !pip.win.closed ? pip.cotId : null]);
  // no comparativo: só a cotação aberta (e a da janela flutuante), as configurações e os fornecedores
  return caminhos.some(k => (k.startsWith('cotacoes/') ? abertas.has(k.slice('cotacoes/'.length)) : !k.startsWith('produtos/')));
}

/** Enquanto a pessoa digita quantidades: só os números dos outros campos e os totais (sem redesenhar tudo). */
function atualizarQtdsTela() {
  const alvos = [[document, cotAtual()]];
  if (pip.win && !pip.win.closed) alvos.push([pip.win.document, db.cotacoes.find(x => x.id === pip.cotId)]);
  for (const [d, c] of alvos) {
    if (!c) continue;
    for (const el of d.querySelectorAll('input[data-qtd-loja]')) {
      if (el === d.activeElement) continue; // o campo em que a pessoa está digitando fica como está
      const v = c.qtds?.[+el.dataset.i]?.[el.dataset.qtdLoja];
      const txt = v == null ? '' : String(v);
      if (el.value === txt) continue;
      el.value = txt;
      el.classList.toggle('preenchida', v > 0);
      el.classList.toggle('zerada', v === 0);
    }
  }
  const c = cotAtual();
  if (c && document.getElementById('totalComp')) atualizarTotaisComp(c);
}

/**
 * Redesenha sem atrapalhar quem está digitando. `caminhos`: documentos que mudaram em outro computador
 * (o que não aparece na tela aberta não redesenha nada).
 */
/** A cotação sem as quantidades das lojas: se só as quantidades mudaram, não precisa redesenhar a tabela. */
function assinaturaSemQtd(c) {
  // tudo o que aparece na tela da cotação, menos as quantidades
  const duvidas = db.duvidas.filter(d => d.origem?.cotId === c.id);
  return JSON.stringify([c, db.config, db.fornecedores, duvidas], (k, v) => (k === 'qtds' ? undefined : v));
}

// lista de cotações: clicar em qualquer lugar da linha abre a cotação
document.addEventListener('click', e => {
  const tr = e.target.closest?.('tr[data-abrir-cot]');
  if (!tr || e.target.closest('a, button, input, label, select')) return;
  ir('cotacao', tr.dataset.abrirCot);
});

// "↑" para voltar ao topo nas páginas longas
{
  let quadroTopo = 0;
  window.addEventListener('scroll', () => {
    if (quadroTopo) return;
    quadroTopo = requestAnimationFrame(() => {
      quadroTopo = 0;
      const b = document.getElementById('voltarTopo');
      if (b) b.hidden = window.scrollY < 900;
    });
  }, { passive: true });
  document.addEventListener('click', e => {
    if (e.target.closest?.('#voltarTopo')) window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// menu "⋯": abre por cima da página, junto do botão (a tabela tem rolagem própria e cortaria a lista)
document.addEventListener('toggle', e => {
  const m = e.target;
  if (!m.matches?.('details.menu-acoes') || !m.open) return;
  const lista = m.querySelector('.menu-acoes-lista');
  const r = m.querySelector('summary').getBoundingClientRect();
  lista.style.position = 'fixed';
  lista.style.top = `${r.bottom + 4}px`;
  lista.style.right = `${Math.max(8, document.documentElement.clientWidth - r.right)}px`;
  const lr = lista.getBoundingClientRect();
  if (lr.bottom > window.innerHeight - 8) lista.style.top = `${Math.max(8, r.top - lr.height - 4)}px`; // sem espaço embaixo: abre para cima
}, true);
// rolou a página: o menu aberto fecha (senão ficaria solto no lugar)
window.addEventListener('scroll', () => document.querySelectorAll('details.menu-acoes[open]').forEach(m => { m.open = false; }), { passive: true, capture: true });

// menu "⋯" das ações: fecha ao clicar fora ou depois de escolher
document.addEventListener('click', e => {
  for (const m of document.querySelectorAll('details.menu-acoes[open]')) {
    if (!m.contains(e.target) || e.target.closest('.menu-acoes-lista button')) m.open = false;
  }
}, true);

// arrastar o arquivo do DataCar ou dos papelzinhos para a caixa dele
document.addEventListener('dragover', e => {
  const alvo = e.target.closest?.('[data-soltar]');
  if (!alvo || !e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  alvo.classList.add('soltando');
});
document.addEventListener('dragleave', e => {
  const alvo = e.target.closest?.('[data-soltar]');
  if (alvo && !alvo.contains(e.relatedTarget)) alvo.classList.remove('soltando');
});
document.addEventListener('drop', async e => {
  const alvo = e.target.closest?.('[data-soltar]');
  if (!alvo) return;
  e.preventDefault();
  alvo.classList.remove('soltando');
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (alvo.dataset.soltar === 'papel') await abrirArquivoPapel(file);
  else await abrirArquivoDataCar(file);
});

let ponteiroApertado = false;
/** Roda fn depois que o mouse for solto (redesenhar no meio de um clique faz o clique se perder). */
function quandoSoltar(fn) {
  if (!ponteiroApertado && Date.now() - ultimoClique > 250) { setTimeout(fn, 0); return; }
  setTimeout(() => quandoSoltar(fn), 120);
}
let ultimoClique = 0;
document.addEventListener('pointerdown', () => { ponteiroApertado = true; ultimoClique = Date.now(); }, true);
document.addEventListener('pointerup', () => { ponteiroApertado = false; ultimoClique = Date.now(); }, true);
document.addEventListener('pointercancel', () => { ponteiroApertado = false; }, true);

/** Algo aberto ou em uso na tela que um redesenho fecharia. */
function ocupadoNaTela() {
  const ativo = document.activeElement;
  return ponteiroApertado || Date.now() - ultimoClique < 700
    || (ativo?.tagName === 'SELECT' && !!$('#app')?.contains(ativo)) // lista suspensa (pode estar aberta)
    || !!document.querySelector('.dlg-fundo, #dlgDataCar'); // janela de confirmação, conferência do DataCar…
}

function renderSeguro(caminhos = null) {
  if (caminhos && !afetaTela(caminhos)) return;
  // um colega digitou quantidades na cotação aberta: atualiza só os números e os totais (a tabela fica)
  const t = ui.telaCot;
  if (caminhos && t && rota().nome === 'cotacao' && rota().id === t.cotId) {
    const c = db.cotacoes.find(x => x.id === t.cotId);
    if (c && assinaturaSemQtd(c) === t.sig && document.getElementById('totalComp')) {
      atualizarQtdsTela();
      if (pip.win && !pip.win.closed && pip.cotId === c.id) desenharPip(false);
      return;
    }
  }
  // digitando preços sem salvar: espera (os valores ficam no rascunho, mas o cursor e a rolagem não pulam)
  if (ui.digitando?.rasc && Object.keys(ui.digitando.rasc).length && document.querySelector('#painelDigitar')) {
    clearTimeout(ui.timerRenderAdiado);
    ui.timerRenderAdiado = setTimeout(() => renderSeguro(), 2000);
    return;
  }
  // editando as configurações sem salvar: não redesenha (apagaria o que foi digitado)
  if (ui.cfgSujo && rota().nome === 'config' && document.querySelector('.form-cfg')) return;
  // a pessoa está clicando, com uma lista suspensa aberta ou com uma janela aberta: redesenha depois
  // (senão o que ela acabou de abrir pisca e fecha sozinho)
  if (ocupadoNaTela()) {
    clearTimeout(ui.timerRenderAdiado);
    ui.timerRenderAdiado = setTimeout(() => renderSeguro(), 900);
    return;
  }
  // janela de escolher arquivo aberta: redesenha depois (senão a escolha do arquivo se perde)
  if (ui.escolhendoArquivo && Date.now() - ui.escolhendoArquivo < 120000) {
    clearTimeout(ui.timerRenderAdiado);
    ui.timerRenderAdiado = setTimeout(() => renderSeguro(), 1500);
    return;
  }
  const ativo = document.activeElement;
  const noPip = pip.win && !pip.win.closed ? pip.win.document.activeElement : null;
  const emQtd = ativo?.dataset?.qtdLoja != null || noPip?.dataset?.qtdLoja != null;
  if (!emQtd && Date.now() - ultimaTecla < PAUSA_DIGITACAO && $('#app')?.contains(ativo)) {
    // digitando ou andando pela lista com as setas: redesenha quando der uma pausa
    clearTimeout(ui.timerRenderAdiado);
    ui.timerRenderAdiado = setTimeout(() => renderSeguro(), PAUSA_DIGITACAO);
    return;
  }
  if (emQtd && Date.now() - ultimaTecla < PAUSA_DIGITACAO) {
    // digitando quantidades: atualiza só os números agora; a tela inteira quando der uma pausa
    atualizarQtdsTela();
    clearTimeout(ui.timerRenderAdiado);
    ui.timerRenderAdiado = setTimeout(() => renderSeguro(), PAUSA_DIGITACAO);
    return;
  }
  clearTimeout(ui.timerRenderAdiado);
  if (emQtd) {
    // quantidades já estão gravadas: redesenhar mantém o cursor no mesmo campo
    if (!document.querySelector('.dlg-fundo') && !pip.win?.document?.querySelector?.('.dlg-fundo')) render();
    else ui.timerRenderAdiado = setTimeout(() => renderSeguro(), PAUSA_DIGITACAO);
    return;
  }
  if (ativo && ativo.matches?.('input, textarea, select') && !ativo.closest('#telaLogin') && $('#app')?.contains(ativo)) {
    ativo.addEventListener('blur', () => quandoSoltar(() => (document.hasFocus() ? render() : renderSeguro())), { once: true });
  } else if (!document.querySelector('.dlg-fundo')) render();
}

setInterval(puxarNuvem, 60000);

/* ---------------- versão nova do sistema ----------------
 * Uma aba aberta antes de publicar continua com o sistema antigo. Confere de tempos em tempos
 * (e ao voltar para a aba) se o app.js mudou e mostra uma faixa para atualizar. */
const versaoSistema = { atual: null, avisado: false };
async function assinaturaApp() {
  if (location.protocol === 'file:') return null;
  try {
    const r = await fetch('app.js', { method: 'HEAD', cache: 'no-store' });
    return r.ok ? r.headers.get('etag') || r.headers.get('last-modified') : null;
  } catch (e) {
    return null; // sem internet: tenta depois
  }
}
async function verificarVersaoNova() {
  if (versaoSistema.avisado) return;
  const a = await assinaturaApp();
  if (!a) return;
  if (!versaoSistema.atual) { versaoSistema.atual = a; return; }
  if (a !== versaoSistema.atual) mostrarVersaoNova();
}
function mostrarVersaoNova() {
  versaoSistema.avisado = true;
  if (document.getElementById('faixaVersao')) return;
  const faixa = document.createElement('div');
  faixa.id = 'faixaVersao';
  faixa.setAttribute('role', 'status');
  faixa.innerHTML = '🔄 Saiu uma versão nova do sistema. <button type="button" class="sm primary" data-act="atualizarSistema">Atualizar agora</button>';
  document.body.appendChild(faixa);
}
async function atualizarSistema() {
  // antes de recarregar, termina de salvar o que estiver pendente
  try { if (timerLocal) gravarLocal(); if (nuvem.timer || nuvem.gravando) await sincronizar(); } catch (e) { console.error(e); }
  location.reload();
}
verificarVersaoNova();
setInterval(verificarVersaoNova, 5 * 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) verificarVersaoNova(); });
window.addEventListener('focus', () => puxarNuvem());

async function comRetentativa(fn) {
  for (let tent = 0; ; tent++) {
    try {
      return await fn();
    } catch (e) {
      if (tent < 4 && (e.code === 'unavailable' || e.code === 'resource_exhausted')) {
        await new Promise(r => setTimeout(r, 800 * 2 ** tent + Math.random() * 300));
        continue;
      }
      throw e;
    }
  }
}

async function carregarNuvem() {
  const ler = async col => (await nuvem.db.collection(col).limit(1000).get()).docs.filter(d => d.exists).map(d => [`${col}/${d.id}`, d.data(), d.versao]);
  const [sis, prods, forns, cots] = await Promise.all(['sistema', 'produtos', 'fornecedores', 'cotacoes'].map(ler));
  const todos = [...sis, ...prods, ...forns, ...cots];
  if (!todos.length) return null;
  for (const [path, data, versao] of todos) {
    nuvem.enviado[path] = JSON.stringify(data);
    if (versao) nuvem.versao[path] = versao;
  }
  return estadoDeDocs(sis, prods, forns, cots);
}

/** Monta o estado do sistema a partir dos documentos ([caminho, dados] de cada coleção). */
function estadoDeDocs(sis, prods, forns, cots) {
  // mesmo item em dois documentos (lotes antigos + baldes novos): fica um só (os baldes vêm primeiro)
  const semRepetir = lista => { const vistos = new Set(); return lista.filter(x => x && !vistos.has(x.id) && vistos.add(x.id)); };
  const emOrdem = docs => [...docs].sort((a, b) => (a[0].includes('/b-') ? 0 : 1) - (b[0].includes('/b-') ? 0 : 1));
  // Os documentos chegam congelados (somente leitura): trabalhamos sempre com cópias.
  const mapa = structuredClone(Object.fromEntries(sis));
  return normalizar({
    config: mapa['sistema/config'] || {},
    rascunho: mapa['sistema/extra']?.rascunho || null,
    duvidas: mapa['sistema/extra']?.duvidas || [],
    ultimoBackup: mapa['sistema/extra']?.ultimoBackup || null,
    backupAdiadoAte: mapa['sistema/extra']?.backupAdiadoAte || null,
    produtos: structuredClone(semRepetir(emOrdem(prods).flatMap(([, d]) => d.itens || []))),
    fornecedores: structuredClone(semRepetir(emOrdem(forns).flatMap(([, d]) => d.itens || []))),
    cotacoes: cots.map(([, d]) => structuredClone(d)),
  });
}

let timerStatus = null;
function mostrarStatus(s) {
  nuvem.status = s;
  clearTimeout(timerStatus);
  // salvar costuma levar menos de 1 segundo: o aviso "Salvando…" só aparece se demorar (senão fica piscando)
  if (s === 'salvando') { timerStatus = setTimeout(() => pintarStatus('salvando'), 1500); return; }
  pintarStatus(s);
}
function pintarStatus(s) {
  const el = $('#statusNuvem');
  if (!el || el.dataset.s === s) return;
  const txt = { local: 'Salvo neste navegador', salvando: 'Salvando…', salvo: 'Salvo na nuvem', erro: 'Erro ao salvar', carregando: 'Carregando…' }[s];
  el.textContent = txt;
  el.dataset.s = s;
}

/** Estado a partir de um backup do Supabase ({ caminho: dados }). */
function estadoDeBackup(mapa) {
  const e = Object.entries(mapa || {});
  const de = col => e.filter(([k]) => k.startsWith(col + '/'));
  return estadoDeDocs(de('sistema'), de('produtos'), de('fornecedores'), de('cotacoes'));
}

/** Carrega os dados de um armazenamento na nuvem (página do Claude ou Supabase) e passa a sincronizar. */
async function usarNuvem(adaptador) {
  mostrarStatus('carregando');
  try {
    nuvem.db = adaptador;
    const copiaLocal = db;
    const pendentes = lerPendentes();
    const remoto = await carregarNuvem();
    if (remoto) {
      db = remoto;
      cacheBusca = null;
      if (pendentes && Object.keys(pendentes).length) {
        // alterações que não chegaram a ir para a nuvem (a aba foi fechada antes): junta com o que está lá
        const locais = Object.fromEntries(Object.entries(docsDe(copiaLocal)).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
        for (const [caminho, baseJson] of Object.entries(pendentes)) {
          const base = baseJson != null ? JSON.parse(baseJson) : undefined;
          const remotoDoc = nuvem.enviado[caminho] != null ? JSON.parse(nuvem.enviado[caminho]) : undefined;
          aplicarDoc(caminho, mesclarDoc(caminho, base, locais[caminho], remotoDoc), [base, locais[caminho], remotoDoc]);
        }
        versaoDados++;
        agendarSincronia();
      }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) { /* cache opcional */ }
      render();
      mostrarStatus('salvo');
    } else if (db.produtos.length || db.fornecedores.length || db.cotacoes.length || db.config.loja) {
      await sincronizar(); // primeira vez: leva para a nuvem o que já estava no navegador
    } else {
      mostrarStatus('salvo');
    }
    return true;
  } catch (e) {
    console.error(e);
    nuvem.db = null;
    mostrarStatus('local');
    toast('Não consegui acessar os dados na nuvem. Usando os dados deste navegador.', 6000);
    return false;
  }
}

async function iniciarNuvem() {
  const cfg = window.COTACAO_CONFIG || {};
  if (cfg.supabaseUrl && cfg.supabaseAnonKey) return iniciarSupabase(cfg);
  if (!window.claude || typeof window.claude.use !== 'function') return;
  const [dbx, dl] = await Promise.all([
    window.claude.use('db').catch(() => null),
    window.claude.use('downloads').catch(() => null),
  ]);
  nuvem.downloads = dl;
  if (dbx) await usarNuvem(dbx);
}

/* ---------------- Supabase (site publicado na Cloudflare) ---------------- */

const TABELA_SUPABASE = 'cotacao_documentos';

/*
 * Biblioteca do Excel (quase 1 MB): não trava a abertura do sistema. Carrega em segundo plano logo
 * depois que a tela aparece; se alguém exportar antes disso, espera ela chegar.
 */
let promessaExcel = null;
function carregarExcel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  promessaExcel = promessaExcel || carregarScript('vendor/exceljs.min.js')
    .then(() => window.ExcelJS)
    .catch(e => { promessaExcel = null; throw e; });
  return promessaExcel;
}
async function novoLivroExcel() {
  const X = await carregarExcel();
  return new X.Workbook();
}
window.addEventListener('load', () => {
  const ocioso = window.requestIdleCallback || (fn => setTimeout(fn, 800));
  ocioso(() => carregarExcel().catch(e => console.error(e)));
});

function carregarScript(src) {
  return new Promise((ok, falha) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = ok;
    el.onerror = () => falha(new Error('Não consegui carregar ' + src));
    document.head.appendChild(el);
  });
}

function erroSupabase(error) {
  const e = new Error(error?.message || 'Erro no Supabase');
  e.code = /fetch|network|timeout|failed/i.test(e.message) || error?.status >= 500 ? 'unavailable' : error?.code;
  return e;
}

/** Mesma interface do armazenamento da página do Claude: doc(caminho).set/delete e collection(col).get. */
function adaptadorSupabase(cli) {
  const T = () => cli.from(TABELA_SUPABASE);
  const ler = async caminho => {
    const { data, error } = await T().select('caminho,dados,atualizado_em').eq('caminho', caminho).limit(1);
    if (error) throw erroSupabase(error);
    return data.length ? { existe: true, dados: data[0].dados, versao: data[0].atualizado_em } : { existe: false };
  };
  return {
    doc: caminho => ({
      set: async dados => {
        const { error } = await T().upsert({ caminho, dados });
        if (error) throw erroSupabase(error);
      },
      delete: async () => {
        const { error } = await T().delete().eq('caminho', caminho);
        if (error) throw erroSupabase(error);
      },
      get: () => ler(caminho),
      /** Grava só se o documento ainda estiver na versão que conhecemos (senão: conflito). */
      gravar: async (dados, versao) => {
        if (versao) {
          const { data, error } = await T().update({ dados }).eq('caminho', caminho).eq('atualizado_em', versao).select('atualizado_em');
          if (error) throw erroSupabase(error);
          return data.length ? { ok: true, versao: data[0].atualizado_em } : { ok: false };
        }
        const { data, error } = await T().insert({ caminho, dados }).select('atualizado_em');
        if (error) { if (error.code === '23505') return { ok: false }; throw erroSupabase(error); }
        return { ok: true, versao: data[0]?.atualizado_em };
      },
      apagar: async versao => {
        let q = T().delete().eq('caminho', caminho);
        if (versao) q = q.eq('atualizado_em', versao);
        const { data, error } = await q.select('caminho');
        if (error) throw erroSupabase(error);
        if (data.length) return { ok: true };
        return (await ler(caminho)).existe ? { ok: false } : { ok: true }; // já não existia: tudo certo
      },
    }),
    /** Versão (atualizado_em) de todos os documentos, sem os dados: para ver o que mudou. */
    versoes: async () => {
      const mapa = {};
      for (let de = 0; ; de += 1000) {
        const { data, error } = await T().select('caminho,atualizado_em').order('caminho').range(de, de + 999);
        if (error) throw erroSupabase(error);
        for (const r of data) mapa[r.caminho] = r.atualizado_em;
        if (data.length < 1000) break;
      }
      return mapa;
    },
    buscar: async caminhos => {
      const saida = {};
      for (let k = 0; k < caminhos.length; k += 50) {
        const { data, error } = await T().select('caminho,dados,atualizado_em').in('caminho', caminhos.slice(k, k + 50));
        if (error) throw erroSupabase(error);
        for (const r of data) saida[r.caminho] = { existe: true, dados: r.dados, versao: r.atualizado_em };
      }
      return saida;
    },
    collection: col => ({
      limit: () => ({
        get: async () => {
          const linhas = [];
          for (let de = 0; ; de += 1000) {
            const { data, error } = await cli.from(TABELA_SUPABASE).select('caminho,dados,atualizado_em').eq('colecao', col).order('caminho').range(de, de + 999);
            if (error) throw erroSupabase(error);
            linhas.push(...data);
            if (data.length < 1000) break;
          }
          return { docs: linhas.map(r => ({ id: r.caminho.slice(col.length + 1), exists: true, data: () => r.dados, versao: r.atualizado_em })) };
        },
      }),
    }),
  };
}

async function iniciarSupabase(cfg) {
  mostrarStatus('carregando');
  // link do e-mail de convite ou de "esqueci a senha": o Supabase manda #access_token=…&type=invite|recovery
  const tipoLink = new URLSearchParams(location.hash.slice(1)).get('type');
  try {
    if (!window.supabase) await carregarScript('vendor/supabase.min.js');
    const cli = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      // implicit: os links de convite e de "esqueci a senha" chegam com o token no endereço (#access_token=…)
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'cotacao-disppar-auth' },
    });
    nuvem.supabase = cli;
    let { data: { session } } = await cli.auth.getSession();
    if (session && (tipoLink === 'invite' || tipoLink === 'recovery')) await telaCriarSenha(cli, tipoLink);
    for (;;) {
      if (!session) session = await telaLogin(cli);
      // só entra quem estiver na lista de acesso (tabela cotacao_usuarios)
      const { data, error } = await cli.from('cotacao_usuarios').select('*').limit(1);
      if (!error && data.length) { nuvem.nome = data[0].nome || ''; break; }
      await cli.auth.signOut();
      session = null;
      mensagemLogin(error ? `Erro ao verificar o acesso: ${error.message}` : 'Este e-mail não tem acesso ao sistema. Peça para liberar em "cotacao_usuarios".');
    }
    nuvem.usuario = session.user.email;
    fecharLogin();
    await usarNuvem(adaptadorSupabase(cli));
    assinarMudancas(cli);
    iniciarPresenca(cli);
    verSeAdmin(cli);
    render();
  } catch (e) {
    console.error(e);
    mostrarStatus('erro');
    mensagemLogin('Não consegui conectar ao Supabase: ' + e.message);
  }
}

/** Tela de login por cima do sistema; resolve com a sessão quando o login dá certo. */
function telaLogin(cli) {
  return new Promise(resolve => {
    let tela = $('#telaLogin');
    if (!tela) {
      tela = document.createElement('div');
      tela.id = 'telaLogin';
      tela.innerHTML = `<form class="login-card" autocomplete="on">
        <div class="login-logo">${$('.logo-marca')?.outerHTML || ''}</div>
        <h1>Cotações ${esc(db.config.loja || 'DISPPAR')}</h1>
        <p class="muted small">Entre com o e-mail e a senha cadastrados no Supabase.</p>
        <label>E-mail<input name="email" type="email" required autocomplete="username"></label>
        <label>Senha<input name="senha" type="password" required autocomplete="current-password"></label>
        <p class="login-msg" role="alert"></p>
        <button class="primary" type="submit">Entrar</button>
        <button type="button" class="link" data-esqueci>Esqueci a senha</button>
      </form>`;
      document.body.appendChild(tela);
    }
    tela.hidden = false;
    const form = tela.querySelector('form');
    form.email.focus();
    form.onsubmit = async ev => {
      ev.preventDefault();
      mensagemLogin('Entrando…', true);
      const { data, error } = await cli.auth.signInWithPassword({ email: form.email.value.trim(), password: form.senha.value });
      if (error) return mensagemLogin(/invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message);
      mensagemLogin('', true);
      resolve(data.session);
    };
    tela.querySelector('[data-esqueci]').onclick = async () => {
      const email = form.email.value.trim();
      if (!email) return mensagemLogin('Digite o e-mail para receber o link de nova senha.');
      const { error } = await cli.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
      mensagemLogin(error ? error.message : 'Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.', !error);
    };
  });
}

/** Depois do convite (ou de "esqueci a senha"): a pessoa cria a senha que vai usar para entrar. */
function telaCriarSenha(cli, tipo) {
  return new Promise(resolve => {
    let tela = $('#telaLogin');
    if (!tela) {
      tela = document.createElement('div');
      tela.id = 'telaLogin';
      document.body.appendChild(tela);
    }
    tela.innerHTML = `<form class="login-card" autocomplete="on">
      <div class="login-logo">${$('.logo-marca')?.outerHTML || ''}</div>
      <h1>${tipo === 'invite' ? 'Bem-vindo! Crie sua senha' : 'Crie uma nova senha'}</h1>
      <p class="muted small">Você vai usar esta senha, com o seu e-mail, para entrar no sistema.</p>
      <label>Nova senha<input name="senha" type="password" required minlength="8" autocomplete="new-password"></label>
      <label>Repita a senha<input name="senha2" type="password" required minlength="8" autocomplete="new-password"></label>
      <p class="login-msg" role="alert"></p>
      <button class="primary" type="submit">Salvar senha e entrar</button>
    </form>`;
    tela.hidden = false;
    const form = tela.querySelector('form');
    form.senha.focus();
    form.onsubmit = async ev => {
      ev.preventDefault();
      if (form.senha.value !== form.senha2.value) return mensagemLogin('As duas senhas não são iguais.');
      mensagemLogin('Salvando…', true);
      const { error } = await cli.auth.updateUser({ password: form.senha.value });
      if (error) return mensagemLogin(error.message);
      tela.remove();
      history.replaceState(null, '', location.pathname + location.search);
      resolve();
    };
  });
}

function mensagemLogin(texto, info = false) {
  const el = $('#telaLogin .login-msg');
  if (!el) return;
  el.textContent = texto;
  el.classList.toggle('info', info);
}

function fecharLogin() {
  const tela = $('#telaLogin');
  if (tela) tela.hidden = true;
}

/**
 * Tempo real: quando outro computador salva, o Supabase avisa e este puxa as alterações na hora
 * (sem esperar a verificação de cada minuto). Só o aviso; os dados vêm pelo caminho de sempre.
 */
function assinarMudancas(cli) {
  if (typeof cli.channel !== 'function') return;
  let timer = null;
  try {
    nuvem.canal = cli.channel('cotacao-documentos')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABELA_SUPABASE }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => puxarNuvem(), 700); // junta vários avisos seguidos
      })
      .subscribe(status => { nuvem.tempoReal = status === 'SUBSCRIBED'; });
  } catch (e) {
    console.error(e); // sem tempo real: continua verificando a cada minuto
  }
}

/* ---------------- quem está nesta cotação agora (presença) ----------------
 * Canal privado do Supabase (só quem está logado e liberado entra: presenca.sql). Cada computador
 * anuncia onde está (tela, cotação e o fornecedor escolhido em "Mostrar itens de"). */

const presenca = { canal: null, pronto: false, chave: null, outros: [], ultimo: '', timer: null };

function iniciarPresenca(cli) {
  if (typeof cli.channel !== 'function') return;
  presenca.chave = `${nuvem.usuario}#${uid()}`;
  try {
    presenca.canal = cli.channel('cotacao-presenca', { config: { private: true, presence: { key: presenca.chave } } });
    presenca.canal
      .on('presence', { event: 'sync' }, () => {
        const estado = presenca.canal.presenceState();
        const eu = String(nuvem.usuario || '').toLowerCase();
        const porEmail = new Map();
        for (const lista of Object.values(estado)) {
          for (const x of lista) {
            if (!x?.email || String(x.email).toLowerCase() === eu) continue; // eu mesmo (inclusive outra aba) não aparece
            const atual = porEmail.get(x.email);
            if (!atual || (x.cotId && !atual.cotId)) porEmail.set(x.email, x);
          }
        }
        presenca.outros = [...porEmail.values()];
        atualizarPresencaTela();
      })
      .subscribe(status => {
        presenca.pronto = status === 'SUBSCRIBED';
        if (presenca.pronto) { presenca.ultimo = ''; anunciarPresenca(); }
      });
  } catch (e) {
    console.error(e); // sem presença: o sistema funciona igual
  }
}

function meuEstadoPresenca() {
  const { nome, id } = rota();
  const cotId = nome === 'cotacao' ? id : pip.win && !pip.win.closed ? pip.cotId : null;
  const c = cotId ? db.cotacoes.find(x => x.id === cotId) : null;
  const fv = c ? filtroVencedor(c) : '';
  const forn = !fv ? '' : fv === '__sem' ? 'sem preço' : c.fornecedores.find(f => f.fornecedorId === fv)?.nome || '';
  return { email: nuvem.usuario, nome: nuvem.nome || '', tela: nome, cotId: c ? cotId : null, forn, janela: !!(pip.win && !pip.win.closed) };
}

/** Avisa os outros onde estou (só quando muda). */
function anunciarPresenca() {
  clearTimeout(presenca.timer);
  presenca.timer = setTimeout(() => {
    if (!presenca.canal || !presenca.pronto) return;
    const e = meuEstadoPresenca();
    const k = JSON.stringify(e);
    if (k === presenca.ultimo) return;
    presenca.ultimo = k;
    Promise.resolve(presenca.canal.track(e)).catch(err => console.error(err));
  }, 250);
}

const nomePessoa = x => x.nome || String(x.email || '').split('@')[0];
const pessoasNaCot = cotId => presenca.outros.filter(x => x.cotId === cotId);

/** Chips "Maria · KAIZEN" de quem está na cotação (e aviso se alguém está no mesmo fornecedor que eu). */
function htmlPresencaCot(cotId) {
  const outros = pessoasNaCot(cotId);
  if (!outros.length) return '';
  const meu = meuEstadoPresenca().forn;
  const mesmo = meu ? outros.filter(x => x.forn === meu) : [];
  return `<span class="presenca-rot">👥 Nesta cotação agora:</span>${outros.map(x => `<span class="presenca-chip${mesmo.includes(x) ? ' conflito' : ''}" title="${esc(x.email)}${x.janela ? ' · usando a janela flutuante' : ''}"><span class="presenca-ponto"></span>${esc(nomePessoa(x))}${x.forn ? ` <span class="presenca-forn">· ${esc(x.forn)}</span>` : ''}</span>`).join('')}${mesmo.length ? `<span class="presenca-aviso">⚠ ${esc(mesmo.map(nomePessoa).join(' e '))} também ${mesmo.length > 1 ? 'estão' : 'está'} em ${esc(meu)}</span>` : ''}`;
}

/** Bolinhas na lista de cotações. */
function htmlPresencaLista(cotId) {
  const outros = pessoasNaCot(cotId);
  return outros.map(x => `<span class="presenca-mini" title="${esc(nomePessoa(x))} está nesta cotação${x.forn ? ` (${esc(x.forn)})` : ''}">${esc(nomePessoa(x).slice(0, 1).toUpperCase())}</span>`).join('');
}

/** Atualiza só os pedaços da tela que mostram a presença (sem redesenhar). */
function atualizarPresencaTela() {
  const el = document.getElementById('presencaCot');
  if (el) { el.innerHTML = htmlPresencaCot(el.dataset.cot); el.hidden = !el.innerHTML; }
  for (const x of document.querySelectorAll('.presenca-lista[data-cot]')) x.innerHTML = htmlPresencaLista(x.dataset.cot);
  const ini = document.getElementById('presencaInicio');
  if (ini) { ini.innerHTML = htmlPresencaInicio(); document.getElementById('presencaInicioCard').hidden = !presenca.outros.length; }
  if (pip.win && !pip.win.closed) {
    const p = pip.win.document.getElementById('pipPresenca');
    if (p) { p.innerHTML = htmlPresencaCot(pip.cotId); p.hidden = !p.innerHTML; }
  }
}

/** Relatórios (e a análise dos fornecedores) só para administradores; sem login na nuvem (uso local), liberado. */
function podeVerRelatorios() {
  return !nuvem.usuario || nuvem.admin === true;
}

/** Administrador pode cadastrar usuários (funções do usuarios.sql no Supabase). */
async function verSeAdmin(cli) {
  try {
    const { data, error } = await cli.rpc('cotacao_sou_admin');
    nuvem.admin = !error && data === true;
  } catch (e) {
    nuvem.admin = false;
  }
  if (nuvem.admin && rota().nome === 'config') { await carregarUsuarios(); render(); }
  else if (['relatorios', 'cotacao', 'fornecedores'].includes(rota().nome)) render(); // mostra (ou esconde) o que é só de administrador
  else atualizarNavAdmin();
}

function atualizarNavAdmin() {
  const a = $('#nav a[data-route="relatorios"]');
  if (a) a.hidden = !podeVerRelatorios();
}

async function carregarUsuarios() {
  const { data, error } = await nuvem.supabase.rpc('cotacao_listar_usuarios');
  ui.usuarios = error ? { erro: error.message } : { lista: data || [] };
}

const msgErroSb = e => String(e?.message || e || 'Erro no Supabase');

function renderConta() {
  if (!nuvem.supabase) return '';
  const U = ui.usuarios;
  if (nuvem.admin && !U) { ui.usuarios = { carregando: true }; carregarUsuarios().then(() => { if (rota().nome === 'config') render(); }); }
  const fmtAcesso = d => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nunca entrou');
  return `<section class="card" id="cardConta">
    <div class="row-between"><h2>Conta</h2><button data-act="sairSupabase">Sair</button></div>
    <p class="muted small" style="margin:0">Conectado como <b>${esc(nuvem.usuario || '')}</b>${nuvem.admin ? ' <span class="badge ok">administrador</span>' : ''}. Os dados ficam no Supabase e aparecem em qualquer computador em que você entrar.</p>
    <p class="muted small">🔄 Vários computadores podem usar o sistema ao mesmo tempo: o que um salva aparece nos outros ${nuvem.tempoReal ? '<b>na hora</b>' : 'em até 1 minuto'}. Se duas pessoas mexerem na mesma cotação, as alterações das duas são juntadas.</p>
    <details class="minha-senha"><summary>Trocar a minha senha</summary>
      <form data-form="minhaSenha" class="grid" autocomplete="off">
        <label>Nova senha<input name="senha" type="password" minlength="6" required autocomplete="new-password"></label>
        <label>Repita a nova senha<input name="senha2" type="password" minlength="6" required autocomplete="new-password"></label>
        <div class="actions" style="grid-column:1/-1"><button class="primary">Trocar a senha</button></div>
      </form>
    </details>
    ${nuvem.admin ? `<h3 style="margin-top:18px">Usuários</h3>
      <p class="muted small" style="margin-top:0">Cadastre quem pode usar o sistema. A pessoa entra com o e-mail e a senha que você definir aqui (e pode trocar a senha depois, em Configurações).</p>
      ${!U || U.carregando ? '<p class="muted small">Carregando…</p>' : U.erro ? `<p class="aviso-erro small">Não consegui ler os usuários: ${esc(U.erro)}</p>` : `<div class="table-wrap"><table>
        <thead><tr><th>Usuário</th><th>Acesso</th><th>Último acesso</th><th></th></tr></thead>
        <tbody>${U.lista.map(u => `<tr>
          <td><b>${esc(u.nome || u.email)}</b>${u.nome ? `<br><span class="small muted">${esc(u.email)}</span>` : ''}</td>
          <td>${u.admin ? '<span class="badge ok">administrador</span>' : '<span class="badge">usuário</span>'}${u.email !== String(nuvem.usuario || '').toLowerCase() ? `<br><button type="button" class="link small" data-act="alternarAdmin" data-email="${esc(u.email)}" data-admin="${u.admin ? '0' : '1'}">${u.admin ? 'tirar administrador' : '⭐ tornar administrador'}</button>` : ''}</td>
          <td class="small">${esc(fmtAcesso(u.ultimo_acesso))}</td>
          <td class="actions-cell"><button class="sm" data-act="senhaUsuario" data-email="${esc(u.email)}">Trocar senha</button>${u.email !== String(nuvem.usuario || '').toLowerCase() ? ` <button class="sm danger" data-act="removerUsuario" data-email="${esc(u.email)}">Tirar acesso</button>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>`}
      <form data-form="usuario" class="grid form-usuario" autocomplete="off">
        <label>Nome<input name="nome" placeholder="Ex.: Maria" autocomplete="off"></label>
        <label>E-mail<input name="email" type="email" required autocomplete="off"></label>
        <label>Senha inicial<input name="senha" type="text" minlength="6" required autocomplete="off" placeholder="mínimo 6 caracteres"></label>
        <label class="check-inline" style="align-self:end"><input type="checkbox" name="admin"> pode cadastrar usuários</label>
        <div class="actions" style="grid-column:1/-1"><button class="primary">+ Adicionar usuário</button></div>
      </form>` : ''}
  </section>`;
}

async function sairSupabase() {
  if (!nuvem.supabase) return;
  if (nuvem.timer || nuvem.gravando) await sincronizar();
  await nuvem.supabase.auth.signOut();
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(CHAVE_PENDENTES); } catch (e) { /* sem acesso */ }
  location.reload();
}

/* ---------------- utilitários ---------------- */

const $ = (s, r = document) => r.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const enc = encodeURIComponent;
const byId = list => Object.fromEntries(list.map(x => [x.id, x]));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtData(iso) {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR');
}

const FMT_MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtsPct = new Map();
const fmtsNum = new Map();
function fmtMoeda(v) {
  return v == null || isNaN(v) ? '—' : FMT_MOEDA.format(v);
}

function fmtPct(v, dec = 1) {
  if (v == null || isNaN(v)) return '—';
  let f = fmtsPct.get(dec);
  if (!f) fmtsPct.set(dec, (f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })));
  return f.format(v * 100) + '%';
}

function fmtNum(v, dec = 3) {
  if (v == null || isNaN(v)) return '';
  let f = fmtsNum.get(dec);
  if (!f) fmtsNum.set(dec, (f = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: dec })));
  return f.format(Number(v));
}

/** Aceita "1.234,56", "R$ 10,5", "10.5" ou número. */
function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).replace(/R\$|\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function semAcento(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function slug(s) {
  return semAcento(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'arquivo';
}

function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

async function baixarBlob(blob, nome) {
  if (nuvem.downloads) {
    try {
      await nuvem.downloads.save({ filename: nome, data: blob });
      return true;
    } catch (e) {
      if (e && e.code === 'declined') return false;
      if (e && e.code === 'rate_limited') { toast('Aguarde a confirmação do download anterior.'); return false; }
      console.error(e);
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}

/* ---------------- diálogos na própria página ---------------- */

function abrirDialogo(msg, botoes, doc = document) {
  return new Promise(resolve => {
    const fundo = doc.createElement('div');
    fundo.className = 'dlg-fundo';
    fundo.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">
      <p>${esc(msg).replace(/\n/g, '<br>')}</p>
      <div class="actions">${botoes.map((b, i) => `<button type="button" class="${b.cls || ''}" data-i="${i}">${esc(b.txt)}</button>`).join('')}</div>
    </div>`;
    const fechar = v => { fundo.remove(); doc.removeEventListener('keydown', tecla, true); resolve(v); };
    const tecla = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fechar(botoes[0].valor); }
      else if (e.key === 'Enter' || e.key === ' ') { e.stopImmediatePropagation(); }
    };
    fundo.addEventListener('click', e => {
      e.stopPropagation();
      const b = e.target.closest('button[data-i]');
      if (b) fechar(botoes[+b.dataset.i].valor);
    });
    doc.addEventListener('keydown', tecla, true);
    doc.body.appendChild(fundo);
    fundo.querySelector('button:last-child').focus();
  });
}

/** Diálogo com um campo (texto com sugestões ou lista). Devolve o valor, ou null se cancelar. */
function pedirValor(msg, { valor = '', opcoes = [], tipo = 'texto', ok = 'OK', doc = document } = {}) {
  return new Promise(resolve => {
    const fundo = doc.createElement('div');
    fundo.className = 'dlg-fundo';
    const campo = tipo === 'lista'
      ? `<select id="dlgCampo">${opcoes.map(o => `<option value="${esc(o.valor)}">${esc(o.texto)}</option>`).join('')}</select>`
      : `<input id="dlgCampo" list="dlgOpcoes" value="${esc(valor)}" autocomplete="off"><datalist id="dlgOpcoes">${opcoes.map(o => `<option value="${esc(o)}">`).join('')}</datalist>`;
    fundo.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">
      <p>${esc(msg).replace(/\n/g, '<br>')}</p>
      ${campo}
      <div class="actions"><button type="button" data-r="0">Cancelar</button><button type="button" class="primary" data-r="1">${esc(ok)}</button></div>
    </div>`;
    const inp = () => fundo.querySelector('#dlgCampo');
    const fechar = v => { fundo.remove(); doc.removeEventListener('keydown', tecla, true); resolve(v); };
    const tecla = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fechar(null); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); fechar(inp().value.trim() || null); }
      else e.stopImmediatePropagation();
    };
    fundo.addEventListener('click', e => {
      e.stopPropagation();
      const b = e.target.closest('button[data-r]');
      if (b) fechar(b.dataset.r === '1' ? (inp().value.trim() || null) : null);
    });
    doc.addEventListener('keydown', tecla, true);
    doc.body.appendChild(fundo);
    inp().focus();
    if (inp().select) inp().select();
  });
}

function confirmar(msg, ok = 'Confirmar', doc = document) {
  return abrirDialogo(msg, [{ txt: 'Cancelar', valor: false }, { txt: ok, valor: true, cls: 'primary' }], doc);
}

function avisar(msg, doc = document) {
  return abrirDialogo(msg, [{ txt: 'OK', valor: undefined, cls: 'primary' }], doc);
}

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Salva um arquivo perguntando onde: no Chrome/Edge (arquivo aberto no computador) abre a janela
 * "Salvar como"; na página publicada, o próprio Claude pede a confirmação do download.
 * gerar() devolve o Blob. Retorna false se a pessoa cancelou.
 */
let ultimoSalvo = null; // o próximo "Salvar como" abre na mesma pasta
let janelaSalvar = null; // exportando pela janela flutuante: a janela "Salvar como" é aberta por ela
async function salvarComo(nome, gerar, tipo = { description: 'Planilha do Excel', accept: { [TIPO_XLSX]: ['.xlsx'] } }) {
  const jan = janelaSalvar && !janelaSalvar.closed && typeof janelaSalvar.showSaveFilePicker === 'function' ? janelaSalvar : window;
  if (!nuvem.downloads && typeof jan.showSaveFilePicker === 'function') {
    let handle = null;
    try {
      const opcoes = { suggestedName: nome, types: [tipo] };
      try {
        handle = await jan.showSaveFilePicker(ultimoSalvo ? { ...opcoes, startIn: ultimoSalvo } : opcoes);
      } catch (e) {
        if (!ultimoSalvo || (e && e.name === 'AbortError')) throw e;
        handle = await jan.showSaveFilePicker(opcoes); // pasta anterior não existe mais
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false; // cancelou a janela
      handle = null; // navegador bloqueou a janela: baixa do jeito normal
    }
    if (handle) {
      ultimoSalvo = handle;
      const blob = await gerar();
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      toast(`Arquivo salvo: ${handle.name}`);
      return true;
    }
  }
  return baixarBlob(await gerar(), nome);
}

/* ---------------- .zip (sem compressão: as planilhas .xlsx já são compactadas) ---------------- */

const CRC_TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(dados) {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = CRC_TABELA[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Monta um arquivo .zip com [{ nome, dados: Uint8Array }]. */
function criarZip(arquivos) {
  const partes = [], central = [];
  const agora = new Date();
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
  const data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  let offset = 0;
  for (const a of arquivos) {
    const nome = new TextEncoder().encode(a.nome);
    const crc = crc32(a.dados);
    const cab = new DataView(new ArrayBuffer(30));
    cab.setUint32(0, 0x04034b50, true);
    cab.setUint16(4, 20, true);
    cab.setUint16(6, 0x0800, true); // nomes em UTF-8
    cab.setUint16(8, 0, true); // sem compressão
    cab.setUint16(10, hora, true);
    cab.setUint16(12, data, true);
    cab.setUint32(14, crc, true);
    cab.setUint32(18, a.dados.length, true);
    cab.setUint32(22, a.dados.length, true);
    cab.setUint16(26, nome.length, true);
    partes.push(cab, nome, a.dados);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(12, hora, true);
    cd.setUint16(14, data, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, a.dados.length, true);
    cd.setUint32(24, a.dados.length, true);
    cd.setUint16(28, nome.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd, nome);
    offset += 30 + nome.length + a.dados.length;
  }
  const tamCentral = central.reduce((s, x) => s + x.byteLength, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true);
  fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamCentral, true);
  fim.setUint32(16, offset, true);
  return new Blob([...partes, ...central, fim], { type: 'application/zip' });
}

const TIPO_ZIP = { description: 'Arquivo compactado', accept: { 'application/zip': ['.zip'] } };

async function baixarWorkbook(wb, nome) {
  return salvarComo(nome, async () => new Blob([await wb.xlsx.writeBuffer()], { type: TIPO_XLSX }));
}

function cellValue(cell) {
  let v = cell.value;
  if (v instanceof Date) return v;
  if (v && typeof v === 'object') {
    if ('result' in v) v = v.result;
    else if (v.richText) v = v.richText.map(t => t.text).join('');
    else if ('text' in v) v = v.text;
    else if ('error' in v) v = null;
  }
  return v;
}

function cellTexto(cell) {
  const v = cellValue(cell);
  if (v == null) return '';
  if (v instanceof Date) return v.toLocaleDateString('pt-BR');
  return String(v).trim();
}

function statusBadge(s) {
  const [txt, cls] = STATUS[s] || [s, ''];
  return `<span class="badge ${cls}">${esc(txt)}</span>`;
}

/* ---------------- regras de negócio ---------------- */

function rascunho() {
  if (!db.rascunho) db.rascunho = novoRascunho();
  return db.rascunho;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Última cotação criada (para repetir observações, horário do prazo e fornecedores). */
function ultimaCotacao() {
  return [...db.cotacoes].filter(c => c.status !== 'cancelada')
    .sort((a, b) => (b.criadoEm || b.data || '').localeCompare(a.criadoEm || a.data || ''))[0] || null;
}

/** Nova cotação já vem com título do dia, prazo no próximo dia útil e as observações da última. */
function novoRascunho() {
  const hoje = new Date();
  const d = new Date(hoje);
  do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
  const ult = ultimaCotacao();
  return {
    titulo: `COTAÇÃO ${hoje.getDate()} DE ${MESES[hoje.getMonth()].toUpperCase()}`,
    prazoResposta: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    prazoHora: ult?.prazoHora || '09:00',
    obs: ult?.obs || '',
    itens: [],
    fornecedorIds: [],
  };
}

/** Fornecedores da última cotação que ainda estão no cadastro ("os de sempre"). */
function fornecedoresDeSempre() {
  const ult = ultimaCotacao();
  const cad = new Set(db.fornecedores.map(f => f.id));
  return ult ? ult.fornecedores.map(f => f.fornecedorId).filter(id => cad.has(id)) : [];
}

/** O que conferir antes de criar a cotação (vai para os fornecedores: melhor pegar antes). */
function checklistNova(r = rascunho()) {
  const prod = prodPorId();
  const itens = r.itens.filter(x => prod[x.produtoId]);
  const itensLista = xs => xs.slice(0, 6).join(', ') + (xs.length > 6 ? ` e mais ${xs.length - 6}` : '');
  const cod = x => x.codigoArquivo || prod[x.produtoId].codigo;
  const res = [];
  const semMarca = itens.filter(x => !(x.marca || prod[x.produtoId].marca));
  if (semMarca.length) res.push({ tipo: 'marca', txt: `${semMarca.length} item(ns) sem marca pedida: ${itensLista(semMarca.map(cod))}` });
  const vistos = new Map();
  for (const x of itens) { const k = normCod(cod(x)); vistos.set(k, (vistos.get(k) || 0) + 1); }
  const rep = [...vistos].filter(([, n]) => n > 1);
  if (rep.length) res.push({ tipo: 'repetido', txt: `${rep.length} código(s) repetido(s) na lista: ${itensLista(itens.filter((x, k, a) => vistos.get(normCod(cod(x))) > 1 && a.findIndex(y => normCod(cod(y)) === normCod(cod(x))) === k).map(cod))}` });
  const abertas = db.cotacoes.filter(c => c.status === 'aberta' && !c.arquivada);
  const emAberta = [];
  for (const x of itens) {
    const c = abertas.find(cc => cc.itens.some(it => it.produtoId === x.produtoId));
    if (c) emAberta.push(`${cod(x)} (nº ${c.numero})`);
  }
  if (emAberta.length) res.push({ tipo: 'aberta', txt: `${emAberta.length} item(ns) já estão numa cotação aberta: ${itensLista(emAberta)}` });
  if (!r.papelzinhos) res.push({ tipo: 'papel', txt: 'Os papelzinhos de São Sebastião não foram importados (opcional)' });
  if (!r.prazoResposta) res.push({ tipo: 'prazo', txt: 'Sem prazo de resposta' });
  else if (new Date(`${r.prazoResposta}T${r.prazoHora || '23:59'}`) < new Date()) res.push({ tipo: 'prazo', txt: `O prazo (${fmtData(r.prazoResposta)}${r.prazoHora ? ' ' + r.prazoHora : ''}) já passou` });
  const forn = byId(db.fornecedores);
  const semEmail = r.fornecedorIds.map(id => forn[id]).filter(f => f && !f.email);
  if (semEmail.length) res.push({ tipo: 'email', txt: `${semEmail.length} fornecedor(es) sem e-mail: ${itensLista(semEmail.map(f => f.nome))}` });
  return res;
}

/** Faixa fixa no rodapé da Nova cotação: resumo e o botão de criar. */
function htmlBarraCriar(r = rascunho()) {
  const prod = prodPorId();
  const n = r.itens.filter(x => prod[x.produtoId]).length;
  const nf = r.fornecedorIds.length;
  const ck = n ? checklistNova(r) : [];
  const prazo = r.prazoResposta ? `${fmtData(r.prazoResposta).slice(0, 5)}${r.prazoHora ? ' ' + r.prazoHora : ''}` : 'sem prazo';
  return `<div class="barra-criar-resumo">
      <span title="Itens na cotação">📦 <b>${n}</b><span class="rot-longo"> ${n === 1 ? 'item' : 'itens'}</span></span>
      <span title="Fornecedores que vão receber">🏪 <b>${nf}</b><span class="rot-longo"> fornecedor(es)</span></span>
      <span title="Responder até">⏰ ${esc(prazo)}</span>
      ${ck.length ? `<span class="barra-criar-alerta" title="${esc(ck.map(x => '• ' + x.txt).join('\n'))}">⚠ ${ck.length}<span class="rot-longo"> ponto(s) a conferir</span></span>` : n ? '<span class="barra-criar-ok">✓<span class="rot-longo"> tudo certo</span></span>' : ''}
    </div>
    <div class="barra-criar-acoes">
      <button type="button" class="sm" data-act="limparRascunho">Limpar tudo</button>
      ${n ? '' : '<span class="small muted barra-criar-dica">Adicione itens para criar</span>'}
      <button type="button" class="primary" data-act="criarCotacao" title="${n ? 'Cria a cotação e salva a planilha em Excel' : 'Adicione itens (arquivo do DataCar, papelzinhos ou busca no cadastro) para criar a cotação'}" ${n ? '' : 'disabled'}>Criar cotação<span class="rot-longo"> e salvar planilha</span> →</button>
    </div>`;
}
function atualizarBarraCriar() {
  const b = document.getElementById('barraCriar');
  if (b) b.innerHTML = htmlBarraCriar();
}

function novoFornCot(f) {
  return {
    fornecedorId: f.id,
    nome: f.nome,
    email: f.email || '',
    contato: f.contato || '',
    enviadoEm: null,
    respondidoEm: null,
    respostas: {},
    cond: {},
  };
}

/* ---------------- marcas ---------------- */

function normMarca(v) {
  return semAcento(v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A marca pedida pode ter mais de uma opção: "NSK/SKF", "COFAP ou MONROE". */
/**
 * Marcas aceitas pela marca exigida, no padrão do banco do DISPPAR:
 * "QUALQUER" (também "KIT CIA QUALQUER", "APLIC QUALQUER") = sem exigência;
 * "SÓ COFAP" = só COFAP; "ALB-NAK-KAY-PERF-MONR" = qualquer uma da lista (abreviadas).
 * Também separa por "/", ",", ";", "+" e " OU ".
 */
function opcoesMarca(pedida) {
  const txt = semAcento(pedida).toUpperCase().trim();
  if (!txt || /\b(QUALQUER|QQR|QQ)\b/.test(txt)) return [];
  return [...new Set(txt.split(/\s*[-\/,;|+]\s*|\s+OU\s+/)
    .map(p => normMarca(p).replace(/^(SO|SOMENTE|APENAS)\s+/, ''))
    .filter(Boolean))];
}

const PESO_MARCA = { ok: 4, abrev: 3, duvida: 2, errada: 1 };

function ehSubsequencia(curta, longa) {
  let k = 0;
  for (const ch of longa) if (ch === curta[k]) k++;
  return k === curta.length;
}

/** Compara uma opção de marca pedida com a resposta (as duas já normalizadas). */
function compararMarcaOpcao(op, r) {
  const oc = op.replace(/ /g, ''), rc = r.replace(/ /g, '');
  if (oc === rc) return 'ok';
  if ((db.config.marcasDiferentes?.[op] || []).includes(r)) return 'errada';
  if ((db.config.marcasEquivalentes?.[op] || []).includes(r)) return 'ok';
  let melhor = 'errada';
  for (const [a, b] of [[op, r], [r, op]]) { // a = nome completo, b = possível abreviação
    const ac = a.replace(/ /g, ''), bc = b.replace(/ /g, '');
    const pa = a.split(' '), pb = b.split(' ');
    if (bc.length >= 2 && ac.startsWith(bc)) return 'abrev'; // COF → COFAP
    if (pa.length > 1 && bc === pa.map(w => w[0]).join('')) return 'abrev'; // MM → MAGNETI MARELLI
    if (pa.some(w => w.length >= 3 && pb.includes(w))) return 'abrev'; // MARELLI, "NSK ORIGINAL"
    if (bc.length >= 2 && bc[0] === ac[0] && ehSubsequencia(bc, ac)) {
      if (bc.length >= 3) return 'abrev'; // MGN → MAGNETI, NKT → NAKATA
      melhor = 'duvida'; // só 2 letras: confirmar
    }
  }
  return melhor;
}

/**
 * Situação da marca respondida em relação à pedida:
 * null (item sem marca pedida), 'sem' (fornecedor não informou), 'ok', 'abrev' (abreviação reconhecida),
 * 'duvida' (pode ser abreviação: confirmar) ou 'errada'.
 */
function statusMarca(pedida, resposta) {
  const ops = opcoesMarca(pedida);
  if (!ops.length) return null;
  const r = normMarca(resposta);
  if (!r) return 'sem';
  return ops.map(op => compararMarcaOpcao(op, r)).sort((a, b) => PESO_MARCA[b] - PESO_MARCA[a])[0];
}

function chipMarca(l, j, o) {
  const st = l.marcas[j];
  const m = o?.marca || '';
  const at = `data-act="marcaResposta" data-i="${l.i}" data-f="${j}"`;
  if (l.recusas?.[j]) return `<span class="chip-marca recusada" ${at} title="Marca recusada por você (pedida: ${esc(l.it.marca)}). Este preço não entra. Clique para desfazer.">✗ ${esc(m)}</span>`;
  if (st === 'errada' && l.permitidas?.[j]) return `<span class="chip-marca errada permitida" ${at} title="Marca errada (pedida: ${esc(l.it.marca)}), mas PERMITIDA só nesta cotação: o preço disputa normalmente. Clique para mudar.">⚠ ${esc(m)} ≠ ${esc(l.it.marca)} <b>· permitida</b></span>`;
  if (st === 'errada') return `<span class="chip-marca errada" ${at} title="Pedida: ${esc(l.it.marca)}. Clique para confirmar ou corrigir.">⚠ ${esc(m)} ≠ ${esc(l.it.marca)}</span>`;
  if (st === 'duvida') return `<span class="chip-marca duvida" ${at} title="Pode ser abreviação de ${esc(l.it.marca)}. Clique para confirmar.">? ${esc(m)} — confira</span>`;
  if (st === 'abrev') return `<span class="chip-marca ok" ${at} title="Reconhecida como ${esc(l.it.marca)}">✓ ${esc(m)}</span>`;
  if (st === 'ok') return `<span class="chip-marca ok" title="Marca pedida">✓ ${esc(m)}</span>`;
  if (st === 'sem') return `<span class="chip-marca sem" title="O fornecedor não informou a marca (pedida: ${esc(l.it.marca)})">sem marca</span>`;
  return `<span class="chip-marca neutra" title="Marca respondida (esta cotação aceita qualquer marca)">${esc(m)}</span>`;
}

/** Guarda a decisão sobre uma marca respondida: 'igual' ou 'diferente'. */
function aprenderMarca(pedida, resposta, decisao) {
  const r = normMarca(resposta);
  const ops = opcoesMarca(pedida);
  if (!r || !ops.length) return;
  const eq = db.config.marcasEquivalentes = { ...(db.config.marcasEquivalentes || {}) };
  const dif = db.config.marcasDiferentes = { ...(db.config.marcasDiferentes || {}) };
  const tirar = (mapa, op) => { if (mapa[op]) mapa[op] = mapa[op].filter(x => x !== r); if (mapa[op] && !mapa[op].length) delete mapa[op]; };
  if (decisao === 'igual') {
    // liga a abreviação à opção mais parecida (a que começa com a mesma letra)
    const op = ops.find(x => x[0] === r[0]) || ops[0];
    tirar(dif, op);
    eq[op] = [...new Set([...(eq[op] || []), r])];
  } else {
    for (const op of ops) { tirar(eq, op); dif[op] = [...new Set([...(dif[op] || []), r])]; }
  }
}

/** Lojas para as quais a compra é dividida (Configurações). */
function lojas() {
  const l = (db.config.lojas || []).filter(x => x && x.id);
  return l.length ? l : DEFAULT_DB.config.lojas;
}

/** Sigla da loja (DSS, DPR…), usada na lista de dúvidas. */
function siglaLoja(l) {
  if (l.sigla) return l.sigla;
  if (l.id === 'sao-sebastiao') return 'DSS';
  if (l.id === 'paranoa') return 'DPR';
  return semAcento(l.nome).toUpperCase().split(/\s+/).map(w => w[0]).join('').slice(0, 4);
}

/** true quando já foi digitada alguma quantidade por loja nesta cotação. */
function temQtdLojas(c) {
  return !!c.qtds && Object.values(c.qtds).some(o => o && Object.values(o).some(v => v != null && v >= 0));
}

function qtdLoja(c, i, lojaId) {
  return Number(c.qtds?.[i]?.[lojaId]) || 0;
}

/**
 * Quantidade a comprar do item i: a soma das lojas, depois que as quantidades forem digitadas;
 * antes disso vale a quantidade da cotação (preço por unidade).
 */
function qtdItem(c, i, porLoja = temQtdLojas(c)) {
  if (!porLoja) return c.itens[i].quantidade || 1;
  return lojas().reduce((s, l) => s + qtdLoja(c, i, l.id), 0);
}

/**
 * Marca recusada ("Não, é outra marca") num item: c.recusadas[i][fornecedorId] = marca recusada (normalizada).
 * Vale enquanto o fornecedor mantiver essa marca; se ele mandar outra marca, a recusa cai sozinha.
 */
function recusada(c, i, f) {
  const m = c.recusadas?.[i]?.[f.fornecedorId];
  return m != null && m === normMarca(f.respostas?.[i]?.marca);
}

function recusarMarca(c, i, f) {
  versaoDados++; // o comparativo precisa ser refeito
  const alvo = normMarca(f.respostas?.[i]?.marca);
  c.recusadas = { ...(c.recusadas || {}) };
  const r = { ...(c.recusadas[i] || {}) };
  // a mesma marca de outro fornecedor, no mesmo item, também está errada
  for (const g of c.fornecedores) if (normMarca(g.respostas?.[i]?.marca) === alvo) r[g.fornecedorId] = alvo;
  c.recusadas[i] = r;
  if (c.escolhas?.[i] && r[c.escolhas[i]] != null) { c.escolhas = { ...c.escolhas }; delete c.escolhas[i]; }
}

function desfazerRecusa(c, i, f) {
  if (!c.recusadas?.[i]?.[f.fornecedorId]) return;
  c.recusadas = { ...c.recusadas, [i]: { ...c.recusadas[i] } };
  delete c.recusadas[i][f.fornecedorId];
  if (!Object.keys(c.recusadas[i]).length) delete c.recusadas[i];
}

/**
 * Marca errada permitida só nesta cotação ("Permitir marca"): c.permitidas[i][fornecedorId] = marca (normalizada).
 * Continua contando como marca errada (relatórios, nota do fornecedor), mas o preço disputa normalmente
 * e deixa de ser aviso pendente. Não vale para as próximas cotações.
 */
function permitida(c, i, f) {
  const m = c.permitidas?.[i]?.[f.fornecedorId];
  return m != null && m === normMarca(f.respostas?.[i]?.marca);
}

function permitirMarca(c, i, f) {
  versaoDados++;
  c.permitidas = { ...(c.permitidas || {}), [i]: { ...(c.permitidas?.[i] || {}), [f.fornecedorId]: normMarca(f.respostas?.[i]?.marca) } };
}

function desfazerPermissao(c, i, f) {
  if (c.permitidas?.[i]?.[f.fornecedorId] == null) return;
  versaoDados++;
  c.permitidas = { ...c.permitidas, [i]: { ...c.permitidas[i] } };
  delete c.permitidas[i][f.fornecedorId];
  if (!Object.keys(c.permitidas[i]).length) delete c.permitidas[i];
}

/** Os preços de um item, em texto: a conferência de uma diferença vale enquanto eles não mudarem. */
const assinaturaPrecos = precos => precos.map(x => (x == null ? '' : Math.round(x * 100))).join('|');

/**
 * Monta o comparativo de preços de uma cotação.
 * O vencedor de cada item é o menor preço, a não ser que a pessoa tenha escolhido outro fornecedor
 * (c.escolhas[i] = fornecedorId). l.preco é o preço do vencedor; l.min continua sendo o menor preço.
 */
const cacheComparar = new WeakMap();
function comparar(c) {
  const m = cacheComparar.get(c);
  if (m && m.v === versaoDados) return m.r;
  const r = compararCalculo(c);
  cacheComparar.set(c, { v: versaoDados, r });
  return r;
}

/**
 * Itens desta cotação que estão na fila de Dúvidas: Map(i -> Set(ids das lojas)).
 * Enquanto a dúvida não sai da fila, o item não vai no pedido daquela loja.
 */
function duvidasPorItem(c) {
  const m = new Map();
  const LJ = lojas();
  const cod = x => String(x || '').trim().toUpperCase();
  for (const d of db.duvidas || []) {
    const o = d.origem;
    if (!o || o.cotId !== c.id) continue;
    // dúvidas antigas não têm o número do item: acha pelo código
    const i = o.i != null && c.itens[o.i] ? o.i : c.itens.findIndex(it => cod(it.codigo) && cod(it.codigo) === cod(d.codigo));
    if (i < 0) continue;
    if (!m.has(i)) m.set(i, new Set());
    const lj = LJ.find(x => siglaLoja(x) === d.empresa);
    for (const x of lj ? [lj] : LJ) m.get(i).add(x.id);
  }
  return m;
}

function compararCalculo(c) {
  const porLoja = temQtdLojas(c);
  const duvidas = duvidasPorItem(c);
  const linhas = c.itens.map((it, i) => {
    const precos = c.fornecedores.map(f => {
      const p = f.respostas?.[i]?.preco;
      return p != null && p > 0 ? p : null;
    });
    const marcas = c.fornecedores.map(f => statusMarca(it.marca, f.respostas?.[i]?.marca));
    // marca recusada por você: esse preço não ganha nunca (o item espera outro preço)
    const recusas = c.fornecedores.map(f => recusada(c, i, f));
    // marca errada permitida só nesta cotação: disputa o preço normalmente
    const permitidas = c.fornecedores.map((f, j) => marcas[j] === 'errada' && permitida(c, i, f));
    // preço com marca diferente da pedida não ganha sozinho (a não ser que só haja esses)
    let aptos = precos.map((p, j) => (recusas[j] ? null : p));
    // só há preços com a marca recusada: o mais barato ganha mesmo assim (com aviso), até chegar outro preço
    const soRecusados = !aptos.some(p => p != null) && precos.some((p, j) => p != null && recusas[j]);
    if (soRecusados) aptos = precos.map((p, j) => (recusas[j] ? p : null));
    if (db.config.marcaErradaNaoGanha !== false) {
      const filtrados = aptos.map((p, j) => (marcas[j] === 'errada' && !permitidas[j] ? null : p));
      if (filtrados.some(p => p != null)) aptos = filtrados;
    }
    // classificação: menor preço; no empate (mesmo valor em centavos), quem respondeu primeiro
    const chegada = j => { const t = Date.parse(c.fornecedores[j].respondidoEm || ''); return Number.isNaN(t) ? Infinity : t; };
    const ordem = aptos.map((p, j) => [p, j]).filter(([p]) => p != null)
      .sort((x, y) => Math.round(x[0] * 100) - Math.round(y[0] * 100) || chegada(x[1]) - chegada(y[1]) || x[1] - y[1]);
    const min = ordem.length ? ordem[0][0] : null;
    const minIdx = ordem.length ? ordem[0][1] : -1; // quem ganharia sozinho (menor preço; empate: respondeu primeiro)
    const naoComprar = porLoja && lojas().every(lj => c.qtds?.[i]?.[lj.id] === 0); // 0 em todas as lojas
    let vencedor = minIdx;
    let manual = false;
    // Comando: até 5% acima do 1º lugar também ganha (a não ser que você escolha outro)
    let preferencia = false;
    if (minIdx >= 0 && min > 0) {
      const jc = c.fornecedores.findIndex((f, j) => j !== minIdx && aptos[j] != null && PREFERENCIA.teste(f));
      if (jc >= 0 && aptos[jc] <= min * (1 + PREFERENCIA.ate) + 1e-9) { vencedor = jc; preferencia = true; }
    }
    const escolhido = c.escolhas?.[i];
    if (escolhido) {
      const j = c.fornecedores.findIndex(f => f.fornecedorId === escolhido);
      if (j >= 0 && precos[j] != null && !recusas[j]) { vencedor = j; manual = precos[j] !== min; preferencia = false; }
    }
    // só tinha preço com marca recusada: aguardando o próximo valor
    const aguardando = vencedor < 0 && recusas.some((r, j) => r && precos[j] != null);
    const recusadaGanhou = soRecusados && vencedor >= 0 && recusas[vencedor]; // comprando a marca recusada (não há outro preço)
    const preco = vencedor >= 0 ? precos[vencedor] : null;
    // segundo colocado (de outro fornecedor) e a diferença em % para o melhor
    const [seg, segIdx] = ordem.length > 1 ? ordem[1] : [null, -1];
    const difSegundo = seg != null && min > 0 ? seg / min - 1 : null;
    const q = qtdItem(c, i, porLoja);
    // estoque informado pelo vencedor (Kaizen: "MARCA/estoque"): limite de quantidade
    const estoque = vencedor >= 0 ? (c.fornecedores[vencedor].respostas?.[i]?.estoque ?? null) : null;
    const difConferida = !!c.difConferida?.[i] && c.difConferida[i] === assinaturaPrecos(precos);
    const duvida = duvidas.get(i) || null; // lojas com o item em Dúvidas
    return { it, i, q, naoComprar, duvida, recusadaGanhou, precos, marcas, recusas, permitidas, aguardando, estoque, min, minIdx, vencedor, preco, manual, preferencia, difConferida, segundo: seg, segundoIdx: segIdx, difSegundo };
  });
  const totais = c.fornecedores.map((f, fi) => {
    let total = 0, cotados = 0, vencidos = 0, valorVencido = 0;
    for (const l of linhas) {
      const p = l.precos[fi];
      if (p == null) continue;
      total += p * l.q;
      cotados++;
      if (l.vencedor === fi) { vencidos++; valorVencido += p * l.q; }
    }
    return { total, cotados, vencidos, valorVencido };
  });
  const melhor = linhas.reduce((s, l) => s + (l.preco != null ? l.preco * l.q : 0), 0);
  const menorPossivel = linhas.reduce((s, l) => s + (l.min != null ? l.min * l.q : 0), 0);
  const itensCotados = linhas.filter(l => l.min != null).length;
  const escolhasManuais = linhas.filter(l => l.manual).length;
  const porLojaTotal = Object.fromEntries(lojas().map(lj => [lj.id,
    linhas.reduce((s, l) => s + (l.preco != null ? l.preco * qtdLoja(c, l.i, lj.id) : 0), 0)]));
  return { linhas, totais, melhor, menorPossivel, itensCotados, escolhasManuais, porLoja, porLojaTotal };
}

/**
 * Último preço pago de cada produto (pelo vencedor da cotação mais recente que teve resposta).
 * `excluirId` deixa uma cotação de fora (para comparar a cotação aberta com as anteriores).
 */
function ultimosPrecos(excluirId) {
  const map = {};
  const cots = [...db.cotacoes].filter(c => c.id !== excluirId && c.status !== 'cancelada')
    .sort((a, b) => (a.data + a.numero).localeCompare(b.data + b.numero));
  for (const c of cots) {
    const { linhas } = comparar(c);
    for (const l of linhas) {
      if (!l.it.produtoId || l.preco == null) continue;
      map[l.it.produtoId] = { preco: l.preco, fornecedor: c.fornecedores[l.vencedor].nome, data: c.data, numero: c.numero };
    }
  }
  return map;
}

/**
 * Histórico de preços de cada produto nas cotações com resposta (não canceladas), da mais antiga
 * para a mais recente: produtoId → [{ cotId, numero, data, preco, fornecedor, min, segundo, difSegundo, precos }].
 */
function historicoPrecos() {
  if (cacheHist && cacheHist.db === db && cacheHist.v === versaoDados) return cacheHist.map;
  const map = {};
  const cots = db.cotacoes.filter(c => c.status !== 'cancelada')
    .sort((a, b) => (a.data + a.numero).localeCompare(b.data + b.numero));
  for (const c of cots) {
    for (const l of comparar(c).linhas) {
      if (!l.it.produtoId || l.preco == null) continue;
      (map[l.it.produtoId] ||= []).push({
        cotId: c.id, numero: c.numero, data: c.data, preco: l.preco, fornecedor: c.fornecedores[l.vencedor].nome,
        manual: l.manual, min: l.min, segundo: l.segundo, difSegundo: l.difSegundo,
        precos: l.precos.map((p, j) => ({ nome: c.fornecedores[j].nome, preco: p })).filter(x => x.preco != null).sort((a, b) => a.preco - b.preco),
      });
    }
  }
  cacheHist = { db, v: versaoDados, map };
  return map;
}

/** Gráfico de linha (SVG) com a evolução dos preços pagos. */
function graficoPrecos(hist, grande) {
  const W = grande ? 560 : 90, H = grande ? 150 : 26, PX = grande ? 56 : 3, PY = grande ? 16 : 4;
  const vals = hist.map(h => h.preco);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const x = k => hist.length === 1 ? W / 2 : PX + k * (W - PX - (grande ? 16 : 3)) / (hist.length - 1);
  const y = v => mx === mn ? H / 2 : PY + (mx - v) * (H - 2 * PY - (grande ? 18 : 0)) / (mx - mn);
  const pts = hist.map((h, k) => `${x(k).toFixed(1)},${y(h.preco).toFixed(1)}`).join(' ');
  const dots = hist.map((h, k) => `<circle cx="${x(k).toFixed(1)}" cy="${y(h.preco).toFixed(1)}" r="${grande ? 4 : (k === hist.length - 1 ? 2.5 : 0)}"><title>${esc(`${fmtData(h.data)} · nº ${h.numero} · ${h.fornecedor} · ${fmtMoeda(h.preco)}`)}</title></circle>`).join('');
  const eixo = grande ? `
    <text x="${PX - 6}" y="${y(mx) + 4}" text-anchor="end">${esc(fmtMoeda(mx))}</text>
    ${mx !== mn ? `<text x="${PX - 6}" y="${y(mn) + 4}" text-anchor="end">${esc(fmtMoeda(mn))}</text>` : ''}
    ${hist.map((h, k) => `<text x="${x(k).toFixed(1)}" y="${H - 2}" text-anchor="middle">${esc(fmtData(h.data).slice(0, 5))}</text>`).join('')}` : '';
  return `<svg class="graf-preco${grande ? ' grande' : ''}" viewBox="0 0 ${W} ${H}" width="${grande ? '100%' : W}" height="${H}" role="img" aria-label="Evolução do preço">
    ${hist.length > 1 ? `<polyline points="${pts}" />` : ''}${dots}${eixo}</svg>`;
}

/** Variação entre o último preço pago e o anterior. */
function variacaoPreco(hist) {
  if (hist.length < 2) return null;
  const a = hist[hist.length - 2].preco, b = hist[hist.length - 1].preco;
  return a > 0 ? b / a - 1 : null;
}

function setaVariacao(v) {
  if (v == null) return '';
  if (Math.abs(v) < 0.0005) return '<span class="var-preco">= igual</span>';
  return `<span class="var-preco ${v > 0 ? 'sobe' : 'desce'}">${v > 0 ? '↑' : '↓'} ${fmtPct(Math.abs(v))}</span>`;
}

/** Diferença acima da qual um preço é destacado (30%). */
const LIMITE_ALERTA = 0.3;

/**
 * Avisos de preço fora do normal para o preço `p` de um item: comparado com o último preço pago
 * e com a mediana dos preços dos fornecedores nesta cotação (quando há 3 ou mais preços).
 */
function alertasPreco(p, ultimo, precos) {
  const avisos = [];
  if (p == null) return avisos;
  if (ultimo && ultimo.preco > 0) {
    const d = p / ultimo.preco - 1;
    if (Math.abs(d) >= LIMITE_ALERTA) {
      avisos.push({ tipo: d > 0 ? 'alto' : 'baixo', curto: `${d > 0 ? '↑' : '↓'}${Math.round(Math.abs(d) * 100)}% vs último`,
        texto: `${d > 0 ? 'Acima' : 'Abaixo'} do último preço pago: ${fmtMoeda(ultimo.preco)} (${ultimo.fornecedor}, cotação nº ${ultimo.numero})` });
    }
  }
  const validos = precos.filter(x => x != null).sort((a, b) => a - b);
  if (validos.length >= 3) {
    const m = validos.length % 2 ? validos[(validos.length - 1) / 2] : (validos[validos.length / 2 - 1] + validos[validos.length / 2]) / 2;
    const d = p / m - 1;
    if (d >= 1 || d <= -0.5) {
      avisos.push({ tipo: d > 0 ? 'alto' : 'baixo', curto: d > 0 ? 'muito acima dos outros' : 'muito abaixo dos outros',
        texto: `${d > 0 ? 'Muito acima' : 'Muito abaixo'} dos outros fornecedores (mediana ${fmtMoeda(m)}). Confira se o valor foi digitado certo.` });
    }
  }
  return avisos;
}

function preencherModelo(tpl, c, f, extra = {}) {
  const cfg = db.config;
  const vars = {
    ...extra,
    fornecedor: f ? f.contato || f.nome : '',
    numero: c.numero,
    loja: cfg.loja,
    comprador: cfg.comprador,
    telefone: cfg.telefone,
    email: cfg.email,
    prazo: c.prazoResposta ? textoDataPrazo(c) : 'o prazo combinado',
    titulo: c.titulo || '',
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] || '' : m))
    .replace(/,\s*([!.])/g, '$1') // "Olá, !" quando não há nome
    .replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------- Excel: planilha para o fornecedor ---------------- */

const XL = {
  azul: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF253D83' } }, // azul da marca
  cinza: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } },
  amarelo: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
  verde: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } },
  borda: {
    top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  },
  moeda: '"R$" #,##0.00',
};

/**
 * Planilha da cotação no modelo "COTAÇÃO GERAL DISPPAR" (layout v4), igual à aba PLANILHA da
 * COTAÇÃO COMPLETA.xlsm depois da macro EXPORTAR:
 * linha 1: título, QTDE DE ITENS e data; linha 2: SEQ, CÓDIGO DO PRODUTO, SIMILAR, MARCA EXIGIDA,
 * QTD, DESCRIÇÃO, VALOR, MARCA; a partir da linha 3, os itens (QTD sempre 1, "INFORMAR MARCA").
 * `f` pode ser nulo: planilha genérica, sem fornecedor (a resposta é identificada ao importar).
 */
const PLANILHA_V4 = {
  titulo: 'FFA6CAEC', // Azul-escuro, Texto 2, 75% mais claro
  laranja: 'FFC04F15', // Laranja, Ênfase 2, 25% mais escuro
  cinza: 'FFE8E8E8', // Cinza, Plano de fundo 2
  cinzaEscuro: 'FFAEAEAE', // Cinza, Plano de fundo 2, 25% mais escuro
  azul: 'FF0F9ED5', // cabeçalho do estilo de tabela "Clara 12"
  fonte: 'Aptos Narrow',
};

async function gerarPlanilha(c, f) {
  const cfg = db.config;
  const T = PLANILHA_V4;
  const solido = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const fina = { style: 'thin', color: { argb: T.azul } };
  const wb = await novoLivroExcel();
  wb.creator = cfg.loja || 'Sistema de Cotação';
  wb.created = new Date();
  const ws = wb.addWorksheet('Cotação', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const HEADER = 2;
  const FIRST = 3;
  const n = c.itens.length;

  // linha 1: título, quantidade de itens e data
  ws.mergeCells('A1:E1');
  const titulo = ws.getCell('A1');
  titulo.value = (cfg.tituloPlanilha || DEFAULT_DB.config.tituloPlanilha).toUpperCase();
  titulo.font = { name: T.fonte, size: 18, bold: true, color: { argb: 'FF000000' } };
  titulo.fill = solido(T.titulo);
  titulo.alignment = { horizontal: 'center', vertical: 'middle' };
  titulo.border = { left: { style: 'medium' }, top: { style: 'medium' } };
  const lbl = ws.getCell('F1');
  lbl.value = 'QTDE DE ITENS:';
  lbl.font = { name: T.fonte, size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  lbl.fill = solido(T.laranja);
  lbl.alignment = { horizontal: 'left', vertical: 'middle' };
  lbl.border = { top: { style: 'medium' } };
  const qtd = ws.getCell('G1');
  qtd.value = n;
  qtd.font = { name: 'Calibri', size: 22, bold: true, italic: true, color: { argb: 'FFFF0000' } };
  qtd.fill = solido(T.cinza);
  qtd.alignment = { horizontal: 'center', vertical: 'middle' };
  qtd.border = { top: { style: 'medium' } };
  const data = ws.getCell('H1');
  const [ano, mes, dia] = (c.data || hojeISO()).split('-').map(Number);
  data.value = new Date(Date.UTC(ano, mes - 1, dia));
  data.numFmt = 'dd/mm/yyyy';
  data.font = { name: T.fonte, size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  data.fill = solido(T.laranja);
  data.alignment = { horizontal: 'center', vertical: 'middle' };
  data.border = { top: { style: 'medium' }, right: { style: 'medium' } };
  ws.getRow(1).height = 28.5;

  // linha 2: cabeçalho
  const cab = ['SEQ', 'CÓDIGO DO PRODUTO', 'SIMILAR', 'MARCA EXIGIDA', 'QTD', 'DESCRIÇÃO', 'VALOR', 'MARCA'];
  const centro = new Set([1, 5, 6, 7, 8]);
  cab.forEach((txt, k) => {
    const cell = ws.getRow(HEADER).getCell(k + 1);
    cell.value = txt;
    cell.font = { name: T.fonte, size: 11, bold: true, color: { argb: 'FF000000' } };
    cell.fill = solido(k >= 6 ? T.cinzaEscuro : T.azul);
    cell.alignment = { horizontal: centro.has(k + 1) ? 'center' : 'left' };
    cell.border = { top: fina, bottom: fina, left: k === 0 ? fina : undefined, right: k === 7 ? fina : undefined };
  });

  // itens (códigos repetidos em vermelho, como a formatação condicional da aba PLANILHA)
  const repetidos = parceirosCodigo(c.itens.map(it => it.codigo));
  c.itens.forEach((it, i) => {
    const r = FIRST + i;
    const row = ws.getRow(r);
    row.values = [String(i + 1), it.codigo || '', it.similar || '', it.marca || '', 1, it.descricao, null, 'INFORMAR MARCA'];
    for (let col = 1; col <= 8; col++) {
      const cell = row.getCell(col);
      cell.font = { name: T.fonte, size: 11, bold: col === 8, color: { argb: 'FF000000' } };
      cell.alignment = { horizontal: col === 1 || col === 5 ? 'center' : 'left' };
      if (col !== 3) cell.numFmt = '@';
      cell.border = { bottom: fina, left: col === 1 ? fina : undefined, right: col === 8 ? fina : undefined };
    }
    if (repetidos[i].length) row.getCell(2).font = { name: T.fonte, size: 11, bold: true, color: { argb: 'FFFF0000' } };
    row.getCell(7).fill = solido(T.cinza);
    row.getCell(8).fill = solido(T.cinzaEscuro);
    for (const col of [7, 8]) row.getCell(col).protection = { locked: false };
  });

  // larguras ajustadas ao conteúdo (a macro EXPORTAR faz "AutoAjuste" das colunas)
  const larguras = cab.map((h, k) => {
    let m = h.length;
    c.itens.forEach((it, i) => {
      const v = [String(i + 1), it.codigo || '', it.similar || '', it.marca || '', '1', it.descricao || '', '', 'INFORMAR MARCA'][k];
      m = Math.max(m, String(v).length);
    });
    return m + 2;
  });
  larguras[5] = Math.max(larguras[5], 16); // "QTDE DE ITENS:" em fonte 18
  larguras[6] = Math.max(larguras[6], 12);
  larguras[7] = Math.max(larguras[7], 18); // data em fonte 18
  ws.columns = larguras.map(width => ({ width: Math.min(width, 80) }));

  if (cfg.protegerPlanilha) {
    await ws.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true });
  }

  // Aba oculta usada para reconhecer a planilha quando o fornecedor devolver.
  const meta = wb.addWorksheet('_dados', { state: 'veryHidden' });
  [
    'sistema-cotacao', c.id, f ? f.fornecedorId : '', HEADER, FIRST, n, 0, c.numero, 4,
  ].forEach((v, i) => { meta.getCell(`A${i + 1}`).value = v; });

  return wb;
}

function nomePlanilha(c, f) {
  return f ? `Cotacao_${c.numero}_${slug(f.nome)}.xlsx` : `Cotacao_${c.numero}.xlsx`;
}

async function baixarPlanilha(c, fi) {
  const f = c.fornecedores[fi];
  const wb = await gerarPlanilha(c, f);
  await baixarWorkbook(wb, nomePlanilha(c, f));
}

/* ---------------- Excel: leitura da resposta ---------------- */

async function lerPlanilha(file) {
  const cab = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!(cab[0] === 0x50 && cab[1] === 0x4b)) {
    throw new Error(`O arquivo "${file.name}" não está no formato Excel .xlsx${cab[0] === 0xd0 ? ' (é o formato antigo .xls)' : ''}.\nAbra no Excel e use "Salvar como" → "Pasta de Trabalho do Excel (.xlsx)", depois importe de novo.`);
  }
  const wb = await novoLivroExcel();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch (e) {
    throw new Error(`Não consegui abrir "${file.name}". Abra no Excel, use "Salvar como" .xlsx e importe de novo.\n(detalhe técnico: ${e.message})`);
  }
  const m = wb.getWorksheet('_dados');
  let meta = null;
  if (m && cellTexto(m.getCell('A1')) === 'sistema-cotacao') {
    meta = {
      cotId: cellTexto(m.getCell('A2')),
      fornecedorId: cellTexto(m.getCell('A3')),
      header: Number(cellValue(m.getCell('A4'))),
      first: Number(cellValue(m.getCell('A5'))),
      n: Number(cellValue(m.getCell('A6'))),
      cond: Number(cellValue(m.getCell('A7'))),
      numero: cellTexto(m.getCell('A8')),
      versao: Number(cellValue(m.getCell('A9'))) || 1,
    };
  }
  const ws = wb.getWorksheet('Cotação') || wb.worksheets.find(w => w.name !== '_dados');
  return { meta, ws };
}

/** Aplica os preços lidos da planilha no fornecedor `fi` da cotação `c`. Retorna qtd de preços. */
let ignoradosNaImportacao = 0; // itens com preço 0,00 ou sem valor na última planilha importada

function aplicarResposta(c, fi, ws, meta) {
  let first = meta?.first;
  let cond = meta?.cond;
  let versao = meta?.versao || 0;
  if (!first) {
    // Planilha sem aba de controle: procura o cabeçalho "VALOR" (v2) ou "Preço Unit." (v1).
    for (let r = 1; r <= 60 && !first; r++) {
      // procura a linha de cabeçalho (coluna A = "Item"); a faixa de instruções também cita VALOR/preço
      if (/^seq$/i.test(cellTexto(ws.getCell(`A${r}`))) && /^valor$/i.test(cellTexto(ws.getCell(`G${r}`)))) { first = r + 1; versao = 4; continue; }
      if (!/^item$/i.test(cellTexto(ws.getCell(`A${r}`)))) continue;
      if (/^valor$/i.test(cellTexto(ws.getCell(`G${r}`)))) { first = r + 1; versao = 3; }
      else if (/^valor$/i.test(cellTexto(ws.getCell(`F${r}`)))) { first = r + 1; versao = 2; }
      else if (/^pre[çc]o unit/i.test(cellTexto(ws.getCell(`G${r}`)))) { first = r + 1; versao = 1; }
    }
    if (!first) throw new Error('Não encontrei a coluna VALOR nesta planilha.');
  }
  const colPreco = versao >= 3 ? 'G' : versao === 2 ? 'F' : 'G';
  const colMarca = versao >= 3 ? 'H' : versao === 2 ? 'G' : null;
  const respostas = {};
  let qtd = 0, ignorados = 0;
  const limite = meta?.n || c.itens.length;
  for (let k = 0; k < limite; k++) {
    const r = first + k;
    const idx = parseInt(cellTexto(ws.getCell(`A${r}`)), 10);
    const i = Number.isInteger(idx) && idx >= 1 && idx <= c.itens.length ? idx - 1 : k;
    if (i >= c.itens.length) break;
    const preco = parseNum(cellValue(ws.getCell(`${colPreco}${r}`)));
    let marca = colMarca ? cellTexto(ws.getCell(`${colMarca}${r}`)) : '';
    if (/^informar marca$/i.test(marca)) marca = ''; // o fornecedor não preencheu
    const prazo = versao >= 2 ? '' : cellTexto(ws.getCell(`I${r}`));
    const obs = versao >= 2 ? '' : cellTexto(ws.getCell(`J${r}`));
    // preço 0,00 ou sem valor não é resposta (o fornecedor às vezes preenche só a marca): desconsidera
    if (preco != null && preco > 0) { respostas[i] = { preco, marca, prazo, obs }; qtd++; }
    else if (marca || preco === 0) ignorados++;
  }
  ignoradosNaImportacao = ignorados;
  if (!cond) {
    for (let r = first + limite; r <= first + limite + 20; r++) {
      if (/pagamento/i.test(cellTexto(ws.getCell(`A${r}`)))) { cond = r; break; }
    }
  }
  const condicoes = {};
  if (cond) COND_CAMPOS.forEach(([k], j) => { condicoes[k] = cellTexto(ws.getCell(`D${cond + j}`)); });

  const f = c.fornecedores[fi];
  const antes = f.respostas || {};
  f.respostas = respostas;
  ajustarKaizen(c);
  // planilha nova do fornecedor com o preço corrigido: a diferença do item fica aceita com o valor novo
  c.itens.forEach((_, i) => {
    const velho = antes[i]?.preco;
    const novo = f.respostas[i]?.preco;
    if (velho > 0 && novo > 0 && Math.round(velho * 100) !== Math.round(novo * 100)) aceitarDifCorrigida(c, i);
  });
  f.cond = condicoes;
  f.respondidoEm = new Date().toISOString();
  salvar();
  return qtd;
}

/**
 * Importa uma planilha respondida. Devolve { cotacao, fornecedor, qtd } ou null se a pessoa cancelou;
 * erros são lançados (quem chama decide como avisar).
 */
async function importarRespostaArquivo(file, cotId, fiSugerido) {
  {
    const { meta, ws } = await lerPlanilha(file);
    if (!ws) throw new Error('Planilha vazia.');
    let c = cotId ? db.cotacoes.find(x => x.id === cotId) : null;
    if (meta) {
      const dona = db.cotacoes.find(x => x.id === meta.cotId);
      if (!dona) throw new Error(`Esta planilha é da cotação nº ${meta.numero}, que não existe mais neste sistema.`);
      if (c && dona.id !== c.id) {
        if (!(await confirmar(`Esta planilha pertence à cotação nº ${dona.numero}, não à nº ${c.numero}. Importar na cotação nº ${dona.numero}?`))) return;
      }
      c = dona;
    }
    if (!c) {
      const abertas = [...db.cotacoes].sort((a, b) => (b.data + b.numero).localeCompare(a.data + a.numero));
      if (!abertas.length) throw new Error('Não há cotações no sistema para receber esta planilha.');
      const id = await pedirValor(`Não consegui identificar a cotação da planilha "${file.name}". Escolha a cotação:`, {
        tipo: 'lista', ok: 'Importar',
        opcoes: abertas.map(x => ({ valor: x.id, texto: `Nº ${x.numero} · ${fmtData(x.data)}${x.titulo ? ' · ' + x.titulo : ''} · ${x.itens.length} itens` })),
      });
      if (!id) return;
      c = db.cotacoes.find(x => x.id === id);
    }

    let fi = fiSugerido;
    if (meta) {
      const idx = c.fornecedores.findIndex(f => f.fornecedorId === meta.fornecedorId);
      if (idx >= 0 && fi != null && idx !== fi) {
        if (!(await confirmar(`Esta planilha foi gerada para "${c.fornecedores[idx].nome}". Importar os preços para "${c.fornecedores[idx].nome}"?`))) return;
      }
      if (idx >= 0) fi = idx;
    }
    if (fi == null || !c.fornecedores[fi]) {
      // planilha geral da cotação: usa o nome escrito no campo "Fornecedor"; se estiver vazio, pergunta
      let nome = /forneced/i.test(cellTexto(ws.getCell('A7'))) ? cellTexto(ws.getCell('C7')) : '';
      if (!nome) {
        nome = await pedirValor(`De qual fornecedor é esta planilha (${file.name})?\nO campo "Fornecedor" veio em branco. Escolha um da lista ou digite um nome novo.`, {
          ok: 'Importar',
          opcoes: [...new Set([...c.fornecedores.map(x => x.nome), ...db.fornecedores.map(x => x.nome)])].sort(COLLATOR.compare),
        });
        if (!nome) return;
      }
      let fz = db.fornecedores.find(x => semAcento(x.nome) === semAcento(nome));
      if (!fz) { fz = { id: uid(), nome, contato: '', email: '', telefone: '', obs: '' }; db.fornecedores.push(fz); }
      fi = c.fornecedores.findIndex(x => x.fornecedorId === fz.id);
      if (fi < 0) { c.fornecedores.push(novoFornCot(fz)); fi = c.fornecedores.length - 1; }
    }
    if (fi == null || !c.fornecedores[fi]) throw new Error('Não consegui identificar o fornecedor. Abra a cotação e use o botão "Importar" na linha do fornecedor.');

    const f = c.fornecedores[fi];
    if (Object.keys(f.respostas || {}).length && !(await confirmar(`${f.nome} já tem preços lançados. Substituir pelos da planilha?`))) return;
    const qtd = aplicarResposta(c, fi, ws, meta);
    return { cotacao: c, fornecedor: f.nome, qtd, ignorados: ignoradosNaImportacao };
  }
}

async function importarResposta(file, cotId, fiSugerido) {
  try {
    const r = await importarRespostaArquivo(file, cotId, fiSugerido);
    if (!r) return;
    toast(`${r.qtd} preço(s) importado(s) de ${r.fornecedor}.${r.ignorados ? ` ${r.ignorados} item(ns) com preço 0,00 ou sem valor foram desconsiderados.` : ''}`, r.ignorados ? 6000 : 3500);
    ir('cotacao', r.cotacao.id);
    render();
  } catch (e) {
    console.error(e);
    avisar('Erro ao importar a planilha:\n' + e.message);
  }
}

/** Várias planilhas respondidas de uma vez: importa uma por uma e mostra um resumo no fim. */
async function importarRespostas(files, cotId = null) {
  if (files.length === 1) return importarResposta(files[0], cotId, null);
  const ok = [], falhas = [], canceladas = [];
  for (const file of files) {
    try {
      const r = await importarRespostaArquivo(file, cotId, null);
      if (r) ok.push({ ...r, arquivo: file.name }); else canceladas.push(file.name);
    } catch (e) {
      console.error(e);
      falhas.push({ arquivo: file.name, erro: e.message.split('\n')[0] });
    }
  }
  const cots = [...new Set(ok.map(r => r.cotacao))];
  if (cots.length === 1) ir('cotacao', cots[0].id);
  render();
  const linhas = [`${ok.length} de ${files.length} planilha(s) importada(s):`];
  for (const r of ok) linhas.push(`✓ ${r.fornecedor}: ${r.qtd} preço(s)${r.ignorados ? ` (${r.ignorados} com preço 0,00 ou sem valor desconsiderados)` : ''}${cots.length > 1 ? ` (cotação nº ${r.cotacao.numero})` : ''}`);
  for (const f of falhas) linhas.push(`✗ ${f.arquivo}: ${f.erro}`);
  for (const n of canceladas) linhas.push(`– ${n}: não importada (cancelada)`);
  await avisar(linhas.join('\n'));
}


/* ---------------- Excel: comparativo e produtos ---------------- */

async function exportarComparativo(c) {
  const { linhas, totais, melhor } = comparar(c);
  const wb = await novoLivroExcel();
  const ws = wb.addWorksheet('Comparativo', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const nf = c.fornecedores.length;
  const LJ = lojas();
  const ordem = ordemFornecedores(c);
  const cab = ['Item', 'Código', 'Descrição', 'Unid.', 'Qtd.', ...ordem.map(j => c.fornecedores[j].nome), 'Preço escolhido', 'Fornecedor', 'Total', '2º melhor preço', 'Dif. 1º × 2º', ...LJ.map(l => 'Qtd. ' + l.nome)];
  ws.columns = [6, 14, 44, 8, 10, ...c.fornecedores.map(() => 18), 16, 24, 18, 16, 12, ...LJ.map(() => 14)].map(width => ({ width }));

  ws.mergeCells(1, 1, 1, cab.length);
  ws.getCell('A1').value = `Comparativo da cotação nº ${c.numero}${c.titulo ? ' — ' + c.titulo : ''} (${fmtData(c.data)})`;
  ws.getCell('A1').font = { bold: true, size: 14 };

  const hr = ws.getRow(3);
  cab.forEach((t, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = t;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = XL.azul;
    cell.border = XL.borda;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  hr.height = 32;

  linhas.forEach((l, k) => {
    const row = ws.getRow(4 + k);
    row.values = [
      k + 1, l.it.codigo || '', l.it.descricao, l.it.unidade || '', l.q,
      ...ordem.map(j => l.precos[j] ?? ''),
      l.preco ?? '', l.vencedor >= 0 ? c.fornecedores[l.vencedor].nome + (l.manual ? ' (escolhido)' : '') : 'sem preço',
      l.preco != null ? l.preco * l.q : '',
      l.segundo ?? '', l.difSegundo ?? '',
      ...LJ.map(lj => qtdLoja(c, l.i, lj.id) || ''),
    ];
    for (let col = 1; col <= cab.length; col++) row.getCell(col).border = XL.borda;
    for (let k = 0; k < nf; k++) {
      const cell = row.getCell(6 + k);
      cell.numFmt = XL.moeda;
      if (ordem[k] === l.vencedor) { cell.fill = XL.verde; cell.font = { bold: true, color: { argb: 'FF1E7B4A' } }; }
    }
    row.getCell(6 + nf).numFmt = XL.moeda;
    row.getCell(8 + nf).numFmt = XL.moeda;
    row.getCell(9 + nf).numFmt = XL.moeda;
    row.getCell(10 + nf).numFmt = '0.0%';
    row.getCell(3).alignment = { wrapText: true };
  });

  const tr = ws.getRow(4 + linhas.length);
  tr.getCell(3).value = 'TOTAL (itens cotados)';
  totais.forEach((t, j) => { tr.getCell(6 + j).value = t.total; tr.getCell(6 + j).numFmt = XL.moeda; });
  tr.getCell(8 + nf).value = melhor;
  tr.getCell(8 + nf).numFmt = XL.moeda;
  tr.font = { bold: true };
  for (let col = 1; col <= cab.length; col++) { tr.getCell(col).fill = XL.cinza; tr.getCell(col).border = XL.borda; }

  const ir = ws.getRow(5 + linhas.length);
  ir.getCell(3).value = 'Itens cotados / itens ganhos';
  totais.forEach((t, j) => { ir.getCell(6 + j).value = `${t.cotados}/${linhas.length} · ${t.vencidos} ganho(s)`; });

  let r = 7 + linhas.length;
  for (const [k, label] of COND_CAMPOS) {
    ws.getRow(r).getCell(3).value = label;
    ws.getRow(r).getCell(3).font = { bold: true };
    c.fornecedores.forEach((f, j) => { ws.getRow(r).getCell(6 + j).value = f.cond?.[k] || ''; });
    r++;
  }
  ws.views = [{ state: 'frozen', ySplit: 3, xSplit: 3 }];
  await baixarWorkbook(wb, `Comparativo_${c.numero}.xlsx`);
}

/* ---------------- Excel: pedidos de compra ---------------- */

/**
 * Itens que cada fornecedor ganhou: [{ fi, f, itens: [{ it, i, preco, marca, qtd, qtds }], total }].
 * Com `lojaId`, só as quantidades daquela loja. Itens com quantidade 0 não entram.
 */
/** Quantidade comprada de fato do item: a das lojas em que ele NÃO está em Dúvidas (a mesma conta do pedido exportado). */
function qtdComprada(c, l, porLoja = temQtdLojas(c)) {
  if (!l.duvida) return l.q;
  return porLoja ? lojas().reduce((s, lj) => s + (l.duvida.has(lj.id) ? 0 : qtdLoja(c, l.i, lj.id)), 0) : 0;
}

function pedidosPorFornecedor(c, lojaId = null) {
  const { linhas, porLoja } = comparar(c);
  const LJ = lojas();
  return c.fornecedores.map((f, fi) => {
    const itens = linhas.filter(l => l.vencedor === fi).map(l => {
      // item em Dúvidas: fica fora do pedido da loja da dúvida até sair da fila
      const qtds = Object.fromEntries(LJ.map(lj => [lj.id, l.duvida?.has(lj.id) ? 0 : qtdLoja(c, l.i, lj.id)]));
      const soma = !l.duvida ? l.q : porLoja ? LJ.reduce((s, lj) => s + qtds[lj.id], 0) : 0;
      return {
        it: l.it, i: l.i, preco: l.preco, marca: marcaPedido(l.it.marca, f.respostas?.[l.i]?.marca, l.marcas[fi]),
        qtds, qtd: lojaId ? qtds[lojaId] : soma,
      };
    }).filter(x => x.qtd > 0);
    return { fi, f, itens, porLoja, total: itens.reduce((s, x) => s + x.preco * x.qtd, 0) };
  }).filter(p => p.itens.length);
}

/** Marca que vai no pedido: a pedida por extenso quando a resposta é ela (ou abreviação dela). */
function marcaPedido(pedida, resposta, status) {
  if ((status === 'ok' || status === 'abrev') && opcoesMarca(pedida).length === 1) return opcoesMarca(pedida)[0];
  return resposta || pedida || '';
}

const colLetra = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/**
 * Monta uma aba "Pedido de compra" para um fornecedor.
 * `loja`: pedido só daquela loja (endereço de entrega dela). Sem loja e com quantidades por loja,
 * o pedido traz uma coluna de quantidade para cada loja.
 */
function abaPedido(wb, c, ped, nomeAba, loja = null, { somada = false } = {}) {
  // formato combinado com a loja: título, tabela direto (sem bloco de dados), itens em ordem de descrição
  const itens = [...ped.itens].sort((a, b) => COLLATOR.compare(a.it.descricao || '', b.it.descricao || ''));
  const LJ = lojas();
  const colunasLoja = !loja && ped.porLoja;
  const cols = [
    { h: 'Item', v: x => x.i + 1, centro: true, larg: 5.1 }, // mesmo nº da planilha enviada aos fornecedores
    { h: 'Código', v: x => x.it.codigo || '', larg: 18 },
    { h: 'Similar', v: x => x.it.similar || '', larg: 15.1 },
    ...(colunasLoja
      ? LJ.map(lj => ({ h: 'QTD ' + lj.nome, v: x => x.qtds[lj.id] || '', centro: true, larg: 9 }))
      : []),
    { h: colunasLoja ? 'QTD TOTAL' : 'QTD', v: x => x.qtd, centro: true, qtd: true, larg: colunasLoja ? 7 : 4.7 },
    { h: 'Marca', v: x => x.marca, larg: 10.7 },
    { h: 'Descrição', v: x => x.it.descricao, larg: 31.6, quebra: true },
    { h: 'Valor unit.', v: x => x.preco, moeda: true, preco: true, larg: 10.3 },
    { h: 'Total', total: true, moeda: true, larg: 12.7 },
  ];
  const N = cols.length;
  const ULT = colLetra(N);
  const cQtd = colLetra(cols.findIndex(x => x.qtd) + 1);
  const cPreco = colLetra(cols.findIndex(x => x.preco) + 1);
  const ws = wb.addWorksheet(nomeAba, {
    pageSetup: { orientation: N > 9 ? 'landscape' : 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.mergeCells(`A1:${ULT}1`);
  const titulo = ws.getCell('A1');
  titulo.value = loja ? (somada ? `PEDIDO DE COMPRA — ENTREGA EM ${loja.nome.toUpperCase()}` : `PEDIDO DE COMPRA — ${loja.nome.toUpperCase()}`) : 'PEDIDO DE COMPRA';
  titulo.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titulo.fill = XL.azul;
  titulo.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 21;

  const HEADER = 2;
  const FIRST = HEADER + 1;
  const hr = ws.getRow(HEADER);
  cols.forEach((col, k) => {
    const cell = hr.getCell(k + 1);
    cell.value = col.h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = XL.azul;
    cell.border = XL.borda;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  itens.forEach((x, k) => {
    const n = FIRST + k;
    const row = ws.getRow(n);
    cols.forEach((col, j) => {
      const cell = row.getCell(j + 1);
      cell.value = col.total ? { formula: `${cQtd}${n}*${cPreco}${n}`, result: x.preco * x.qtd } : col.v(x, k);
      cell.border = XL.borda;
      cell.alignment = { vertical: 'middle', horizontal: col.centro ? 'center' : undefined, wrapText: col.quebra || undefined };
      if (col.moeda) cell.numFmt = XL.moeda;
    });
  });

  const LAST = FIRST + itens.length - 1;
  const TOTAL = LAST + 1;
  const penult = colLetra(N - 1);
  ws.mergeCells(`A${TOTAL}:${penult}${TOTAL}`);
  ws.getCell(`A${TOTAL}`).value = `TOTAL DO PEDIDO (${itens.length} ${itens.length === 1 ? 'item' : 'itens'})`;
  ws.getCell(`A${TOTAL}`).alignment = { horizontal: 'right' };
  ws.getCell(`${ULT}${TOTAL}`).value = { formula: `SUM(${ULT}${FIRST}:${ULT}${LAST})`, result: ped.total };
  ws.getCell(`${ULT}${TOTAL}`).numFmt = XL.moeda;
  for (const col of ['A', ULT]) {
    ws.getCell(`${col}${TOTAL}`).font = col === ULT ? { bold: true, size: 14, color: { argb: 'FFFF0000' } } : { bold: true };
    ws.getCell(`${col}${TOTAL}`).fill = XL.cinza;
    ws.getCell(`${col}${TOTAL}`).border = XL.borda;
  }

  ws.columns = cols.map(col => ({ width: col.larg }));
  ws.views = [{ state: 'frozen', ySplit: HEADER }];
  return ws;
}

function nomePedido(c, f, loja) {
  return `Pedido_${c.numero}_${slug(f.nome)}${loja ? '_' + slug(loja.nome) : ''}.xlsx`;
}

/**
 * Baixa pedidos. fi: só daquele fornecedor (sem fi: todos, uma aba por fornecedor).
 * lojaId: só as quantidades daquela loja.
 */
/**
 * Pedido do fornecedor fi exportado. lojaId = null: o pedido inteiro (lojas juntas/somada) -> concluída.
 * Com loja: anota a loja; quando todas as lojas em que ele tem itens foram exportadas -> concluída.
 */
function anotarPedidoExportado(c, fi, lojaId = null) {
  const f = c.fornecedores[fi];
  if (!f) return;
  const agora = new Date().toISOString();
  if (lojaId) {
    f.exportadoLojas = { ...(f.exportadoLojas || {}), [lojaId]: agora };
    const lojasComItens = lojas().filter(lj => pedidosPorFornecedor(c, lj.id).some(p => p.fi === fi)).map(lj => lj.id);
    if (!lojasComItens.every(id => f.exportadoLojas[id])) return;
  }
  f.concluidoEm = f.concluidoEm || agora;
}

async function baixarPedidos(c, fi = null, lojaId = null) {
  const loja = lojaId ? lojas().find(l => l.id === lojaId) : null;
  const peds = pedidosPorFornecedor(c, lojaId).filter(p => fi == null || p.fi === fi);
  if (!peds.length) {
    avisar(loja ? `Não há itens com quantidade para ${loja.nome}${fi != null ? ' neste fornecedor' : ''}.` : 'Nenhum item com quantidade foi ganho por este fornecedor.');
    return;
  }
  const wb = await novoLivroExcel();
  wb.creator = db.config.loja || 'Sistema de Cotação';
  wb.created = new Date();
  const usados = new Set();
  for (const p of peds) {
    // nome da aba: até 31 caracteres, sem caracteres proibidos, sem repetir
    let base = p.f.nome.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Fornecedor';
    let nome = base, n = 2;
    while (usados.has(nome.toLowerCase())) nome = `${base.slice(0, 26)} ${n++}`;
    usados.add(nome.toLowerCase());
    abaPedido(wb, c, p, nome, loja);
  }
  const arquivo = fi != null ? nomePedido(c, peds[0].f, loja) : `Pedidos_${c.numero}${loja ? '_' + slug(loja.nome) : ''}.xlsx`;
  if (!(await baixarWorkbook(wb, arquivo))) return;
  // exportou: a cotação desses fornecedores fica concluída (por loja, quando todas as lojas saírem)
  const antes = peds.filter(p => !p.f.concluidoEm).length;
  for (const p of peds) anotarPedidoExportado(c, p.fi, lojaId);
  const agora = peds.filter(p => p.f.concluidoEm).length - (peds.length - antes);
  salvar();
  render();
  if (agora) toast(`${agora} fornecedor(es) marcado(s) como concluído(s).`);
}

/* ---------------- NF-e: conferência do recebimento ---------------- */

const soDigitos = v => String(v || '').replace(/\D/g, '');
const normCod = v => semAcento(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
const semZeros = v => v.replace(/^0+(?=.)/, '');
const fmtCnpj = v => {
  const d = soDigitos(v);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d;
};
/** Diferença de preço tolerada (arredondamento): 0,5% ou R$ 0,02. */
const tolPreco = p => Math.max(0.02, p * 0.005);

/** Lê o XML de uma NF-e (modelo 55, com ou sem nfeProc). */
function lerNFe(texto, nomeArquivo) {
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`"${nomeArquivo}" não é um XML válido.`);
  const inf = doc.getElementsByTagName('infNFe')[0];
  if (!inf) throw new Error(`"${nomeArquivo}" não é o XML de uma NF-e (não encontrei a tag infNFe).`);
  const um = (el, tag) => el?.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
  const num = v => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
  const tag = t => inf.getElementsByTagName(t)[0];
  const ide = tag('ide'), emit = tag('emit'), dest = tag('dest'), tot = tag('ICMSTot');
  const itens = [...inf.getElementsByTagName('det')].map(det => {
    const prod = det.getElementsByTagName('prod')[0];
    const imp = det.getElementsByTagName('imposto')[0];
    return {
      n: Number(det.getAttribute('nItem')) || 0,
      cProd: um(prod, 'cProd'), ean: um(prod, 'cEAN'), xProd: um(prod, 'xProd'), un: um(prod, 'uCom'),
      q: num(um(prod, 'qCom')), vUn: num(um(prod, 'vUnCom')), vProd: num(um(prod, 'vProd')), vDesc: num(um(prod, 'vDesc')),
      vIPI: num(um(imp, 'vIPI')), vST: num(um(imp, 'vICMSST')), xPed: um(prod, 'xPed'), infAd: um(det, 'infAdProd'),
    };
  });
  if (!itens.length) throw new Error(`A nota "${nomeArquivo}" não tem itens.`);
  return {
    chave: (inf.getAttribute('Id') || '').replace(/^NFe/, ''),
    numero: um(ide, 'nNF'), serie: um(ide, 'serie'), emissao: (um(ide, 'dhEmi') || um(ide, 'dEmi')).slice(0, 10),
    emitente: { cnpj: soDigitos(um(emit, 'CNPJ') || um(emit, 'CPF')), nome: um(emit, 'xNome'), fantasia: um(emit, 'xFant') },
    dest: { cnpj: soDigitos(um(dest, 'CNPJ') || um(dest, 'CPF')), nome: um(dest, 'xNome') },
    total: num(um(tot, 'vNF')), totalProdutos: num(um(tot, 'vProd')), frete: num(um(tot, 'vFrete')),
    itens,
  };
}

/** Preço unitário efetivo de uma linha da nota (com desconto, sem impostos). */
const precoLinhaNF = x => (x.q ? (x.vProd - (x.vDesc || 0)) / x.q : x.vUn);

const PALAVRAS_EMPRESA = new Set(['LTDA', 'EIRELI', 'COMERCIO', 'COM', 'DISTRIBUIDORA', 'DISTRIBUIDOR', 'DISTRIBUICAO', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'AUTO', 'AUTOPECAS', 'PECAS', 'ME', 'EPP', 'SA', 'IMPORTACAO', 'EXPORTACAO', 'IND', 'INDUSTRIA', 'E', 'ATACADO', 'VAREJO', 'LTD']);
const palavrasNome = v => normMarca(v).split(' ').filter(w => w.length >= 3 && !PALAVRAS_EMPRESA.has(w));

/** Fornecedor do cadastro que emitiu a nota: pelo CNPJ ou por palavras do nome. */
function acharFornecedorNFe(nf) {
  const cnpj = nf.emitente.cnpj;
  const porCnpj = cnpj && db.fornecedores.find(f => soDigitos(f.cnpj) === cnpj);
  if (porCnpj) return porCnpj;
  const alvo = new Set([...palavrasNome(nf.emitente.nome), ...palavrasNome(nf.emitente.fantasia)]);
  const pontos = db.fornecedores.map(f => [f, palavrasNome(f.nome).filter(w => alvo.has(w)).length]).filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1]);
  if (pontos.length && (pontos.length === 1 || pontos[0][1] > pontos[1][1])) return pontos[0][0];
  return null;
}

/** Cotações (não canceladas) com pedido de compra para o fornecedor, da mais recente para a mais antiga. */
function cotacoesComPedido(fornecedorId) {
  return db.cotacoes.filter(c => c.status !== 'cancelada' && pedidosPorFornecedor(c).some(p => p.f.fornecedorId === fornecedorId))
    .sort((a, b) => (b.data + b.numero).localeCompare(a.data + a.numero));
}

function codigosItem(it) {
  const brutos = [it.codigo, it.codigoArquivo, it.codigoCadastro, ...String(it.similar || '').split(/[\s,;|]+/)];
  return [...new Set(brutos.flatMap(v => [v, ...String(v || '').split(/[\/,;|]+/)]).map(normCod).filter(t => t.length >= 3))];
}

/** Liga uma linha da nota a um item da cotação: vínculo aprendido, código, código parecido ou descrição. */
function casarItemNFe(c, fornCad, x, noPedido) {
  const k = normCod(x.cProd);
  const preferir = lista => lista.find(i => noPedido.has(i)) ?? lista[0];
  const vinc = fornCad?.codigosNfe?.[k];
  if (vinc) {
    const i = c.itens.findIndex(it => it.produtoId === vinc);
    if (i >= 0) return { idx: i, como: 'aprendido' };
  }
  if (k.length >= 3) {
    const exatos = c.itens.map((it, i) => (codigosItem(it).some(t => t === k || semZeros(t) === semZeros(k)) ? i : -1)).filter(i => i >= 0);
    if (exatos.length) return { idx: preferir(exatos), como: 'codigo' };
    if (k.length >= 5) {
      const parecidos = c.itens.map((it, i) => (codigosItem(it).some(t => t.length >= 5 && (k.includes(t) || t.includes(k))) ? i : -1)).filter(i => i >= 0);
      if (parecidos.length) return { idx: preferir(parecidos), como: 'parecido' };
    }
  }
  // pela descrição: palavras em comum
  const pal = v => new Set(normMarca(v).split(' ').filter(w => w.length >= 3));
  const a = pal(x.xProd);
  const notas = c.itens.map((it, i) => {
    const b = pal(it.descricao);
    const comum = [...a].filter(w => b.has(w)).length;
    return [i, comum / Math.max(1, Math.min(a.size, b.size))];
  }).filter(([, sc]) => sc >= 0.6).sort((p, q) => q[1] - p[1] || (noPedido.has(q[0]) - noPedido.has(p[0])));
  if (notas.length && (notas.length === 1 || notas[0][1] > notas[1][1] || noPedido.has(notas[0][0]))) return { idx: notas[0][0], como: 'descricao' };
  return { idx: -1, como: '' };
}

/** Itens do pedido (fornecedor + loja) com as quantidades pedidas. */
function itensPedido(c, fornecedorId, lojaId) {
  const ped = pedidosPorFornecedor(c, lojaId).find(p => p.f.fornecedorId === fornecedorId);
  return ped ? ped.itens : [];
}

/** Compara uma nota com o pedido. */
function conferirNFe(c, rec) {
  const pedido = itensPedido(c, rec.fornecedorId, rec.lojaId);
  const noPedido = new Map(pedido.map(p => [p.i, p]));
  const outras = (c.recebimentos || []).filter(r => r.id !== rec.id && r.fornecedorId === rec.fornecedorId && (r.lojaId || null) === (rec.lojaId || null));
  const qtdOutras = i => outras.reduce((s, r) => s + r.itens.filter(x => x.idx === i).reduce((t, x) => t + x.q, 0), 0);
  const porItem = new Map();
  const naoPedidos = [];
  rec.itens.forEach((x, k) => {
    if (x.idx >= 0 && noPedido.has(x.idx)) {
      if (!porItem.has(x.idx)) porItem.set(x.idx, []);
      porItem.get(x.idx).push({ ...x, k });
    } else naoPedidos.push({ ...x, k, deOutro: x.idx >= 0 });
  });
  const linhas = pedido.map(p => {
    const nfs = porItem.get(p.i) || [];
    const antes = qtdOutras(p.i);
    const esperado = Math.max(0, p.qtd - antes);
    const qNF = nfs.reduce((s, x) => s + x.q, 0);
    const valorNF = nfs.reduce((s, x) => s + x.vProd - (x.vDesc || 0), 0);
    const precoNF = qNF ? valorNF / qNF : null;
    const sit = [];
    let cobrar = 0;
    if (!nfs.length) sit.push(esperado ? 'nao-veio' : 'outra-nota');
    else {
      const d = precoNF - p.preco;
      if (d > tolPreco(p.preco)) { sit.push('preco-maior'); cobrar = d * qNF; }
      else if (d < -tolPreco(p.preco)) sit.push('preco-menor');
      if (qNF < esperado) sit.push('faltou');
      else if (qNF > esperado) sit.push('a-mais');
      if (!sit.length) sit.push('ok');
    }
    const marcaNaNota = p.marca && nfs.some(x => normMarca(`${x.xProd} ${x.infAd}`).split(' ').some(w => opcoesMarca(p.marca).some(o => o === w || o.replace(/ /g, '') === w)));
    return { p, nfs, antes, esperado, qNF, precoNF, sit, cobrar, marcaNaNota };
  });
  const resumo = {
    ok: linhas.filter(l => l.sit[0] === 'ok').length,
    precoMaior: linhas.filter(l => l.sit.includes('preco-maior')).length,
    precoMenor: linhas.filter(l => l.sit.includes('preco-menor')).length,
    qtd: linhas.filter(l => l.sit.includes('faltou') || l.sit.includes('a-mais')).length,
    naoVeio: linhas.filter(l => l.sit.includes('nao-veio')).length,
    naoPedidos: naoPedidos.length,
    cobrar: linhas.reduce((s, l) => s + l.cobrar, 0),
    valorNaoPedidos: naoPedidos.reduce((s, x) => s + x.vProd - (x.vDesc || 0), 0),
  };
  resumo.divergencias = resumo.precoMaior + resumo.qtd + resumo.naoVeio + resumo.naoPedidos;
  return { linhas, naoPedidos, resumo };
}

/** Situação do recebimento de um pedido (fornecedor + loja). */
function situacaoRecebimento(c, fornecedorId, lojaId) {
  const recs = (c.recebimentos || []).filter(r => r.fornecedorId === fornecedorId && (r.lojaId || null) === (lojaId || null));
  if (!recs.length) return { estado: 'pendente', recs };
  const pedido = itensPedido(c, fornecedorId, lojaId);
  const recebido = i => recs.reduce((s, r) => s + r.itens.filter(x => x.idx === i).reduce((t, x) => t + x.q, 0), 0);
  const faltando = pedido.filter(p => recebido(p.i) < p.qtd).length;
  const confs = recs.map(r => conferirNFe(c, r));
  const precoOuExtra = confs.some(x => x.resumo.precoMaior || x.resumo.naoPedidos);
  const cobrar = confs.reduce((s, x) => s + x.resumo.cobrar, 0);
  return { estado: precoOuExtra ? 'divergencia' : faltando ? 'parcial' : 'recebido', recs, faltando, cobrar };
}

const ESTADO_REC = {
  pendente: ['aguardando nota', ''],
  recebido: ['✓ recebido', 'ok'],
  parcial: ['parcial', 'warn'],
  divergencia: ['⚠ divergência', 'danger'],
};

const SIT_NF = {
  ok: ['✓ OK', 'ok'],
  'preco-maior': ['⚠ preço acima', 'danger'],
  'preco-menor': ['preço abaixo', 'blue'],
  faltou: ['⚠ veio menos', 'warn'],
  'a-mais': ['⚠ veio a mais', 'warn'],
  'nao-veio': ['✗ não veio', 'danger'],
  'outra-nota': ['veio em outra nota', ''],
};

async function importarNFes(files, cotId = null, fiSugerido = null) {
  for (const file of files) {
    try {
      await importarNFe(file, cotId, fiSugerido);
    } catch (e) {
      console.error(e);
      await avisar('Erro ao importar a nota:\n' + e.message);
    }
  }
}

async function importarNFe(file, cotId, fiSugerido) {
  const nf = lerNFe(await file.text(), file.name);
  const rotuloNF = `NF-e nº ${nf.numero} de ${nf.emitente.fantasia || nf.emitente.nome} (${fmtCnpj(nf.emitente.cnpj)})`;
  let c = cotId ? db.cotacoes.find(x => x.id === cotId) : null;

  // 1. fornecedor
  let fornCad = null;
  if (c && fiSugerido != null && c.fornecedores[fiSugerido]) fornCad = db.fornecedores.find(f => f.id === c.fornecedores[fiSugerido].fornecedorId);
  if (!fornCad) fornCad = acharFornecedorNFe(nf);
  if (!fornCad) {
    const comPedido = db.fornecedores.filter(f => cotacoesComPedido(f.id).length).sort((a, b) => COLLATOR.compare(a.nome, b.nome));
    if (!comPedido.length) throw new Error('Não há pedidos de compra no sistema para conferir esta nota.');
    const id = await pedirValor(`${rotuloNF}\nDe qual fornecedor do cadastro é esta nota? (o CNPJ fica salvo para as próximas)`, {
      tipo: 'lista', ok: 'Continuar', opcoes: comPedido.map(f => ({ valor: f.id, texto: f.nome })),
    });
    if (!id) return;
    fornCad = db.fornecedores.find(f => f.id === id);
  }
  if (nf.emitente.cnpj && !soDigitos(fornCad.cnpj)) fornCad.cnpj = fmtCnpj(nf.emitente.cnpj);

  // 2. cotação
  if (!c || !pedidosPorFornecedor(c).some(p => p.f.fornecedorId === fornCad.id)) {
    const cands = cotacoesComPedido(fornCad.id);
    if (!cands.length) throw new Error(`Não achei pedido de compra para ${fornCad.nome}. Confira se ele ganhou itens com quantidade em alguma cotação.`);
    const peloPedido = cands.find(x => nf.itens.some(i => i.xPed && soDigitos(i.xPed) && semZeros(soDigitos(i.xPed)) === semZeros(soDigitos(x.numero))));
    c = peloPedido || (cands.length === 1 ? cands[0] : null);
    if (!c) {
      const id = await pedirValor(`${rotuloNF}\nDe qual cotação é o pedido desta nota?`, {
        tipo: 'lista', ok: 'Conferir', opcoes: cands.map(x => ({ valor: x.id, texto: `Nº ${x.numero} · ${fmtData(x.data)}${x.titulo ? ' · ' + x.titulo : ''}` })),
      });
      if (!id) return;
      c = db.cotacoes.find(x => x.id === id);
    }
  }

  // 3. loja
  let lojaId = null;
  if (comparar(c).porLoja) {
    const LJ = lojas();
    const porCnpj = nf.dest.cnpj && LJ.find(l => soDigitos(l.cnpj) === nf.dest.cnpj);
    if (porCnpj) lojaId = porCnpj.id;
    else if (LJ.length === 1) lojaId = LJ[0].id;
    else {
      const v = await pedirValor(`${rotuloNF}\nPara qual loja é esta nota? (destinatário: ${nf.dest.nome || '—'} ${fmtCnpj(nf.dest.cnpj)})\nCadastre o CNPJ das lojas em Configurações para o sistema reconhecer sozinho.`, {
        tipo: 'lista', ok: 'Conferir', opcoes: [...LJ.map(l => ({ valor: l.id, texto: l.nome })), { valor: '*', texto: 'As lojas juntas (um pedido só)' }],
      });
      if (!v) return;
      lojaId = v === '*' ? null : v;
    }
  }

  // 4. nota repetida
  const ja = (c.recebimentos || []).find(r => r.nf.chave && r.nf.chave === nf.chave);
  if (ja && !(await confirmar(`A NF-e nº ${nf.numero} já foi conferida nesta cotação. Conferir de novo (substitui a anterior)?`))) return;

  const noPedido = new Set(itensPedido(c, fornCad.id, lojaId).map(p => p.i));
  const { itens, ...cab } = nf;
  const rec = {
    id: ja ? ja.id : uid(), fornecedorId: fornCad.id, lojaId, importadoEm: new Date().toISOString(), nf: cab,
    itens: itens.map(x => ({ ...x, ...casarItemNFe(c, fornCad, x, noPedido) })),
  };
  c.recebimentos = [...(c.recebimentos || []).filter(r => r.id !== rec.id), rec];
  salvar();
  ir('cotacao', c.id);
  ui.conferindo = { cotId: c.id, recId: rec.id };
  render();
  $('#painelNFe')?.scrollIntoView({ behavior: 'smooth' });
  const { resumo } = conferirNFe(c, rec);
  toast(resumo.divergencias ? `NF-e nº ${nf.numero}: ${resumo.divergencias} divergência(s).` : `NF-e nº ${nf.numero} confere com o pedido.`);
}

function nomeLojaRec(rec) {
  if (!rec.lojaId) return '';
  return lojas().find(l => l.id === rec.lojaId)?.nome || '';
}

/** Painel da conferência de uma nota. */
function painelNFe(c, rec) {
  const f = c.fornecedores.find(x => x.fornecedorId === rec.fornecedorId);
  const { linhas, naoPedidos, resumo } = conferirNFe(c, rec);
  const pedido = itensPedido(c, rec.fornecedorId, rec.lojaId);
  const chip = k => `<span class="badge ${SIT_NF[k][1]}">${SIT_NF[k][0]}</span>`;
  const comoTxt = { aprendido: 'vínculo salvo', codigo: 'pelo código', parecido: 'código parecido — confira', descricao: 'pela descrição — confira', manual: 'vinculado por você' };
  const loja = nomeLojaRec(rec);
  const opcoesVinc = sel => `<option value="">Vincular a um item do pedido…</option>${pedido.map(p => `<option value="${p.i}" ${sel === p.i ? 'selected' : ''}>${esc([p.it.codigo, p.it.descricao].filter(Boolean).join(' · '))}</option>`).join('')}`;
  return `
  <section class="card" id="painelNFe">
    <div class="row-between">
      <h3>Conferência da NF-e nº ${esc(rec.nf.numero)}${loja ? ' · ' + esc(loja) : ''}</h3>
      <div class="row">
        ${resumo.divergencias ? '<button class="sm" data-act="copiarCobranca" title="Texto para mandar ao fornecedor">⧉ Copiar texto para o fornecedor</button><button class="sm" data-act="exportarDivergencias">⬇ Divergências (Excel)</button>' : ''}
        <button class="sm danger" data-act="excluirNFe">Excluir conferência</button>
        <button class="sm" data-act="fecharNFe">Fechar</button>
      </div>
    </div>
    <p class="muted small" style="margin:0 0 8px">${esc(rec.nf.emitente.nome)} · CNPJ ${esc(fmtCnpj(rec.nf.emitente.cnpj))} · emitida em ${fmtData(rec.nf.emissao)} · valor da nota ${fmtMoeda(rec.nf.total)}${rec.nf.frete ? ` (frete ${fmtMoeda(rec.nf.frete)})` : ''} · pedido de <b>${esc(f?.nome || '')}</b></p>
    <div class="stats">
      <div class="stat"><span class="muted small">Itens conferidos</span><b>${linhas.length}</b><span class="small muted">${resumo.ok} OK</span></div>
      <div class="stat${resumo.precoMaior ? ' stat-ruim' : ''}"><span class="muted small">Preço acima do cotado</span><b>${resumo.precoMaior}</b><span class="small">${resumo.cobrar ? 'a cobrar ' + fmtMoeda(resumo.cobrar) : ''}</span></div>
      <div class="stat${resumo.qtd ? ' stat-atencao' : ''}"><span class="muted small">Quantidade diferente</span><b>${resumo.qtd}</b></div>
      <div class="stat${resumo.naoVeio ? ' stat-ruim' : ''}"><span class="muted small">Não vieram</span><b>${resumo.naoVeio}</b></div>
      <div class="stat${resumo.naoPedidos ? ' stat-atencao' : ''}"><span class="muted small">Na nota, mas não pedidos</span><b>${resumo.naoPedidos}</b><span class="small">${resumo.valorNaoPedidos ? fmtMoeda(resumo.valorNaoPedidos) : ''}</span></div>
    </div>
    <div class="table-wrap"><table class="tab-nfe">
      <thead><tr><th>Situação</th><th>Item do pedido</th><th>Na nota</th><th class="r">Qtd. pedida</th><th class="r">Qtd. na nota</th><th class="r">Preço cotado</th><th class="r">Preço na nota</th><th class="r">A cobrar</th></tr></thead>
      <tbody>${linhas.map(l => `<tr class="${l.sit[0] === 'ok' || l.sit[0] === 'outra-nota' ? '' : 'nfe-div'}">
        <td>${l.sit.map(chip).join(' ')}</td>
        <td>${esc(l.p.it.descricao)}<br><span class="small muted">${esc(l.p.it.codigo || '')}</span>${l.p.marca ? ` <span class="marca-pedida">${esc(l.p.marca)}</span>` : ''}</td>
        <td>${l.nfs.length ? l.nfs.map(x => `<span class="small"><b>${esc(x.cProd)}</b> ${esc(x.xProd)}</span><br><span class="small muted">${esc(comoTxt[x.como] || '')}</span> <button class="link small" data-act="desvincularNFe" data-k="${x.k}" title="Não é este item">desvincular</button>`).join('<br>') : '<span class="muted">—</span>'}
          ${l.nfs.length && l.p.marca && opcoesMarca(l.p.marca).length === 1 ? (l.marcaNaNota ? '<br><span class="chip-marca ok">✓ marca na descrição da nota</span>' : '<br><span class="chip-marca sem">marca não aparece na nota</span>') : ''}</td>
        <td class="r">${fmtNum(l.esperado)}${l.antes ? `<br><span class="small muted">${fmtNum(l.antes)} em outra nota</span>` : ''}</td>
        <td class="r">${l.nfs.length ? fmtNum(l.qNF) : '—'}</td>
        <td class="r">${fmtMoeda(l.p.preco)}</td>
        <td class="r">${l.precoNF != null ? fmtMoeda(l.precoNF) : '—'}${l.precoNF != null && Math.abs(l.precoNF - l.p.preco) > tolPreco(l.p.preco) ? `<br><span class="small ${l.precoNF > l.p.preco ? 'txt-ruim' : 'muted'}">${l.precoNF > l.p.preco ? '+' : ''}${fmtPct(l.precoNF / l.p.preco - 1)}</span>` : ''}</td>
        <td class="r">${l.cobrar ? `<b class="txt-ruim">${fmtMoeda(l.cobrar)}</b>` : ''}</td>
      </tr>`).join('')}
      ${naoPedidos.length ? `<tr class="sub-cab"><td colspan="8">Na nota, mas não estão neste pedido</td></tr>` + naoPedidos.map(x => `<tr class="nfe-div">
        <td><span class="badge warn">${x.deOutro ? 'item de outro fornecedor' : 'não pedido'}</span></td>
        <td><select data-vincular-nfe="${x.k}" class="sel-vinc">${opcoesVinc(null)}</select>${x.deOutro ? `<br><span class="small muted">na cotação: ${esc(c.itens[x.idx].descricao)}</span>` : ''}</td>
        <td class="small"><b>${esc(x.cProd)}</b> ${esc(x.xProd)}</td>
        <td class="r">—</td>
        <td class="r">${fmtNum(x.q)} ${esc(x.un)}</td>
        <td class="r">—</td>
        <td class="r">${fmtMoeda(precoLinhaNF(x))}${x.q !== 1 ? `<br><span class="small muted">total ${fmtMoeda(x.vProd - (x.vDesc || 0))}</span>` : ''}</td>
        <td></td>
      </tr>`).join('') : ''}
      </tbody>
    </table></div>
    <p class="small muted" style="margin:6px 0 0">Preço na nota = valor do produto com desconto, sem IPI/ST e frete. Se um item foi ligado errado, clique em <b>desvincular</b>; para ligar um item da nota ao pedido, escolha na lista. O sistema lembra os vínculos deste fornecedor para as próximas notas.</p>
  </section>`;
}

function textoCobranca(c, rec) {
  const { linhas, naoPedidos, resumo } = conferirNFe(c, rec);
  const f = c.fornecedores.find(x => x.fornecedorId === rec.fornecedorId);
  const L = [`Olá${f?.contato ? ', ' + f.contato : ''}!`, '', `Conferimos a NF-e nº ${rec.nf.numero} (${fmtData(rec.nf.emissao)}) com o nosso pedido da cotação nº ${c.numero}${nomeLojaRec(rec) ? ' — loja ' + nomeLojaRec(rec) : ''} e encontramos estas diferenças:`, ''];
  for (const l of linhas) {
    const nome = [l.p.it.codigo, l.p.it.descricao].filter(Boolean).join(' ');
    if (l.sit.includes('preco-maior')) L.push(`- ${nome}: cotado a ${fmtMoeda(l.p.preco)}, faturado a ${fmtMoeda(l.precoNF)} (${fmtNum(l.qNF)} un., diferença de ${fmtMoeda(l.cobrar)})`);
    if (l.sit.includes('faltou')) L.push(`- ${nome}: pedimos ${fmtNum(l.esperado)}, vieram ${fmtNum(l.qNF)}`);
    if (l.sit.includes('a-mais')) L.push(`- ${nome}: pedimos ${fmtNum(l.esperado)}, vieram ${fmtNum(l.qNF)}`);
    if (l.sit.includes('nao-veio')) L.push(`- ${nome}: pedimos ${fmtNum(l.esperado)}, não veio na nota`);
  }
  for (const x of naoPedidos) L.push(`- ${x.cProd} ${x.xProd}: veio na nota (${fmtNum(x.q)} un., ${fmtMoeda(x.vProd - (x.vDesc || 0))}), mas não estava no pedido`);
  if (resumo.cobrar) L.push('', `Total cobrado acima do cotado: ${fmtMoeda(resumo.cobrar)}.`);
  L.push('', 'Podem verificar, por favor?', '', db.config.comprador || '', db.config.loja || '');
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Liga (ou desliga, com idx -1) a linha k da nota a um item da cotação e lembra o vínculo. */
function vincularItemNFe(c, rec, k, idx) {
  const x = rec.itens[k];
  if (!x) return;
  rec.itens = rec.itens.map((y, j) => (j === k ? { ...y, idx, como: idx >= 0 ? 'manual' : '' } : y));
  const cad = db.fornecedores.find(f => f.id === rec.fornecedorId);
  const chave = normCod(x.cProd);
  if (cad && chave) {
    const mapa = { ...(cad.codigosNfe || {}) };
    if (idx >= 0 && c.itens[idx]?.produtoId) mapa[chave] = c.itens[idx].produtoId;
    else delete mapa[chave];
    cad.codigosNfe = mapa;
  }
  salvar();
  render();
  toast(idx >= 0 ? `"${x.cProd}" ligado a ${c.itens[idx].descricao}. O sistema lembra nas próximas notas.` : `"${x.cProd}" desvinculado.`);
}

async function exportarDivergencias(c, rec) {
  const { linhas, naoPedidos, resumo } = conferirNFe(c, rec);
  const f = c.fornecedores.find(x => x.fornecedorId === rec.fornecedorId);
  const wb = await novoLivroExcel();
  const ws = wb.addWorksheet('Divergências', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.mergeCells('A1:H1');
  ws.getCell('A1').value = `Divergências da NF-e nº ${rec.nf.numero} — ${f?.nome || rec.nf.emitente.nome}`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = `Cotação nº ${c.numero}${nomeLojaRec(rec) ? ' · loja ' + nomeLojaRec(rec) : ''} · emitida em ${fmtData(rec.nf.emissao)} · valor da nota ${fmtMoeda(rec.nf.total)}`;
  const cab = ['Situação', 'Código', 'Descrição', 'Qtd. pedida', 'Qtd. na nota', 'Preço cotado', 'Preço na nota', 'A cobrar'];
  const hr = ws.getRow(4);
  cab.forEach((t, k) => { const cell = hr.getCell(k + 1); cell.value = t; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = XL.azul; cell.border = XL.borda; });
  let r = 5;
  const linha = vals => {
    const row = ws.getRow(r++);
    row.values = vals;
    for (let k = 1; k <= 8; k++) row.getCell(k).border = XL.borda;
    for (const k of [6, 7, 8]) row.getCell(k).numFmt = XL.moeda;
  };
  for (const l of linhas) {
    if (l.sit[0] === 'ok' || l.sit[0] === 'outra-nota') continue;
    linha([l.sit.map(k => SIT_NF[k][0].replace(/^[^\wÀ-ú]+/, '')).join(', '), l.p.it.codigo || '', l.p.it.descricao, l.esperado, l.nfs.length ? l.qNF : 0, l.p.preco, l.precoNF ?? '', l.cobrar || '']);
  }
  for (const x of naoPedidos) linha(['não pedido', x.cProd, x.xProd, 0, x.q, '', precoLinhaNF(x), '']);
  const tr = ws.getRow(r);
  tr.getCell(7).value = 'Total a cobrar';
  tr.getCell(8).value = resumo.cobrar;
  tr.getCell(8).numFmt = XL.moeda;
  tr.font = { bold: true };
  ws.columns = [22, 16, 46, 12, 12, 14, 14, 14].map(width => ({ width }));
  await baixarWorkbook(wb, `Divergencias_NF${rec.nf.numero}_${slug(f?.nome || 'fornecedor')}.xlsx`);
}

async function exportarProdutos() {
  const wb = await novoLivroExcel();
  const ws = wb.addWorksheet('Produtos');
  ws.columns = [
    { header: 'Código', key: 'codigo', width: 16 },
    { header: 'Descrição', key: 'descricao', width: 50 },
    { header: 'Unidade', key: 'unidade', width: 10 },
    { header: 'Similar', key: 'similar', width: 22 },
    { header: 'Marca', key: 'marca', width: 20 },
    { header: 'Categoria', key: 'categoria', width: 20 },
    { header: 'Observação', key: 'obs', width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  db.produtos.forEach(p => ws.addRow(p));
  await baixarWorkbook(wb, `Produtos_${hojeISO()}.xlsx`);
}

const MAPA_COLUNAS = {
  codigo: ['codigo', 'cod', 'cod.', 'sku', 'referencia interna', 'ref interna', 'codigo do produto', 'nr_fabrica', 'nr fabrica'],
  descricao: ['descricao', 'produto', 'nome', 'item', 'descricao do produto'],
  unidade: ['unidade', 'un', 'und', 'unid', 'unid.', 'un.'],
  similar: ['similar', 'similares', 'equivalente', 'codigo similar', 'cod similar'],
  marca: ['marca', 'marca exigida', 'fabricante', 'referencia', 'ref', 'marca/ref.', 'marca/ref', 'brand'],
  categoria: ['categoria', 'grupo', 'departamento', 'secao'],
  obs: ['observacao', 'obs', 'observacoes'],
};

function lerCSV(texto) {
  const linhas = texto.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!linhas.length) return [];
  const amostra = linhas.slice(0, 5).join('\n');
  const conta = ch => amostra.split(ch).length - 1;
  const sep = ['\t', ';', '|', ','].reduce((m, ch) => (conta(ch) > conta(m) ? ch : m), ';');
  return linhas.map(l => {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === sep && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  });
}

/* ---------------- arquivo do DataCar (itens da cotação) ---------------- */

async function lerTextoArquivo(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** Lê .xlsx, .csv, .txt ou tabela HTML (.xls/.htm) e devolve as linhas como listas de textos. */
/** Arquivo do zip (lê o diretório central e descompacta com o próprio navegador). */
async function arquivoDoZip(buf, nome) {
  const v = new DataView(buf);
  let fim = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error('Arquivo compactado inválido.');
  const total = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const dec = new TextDecoder();
  for (let k = 0; k < total; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const metodo = v.getUint16(p + 10, true);
    const tam = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const n = dec.decode(new Uint8Array(buf, p + 46, nl));
    if (n === nome) {
      const ini = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const dados = new Uint8Array(buf, ini, tam);
      if (metodo === 0) return dados;
      const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(fluxo).arrayBuffer());
    }
    p += 46 + nl + el + cl;
  }
  return null;
}
async function zipEhOds(file) {
  try {
    const m = await arquivoDoZip(await file.arrayBuffer(), 'mimetype');
    return !!m && /opendocument\.spreadsheet/.test(new TextDecoder().decode(m));
  } catch (e) { return false; }
}
/** Planilha do LibreOffice (.ods): linhas da primeira aba, como texto. */
async function lerLinhasOds(file) {
  const xml = await arquivoDoZip(await file.arrayBuffer(), 'content.xml');
  if (!xml) throw new Error('Não achei a planilha dentro do arquivo .ods.');
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
  const NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const tab = doc.getElementsByTagNameNS(NS, 'table')[0];
  if (!tab) return [];
  const linhas = [];
  for (const tr of tab.getElementsByTagNameNS(NS, 'table-row')) {
    const vals = [];
    for (const td of tr.children) {
      if (td.namespaceURI !== NS || !/^(covered-)?table-cell$/.test(td.localName)) continue;
      const txt = [...td.childNodes].map(x => x.textContent).join(' ').replace(/\s+/g, ' ').trim();
      const rep = Math.min(Number(td.getAttributeNS(NS, 'number-columns-repeated')) || 1, txt ? 200 : 20);
      for (let k = 0; k < rep; k++) vals.push(txt);
    }
    while (vals.length && !vals[vals.length - 1]) vals.pop();
    const repL = Math.min(Number(tr.getAttributeNS(NS, 'number-rows-repeated')) || 1, vals.length ? 500 : 1);
    for (let k = 0; k < repL; k++) linhas.push(vals);
  }
  return linhas;
}

async function lerLinhasArquivo(file) {
  const cab = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const zip = cab[0] === 0x50 && cab[1] === 0x4b;
  const xlsAntigo = cab[0] === 0xd0 && cab[1] === 0xcf;
  if (xlsAntigo) throw new Error('Este arquivo está no formato antigo do Excel (.xls). Abra no Excel e salve como "Pasta de Trabalho do Excel (.xlsx)" ou como CSV, e selecione de novo.');
  if (zip && (/\.ods$/i.test(file.name || '') || await zipEhOds(file))) return lerLinhasOds(file);
  if (zip) {
    const wb = await novoLivroExcel();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets.find(w => w.rowCount > 0) || wb.worksheets[0];
    const linhas = [];
    ws.eachRow({ includeEmpty: false }, row => {
      const vals = [];
      for (let col = 1; col <= row.cellCount; col++) vals.push(cellTexto(row.getCell(col)));
      linhas.push(vals);
    });
    return linhas;
  }
  const texto = await lerTextoArquivo(file);
  if (/^\s*</.test(texto) && /<table/i.test(texto)) {
    const doc = new DOMParser().parseFromString(texto, 'text/html');
    return [...doc.querySelectorAll('tr')].map(tr => [...tr.querySelectorAll('th,td')].map(td => td.textContent.replace(/\s+/g, ' ').trim()));
  }
  return lerCSV(texto);
}

function acharColuna(cab, padroes) {
  const norm = cab.map(semAcento);
  for (const p of padroes) {
    const i = norm.findIndex(h => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

function indiceProdutos() {
  const mapa = new Map();
  const add = (k, p) => { k = semAcento(k).replace(/\s+/g, ''); if (k && !mapa.has(k)) mapa.set(k, p); };
  for (const p of db.produtos) add(p.codigo, p);
  for (const p of db.produtos) {
    for (const parte of String(p.codigo || '').split(/[\/,;]+/)) add(parte, p);
    for (const parte of String(p.similar || '').split(/[\/,;\s]+/)) add(parte, p);
    if (p.obsDataCar) add(p.obsDataCar, p);
  }
  return mapa;
}

function casarLinhasDataCar() {
  const d = ui.datacar;
  const mapa = indiceProdutos();
  d.linhas.forEach(l => {
    // OBS (chave) agrupa os itens; o código do arquivo identifica o produto.
    const chave = String(l.cels[d.col] ?? '').trim();
    const codigo = d.colCod >= 0 && d.colCod !== d.col ? String(l.cels[d.colCod] ?? '').trim() : '';
    const busca = codigo || chave;
    let p = null;
    if (busca) {
      p = mapa.get(semAcento(busca).replace(/\s+/g, '')) || null;
      if (!p) for (const parte of busca.split(/[\/,;]+/)) { p = mapa.get(semAcento(parte).replace(/\s+/g, '')); if (p) break; }
    }
    l.chave = chave;
    l.codigo = codigo;
    l.produtoId = p ? p.id : null;
    if (!busca) l.sel = false;
    else if (l.sel === undefined) l.sel = false; // começam todos desmarcados
  });
}

/**
 * Papelzinhos de São Sebastião: planilha diária (CÓDIGO / OBS 1…3) que a loja manda para entrar na cotação.
 * Abre na mesma conferência do DataCar, um item por linha; o que já está na cotação não entra de novo.
 */
async function abrirArquivoPapel(file) {
  try {
    const linhas = (await lerLinhasArquivo(file)).filter(l => l.some(v => String(v).trim()));
    if (!linhas.length) throw new Error('O arquivo está vazio.');
    let h = linhas.slice(0, 10).findIndex(l => l.some(v => /^cod/.test(semAcento(v))));
    if (h < 0) h = 0;
    const largura = Math.max(...linhas.map(l => l.length));
    const cab = Array.from({ length: largura }, (_, i) => String(linhas[h][i] ?? '').trim().replace(/:$/, '') || `Coluna ${i + 1}`);
    let colCod = cab.findIndex(c => /^cod/.test(semAcento(c)));
    if (colCod < 0) colCod = 0;
    const dados = linhas.slice(h + 1).map(l => Array.from({ length: largura }, (_, i) => String(l[i] ?? '').trim())).filter(l => l[colCod]);
    const naCotacao = new Set(rascunho().itens.map(x => x.produtoId));
    ui.datacar = {
      modo: 'papel',
      arquivo: file.name,
      cab,
      col: colCod, // um item por grupo
      colCod,
      colDesc: -1,
      colQtd: -1,
      colMarca: -1,
      colObs: cab.map((c, i) => (i !== colCod && /^obs/.test(semAcento(c)) ? i : -1)).filter(i => i >= 0),
      linhas: dados.map((cels, orig) => ({ cels, orig })),
      ordem: { campo: 'chave', dir: 1 },
      pos: 0,
      gcur: 0,
      grupoAberto: null,
    };
    casarLinhasDataCar();
    // o que já está na Nova cotação nem aparece aqui (não entra de novo)
    const d = ui.datacar;
    const jaEstao = d.linhas.filter(l => l.produtoId && naCotacao.has(l.produtoId));
    d.linhas = d.linhas.filter(l => !jaEstao.includes(l));
    d.jaNaCotacao = jaEstao.length;
    if (!d.linhas.length) {
      ui.datacar = null;
      rascunho().papelzinhos = { arquivo: file.name, em: new Date().toISOString(), adicionados: 0, jaEstavam: jaEstao.length };
      salvar();
      render();
      return avisar(`Todos os ${jaEstao.length} item(ns) dos papelzinhos já estão na cotação. Nada a acrescentar.`);
    }
    aplicarOrdemDataCar();
    render();
    focarDataCar();
  } catch (e) {
    console.error(e);
    avisar('Não consegui ler o arquivo:\n' + e.message);
  }
}

async function abrirArquivoDataCar(file) {
  try {
    let linhas = (await lerLinhasArquivo(file)).filter(l => l.some(v => String(v).trim()));
    if (!linhas.length) throw new Error('O arquivo está vazio.');
    // Cabeçalho: a primeira das 15 primeiras linhas que tenha uma coluna OBS.
    let h = linhas.slice(0, 15).findIndex(l => l.some(v => /^obs/.test(semAcento(v))));
    if (h < 0) h = 0;
    const largura = Math.max(...linhas.map(l => l.length));
    const cab = Array.from({ length: largura }, (_, i) => String(linhas[h][i] ?? '').trim() || `Coluna ${i + 1}`);
    const dados = linhas.slice(h + 1).map(l => Array.from({ length: largura }, (_, i) => String(l[i] ?? '').trim()));
    let col = acharColuna(cab, [/^obs/, /observ/]);
    if (col < 0) col = 0;
    ui.datacar = {
      arquivo: file.name,
      cab,
      col,
      colDesc: acharColuna(cab, [/^descri/, /descri/, /produto/, /^nome/, /aplica/]),
      colQtd: acharColuna(cab, [/^qt/, /quant/]),
      colMarca: acharColuna(cab, [/marca/, /fabric/]),
      colCod: (() => {
        const padroes = [/^cod/, /codigo/, /^referencia/, /^ref\b/, /peca/, /part ?n/, /^numero|^n[ºo°]/];
        for (const p of padroes) {
          const i = cab.findIndex((h, j) => j !== col && p.test(semAcento(h)));
          if (i >= 0) return i;
        }
        return -1;
      })(),
      linhas: dados.map((cels, orig) => ({ cels, orig })),
      ordem: { campo: 'chave', dir: 1 }, // conferência em ordem A-Z pelo OBS
      pos: 0, // item em conferência dentro do grupo aberto
      gcur: 0, // grupo selecionado na lista
      grupoAberto: null,
    };
    casarLinhasDataCar();
    aplicarOrdemDataCar();
    render();
    focarDataCar();
  } catch (e) {
    console.error(e);
    avisar('Não consegui ler o arquivo:\n' + e.message);
  }
}

/** "XX" na OBS do DataCar = item para cotar para a loja de São Sebastião. */
const temXX = v => /(^|[^a-z0-9])xx([^a-z0-9]|$)/i.test(String(v || ''));
const tirarXX = v => String(v || '').replace(/(^|\s)xx(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
/** Etiqueta da loja pela OBS: 'dss' (só XX), 'ambas' (com e sem XX) ou ''. */
function lojaPelaObs(obs = []) {
  if (!obs.some(temXX)) return '';
  return obs.some(o => !temXX(o)) ? 'ambas' : 'dss';
}

// "01" e "01 XX" ficam no mesmo grupo (o XX aparece em cada item)
const grupoDc = v => {
  const t = semAcento(v).replace(/\s+/g, ' ');
  return tirarXX(t) || (temXX(t) ? 'xx' : t);
};
const chaveCodigo = v => semAcento(v).replace(/\s+/g, '');

/**
 * Partes de um código para achar repetidos: "2527/GR12527" -> ["2527", "gr12527", "2527/gr12527"].
 * Como no DISPPAR, o sufixo de KIT não conta: "40123-KITCIA" também vira "40123".
 */
function tokensCodigo(cod) {
  const k = chaveCodigo(cod || '');
  if (!k) return [];
  const partes = k.split(/[\/,;|]+/).filter(t => t.length >= 3);
  const semKit = [k, ...partes].map(t => t.replace(/^(.{3,}?)[-\/]?kit[a-z0-9]*$/, '$1')).filter(t => t.length >= 3);
  return [...new Set([k, ...partes, ...semKit])];
}

/** Para cada código, os índices dos outros com código igual ou contido (ver tokensCodigo). */
function parceirosCodigo(codigos) {
  const porToken = new Map();
  const toks = codigos.map((c, i) => {
    const t = tokensCodigo(c);
    t.forEach(x => { if (!porToken.has(x)) porToken.set(x, new Set()); porToken.get(x).add(i); });
    return t;
  });
  return codigos.map((c, i) => {
    const set = new Set();
    toks[i].forEach(t => porToken.get(t).forEach(j => { if (j !== i) set.add(j); }));
    return [...set];
  });
}

/** Item de KIT (KIT CORREIA, KIT TENSOR, "KIT …" na descrição ou código terminado em KIT). */
function ehKit(codigo, descricao) {
  return /\bKIT\b/i.test(semAcento(descricao || '').toUpperCase()) || /[-\/\s]KIT[A-Z0-9 ]*$/i.test(String(codigo || '').trim());
}

function chaveOrdemDataCar(l, campo) {
  const d = ui.datacar;
  const txt = c => (c >= 0 ? l.cels[c] : '');
  const p = l.produtoId ? db.produtos.find(x => x.id === l.produtoId) : null;
  if (campo === 'chave') return l.chave || '';
  if (campo === 'arquivo') return [d.colCod >= 0 && d.colCod !== d.col ? txt(d.colCod) : '', txt(d.colDesc)].filter(Boolean).join(' ') || l.cels.join(' ');
  if (campo === 'produto') return p ? `${p.codigo} ${p.descricao}` : '';
  if (campo === 'marca') return marcaAtualDataCar(l, p) || '';
  if (campo === 'marca') return (p && p.marca) || l.marca || txt(d.colMarca) || '';
  return '';
}

function aplicarOrdemDataCar() {
  const d = ui.datacar;
  const { campo: c, dir } = d.ordem;
  if (!c) { d.linhas.sort((a, b) => a.orig - b.orig); return; }
  const col = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
  const chaves = new Map(d.linhas.map(l => [l, semAcento(chaveOrdemDataCar(l, c)).replace(/\s+/g, ' ')]));
  d.linhas.sort((a, b) => {
    const ka = chaves.get(a), kb = chaves.get(b);
    if (!ka !== !kb) return ka ? -1 : 1; // vazios sempre no fim
    return (col.compare(ka, kb) * dir) || a.orig - b.orig;
  });
}

function marcaAtualDataCar(l, p) {
  const d = ui.datacar;
  return l.marca ?? (p ? p.marca : (d.colMarca >= 0 ? l.cels[d.colMarca] : '')) ?? '';
}

/* ---------------- conferência por grupo de OBS ----------------
 * Nível 1 (grupos): uma linha por OBS. → o grupo todo vai, ← não vai, Enter abre para escolher itens.
 * Nível 2 (itens do grupo): um item por vez. → / Espaço vai, ← não vai, Backspace volta, Esc volta aos grupos.
 * Itens sem decisão não vão. Enter duas vezes na linha "Concluir" adiciona à cotação. */

function okDataCar(l) {
  return !!(l.codigo || l.chave);
}

function todosDataCar() {
  return ui.datacar.linhas.filter(okDataCar);
}

/** Itens em conferência: os do grupo aberto (nível 2) ou todos. */
function filaDataCar() {
  const d = ui.datacar;
  const todos = todosDataCar();
  return d.grupoAberto == null ? todos : todos.filter(l => grupoDc(l.chave || '') === d.grupoAberto);
}

function gruposDataCar() {
  const d = ui.datacar;
  const mapa = new Map();
  for (const l of todosDataCar()) {
    const k = grupoDc(l.chave || '');
    if (!mapa.has(k)) mapa.set(k, { k, rotulo: l.chave ? (tirarXX(l.chave) || l.chave) : 'Sem ' + d.cab[d.col], itens: [] });
    mapa.get(k).itens.push(l);
  }
  return [...mapa.values()].sort((a, b) => (!a.k - !b.k) || COLLATOR.compare(a.k, b.k));
}

/** Grupo aparece na lista? (busca por OBS, código ou descrição; filtro "só sem decisão") */
function grupoVisivelDc(g) {
  const d = ui.datacar;
  if (d.soPend && !['pendente', 'incompleto'].includes(estadoGrupo(g).estado)) return false;
  const q = (d.busca || '').trim();
  if (!q) return true;
  const t = semAcento(q);
  const k = normCod(q);
  return semAcento(g.rotulo).includes(t) || g.itens.some(l => (d.colDesc >= 0 && semAcento(l.cels[d.colDesc] || '').includes(t))
    || (k.length >= 2 && normCod(l.codigo).includes(k)) || semAcento(l.codigo || '').includes(t));
}

/** Índices (na lista completa) dos grupos visíveis. */
function visiveisDc(gs = gruposDataCar()) {
  return gs.map((g, i) => (grupoVisivelDc(g) ? i : -1)).filter(i => i >= 0);
}

function estadoGrupo(g) {
  const vai = g.itens.filter(l => l.decisao === 'vai').length;
  const nao = g.itens.filter(l => l.decisao === 'nao').length;
  const n = g.itens.length;
  const falta = n - vai - nao;
  const estado = falta === n ? 'pendente' : falta ? 'incompleto' : vai === n ? 'vai' : nao === n ? 'nao' : 'misto';
  return { vai, nao, n, falta, estado };
}

function contagemDataCar() {
  const todos = todosDataCar();
  const vai = todos.filter(l => l.decisao === 'vai').length;
  const nao = todos.filter(l => l.decisao === 'nao').length;
  return { total: todos.length, vai, nao, falta: todos.length - vai - nao };
}

function proximoGrupoPendente(depois) {
  const gs = gruposDataCar();
  const ok = i => ['pendente', 'incompleto'].includes(estadoGrupo(gs[i]).estado) && grupoVisivelDc(gs[i]);
  for (let i = depois + 1; i < gs.length; i++) if (ok(i)) return i;
  for (let i = 0; i <= depois && i < gs.length; i++) if (ok(i)) return i;
  return gs.length; // linha "Concluir"
}

/* Regras do DISPPAR para a OBS do DataCar: palavras que sugerem se o grupo vai ou não para a cotação. */
const REGRAS_OBS = [
  ['nao', ['cortar', 'retirar', 'descartar', 'desconsiderar', 'cancelado', 'cancelada', 'nao cotar', 'nao comprar', 'nao usar']],
  ['revisar', ['duvida', 'duvidas', 'confirmar', 'conferir', 'verificar', 'revisar', 'avaliar', 'analisar', 'aguardar', 'pendente']],
  ['vai', ['ok', 'manter', 'aprovado', 'conferido', 'liberado']],
];

/** Sugestão para um grupo pela OBS: { tipo: 'vai' | 'nao' | 'revisar', palavra } ou null. */
function sugestaoObs(texto) {
  const t = ` ${semAcento(texto).replace(/[^a-z0-9]+/g, ' ').trim()} `;
  if (!t.trim()) return null;
  for (const [tipo, palavras] of REGRAS_OBS) {
    const achou = palavras.find(w => t.includes(` ${w} `));
    if (achou) return { tipo, palavra: achou };
  }
  return null;
}

function aplicarSugestoesDataCar() {
  const gs = gruposDataCar();
  let n = 0;
  for (const g of gs) {
    const sug = sugestaoObs(g.rotulo);
    if (!sug || sug.tipo === 'revisar' || estadoGrupo(g).estado !== 'pendente') continue;
    for (const l of g.itens) { l.decisao = sug.tipo; l.sel = sug.tipo === 'vai'; }
    n++;
  }
  desenharConferencia();
  toast(n ? `Sugestão aplicada em ${n} grupo(s).` : 'Nenhum grupo pendente com sugestão.');
}

/** Decide todos os grupos selecionados de uma vez. */
function decidirSelecionadosDc(decisao) {
  const d = ui.datacar;
  const gs = gruposDataCar();
  const alvo = gs.map((g, i) => [g, i]).filter(([g]) => d.selG?.has(g.k));
  for (const [g] of alvo) for (const l of g.itens) { l.decisao = decisao; l.sel = decisao === 'vai'; }
  d.selG = new Set();
  d.ancoraG = null;
  if (alvo.length) d.gcur = proximoGrupoPendente(alvo[alvo.length - 1][1]);
  desenharConferencia();
  toast(`${alvo.length} grupo(s): ${decisao === 'vai' ? '✓ vão' : '✗ não vão'}.`);
}

/** Todos os grupos ainda sem decisão (os que aparecem, se houver busca) vão / não vão. */
async function decidirRestantesDc(decisao) {
  const d = ui.datacar;
  const gs = gruposDataCar().filter(g => ['pendente', 'incompleto'].includes(estadoGrupo(g).estado) && grupoVisivelDc(g));
  if (!gs.length) return toast('Nenhum grupo sem decisão.');
  const itens = gs.reduce((t, g) => t + g.itens.filter(l => !l.decisao).length, 0);
  if (!(await confirmar(`${decisao === 'vai' ? '✓ Todos vão' : '✗ Nenhum vai'}: ${gs.length} grupo(s) sem decisão${d.busca ? ` (da busca "${d.busca}")` : ''}, ${itens} item(ns).\n\nOs grupos que você já decidiu não mudam.`, decisao === 'vai' ? 'Todos vão' : 'Nenhum vai'))) { focarDataCar(); return; }
  for (const g of gs) for (const l of g.itens) if (!l.decisao) { l.decisao = decisao; l.sel = decisao === 'vai'; }
  d.gcur = proximoGrupoPendente(-1);
  desenharConferencia();
}

/** Seleção de grupos: faixa (Shift) ou um a um (Ctrl / caixinha). */
function selecionarGrupoDc(i, modo) {
  const d = ui.datacar;
  const gs = gruposDataCar();
  if (!gs[i]) return;
  d.selG ||= new Set();
  if (modo === 'faixa') {
    const vis = visiveisDc(gs);
    const a = d.ancoraG ?? d.gcur ?? i;
    const [ini, fim] = a < i ? [a, i] : [i, a];
    for (const k of vis) if (k >= ini && k <= fim) d.selG.add(gs[k].k);
    d.ancoraG = a;
  } else {
    const k = gs[i].k;
    if (d.selG.has(k)) d.selG.delete(k); else d.selG.add(k);
    d.ancoraG = i;
  }
  d.gcur = i;
  desenharConferencia();
}

function decidirGrupoDataCar(gi, decisao) {
  const d = ui.datacar;
  if (d.selG?.size) return decidirSelecionadosDc(decisao); // há grupos selecionados: vale para todos
  const g = gruposDataCar()[gi];
  if (!g) return;
  for (const l of g.itens) { l.decisao = decisao; l.sel = decisao === 'vai'; }
  d.gcur = proximoGrupoPendente(gi);
  desenharConferencia();
}

function abrirGrupoDataCar(gi) {
  const d = ui.datacar;
  const g = gruposDataCar()[gi];
  if (!g) return;
  d.gcur = gi;
  d.grupoAberto = g.k;
  const i = g.itens.findIndex(l => !l.decisao);
  d.pos = i < 0 ? 0 : i;
  desenharConferencia();
}

function fecharGrupoDataCar(avancar) {
  const d = ui.datacar;
  d.grupoAberto = null;
  if (avancar) d.gcur = proximoGrupoPendente(d.gcur);
  desenharConferencia();
}

function decidirDataCar(decisao) {
  const d = ui.datacar;
  const fila = filaDataCar();
  const l = fila[d.pos];
  if (!l) return;
  l.decisao = decisao;
  l.sel = decisao === 'vai';
  if (d.pos + 1 >= fila.length) { fecharGrupoDataCar(true); return; } // fim do grupo: volta à lista
  d.pos++;
  desenharConferencia();
}

function voltarDataCar() {
  const d = ui.datacar;
  if (d.grupoAberto == null) { moverGrupoDataCar(d.gcur - 1); return; }
  if (d.pos <= 0) { fecharGrupoDataCar(false); return; }
  d.pos--;
  desenharConferencia();
}

function moverGrupoDataCar(i) {
  const d = ui.datacar;
  const n = gruposDataCar().length;
  d.gcur = Math.max(0, Math.min(n, i));
  desenharConferencia();
}

/** ↑/↓ andando só pelos grupos que aparecem (a linha "Concluir" é a última). */
function passoGrupoDc(delta, estender) {
  const d = ui.datacar;
  const gs = gruposDataCar();
  const vis = [...visiveisDc(gs), gs.length];
  let pos = vis.indexOf(d.gcur);
  if (pos < 0) pos = delta > 0 ? -1 : vis.length;
  const novo = vis[Math.max(0, Math.min(vis.length - 1, pos + delta))];
  if (estender && novo < gs.length) {
    d.selG ||= new Set();
    if (d.ancoraG == null) { d.ancoraG = d.gcur < gs.length ? d.gcur : novo; if (gs[d.ancoraG]) d.selG.add(gs[d.ancoraG].k); }
    d.selG.add(gs[novo].k);
  }
  moverGrupoDataCar(novo);
}

function editarMarcaDataCar(textoInicial) {
  const caixa = $('#dcMarcaCampo');
  if (!caixa || caixa.querySelector('input')) return;
  const d = ui.datacar;
  const l = filaDataCar()[d.pos];
  if (!l) return;
  const p = l.produtoId ? db.produtos.find(x => x.id === l.produtoId) : null;
  caixa.innerHTML = `<input data-dc-marca="1" value="${esc(marcaAtualDataCar(l, p))}" placeholder="Informar marca" aria-label="Marca">`;
  const inp = caixa.firstChild;
  inp.focus();
  if (textoInicial != null) inp.value = textoInicial;
  inp.setSelectionRange(inp.value.length, inp.value.length);
}

function fecharMarcaDataCar(inp, salvarValor) {
  if (inp.dataset.fechando) return; // remover o campo dispara "focusout": evita fechar duas vezes
  inp.dataset.fechando = '1';
  const d = ui.datacar;
  const l = d && filaDataCar()[d.pos];
  if (l && salvarValor) l.marca = inp.value.trim();
  desenharConferencia();
}

function focarDataCar() {
  if (document.activeElement?.id === 'dcBusca') return; // digitando na busca: não tira o cursor de lá
  $('#dcCaixa')?.focus({ preventScroll: true });
}

function desarmarEnterDataCar() {
  const d = ui.datacar;
  if (!d || !d.enterArmado) return;
  d.enterArmado = 0;
  document.querySelectorAll('#dlgDataCar [data-act="dcAdicionar"]').forEach(btn => { btn.textContent = 'Adicionar à cotação'; btn.classList.remove('armado'); });
}

function enterDuploDataCar() {
  const d = ui.datacar;
  const { vai } = contagemDataCar();
  const pend = gruposDataCar().filter(g => ['pendente', 'incompleto'].includes(estadoGrupo(g).estado)).length;
  if (d.enterArmado && Date.now() - d.enterArmado < 5000) {
    d.enterArmado = 0;
    acoes.dcAdicionar();
    return;
  }
  d.enterArmado = Date.now();
  document.querySelectorAll('#dlgDataCar [data-act="dcAdicionar"]').forEach(btn => { btn.textContent = 'Enter de novo para adicionar'; btn.classList.add('armado'); });
  toast(vai
    ? `Pressione Enter de novo para adicionar ${vai} item(ns) à cotação.${pend ? ` Atenção: ${pend} grupo(s) ainda sem decisão (não vão).` : ''}`
    : 'Nenhum item marcado para ir.', 5000);
}

function teclaDataCar(e) {
  const d = ui.datacar;
  const t = e.target;
  if (e.key !== 'Enter') desarmarEnterDataCar();
  // Editando a marca: Enter/Tab confirma, Esc desiste.
  if (t.dataset && t.dataset.dcMarca != null) {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') {
      e.preventDefault();
      fecharMarcaDataCar(t, e.key !== 'Escape');
      focarDataCar();
    }
    return;
  }
  if (t.id === 'dcBusca') {
    // na busca: Esc limpa; ↓ ou Enter vai para a lista
    if (e.key === 'Escape') { e.preventDefault(); if (t.value) { t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); } else { t.blur(); focarDataCar(); } }
    else if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); d.gcur = visiveisDc()[0] ?? gruposDataCar().length; t.blur(); desenharConferencia(); }
    return;
  }
  if (t.matches('select, input, textarea')) return; // seletores de coluna
  if (e.repeat && [' ', 'ArrowRight', 'ArrowLeft', 'Backspace', 'Enter'].includes(e.key)) { e.preventDefault(); return; } // tecla segurada não decide vários

  if (d.grupoAberto == null) {
    // ----- nível 1: grupos
    const n = gruposDataCar().length;
    const naLista = d.gcur < n;
    if (e.key === 'ArrowDown') { e.preventDefault(); passoGrupoDc(1, e.shiftKey); }
    else if (e.key === 'ArrowUp' || e.key === 'Backspace') { e.preventDefault(); passoGrupoDc(-1, e.shiftKey && e.key === 'ArrowUp'); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      const gs = gruposDataCar();
      d.selG = new Set(visiveisDc(gs).map(i => gs[i].k));
      desenharConferencia();
    }
    else if (e.key === 'Escape' && d.selG?.size) { e.preventDefault(); d.selG = new Set(); d.ancoraG = null; desenharConferencia(); }
    else if (e.key === '/' || (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey)) {
      // digitar na lista vai para a busca
      const b = $('#dcBusca');
      if (b) { e.preventDefault(); b.focus(); if (e.key !== '/') { b.value += e.key; b.dispatchEvent(new Event('input', { bubbles: true })); } }
    }
    else if ((e.key === 'ArrowRight' || e.key === ' ') && naLista) { e.preventDefault(); decidirGrupoDataCar(d.gcur, 'vai'); }
    else if (e.key === 'ArrowLeft' && naLista) { e.preventDefault(); decidirGrupoDataCar(d.gcur, 'nao'); }
    else if (e.key === 'Enter') { e.preventDefault(); if (naLista) abrirGrupoDataCar(d.gcur); else enterDuploDataCar(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); moverGrupoDataCar(e.key === 'Home' ? 0 : n); }
    else if (e.key === 'Escape') { e.preventDefault(); acoes.dcCancelar(); }
    return;
  }
  // ----- nível 2: itens do grupo aberto
  const letra = e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); decidirDataCar('vai'); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); decidirDataCar('nao'); }
  else if (e.key === 'Backspace' || e.key === 'ArrowUp') { e.preventDefault(); voltarDataCar(); }
  else if (e.key === 'F2') { e.preventDefault(); editarMarcaDataCar(); }
  else if (letra) { e.preventDefault(); editarMarcaDataCar(e.key); }
  else if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); fecharGrupoDataCar(false); }
}

/** Redesenha o miolo (lista de grupos ou item do grupo aberto). */
function desenharConferencia() {
  const alvo = $('#dcConferencia');
  if (!alvo) return;
  const det = alvo.querySelector('.conf-arquivo');
  if (det) ui.datacar.verArquivo = det.open;
  const lista = alvo.querySelector('.conf-grupos');
  const topo = lista ? lista.scrollTop : 0;
  alvo.innerHTML = conteudoConferencia();
  const nova = alvo.querySelector('.conf-grupos');
  if (nova) {
    nova.scrollTop = topo;
    const atual = nova.querySelector('.conf-grupo.atual');
    if (atual) {
      // mantém a linha atual visível, com a próxima à vista
      const alt = atual.offsetHeight;
      const ini = atual.offsetTop;
      if (nova.scrollTop > ini - 4) nova.scrollTop = ini - 4;
      else if (nova.scrollTop + nova.clientHeight < ini + alt * 2) nova.scrollTop = ini + alt * 2 - nova.clientHeight;
    }
  }
  focarDataCar();
}

function progressoDataCar() {
  const gs = gruposDataCar();
  const c = contagemDataCar();
  const decididos = gs.filter(g => !['pendente', 'incompleto'].includes(estadoGrupo(g).estado)).length;
  const pct = gs.length ? Math.round((decididos / gs.length) * 100) : 100;
  return `
    <div class="conf-progresso">
      <div class="conf-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${gs.length}" aria-valuenow="${decididos}"><span style="width:${pct}%"></span></div>
      <div class="conf-numeros">
        <span>${ui.datacar?.modo === 'papel' ? 'Itens' : 'Grupos'} decididos: <b>${decididos}</b> de ${gs.length}</span>
        <span class="conf-vai">✓ ${c.vai} itens vão</span>
        <span class="conf-nao">✗ ${c.nao} não vão</span>
        ${c.falta ? `<span class="muted">${c.falta} sem decisão</span>` : ''}
      </div>
    </div>`;
}

function conteudoConferencia() {
  const d = ui.datacar;
  return d.grupoAberto == null ? conteudoGrupos() : conteudoItem();
}

function conteudoGrupos() {
  const d = ui.datacar;
  const gs = gruposDataCar();
  if (d.gcur == null || d.gcur > gs.length) d.gcur = 0;
  const rotEstado = { pendente: 'sem decisão', incompleto: 'incompleto', vai: 'VAI', nao: 'NÃO VAI', misto: 'escolhido' };
  const vis = new Set(visiveisDc(gs));
  if (d.gcur < gs.length && !vis.has(d.gcur)) d.gcur = [...vis][0] ?? gs.length;
  d.selG ||= new Set();
  const linhas = gs.map((g, i) => {
    if (!vis.has(i)) return '';
    const e = estadoGrupo(g);
    const amostra = d.modo === 'papel'
      ? g.itens.slice(0, 1).map(l => {
        const p = l.produtoId ? db.produtos.find(x => x.id === l.produtoId) : null;
        const obs = (d.colObs || []).map(c => l.cels[c]).filter(Boolean).join(' · ');
        return `${p ? p.descricao + (p.marca ? ' · ' + p.marca : '') : '🆕 não cadastrado'}${obs ? ' · ' + obs : ''}`;
      })
      : g.itens.slice(0, 3).map(l => (d.colDesc >= 0 && l.cels[d.colDesc]) || l.codigo).filter(Boolean);
    const sel = d.selG.has(g.k);
    return `<div class="conf-grupo est-${e.estado} ${i === d.gcur ? 'atual' : ''}${sel ? ' selecionado' : ''}" data-g-idx="${i}">
      <span class="cg-sel" title="Selecionar (ou Shift+clique / Shift+↓ para uma faixa)"><input type="checkbox" tabindex="-1" ${sel ? 'checked' : ''} aria-label="Selecionar o grupo ${esc(g.rotulo)}"></span>
      <div class="cg-obs"><b title="${esc(g.rotulo)}">${esc(g.rotulo)}</b><span>${e.n} ${e.n === 1 ? 'item' : 'itens'}</span>${(sug => (sug ? `<span class="sug-obs ${sug.tipo}" title="A OBS diz &quot;${esc(sug.palavra)}&quot;">${{ vai: 'sugestão: vai', nao: 'sugestão: não vai', revisar: 'revisar' }[sug.tipo]}</span>` : ''))(sugestaoObs(g.rotulo))}</div>
      <div class="cg-amostra small">${amostra.map(esc).join(' · ')}${e.n > 3 ? ` <span class="muted">+${e.n - 3}</span>` : ''}</div>
      <div class="cg-estado"><span class="badge ${e.estado === 'vai' ? 'ok' : e.estado === 'nao' ? 'danger' : e.estado === 'pendente' ? '' : 'warn'}">${rotEstado[e.estado]}${e.estado === 'misto' || e.estado === 'incompleto' ? ` · ${e.vai} vão` : ''}</span></div>
      <div class="cg-acoes">
        <button type="button" class="sm conf-mini-nao" data-act="dcGNao" data-i="${i}" title="O grupo todo NÃO vai (←)">✗</button>
        <button type="button" class="sm" data-act="dcGAbrir" data-i="${i}" title="Escolher itens deste grupo (Enter)">Escolher</button>
        <button type="button" class="sm conf-mini-vai" data-act="dcGVai" data-i="${i}" title="O grupo todo VAI (→)">✓ Vai</button>
      </div>
    </div>`;
  }).join('');
  const pend = gs.filter(g => ['pendente', 'incompleto'].includes(estadoGrupo(g).estado)).length;
  const c = contagemDataCar();
  const nSug = gs.filter(g => estadoGrupo(g).estado === 'pendente' && ['vai', 'nao'].includes(sugestaoObs(g.rotulo)?.tipo)).length;
  const nSel = d.selG.size;
  const itensSel = nSel ? gs.filter(g => d.selG.has(g.k)).reduce((t, g) => t + g.itens.length, 0) : 0;
  const nVis = vis.size;
  const pendVis = gs.filter((g, i) => vis.has(i) && ['pendente', 'incompleto'].includes(estadoGrupo(g).estado)).length;
  return `${progressoDataCar()}
    <div class="conf-lote">
      ${nSel ? `<span class="conf-lote-sel"><b>${nSel}</b> grupo(s) selecionado(s) · ${itensSel} item(ns)</span>
        <button type="button" class="sm conf-mini-vai" data-act="dcSelVai" title="Os selecionados vão (→)">✓ Vão</button>
        <button type="button" class="sm conf-mini-nao" data-act="dcSelNao" title="Os selecionados não vão (←)">✗ Não vão</button>
        <button type="button" class="sm link" data-act="dcSelLimpar" title="Esc">limpar seleção</button>`
      : `<span class="small muted">${d.modo === 'papel' && d.jaNaCotacao ? `${d.jaNaCotacao} já estava(m) na cotação (não aparecem aqui) · ` : ''}${d.busca || d.soPend ? `${nVis} de ${gs.length} aparecendo · ` : ''}Shift+↓ ou Shift+clique seleciona vários · Ctrl+A todos</span>`}
      ${pendVis ? `<span class="conf-lote-rest">Os ${pendVis} sem decisão${d.busca ? ' (da busca)' : ''}:
        <button type="button" class="sm conf-mini-vai" data-act="dcRestVai">✓ todos vão</button>
        <button type="button" class="sm conf-mini-nao" data-act="dcRestNao">✗ nenhum vai</button></span>` : ''}
    </div>
    ${nSug && d.modo !== 'papel' ? `<div class="conf-sugestoes small">A OBS de ${nSug} grupo(s) já diz o que fazer (ex.: "CORTAR", "NÃO COTAR", "OK"). <button type="button" class="sm" data-act="dcSugestoes">Aplicar sugestões</button></div>` : ''}
    <div class="conf-grupos" role="listbox" aria-label="Grupos de ${esc(d.cab[d.col])}">
      ${linhas}
      <div class="conf-grupo conf-concluir ${d.gcur === gs.length ? 'atual' : ''}" data-g-idx="${gs.length}">
        <div><b>Concluir</b> · ${c.vai} item(ns) vão para a cotação${pend ? ` · <span class="conf-alerta">${pend} grupo(s) sem decisão</span>` : ' · ✓ todos os grupos decididos'}</div>
        <div class="small muted">Nesta linha, <span class="kbd">Enter</span> <span class="kbd">Enter</span> adiciona à cotação</div>
      </div>
    </div>
    <p class="small muted" style="margin:8px 0 0">
      <span class="kbd">↑</span> <span class="kbd">↓</span> grupos · <span class="kbd">→</span>/<span class="kbd">Espaço</span> grupo todo vai ·
      <span class="kbd">←</span> grupo todo não vai · <span class="kbd">Enter</span> escolher itens do grupo · <span class="kbd">Shift</span>+<span class="kbd">↓</span> seleciona vários · digite para buscar · <span class="kbd">Esc</span> sair
    </p>`;
}

function conteudoItem() {
  const d = ui.datacar;
  const fila = filaDataCar();
  if (d.pos >= fila.length) d.pos = Math.max(0, fila.length - 1);
  const l = fila[d.pos];
  if (!l) return conteudoGrupos();
  const p = l.produtoId ? db.produtos.find(x => x.id === l.produtoId) : null;
  const txt = cc => (cc >= 0 ? l.cels[cc] : '');
  const naCotacao = new Set(rascunho().itens.map(x => x.produtoId));
  const m = marcaAtualDataCar(l, p);
  const meusTokens = new Set(tokensCodigo(l.codigo));
  const repetido = l.codigo && todosDataCar().some(x => x !== l && tokensCodigo(x.codigo).some(t => meusTokens.has(t)));
  const vai = fila.filter(x => x.decisao === 'vai').length;
  const nao = fila.filter(x => x.decisao === 'nao').length;
  return `${progressoDataCar()}
    <div class="conf-grupo-aberto">
      <button type="button" class="sm" data-act="dcGFechar">← Voltar aos grupos (Esc)</button>
      <span>Grupo <b>${esc(l.chave || '—')}</b> · item <b>${d.pos + 1}</b> de ${fila.length} · <span class="conf-vai">✓ ${vai}</span> · <span class="conf-nao">✗ ${nao}</span></span>
    </div>
    <div class="conf-card ${l.decisao ? 'conf-' + l.decisao : ''}">
      <div class="conf-topo">
        ${l.decisao ? `<span class="badge ${l.decisao === 'vai' ? 'ok' : 'danger'}">já decidido: ${l.decisao === 'vai' ? 'VAI' : 'NÃO VAI'}</span>` : ''}
        ${repetido ? '<span class="badge warn">código repetido no arquivo</span>' : ''}
        ${p && naCotacao.has(p.id) ? '<span class="badge">já está na cotação</span>' : ''}
      </div>
      <div class="conf-codigo">${esc(l.codigo || l.chave)}</div>
      <div class="conf-desc">${esc(txt(d.colDesc) || (p ? p.descricao : ''))}</div>
      <div class="conf-cadastro small">${p
        ? `Cadastro: <b>${esc(p.codigo)}</b> · ${esc(p.descricao)}${p.similar ? ` · sim. ${esc(p.similar)}` : ''}`
        : `<span class="badge warn">não cadastrado · será cadastrado ao adicionar</span>
          <label class="conf-desc-novo">Descrição para o cadastro <input data-dc-desc="1" value="${esc(l.desc ?? (txt(d.colDesc) || ''))}" placeholder="Ex.: SPRAY SELANTE 300ML" autocomplete="off"></label>`}</div>
      <div class="conf-observacoes">
        <div><span>${esc(d.cab[d.col])} na planilha</span><b>${esc(l.chave || '—')}</b></div>
        ${p && p.obs ? `<div><span>Observação no cadastro</span><b>${esc(p.obs)}</b></div>` : ''}
      </div>
      <details class="conf-arquivo" ${d.verArquivo ? 'open' : ''}>
        <summary class="small">Todas as colunas desta linha no arquivo</summary>
        <table>${d.cab.map((c, i) => l.cels[i] ? `<tr><th>${esc(c)}</th><td>${esc(l.cels[i])}</td></tr>` : '').join('')}</table>
      </details>
      <label class="conf-marca-rotulo">Marca <span class="muted small">(digite para trocar${p && p.marca ? ' · vale só nesta cotação' : ''})</span></label>
      <div id="dcMarcaCampo" class="conf-marca ${m ? '' : 'falta'} ${p && p.marca && m !== p.marca ? 'so-cotacao' : ''}" data-act="dcEditarMarca" title="Clique ou comece a digitar para trocar a marca">${m ? esc(m) : 'Informar marca'}</div>
      <div class="conf-botoes">
        <button type="button" class="conf-btn conf-btn-nao" data-act="dcDecidir" data-d="nao"><span class="kbd">←</span> Não vai</button>
        <button type="button" class="conf-btn conf-btn-vai" data-act="dcDecidir" data-d="vai">Vai para a cotação <span class="kbd">→</span> <span class="kbd">Espaço</span></button>
      </div>
    </div>
    <p class="small muted" style="margin:8px 0 0">
      <span class="kbd">→</span>/<span class="kbd">Espaço</span> vai · <span class="kbd">←</span> não vai · <span class="kbd">Backspace</span> item anterior ·
      digite para trocar a marca · <span class="kbd">Esc</span> volta aos grupos
    </p>`;
}

function renderSoDataCar() {
  const atual = $('#dlgDataCar');
  if (!atual) return render();
  const tmp = document.createElement('div');
  tmp.innerHTML = renderDataCar();
  atual.replaceWith(tmp.firstElementChild);
}

function renderDataCar() {
  const d = ui.datacar;
  if (!d) return '';
  return `
  <div class="dlg-fundo" id="dlgDataCar">
    <div class="dlg dlg-conf${d.modo === 'papel' ? ' modo-papel' : ''}" role="dialog" aria-modal="true" aria-labelledby="dcTitulo" tabindex="-1" id="dcCaixa">
      <div class="row-between">
        <h3 id="dcTitulo" style="margin:0">${d.modo === 'papel' ? '📝 Papelzinhos de São Sebastião' : 'Conferência por grupo de OBS'}</h3>
        <span class="muted small">${esc(d.arquivo)}</span>
      </div>
      <details class="conf-colunas">
        <summary class="small">Colunas do arquivo</summary>
        <div class="row" style="margin-top:6px">
          <label style="margin:0;display:flex;gap:6px;align-items:center">OBS (ordem)
            <select id="dcCol" style="width:auto;margin:0">${d.cab.map((c, i) => `<option value="${i}" ${i === d.col ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          </label>
          <label style="margin:0;display:flex;gap:6px;align-items:center">Código do item
            <select id="dcColCod" style="width:auto;margin:0">
              <option value="-1" ${d.colCod < 0 ? 'selected' : ''}>(escolha a coluna)</option>
              ${d.cab.map((c, i) => `<option value="${i}" ${i === d.colCod ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
          </label>
          ${d.colCod < 0 ? '<span class="badge warn">Não achei a coluna de código: escolha ao lado</span>' : ''}
        </div>
      </details>
      <div class="conf-busca">
        <input type="search" id="dcBusca" value="${esc(d.busca || '')}" placeholder="🔎 Buscar OBS, código ou descrição" autocomplete="off" aria-label="Buscar grupos">
        <label class="check-inline small"><input type="checkbox" id="dcSoPend" ${d.soPend ? 'checked' : ''}> só sem decisão</label>
      </div>
      <div id="dcConferencia">${conteudoConferencia()}</div>
      <div class="row-between" style="margin-top:8px">
        <span></span>
        <div class="row">
          <button data-act="dcCancelar">Cancelar</button>
          <button class="primary" data-act="dcAdicionar">Adicionar à cotação</button>
        </div>
      </div>
    </div>
  </div>`;
}

async function importarProdutos(file) {
  try {
    let linhas;
    if (/\.csv$|\.txt$/i.test(file.name)) {
      linhas = lerCSV(await file.text());
    } else {
      const wb = await novoLivroExcel();
      await wb.xlsx.load(await file.arrayBuffer());
      // a planilha COTAÇÃO COMPLETA tem o banco na aba "BANCO DE DADOS"
      const ws = wb.worksheets.find(w => /^banco/i.test(w.name.trim())) || wb.worksheets[0];
      linhas = [];
      ws.eachRow({ includeEmpty: false }, row => {
        const vals = [];
        for (let col = 1; col <= Math.max(row.cellCount, 6); col++) vals.push(cellTexto(row.getCell(col)));
        linhas.push(vals);
      });
    }
    if (!linhas.length) throw new Error('Arquivo vazio.');

    // o cabeçalho pode não estar na 1ª linha (ex.: título "BANCO DE DADOS" em cima)
    const lerCab = l => {
      const cab = l.map(semAcento);
      const idx = {};
      for (const [campo, nomes] of Object.entries(MAPA_COLUNAS)) {
        const i = cab.findIndex(h => nomes.includes(h));
        if (i >= 0) idx[campo] = i;
      }
      return idx;
    };
    let linhaCab = linhas.slice(0, 10).findIndex(l => lerCab(l).descricao != null);
    const idx = lerCab(linhas[Math.max(0, linhaCab)]);
    let dados = linhas;
    if (linhaCab >= 0) dados = linhas.slice(linhaCab + 1);
    else Object.assign(idx, { codigo: 0, descricao: 1, unidade: 2, marca: 3, categoria: 4, obs: 5 });

    const porCodigo = Object.fromEntries(db.produtos.filter(p => p.codigo).map(p => [semAcento(p.codigo), p]));
    let novos = 0, atualizados = 0;
    const semMarca = [];
    for (const l of dados) {
      const get = k => (idx[k] != null ? String(l[idx[k]] ?? '').trim() : '');
      const p = { codigo: get('codigo'), similar: get('similar'), descricao: get('descricao'), unidade: get('unidade').toUpperCase() || 'UN', marca: get('marca'), categoria: get('categoria'), obs: get('obs') };
      if (!p.descricao) continue;
      const existente = p.codigo && porCodigo[semAcento(p.codigo)];
      if (existente) {
        Object.assign(existente, Object.fromEntries(Object.entries(p).filter(([, v]) => v)));
        atualizados++;
      } else if (!p.marca) {
        semMarca.push(p.codigo || p.descricao); // sem marca exigida não entra no banco
      } else {
        const novo = { id: uid(), ...p, criadoEm: new Date().toISOString() };
        db.produtos.push(novo);
        if (novo.codigo) porCodigo[semAcento(novo.codigo)] = novo;
        novos++;
      }
    }
    salvar();
    render();
    const resumo = `${novos} produto(s) novo(s), ${atualizados} atualizado(s).`;
    if (semMarca.length) avisar(`${resumo}\n\n${semMarca.length} produto(s) novo(s) sem marca exigida NÃO entraram no banco:\n${semMarca.slice(0, 15).join(', ')}${semMarca.length > 15 ? '…' : ''}\n\nPreencha a coluna de marca na planilha e importe de novo.`);
    else toast(resumo);
  } catch (e) {
    console.error(e);
    avisar('Erro ao importar produtos:\n' + e.message);
  }
}

/* ---------------- e-mail ---------------- */

/** Links e textos do e-mail. tipo: 'cotacao' (padrão) ou 'cobranca'. */
function dadosEmail(c, f, tipo = 'cotacao', formato = 'lojas') {
  const cfg = db.config;
  const D = DEFAULT_DB.config;
  const [tplA, tplC] = tipo === 'cobranca' ? [cfg.assuntoCobranca || D.assuntoCobranca, cfg.corpoCobranca || D.corpoCobranca]
    : tipo === 'pedido' ? [cfg.assuntoPedido || D.assuntoPedido, cfg.corpoPedido || D.corpoPedido]
      : [cfg.assuntoEmail, cfg.corpoEmail];
  const extra = tipo === 'pedido' && f ? varsPedido(c, f.fornecedorId, formato) : {};
  const assunto = preencherModelo(tplA, c, f, extra);
  const corpo = preencherModelo(tplC, c, f, extra);
  return {
    assunto,
    corpo,
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(f?.email || '')}&su=${enc(assunto)}&body=${enc(corpo)}`,
    outlook: `https://outlook.office.com/mail/deeplink/compose?to=${enc(f?.email || '')}&subject=${enc(assunto)}&body=${enc(corpo)}`,
    mailto: `mailto:${enc(f?.email || '')}?subject=${enc(assunto)}&body=${enc(corpo.replace(/\n/g, '\r\n'))}`,
  };
}

/** Um e-mail só para vários fornecedores, com todos em cópia oculta (ninguém vê os outros). */
function dadosEmailGrupo(c, fornecedores, tipo = 'cotacao') {
  const m = dadosEmail(c, null, tipo);
  const emails = fornecedores.map(f => f.email).filter(Boolean);
  const cco = emails.join(',');
  const para = db.config.email || '';
  return {
    ...m,
    emails,
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(para)}&bcc=${enc(cco)}&su=${enc(m.assunto)}&body=${enc(m.corpo)}`,
    mailto: `mailto:${enc(para)}?bcc=${enc(cco)}&subject=${enc(m.assunto)}&body=${enc(m.corpo.replace(/\n/g, '\r\n'))}`,
  };
}

/** Fim do prazo de resposta: a data com a hora marcada (sem hora: até o fim do dia). */
function limitePrazo(c) {
  if (!c.prazoResposta) return null;
  const [a, m, d] = c.prazoResposta.split('-').map(Number);
  const [h, mi] = (c.prazoHora || '23:59').split(':').map(Number);
  return new Date(a, m - 1, d, h || 0, mi || 0, c.prazoHora ? 0 : 59, c.prazoHora ? 0 : 999);
}

/** "29/09/2026 às 09:00" (ou só a data, sem hora marcada). */
function textoDataPrazo(c) {
  return c.prazoResposta ? fmtData(c.prazoResposta) + (c.prazoHora ? ` às ${c.prazoHora}` : '') : '';
}

/** Respondeu dentro do prazo (data e hora)? */
function respondeuNoPrazo(c, f) {
  const lim = limitePrazo(c);
  return !!(lim && f.respondidoEm && new Date(f.respondidoEm) <= lim);
}

/** Dias até o prazo de resposta (negativo = vencido; -0,5 = venceu hoje, depois da hora marcada). */
function diasAtePrazo(c) {
  if (!c.prazoResposta) return null;
  const [a, m, d] = c.prazoResposta.split('-').map(Number);
  const [ha, hm, hd] = hojeISO().split('-').map(Number);
  const dias = Math.round((Date.UTC(a, m - 1, d) - Date.UTC(ha, hm - 1, hd)) / 86400000);
  return dias === 0 && Date.now() > limitePrazo(c) ? -0.5 : dias;
}

function textoPrazo(dias, hora = '') {
  if (dias == null) return '';
  const h = hora ? ` às ${hora}` : '';
  if (dias < 0 && dias > -1) return `venceu hoje${h}`;
  if (dias < 0) return dias === -1 ? 'venceu ontem' : `venceu há ${-dias} dias`;
  if (dias === 0) return `vence hoje${h}`;
  if (dias === 1) return `vence amanhã${h}`;
  return `vence em ${dias} dias`;
}

const respondeu = f => !!f.respondidoEm || Object.values(f.respostas || {}).some(r => r?.preco > 0);

/**
 * Cotação aberta com fornecedores sem resposta e prazo vencido ou perto de vencer.
 * Retorna { dias, pendentes: [índices dos fornecedores] } ou null.
 */
function situacaoPrazo(c) {
  if (c.status !== 'aberta' || c.arquivada) return null;
  const dias = diasAtePrazo(c);
  if (dias == null || dias > (Number(db.config.diasAviso) || 0)) return null;
  const pendentes = c.fornecedores.map((f, fi) => (respondeu(f) ? -1 : fi)).filter(fi => fi >= 0);
  return pendentes.length ? { dias, pendentes } : null;
}

function cotacoesComPrazo() {
  return db.cotacoes.map(c => ({ c, s: situacaoPrazo(c) })).filter(x => x.s)
    .sort((a, b) => a.s.dias - b.s.dias);
}

function marcarEnviado(c, fi, tipo = 'cotacao') {
  const f = c.fornecedores[fi];
  if (!f) return;
  if (tipo === 'cobranca') f.cobradoEm = new Date().toISOString();
  else if (tipo === 'pedido') f.pedidoEnviadoEm = new Date().toISOString();
  else f.enviadoEm = new Date().toISOString();
  salvar();
}

/** Gera as planilhas dos fornecedores `fis` e salva num .zip. */
async function salvarZip(c, fis) {
  if (!fis.length) { avisar('Marque pelo menos um fornecedor.'); return; }
  const gerar = async () => {
    const arquivos = [];
    for (const fi of fis) {
      const f = c.fornecedores[fi];
      const wb = await gerarPlanilha(c, f);
      arquivos.push({ nome: nomePlanilha(c, f), dados: new Uint8Array(await wb.xlsx.writeBuffer()) });
    }
    return criarZip(arquivos);
  };
  const ok = await salvarComo(`Cotacao_${c.numero}_planilhas.zip`, gerar, TIPO_ZIP);
  if (ok && nuvem.downloads) toast(`${fis.length} planilha(s) no arquivo .zip.`);
}

/** Grava as planilhas numa pasta escolhida (Chrome/Edge com o arquivo aberto no computador). */
async function salvarNaPasta(c, fis) {
  let dir;
  try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { return; }
  for (const fi of fis) {
    const f = c.fornecedores[fi];
    const wb = await gerarPlanilha(c, f);
    const h = await dir.getFileHandle(nomePlanilha(c, f), { create: true });
    const w = await h.createWritable();
    await w.write(new Blob([await wb.xlsx.writeBuffer()], { type: TIPO_XLSX }));
    await w.close();
  }
  toast(`${fis.length} planilha(s) salvas na pasta "${dir.name}".`);
}

function abrirLote(c, fis, tipo) {
  ui.lote = { cotId: c.id, tipo, ids: fis.map(fi => c.fornecedores[fi].fornecedorId), inicio: new Date().toISOString() };
  ui.enviando = null;
  ui.digitando = null;
  render();
  $('#painelLote')?.scrollIntoView({ behavior: 'smooth' });
}

async function copiar(texto, el) {
  try {
    await navigator.clipboard.writeText(texto);
    toast('Copiado.');
  } catch (e) {
    const alvo = el && el.closest('.copiavel')?.querySelector('.copia-alvo');
    if (alvo) {
      const r = document.createRange();
      r.selectNodeContents(alvo);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    toast('Selecionei o texto. Use Ctrl+C para copiar.');
  }
}

/* ============================================================
 * TELAS
 * ============================================================ */

/*
 * Índices dos produtos, refeitos só quando os dados mudam (salvar() muda versaoDados; carregar troca db.produtos).
 * Evita varrer e tirar acento dos ~10 mil produtos a cada tecla.
 */
let cacheIndices = null;
function indices() {
  const c = cacheIndices;
  if (c && c.v === versaoDados && c.ref === db.produtos && c.n === db.produtos.length) return c;
  const porId = {}, codigos = new Set(), busca = [];
  for (const p of db.produtos) {
    porId[p.id] = p;
    const cods = [p.codigo, p.similar].filter(Boolean).join(' ');
    const e = { p, texto: semAcento([cods, p.marca, p.descricao].filter(Boolean).join(' ')), cod: normCod(cods), codPrincipal: normCod(p.codigo) };
    busca.push(e);
    if (e.codPrincipal) codigos.add(e.codPrincipal);
  }
  cacheIndices = { v: versaoDados, ref: db.produtos, n: db.produtos.length, porId, codigos, busca, porIdBusca: Object.fromEntries(busca.map(e => [e.p.id, e])) };
  return cacheIndices;
}
const prodPorId = () => indices().porId;

/** Palavras da busca já preparadas: sem acento (texto) e só letras/números (código). */
const palavrasBusca = termo => String(termo || '').trim().split(/\s+/).filter(Boolean).map(pal => ({ t: semAcento(pal), c: normCod(pal) }));
const casaBusca = (pals, texto, cod) => pals.every(x => texto.includes(x.t) || (x.c && cod.includes(x.c)));

/** Busca na lista de itens da cotação: código (com ou sem traço/barra), similar, marca e descrição. */
function itemNaBusca(x, p, termo, pals = palavrasBusca(termo)) {
  if (!pals.length) return true;
  if (!x || !p) return false;
  const e = indices().porIdBusca[p.id];
  let texto = e ? e.texto : semAcento([p.codigo, p.similar, p.marca, p.descricao].filter(Boolean).join(' '));
  let cod = e ? e.cod : normCod([p.codigo, p.similar].filter(Boolean).join(' '));
  if (x.codigoArquivo) { texto += ' ' + semAcento(x.codigoArquivo); cod += ' ' + normCod(x.codigoArquivo); }
  if (x.marca) texto += ' ' + semAcento(x.marca);
  return casaBusca(pals, texto, cod);
}

/** Filtros rápidos da lista de itens da nova cotação. */
const TIPOS_ITENS = [
  ['semMarca', '⚠ Sem marca', 'Itens sem marca pedida'],
  ['repetido', '🔁 Repetidos', 'Mesmo código em mais de uma linha'],
  ['novo', '🆕 Novos no cadastro', 'Cadastrados agora pelo arquivo do DataCar'],
  ['papel', '📝 Papelzinhos', 'Vieram do arquivo de papelzinhos de São Sebastião'],
];
function itemNoTipo(ctx, x, i, tipo = ui.tipoItens) {
  if (!tipo || !x) return true;
  const p = ctx.prod[x.produtoId];
  if (tipo === 'semMarca') return !(x.marca || p?.marca);
  if (tipo === 'repetido') return ctx.repetido(x, i);
  if (tipo === 'novo') return !!x.novoCadastro;
  if (tipo === 'papel') return !!x.papelzinho;
  return true;
}
function htmlTiposItens(ctx) {
  const r = ctx.r;
  const conta = Object.fromEntries(TIPOS_ITENS.map(([k]) => [k, r.itens.filter((x, i) => itemNoTipo(ctx, x, i, k)).length]));
  if (ui.tipoItens && !conta[ui.tipoItens]) ui.tipoItens = '';
  const chips = TIPOS_ITENS.filter(([k]) => conta[k]).map(([k, rot, tit]) => `<button type="button" class="chip-tipo${ui.tipoItens === k ? ' ativo' : ''}${k === 'semMarca' || k === 'repetido' ? ' atencao' : ''}" data-act="tipoItens" data-tipo="${k}" title="${esc(tit)} — clique para ver só esses">${rot} <b>${conta[k]}</b></button>`);
  if (!chips.length) return '';
  return `<button type="button" class="chip-tipo${ui.tipoItens ? '' : ' ativo'}" data-act="tipoItens" data-tipo="">Todos <b>${r.itens.length}</b></button>${chips.join('')}`;
}

function contaFiltroItens() {
  const r = rascunho();
  if (!ui.filtroItens.trim() && !ui.tipoItens) return '';
  const prod = prodPorId();
  const pals = palavrasBusca(ui.filtroItens);
  const ctx = ui.tipoItens ? contextoNova() : null;
  const n = r.itens.filter((x, i) => itemNaBusca(x, prod[x.produtoId], null, pals) && (!ctx || itemNoTipo(ctx, x, i))).length;
  return n ? `${n} de ${r.itens.length} itens` : 'Nenhum item encontrado';
}

/** Produtos do cadastro que combinam com a busca e ainda não estão na cotação (código igual primeiro). */
function foraDaLista(termo, max = 6) {
  const t = String(termo || '').trim();
  if (!t) return { lista: [], total: 0 };
  const ja = new Set(rascunho().itens.map(x => x.produtoId));
  const alvo = normCod(t);
  const pals = palavrasBusca(t);
  const achados = indices().busca.filter(e => !ja.has(e.p.id) && casaBusca(pals, e.texto, e.cod));
  const peso = e => (alvo && e.codPrincipal === alvo ? 0 : alvo && e.codPrincipal.startsWith(alvo) ? 1 : 2);
  // só ordena o necessário: os de código igual/parecido primeiro, depois por descrição
  achados.sort((a, b) => peso(a) - peso(b) || COLLATOR.compare(a.p.descricao || '', b.p.descricao || ''));
  return { lista: achados.slice(0, max).map(e => e.p), total: achados.length };
}

/** A busca parece um código que não existe no banco (e não achou nada na lista)? Então dá para cadastrar. */
function codigoParaCadastrar(termo) {
  const t = String(termo || '').trim();
  if (!t || /\s/.test(t) || !normCod(t)) return '';
  if (indices().codigos.has(normCod(t))) return '';
  const prod = prodPorId();
  const pals = palavrasBusca(t);
  if (rascunho().itens.some(x => itemNaBusca(x, prod[x.produtoId], null, pals))) return '';
  return t.toUpperCase();
}

function htmlForaDaLista() {
  const termo = ui.filtroItens.trim();
  if (!termo) return '';
  const { lista, total } = foraDaLista(termo);
  const novo = codigoParaCadastrar(termo);
  const cadastrar = novo ? `<div class="fora-item"><button type="button" class="sm" data-act="cadastrarDaBusca">+ Cadastrar “${esc(novo)}” no banco e incluir</button>${lista.length ? '' : ' <span class="small muted">(Enter também)</span>'}</div>` : '';
  if (!lista.length) return `<p class="small muted">Nenhum produto com “${esc(termo)}” no cadastro${novo ? '.' : ' fora da lista.'}</p>${cadastrar}`;
  return `<p class="small muted">No cadastro, fora da lista${total > lista.length ? ` (${lista.length} de ${total}; digite mais para achar)` : ''}:</p>
    ${lista.map((p, k) => `<div class="fora-item">
      <button type="button" class="sm primary" data-act="incluirDaBusca" data-id="${p.id}" title="${k === 0 ? 'Enter na busca também inclui este' : 'Incluir na cotação'}">+ Incluir</button>
      <b>${esc(p.codigo || '—')}</b> <span>${esc(p.descricao)}</span> ${p.marca ? `<span class="muted">(${esc(p.marca)})</span>` : ''}${p.similar ? ` <span class="muted small">sim. ${esc(p.similar)}</span>` : ''}
    </div>`).join('')}${cadastrar}`;
}

/** Cadastra no banco um produto novo com o código buscado (pede a descrição) e inclui na cotação. */
async function cadastrarEIncluir(codigo) {
  if (!codigo) return;
  const descricao = await pedirValor(`Cadastrar o produto ${codigo} no banco e incluir na cotação.\n\nDescrição:`, { ok: 'Cadastrar e incluir' });
  if (!descricao) { $('#filtroItens')?.focus(); return; }
  const marca = await pedirValor(`${codigo} · ${descricao.toUpperCase()}\n\nMarca exigida (ex.: QUALQUER, SÓ COFAP):`, { opcoes: marcasConhecidas().slice(0, 300).map(x => x.m), ok: 'Cadastrar e incluir' });
  if (!marca) { toast('Sem marca exigida o produto não é cadastrado.'); $('#filtroItens')?.focus(); return; }
  const p = { id: uid(), codigo, descricao: descricao.toUpperCase(), unidade: 'UN', similar: '', marca: marca.toUpperCase(), categoria: '', obs: '', criadoEm: new Date().toISOString() };
  db.produtos.push(p);
  incluirNaLista(p.id);
  toast(`${codigo} · ${p.descricao} (${p.marca}) cadastrado no banco e incluído.`);
}

/** Inclui um produto do cadastro na cotação e põe o cursor nele (para já digitar a marca). */
function incluirNaLista(id) {
  const r = rascunho();
  const p = db.produtos.find(x => x.id === id);
  if (!p) return;
  if (!r.itens.some(x => x.produtoId === id)) {
    r.itens.push({ produtoId: id, quantidade: 1 });
    salvar();
  }
  render();
  const i = r.itens.findIndex(x => x.produtoId === id);
  if (i >= 0) moverCursorItem(i);
  toast(`Incluído na cotação: ${p.codigo || ''} · ${p.descricao}.`);
}

/** KIT CORREIA / KIT TENSOR: o código pode ser trocado só na cotação (o cadastro não muda). */
const codigoSoNaCotacao = p => /\bKIT (CORREIA|TENSOR)\b/.test(normMarca(p && p.descricao));

/** Itens da cotação sempre em ordem alfabética (A-Z) pela descrição. */
/** Ordem da lista da nova cotação: 'desc' (descrição A→Z, a da planilha), 'obs' (OBS do DataCar) ou 'cod' (código). */
function ordenarItensRascunho(r, prod, ordem = 'desc') {
  const desc = (a, b) => COLLATOR.compare(prod[a.produtoId]?.descricao || '', prod[b.produtoId]?.descricao || '');
  const cod = (a, b) => COLLATOR.compare(a.codigoArquivo || prod[a.produtoId]?.codigo || '', b.codigoArquivo || prod[b.produtoId]?.codigo || '');
  const obs = x => tirarXX((x.obsArquivo || [])[0] || '') || '\uffff'; // sem OBS vai para o fim
  r.itens.sort(ordem === 'cod' ? (a, b) => cod(a, b) || desc(a, b)
    : ordem === 'obs' ? (a, b) => COLLATOR.compare(obs(a), obs(b)) || desc(a, b) || cod(a, b)
      : (a, b) => desc(a, b) || cod(a, b));
}

/** O que a lista de itens da nova cotação precisa para desenhar: códigos repetidos, OBS… */
function contextoNova() {
  const r = rascunho();
  const prod = prodPorId();
  // Códigos repetidos: itens cujo código é igual ou CONTÉM o mesmo código de outro item
  // (ex.: "2527/GR12527" e "2527/RD45552", ou "UB152" e "UB152/20036"), ou várias linhas do arquivo no mesmo item.
  const codDe = x => x.codigoArquivo || prod[x.produtoId].codigo || '';
  const porToken = new Map();
  const tokensDe = r.itens.map((x, i) => {
    const toks = tokensCodigo(codDe(x));
    toks.forEach(t => { if (!porToken.has(t)) porToken.set(t, new Set()); porToken.get(t).add(i); });
    return toks;
  });
  const parceiros = r.itens.map((x, i) => {
    const set = new Set();
    tokensDe[i].forEach(t => porToken.get(t).forEach(j => { if (j !== i) set.add(j); }));
    return [...set];
  });
  const obsRep = o => o.filter(temXX).length > 1 || o.filter(v => !temXX(v)).length > 1; // XX e sem XX = duas lojas, não é repetido
  const repetido = (x, i = r.itens.indexOf(x)) => !x.dupVisto && (parceiros[i].length > 0 || obsRep(x.obsArquivo || []));
  const obsDe = x => {
    const k2 = chaveCodigo(codDe(x));
    const o = (r.obsPorCodigo && r.obsPorCodigo[k2]) || x.obsArquivo || [];
    return o.length ? o.map(v => v || 'sem OBS').join(' · ') : (prod[x.produtoId].obs || '—');
  };
  return { r, prod, codDe, tokensDe, parceiros, repetido, obsDe };
}

/** Painel "código repetido" da nova cotação. */
function painelRepetidos(ctx) {
  const { r, prod, codDe, tokensDe, parceiros, repetido, obsDe } = ctx;
  const gruposRep = [];
  {
    const visto = new Set();
    r.itens.forEach((x, i) => {
      if (visto.has(i) || !parceiros[i].length) return;
      const comp = [];
      const pilha = [i];
      while (pilha.length) {
        const j = pilha.pop();
        if (visto.has(j)) continue;
        visto.add(j);
        comp.push(j);
        parceiros[j].forEach(k => { if (!visto.has(k)) pilha.push(k); });
      }
      if (comp.some(j => repetido(r.itens[j], j))) {
        comp.sort((a, b) => a - b);
        const comuns = tokensDe[comp[0]].filter(t => comp.some(j => j !== comp[0] && tokensDe[j].includes(t)));
        gruposRep.push({ itens: comp, comum: comuns.sort((a, b) => a.length - b.length)[0] || '' });
      }
    });
  }
  const painelRep = gruposRep.length ? `
    <div class="painel-dup">
      <div class="painel-dup-titulo">⚠ <b>${gruposRep.length} caso(s) de código repetido</b> · compare os itens lado a lado e decida: <b>✓ Manter</b> ou <b>✕ Tirar</b></div>
      ${gruposRep.map(g => `
        <div class="dup-grupo">
          <div class="dup-comum">Código em comum: <b>${esc(g.comum.toUpperCase())}</b> · ${g.itens.length} itens${(() => {
            const kits = g.itens.filter(j => ehKit(codDe(r.itens[j]), prod[r.itens[j].produtoId].descricao)).length;
            return kits && kits < g.itens.length ? ' · <span class="aviso-kit">KIT e peça avulsa com o mesmo código: confira se precisa dos dois</span>' : '';
          })()}</div>
          ${g.itens.map(j => {
            const x = r.itens[j];
            const px = prod[x.produtoId];
            return `<div class="dup-item ${x.dupVisto ? 'visto' : ''}">
              <button type="button" class="link dup-num" data-act="irItem" data-i="${j}" title="Ver na lista">#${j + 1}</button>
              <span class="dup-cod">${esc(codDe(x))}</span>
              <span class="dup-desc">${ehKit(codDe(x), px.descricao) ? '<span class="badge kit">KIT</span> ' : ''}${esc(px.descricao)}</span>
              <span class="dup-obs">OBS: <b>${esc(obsDe(x))}</b></span>
              <span class="dup-marca">${esc(x.marca || px.marca || '')}</span>
              <span class="dup-acoes">${x.dupVisto ? '<span class="badge ok">mantido</span>' : `<button class="sm" data-act="manterItem" data-i="${j}">✓ Manter</button>`}
                <button class="sm danger" data-act="removerItem" data-i="${j}" title="Tirar da cotação">✕ Tirar</button></span>
            </div>`;
          }).join('')}
        </div>`).join('')}
    </div>` : '';

  return painelRep;
}

/** Produto do cadastro com este código (o código inteiro ou uma das partes "A/B"). */
function acharProdutoPorCodigo(cod) {
  const mapa = indiceProdutos();
  const k = v => semAcento(v).replace(/\s+/g, '');
  let p = mapa.get(k(cod)) || null;
  if (!p) for (const parte of String(cod).split(/[\/,;]+/)) { p = mapa.get(k(parte)); if (p) break; }
  return p;
}

/** O produto foi cadastrado agora e não é usado em mais nada (pode sair do cadastro). */
function produtoSoNesteItem(prodId, item) {
  return !db.cotacoes.some(c => c.itens.some(it => it.produtoId === prodId))
    && !rascunho().itens.some(y => y !== item && y.produtoId === prodId);
}

/**
 * Papelzinho com código incompleto ou errado: a correção vai para o cadastro.
 * Se o código corrigido já existe no cadastro, o item passa a ser aquele produto (sem repetir o cadastro).
 */
function corrigirCodigoPapel(i, valor) {
  const r = rascunho();
  const x = r.itens[i];
  const p = x && db.produtos.find(pp => pp.id === x.produtoId);
  const novo = String(valor || '').trim().toUpperCase();
  if (!x || !p) return;
  if (!novo || novo === String(x.codigoArquivo || p.codigo).toUpperCase()) { render(); return; }
  const eraNovo = !!x.novoCadastro;
  const existente = acharProdutoPorCodigo(novo);
  if (existente && existente.id !== p.id) {
    // já está no cadastro: usa o de lá (e o cadastro feito agora, se ninguém usa, sai)
    if (eraNovo && produtoSoNesteItem(p.id, x)) db.produtos = db.produtos.filter(pp => pp.id !== p.id);
    const outro = r.itens.find(y => y !== x && y.produtoId === existente.id);
    if (outro) {
      r.itens.splice(i, 1);
      toast(`${existente.codigo} já estava na cotação: o papelzinho foi juntado a ele.`, 6000);
    } else {
      Object.assign(x, { produtoId: existente.id, codigoArquivo: '', marca: '' });
      delete x.novoCadastro;
      toast(`Código corrigido: é o ${existente.codigo} do cadastro (${existente.descricao}${existente.marca ? ' · ' + existente.marca : ''}).`, 6000);
    }
  } else if (eraNovo) {
    // cadastrado agora pelo papelzinho: corrige o próprio cadastro
    p.codigo = novo;
    if (!p.descricao || p.descricao.toUpperCase() === String(x.codigoArquivo || '').toUpperCase()) p.descricao = p.descricao || novo;
    x.codigoArquivo = '';
    toast(`Código corrigido para ${novo} (salvo no cadastro).`);
  } else {
    // estava ligado a outro produto do cadastro por engano: cadastra o código certo
    const np = { id: uid(), codigo: novo, similar: '', descricao: novo, unidade: 'UN', marca: '', categoria: '', obs: '', criadoEm: new Date().toISOString() };
    db.produtos.push(np);
    Object.assign(x, { produtoId: np.id, codigoArquivo: '', marca: '', novoCadastro: true });
    toast(`${novo} não estava no cadastro: foi cadastrado. Preencha a descrição em Produtos e a marca na lista.`, 7000);
  }
  salvar();
  render();
}

/** Itens desta cotação cadastrados agora pelo DataCar que ainda estão sem marca exigida. */
function novosSemMarcaNaLista() {
  const r = rascunho();
  const prod = byId(db.produtos);
  return r.itens.map((x, i) => [x, i]).filter(([x]) => x.novoCadastro && !(x.marca || prod[x.produtoId]?.marca)).map(([, i]) => i);
}

function htmlAvisoNovosCad() {
  const r = rascunho();
  const novos = r.itens.filter(x => x.novoCadastro).length;
  if (!novos) return '';
  const falta = novosSemMarcaNaLista().length;
  return `<div class="aviso-novos-cad${falta ? '' : ' ok'}">🆕 <b>${novos} produto(s) novo(s)</b> cadastrado(s) pelo arquivo do DataCar (etiqueta "novo no cadastro").
    ${falta ? `<b>${falta} sem marca exigida</b>: preencha nos campos amarelos. <button type="button" class="sm primary" data-act="irNovoSemMarca">Ir para o próximo sem marca</button>` : '✓ Todos já têm marca.'}</div>`;
}

/** Uma linha da lista de itens da nova cotação. */
function linhaItemNova(ctx, x, i) {
  const { r, prod, codDe, parceiros, repetido } = ctx;
    const p = prod[x.produtoId];
    const dup = repetido(x, i);
    // OBS da planilha original: todas as linhas do arquivo com este código; senão as linhas usadas; senão a OBS do cadastro
    const k = chaveCodigo(x.codigoArquivo || p.codigo);
    const daPlanilha = (r.obsPorCodigo && r.obsPorCodigo[k]) || x.obsArquivo || [];
    const obs = daPlanilha.map(o => o || 'sem OBS');
    const origemObs = daPlanilha.length ? 'OBS na planilha' : p.obs ? 'OBS no cadastro' : '';
    const textoObs = daPlanilha.length ? obs : p.obs ? [p.obs] : [];
    return `<tr data-item-linha="${i}" ${itemNaBusca(x, p, ui.filtroItens) && itemNoTipo(ctx, x, i) ? '' : 'hidden'} class="${i === ui.cursorItem ? 'item-atual' : ''} ${dup ? 'item-dup' : ''}">
      <td class="c">${i + 1}</td>
      <td>${x.papelzinho
        ? `<input class="cod-item cod-papel" data-codigo-papel="${i}" value="${esc(x.codigoArquivo || p.codigo)}" title="Código do papelzinho: corrija se veio incompleto ou errado. A correção fica salva no cadastro (se o código já existir lá, o item passa a ser o do cadastro)." aria-label="Código de ${esc(p.descricao)} (papelzinho)" spellcheck="false" autocomplete="off">`
        : codigoSoNaCotacao(p)
        ? `<input class="cod-item ${x.codigoArquivo && x.codigoArquivo !== p.codigo ? 'so-cotacao' : ''}" data-codigo-item="${i}" value="${esc(x.codigoArquivo || p.codigo)}" title="Código só desta cotação: o cadastro continua ${esc(p.codigo)}." aria-label="Código de ${esc(p.descricao)} nesta cotação">`
        : esc(x.codigoArquivo || p.codigo)}${ehKit(x.codigoArquivo || p.codigo, p.descricao) ? ' <span class="badge kit">KIT</span>' : ''}${x.papelzinho ? ' <span class="tag-papel" title="Veio dos papelzinhos de São Sebastião">PAPELZINHOS</span>' : ''}${x.novoCadastro ? ` <span class="badge novo-cad" title="Não estava no cadastro: foi cadastrado agora pelo arquivo do DataCar${p.marca ? '' : '. Preencha a marca exigida.'}">🆕 novo no cadastro</span>` : ''}${dup ? ' <span class="badge warn">repetido</span>' : ''}${dup && parceiros[i].length ? `<br><span class="obs-dup">mesmo código em: ${parceiros[i].slice(0, 4).map(j => `<button type="button" class="link" data-act="irItem" data-i="${j}" title="Ir para a linha ${j + 1}">#${j + 1} ${esc(codDe(r.itens[j]))}</button>`).join(' ')}${parceiros[i].length > 4 ? ` +${parceiros[i].length - 4}` : ''}</span>` : ''}${x.codigoArquivo && x.codigoArquivo !== p.codigo ? `<br><span class="small muted">cadastro: ${esc(p.codigo)}</span>` : ''}${textoObs.length
        ? `<br><span class="${dup ? 'obs-dup' : 'obs-item'}" title="${origemObs}">OBS <b>${textoObs.map(esc).join(' · ')}</b></span>`
        : dup ? '<br><span class="obs-dup">OBS: não encontrada. Importe o arquivo do DataCar de novo para ver.</span>' : ''}
        ${textoObs.length || dup ? '' : '<br>'}<details class="sim-item"><summary title="Códigos similares (ficam no cadastro)">${p.similar ? `<b>${esc(p.similar)}</b> ✎` : '+ similar'}</summary><input data-similar-prod="${p.id}" value="${esc(p.similar)}" placeholder="Códigos similares" aria-label="Códigos similares de ${esc(p.descricao)}"></details></td>
      <td style="width:170px"><input class="${(x.marca || p.marca) ? '' : 'falta'} ${x.marca ? 'so-cotacao' : ''}" data-marca-item="${i}" value="${esc(x.marca || p.marca)}" placeholder="Informar marca" title="${p.marca ? `Cadastro: ${esc(p.marca)}. Alterar aqui muda só nesta cotação (Enter duas vezes grava como padrão no cadastro).` : 'Sem marca no cadastro: a marca informada fica salva.'}" aria-label="Marca de ${esc(p.descricao)}">${x.marca ? `<br><span class="small muted">cadastro: ${esc(p.marca)}</span>` : ''}</td>
      <td>${esc(p.descricao)}</td>
      <td class="c" style="white-space:nowrap">${dup ? `<button class="sm" data-act="manterItem" data-i="${i}" title="Manter na cotação e tirar o destaque">✓ Manter</button> ` : ''}<button class="sm danger" data-act="removerItem" data-i="${i}" title="Remover">✕</button></td>
    </tr>`;
}

/**
 * Redesenha só a linha do item i (e o painel de repetidos), sem refazer a tela inteira:
 * com centenas de itens, refazer tudo a cada marca salva travava a digitação.
 */
function atualizarLinhaItem(i) {
  const tr = document.querySelector(`#tabItens [data-item-linha="${i}"]`);
  const x = rascunho().itens[i];
  atualizarBarraCriar(); // "pontos a conferir" (item sem marca) acompanha
  if (!tr || !x) return render();
  const ctx = contextoNova();
  const tpl = document.createElement('template');
  tpl.innerHTML = linhaItemNova(ctx, x, i).trim();
  tr.replaceWith(tpl.content.firstElementChild);
  const painel = document.querySelector('.painel-dup');
  if (painel && ctx.parceiros[i].length) { // só quando o item aparece no painel
    const novo = painelRepetidos(ctx).trim();
    if (!novo) painel.remove();
    else {
      tpl.innerHTML = novo;
      painel.replaceWith(tpl.content.firstElementChild);
    }
  }
}

function renderNova() {
  const r = rascunho();
  const prod = prodPorId();
  r.itens = r.itens.filter(x => prod[x.produtoId]);
  ordenarItensRascunho(r, prod, ui.ordemItens);
  const forn = byId(db.fornecedores);
  r.fornecedorIds = r.fornecedorIds.filter(id => forn[id]);

  const ctx = contextoNova();
  const painelRep = painelRepetidos(ctx);
  const linhas = r.itens.map((x, i) => linhaItemNova(ctx, x, i)).join('');

  const fornList = db.fornecedores.length
    ? `<div class="checklist">${[...db.fornecedores].sort((a, b) => a.nome.localeCompare(b.nome)).map(f => `
        <label class="${r.fornecedorIds.includes(f.id) ? 'on' : ''}"><input type="checkbox" data-forn="${f.id}" ${r.fornecedorIds.includes(f.id) ? 'checked' : ''}>
        <span><b>${esc(f.nome)}</b><br><span class="small muted">${esc(f.email || 'sem e-mail')}</span></span></label>`).join('')}</div>`
    : '<p class="muted">Nenhum fornecedor cadastrado ainda.</p>';

  return `
  <section class="card nova-cab">
    <div class="nova-cab-topo">
      <h2>Nova cotação</h2>
      ${!r.titulo || !r.prazoResposta || (!r.obs && ultimaCotacao()?.obs) ? `<button type="button" class="sm nc-padrao" data-act="preencherPadraoNova" title="Preenche só o que está vazio: título do dia, prazo no próximo dia útil e as observações da última cotação. Os itens e fornecedores continuam.">↺ Preencher padrão</button>` : ''}
    </div>
    <div class="nova-cab-linha">
      <label class="nc-titulo">Título<input data-draft="titulo" value="${esc(r.titulo)}" placeholder="Ex.: COTAÇÃO 30 DE SETEMBRO"></label>
      <label class="nc-prazo">Responder até<span class="prazo-campos"><input type="date" data-draft="prazoResposta" value="${esc(r.prazoResposta)}"><input type="time" data-draft="prazoHora" value="${esc(r.prazoHora || '')}" aria-label="Hora do prazo" title="Hora (opcional)"></span></label>
    </div>
    <details class="nc-obs">
      <summary>📝 Observações para o fornecedor <span class="small muted nc-obs-resumo">${r.obs ? '· ' + esc(r.obs.replace(/\s+/g, ' ').slice(0, 90)) + (r.obs.length > 90 ? '…' : '') : '· nenhuma (clique para escrever; vai na planilha)'}</span></summary>
      <textarea data-draft="obs" rows="2" placeholder="Ex.: Entrega na loja, informar prazo e forma de pagamento.">${esc(r.obs)}</textarea>
    </details>
  </section>

  <section class="card">
    <h3>1. Itens da cotação (${r.itens.length})</h3>
    <div class="fontes-itens${r.itens.length ? '' : ' vazio'}">
    <div class="datacar-box${r.itens.length ? ' compacta' : ''}" data-soltar="datacar" title="Clique no botão ou arraste o arquivo para cá">
      <label class="btn ${r.itens.length ? '' : 'btn-primary'}" style="margin:0">📂 ${r.itens.length ? 'Abrir outro arquivo do DataCar' : 'Abrir arquivo do DataCar'}<input type="file" class="hidden" accept=".xlsx,.xls,.ods,.csv,.txt,.htm,.html" data-import-datacar></label>
      <span class="small muted">${r.itens.length ? 'Os itens de outro arquivo são somados à lista.' : 'Clique ou <b>arraste o arquivo para cá</b>. Os itens são reconhecidos pelo <b>código</b>; a <b>OBS</b> serve para ordenar e agrupar.'}</span>
    </div>
    ${painelRep}
    <div class="papel-box${r.papelzinhos ? ' feito' : ''}" data-soltar="papel" title="Clique no botão ou arraste o arquivo para cá">
      <label class="btn sm" style="margin:0" title="Planilha diária de São Sebastião (CÓDIGO / OBS). Não é obrigatória.">📝 ${r.papelzinhos ? 'Abrir outro arquivo de papelzinhos' : 'Papelzinhos de São Sebastião'}<input type="file" class="hidden" accept=".ods,.xlsx,.csv,.txt" data-import-papel></label>
      <span class="small ${r.papelzinhos ? '' : 'muted'}">${r.papelzinhos
        ? `✓ <b>${esc(r.papelzinhos.arquivo)}</b> · ${r.papelzinhos.adicionados} acrescentado(s) · ${r.papelzinhos.jaEstavam} já estava(m) na cotação`
        : r.itens.length ? 'opcional · ainda não importado' : 'Opcional: o arquivo diário da loja. O que já estiver na cotação não entra de novo; o resto entra com a etiqueta PAPELZINHOS.'}</span>
    </div>
    </div>
    ${r.itens.length ? `<div class="tipos-itens" id="tiposItens">${htmlTiposItens(ctx)}</div>` : ''}
    <div class="busca-itens"><input id="filtroItens" value="${esc(ui.filtroItens)}" placeholder="${r.itens.length ? '🔎 Procurar na lista ou no cadastro: código, similar, marca ou descrição' : '🔎 Ou procure um item no cadastro para adicionar (código, similar, marca ou descrição)'}" autocomplete="off" aria-label="Procurar nos itens da cotação e no cadastro"><span id="contaFiltroItens" class="small muted">${contaFiltroItens()}</span></div>
    <div id="avisoNovosCad">${htmlAvisoNovosCad()}</div>
    <div id="foraDaLista" class="fora-lista">${htmlForaDaLista()}</div>
    ${r.itens.length ? `<div class="table-wrap tab-itens" id="tabItens" tabindex="0" aria-label="Itens da cotação. Use as setas para navegar e digite para preencher a marca."><table>
      <thead><tr><th class="c">#</th><th>${(() => {
        const o = ui.ordemItens || 'desc';
        const bt = (k, rot, tit) => `<button type="button" class="th-ordem${o === k ? ' ativa' : ''}" data-act="ordemItens" data-ordem="${k}" title="${tit}">${rot}${o === k ? ' ↓' : ''}</button>`;
        return `${bt('cod', 'Código', 'Ordenar por código')} <span class="muted">·</span> ${bt('obs', 'OBS', 'Ordenar pela OBS do DataCar (mesma ordem da conferência)')}</th><th>Marca</th><th>${bt('desc', 'Descrição', 'Ordenar pela descrição (A→Z, a ordem da planilha)')}`;
      })()}</th><th></th></tr></thead>
      <tbody>${linhas}</tbody></table></div>
      <details class="atalhos-itens small muted"><summary>⌨ Atalhos do teclado na lista</summary>Clique numa linha e use <span class="kbd">↑</span> <span class="kbd">↓</span> para navegar · digite para preencher a marca (sugere as marcas do cadastro; <span class="kbd">Delete</span> apaga a sugestão) · <span class="kbd">Enter</span> salva nesta cotação e vai para o próximo · <span class="kbd">Enter</span> <span class="kbd">Enter</span> salva como padrão no cadastro · <span class="kbd">Esc</span> desfaz · <span class="kbd">F2</span> completa a marca sem apagar · <span class="kbd">Ctrl</span>+<span class="kbd">Delete</span> ou ✕ tira o item (pede confirmação) · em KIT CORREIA e KIT TENSOR o código pode ser trocado só nesta cotação</details>` : ''}
  </section>

  <section class="card">
    <div class="row-between">
      <h3>2. Fornecedores que vão receber (${r.fornecedorIds.length})</h3>
      ${db.fornecedores.length ? `<div class="forn-atalhos">${fornecedoresDeSempre().length ? `<button type="button" class="sm primary" data-act="fornDeSempre" title="Os mesmos fornecedores da última cotação">⭐ Os de sempre (${fornecedoresDeSempre().length})</button>` : ''}<button type="button" class="sm" data-act="fornTodos">Todos</button><button type="button" class="sm" data-act="fornNenhum">Nenhum</button></div>` : ''}
    </div>
    <p class="small muted" style="margin:-6px 0 10px" title="Ao importar a resposta, o fornecedor é identificado pelo nome escrito na planilha.">Opcional: dá para criar sem fornecedor e enviar a planilha para quem quiser.</p>
    ${fornList}
    <details>
      <summary>+ Cadastrar fornecedor novo</summary>
      <form data-form="fornecedorRapido" class="grid">
        <label>Nome / empresa *<input name="nome" required></label>
        <label>E-mail<input name="email" type="email"></label>
        <label>Contato (pessoa)<input name="contato"></label>
        <div class="actions" style="align-self:end"><button class="primary">Salvar e selecionar</button></div>
      </form>
    </details>
  </section>

  <div class="barra-criar" id="barraCriar">${htmlBarraCriar(r)}</div>
  ${renderDataCar()}`;
}

let cacheBusca = null;
const COLLATOR = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

/** Texto de busca (sem acentos) de cada produto, calculado uma vez. */
/** Texto de busca de cada produto, já em ordem de descrição (refeito só quando os dados mudam). */
function indiceBusca() {
  if (!cacheBusca) {
    cacheBusca = db.produtos.map(p => [p, semAcento(`${p.codigo} ${p.similar || ''} ${p.descricao} ${p.marca} ${p.categoria}`)])
      .sort((a, b) => COLLATOR.compare(a[0].descricao || '', b[0].descricao || ''));
  }
  return cacheBusca;
}

function linhasCotacoes() {
  const q = semAcento(ui.filtroCot);
  const lista = [...db.cotacoes]
    .sort((a, b) => (b.data + b.numero).localeCompare(a.data + a.numero))
    .filter(c => (ui.verArquivadas ? !!c.arquivada : !c.arquivada))
    .filter(c => !ui.statusCot || c.status === ui.statusCot)
    .filter(c => !q || semAcento(`${c.numero} ${c.titulo} ${c.fornecedores.map(f => f.nome).join(' ')} ${c.itens.map(i => i.descricao + ' ' + i.codigo).join(' ')}`).includes(q));
  if (!lista.length) return `<tr><td colspan="8" class="empty">${ui.verArquivadas ? 'Nenhuma cotação arquivada.' : 'Nenhuma cotação encontrada.'}</td></tr>`;
  return lista.map(c => {
    const resp = c.fornecedores.filter(f => f.respondidoEm).length;
    const { itensCotados } = comparar(c);
    const peds = itensCotados ? pedidosPorFornecedor(c) : [];
    const comPed = new Set([...peds.map(p => p.fi), ...c.fornecedores.map((f, fi) => (f.concluidoEm ? fi : -1)).filter(fi => fi >= 0)]);
    const exp = [...comPed].filter(fi => c.fornecedores[fi].concluidoEm).length;
    return `<tr class="linha-cot" data-abrir-cot="${esc(c.id)}" title="Abrir a cotação nº ${esc(c.numero)}">
      <td><a href="#" data-route="cotacao" data-id="${c.id}"><b>${esc(c.numero)}</b></a><span class="presenca-lista" data-cot="${esc(c.id)}">${htmlPresencaLista(c.id)}</span></td>
      <td>${fmtData(c.data)}</td>
      <td class="titulo-cot">${esc(c.titulo || '—')} <button type="button" class="link editar-titulo" data-act="editarTituloCot" data-id="${esc(c.id)}" title="Editar o título da cotação" aria-label="Editar o título da cotação nº ${esc(c.numero)}">✎</button></td>
      <td class="c">${c.itens.length}</td>
      <td class="c"><span class="badge ${resp === c.fornecedores.length && resp ? 'ok' : resp ? 'warn' : ''}">${resp}/${c.fornecedores.length}</span></td>
      <td class="c">${comPed.size ? `<span class="badge ${exp === comPed.size ? 'ok' : exp ? 'warn' : ''}">${exp}/${comPed.size}</span>` : '<span class="muted">—</span>'}</td>
      <td class="r">${itensCotados ? fmtMoeda(peds.reduce((t, pp) => t + pp.total, 0)) : '—'}</td>
      <td>${statusBadge(c.status)}</td>
    </tr>`;
  }).join('');
}

function avisosPrazo() {
  const lista = cotacoesComPrazo();
  if (!lista.length) return '';
  return `<section class="card aviso-prazo-card">
    <h3>⏰ Respostas ${lista.some(x => x.s.dias < 0) ? 'atrasadas ou ' : ''}perto do prazo</h3>
    <ul class="lista-prazo">${lista.map(({ c, s }) => `<li>
      <a href="#" data-route="cotacao" data-id="${c.id}"><b>Cotação nº ${esc(c.numero)}</b></a>
      <span class="badge ${s.dias < 0 ? 'danger' : 'warn'}">${textoPrazo(s.dias, c.prazoHora)}</span>
      ${(() => {
        const nomes = s.pendentes.map(fi => c.fornecedores[fi].nome);
        const conf = s.pendentes.filter(fi => c.fornecedores[fi].confirmadoEm).length;
        return `<span class="small" title="${esc(nomes.join(', '))}">faltam <b>${nomes.length}</b>: ${esc(nomes.slice(0, 4).join(', '))}${nomes.length > 4 ? ` e mais ${nomes.length - 4}` : ''}${conf ? ` · ${conf} confirmaram o recebimento` : ''}</span>
      <button type="button" class="sm" data-act="cobrarCot" data-id="${esc(c.id)}" title="E-mail de lembrete para quem ainda não respondeu">📣 Cobrar</button>`;
      })()}
    </li>`).join('')}</ul>
  </section>`;
}

/** Cotações que podem ser arquivadas: canceladas e finalizadas há mais de N dias. */
function paraArquivar() {
  const d = new Date();
  d.setDate(d.getDate() - (Number(db.config.arquivarDias) || 60));
  const limite = d.toISOString().slice(0, 10);
  return db.cotacoes.filter(c => !c.arquivada && !c.manterNaLista && (c.status === 'cancelada' || (c.status === 'finalizada' && c.data < limite)))
    .sort((a, b) => (a.data + a.numero).localeCompare(b.data + b.numero));
}

function sugestaoArquivar() {
  const lista = paraArquivar();
  if (!lista.length || ui.verArquivadas) return '';
  const canc = lista.filter(c => c.status === 'cancelada').length;
  const fin = lista.length - canc;
  return `<section class="card sugestao-arquivar">
    <div class="row-between">
      <span>🗂️ <b>${lista.length} cotação(ões) podem ser arquivadas</b>
        <span class="small muted">(${[canc && `${canc} cancelada(s)`, fin && `${fin} finalizada(s) há mais de ${Number(db.config.arquivarDias) || 60} dias`].filter(Boolean).join(', ')}: ${lista.map(c => 'nº ' + esc(c.numero)).join(', ')})</span></span>
      <button class="sm primary" data-act="arquivarSugeridas">Arquivar</button>
    </div>
    <p class="small muted" style="margin:4px 0 0">Arquivadas saem da lista para ela ficar mais leve, mas continuam no histórico de preços e nos relatórios.</p>
  </section>`;
}

function renderCotacoes() {
  const visiveis = db.cotacoes.filter(c => !c.arquivada);
  const nArq = db.cotacoes.length - visiveis.length;
  const abertas = visiveis.filter(c => c.status === 'aberta');
  const aguardando = abertas.reduce((s, c) => s + c.fornecedores.filter(f => !f.respondidoEm).length, 0);
  return `
  <section class="card">
    <div class="row-between">
      <h2>Cotações</h2>
      <div class="row">
        ${abertas.length ? '<label class="btn" style="margin:0" title="Importar as planilhas que os fornecedores devolveram (o sistema acha a cotação e o fornecedor de cada uma)">📥 Importar respostas<input type="file" class="hidden" accept=".xlsx,.xls" multiple data-import-geral></label>' : ''}
        <label class="btn" style="margin:0" title="Conferir a nota fiscal (XML da NF-e) com o pedido de compra">🧾 Conferir NF-e<input type="file" class="hidden" accept=".xml,text/xml,application/xml" multiple data-import-nfe-geral></label>
        <a class="btn btn-primary" href="#" data-route="nova">+ Nova cotação</a>
      </div>
    </div>
    <div class="stats">
      <a href="#" class="stat stat-link" data-act="filtroStatusCot" data-status="" title="Ver todas"><span class="muted small">Cotações na lista</span><b>${visiveis.length}</b>${nArq ? `<span class="small muted">+ ${nArq} arquivada(s)</span>` : ''}</a>
      <a href="#" class="stat stat-link" data-act="filtroStatusCot" data-status="aberta" title="Ver só as abertas"><span class="muted small">Abertas</span><b>${abertas.length}</b></a>
      <a href="#" class="stat stat-link${aguardando ? ' stat-atencao' : ''}" data-act="filtroStatusCot" data-status="aberta" title="Ver as abertas (onde faltam respostas)"><span class="muted small">Respostas pendentes</span><b>${aguardando}</b></a>
    </div>
    <div class="row filtros-cot">
      <input class="grow" id="filtroCot" placeholder="🔎 Buscar por nº, título, fornecedor ou produto…" value="${esc(ui.filtroCot)}">
      <div class="chips-status" role="group" aria-label="Status">${[['', 'Todas'], ...Object.entries(STATUS).map(([k, [t]]) => [k, t + 's'])].map(([k, t]) => {
        const n = k ? visiveis.filter(c => c.status === k).length : visiveis.length;
        return `<button type="button" class="chip-status${(ui.statusCot || '') === k ? ' ativo' : ''}" data-act="filtroStatusCot" data-status="${k}">${t} <b>${n}</b></button>`;
      }).join('')}</div>
      ${nArq || ui.verArquivadas ? `<label class="check-inline"><input type="checkbox" id="verArquivadas" ${ui.verArquivadas ? 'checked' : ''}> Ver só as arquivadas (${nArq})</label>` : ''}
    </div>
  </section>
  ${avisosPrazo()}
  ${sugestaoArquivar()}
  <section class="card table-wrap">
    <table>
      <thead><tr><th>Nº</th><th>Data</th><th>Título</th><th class="c">Itens</th><th class="c">Respostas</th><th class="c" title="Pedidos exportados / fornecedores com pedido">Pedidos</th><th class="r" title="Total do pedido: preço escolhido × quantidade, sem os itens em Dúvidas">Total do pedido</th><th>Status</th></tr></thead>
      <tbody id="tbCot">${linhasCotacoes()}</tbody>
    </table>
  </section>`;
}

function textoSel(c) {
  const n = c.fornecedores.filter(f => ui.sel?.ids.has(f.fornecedorId)).length;
  return n ? `${n} de ${c.fornecedores.length} marcado(s)` : 'Marque os fornecedores na primeira coluna';
}

function fornecedoresMarcados(c) {
  return c.fornecedores.map((f, fi) => ({ f, fi })).filter(x => ui.sel?.ids.has(x.f.fornecedorId));
}

/* ---------------- envio dos pedidos de compra ---------------- */

function nomeAbaSeguro(nome, usados) {
  const base = String(nome || 'Pedido').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Pedido';
  let n = base, k = 2;
  while (usados.has(n.toLowerCase())) n = `${base.slice(0, 26)} ${k++}`;
  usados.add(n.toLowerCase());
  return n;
}

/**
 * Planilha do pedido de um fornecedor: uma aba por loja (formato 'lojas', cada uma com o
 * endereço de entrega) ou uma aba com as lojas juntas. Sem quantidades por loja, uma aba só.
 */
async function gerarPedidoFornecedor(c, fornecedorId, formato = 'lojas') {
  const f = c.fornecedores.find(x => x.fornecedorId === fornecedorId);
  if (!f) return null;
  const wb = await novoLivroExcel();
  wb.creator = db.config.loja || 'Sistema de Cotação';
  wb.created = new Date();
  const usados = new Set();
  if (comparar(c).porLoja && formato !== 'juntas') {
    for (const lj of lojas()) {
      const ped = pedidosPorFornecedor(c, lj.id).find(p => p.f.fornecedorId === fornecedorId);
      if (ped) abaPedido(wb, c, ped, nomeAbaSeguro(lj.nome, usados), lj);
    }
  } else {
    const ped = pedidosPorFornecedor(c).find(p => p.f.fornecedorId === fornecedorId);
    if (ped) abaPedido(wb, c, ped, nomeAbaSeguro(f.nome, usados));
  }
  return wb.worksheets.length ? { wb, nome: nomePedido(c, f) } : null;
}

/** Campos do e-mail do pedido: {totalPedido} {itensPedido} {entrega} {pagamento}. */
function varsPedido(c, fornecedorId, formato = 'lojas') {
  const ped = pedidosPorFornecedor(c).find(p => p.f.fornecedorId === fornecedorId);
  if (!ped) return { totalPedido: fmtMoeda(0), itensPedido: '0', entrega: '', pagamento: '' };
  let entrega = '';
  if (ped.porLoja) {
    const linhas = lojas().map(lj => {
      const itens = ped.itens.filter(x => x.qtds[lj.id] > 0);
      if (!itens.length) return '';
      const total = itens.reduce((s, x) => s + x.preco * x.qtds[lj.id], 0);
      return `- ${lj.nome}${lj.endereco ? ' (' + lj.endereco + ')' : ''}: ${itens.length} item(ns), ${fmtMoeda(total)}`;
    }).filter(Boolean);
    entrega = (formato === 'juntas'
      ? 'Entregar nas lojas (a quantidade de cada loja está na planilha):\n'
      : 'O pedido está separado por loja, uma aba para cada:\n') + linhas.join('\n');
  } else if (db.config.endereco) entrega = `Entregar em: ${db.config.endereco}`;
  return {
    totalPedido: fmtMoeda(ped.total),
    itensPedido: String(ped.itens.length),
    entrega,
    pagamento: ped.f.cond?.pagamento || '',
  };
}

function painelEnvioPedidos(c) {
  const L = ui.lote;
  const porLoja = comparar(c).porLoja;
  const peds = pedidosPorFornecedor(c).filter(p => L.ids.includes(p.f.fornecedorId));
  if (!peds.length) return '';
  const atual = peds.find(p => !p.f.pedidoEnviadoEm && p.f.email);
  const feitos = peds.filter(p => p.f.pedidoEnviadoEm).length;
  const semEmail = peds.filter(p => !p.f.email);
  return `
  <section class="card envio" id="painelLote">
    <div class="row-between">
      <h3>Enviar pedidos de compra · ${peds.length} fornecedor(es)</h3>
      <button class="sm" data-act="fecharLote">Fechar</button>
    </div>
    ${porLoja ? `<div class="row formato-pedido">
      <span class="small"><b>Planilha do pedido:</b></span>
      <label class="check-inline"><input type="radio" name="formatoPedido" value="lojas" ${L.formato !== 'juntas' ? 'checked' : ''}> uma aba para cada loja</label>
      <label class="check-inline"><input type="radio" name="formatoPedido" value="juntas" ${L.formato === 'juntas' ? 'checked' : ''}> lojas juntas (uma coluna de quantidade por loja)</label>
    </div>` : ''}
    <div class="lote-opcao">
      <h4>Um e-mail para cada fornecedor <span class="small muted">(${feitos} de ${peds.length} enviado(s))</span></h4>
      <p class="small" style="margin:4px 0 8px">Cada fornecedor recebe uma planilha só com o pedido dele. O e-mail já vai com o total${porLoja ? ' e as lojas de entrega' : ''}; falta anexar a planilha.</p>
      <div class="row" style="margin-bottom:10px">
        <button class="sm primary" data-act="zipPedidos">⬇ Baixar os ${peds.length} pedidos (.zip)</button>
        <span class="small muted">Ou baixe o de cada um na linha dele (⬇ Pedido).</span>
      </div>
      <div class="table-wrap"><table class="tab-lote">
        <thead><tr><th></th><th>Fornecedor</th><th class="r">Pedido</th><th>E-mail</th><th>Abrir o e-mail (e anexar o pedido)</th><th></th></tr></thead>
        <tbody>${peds.map(p => {
          const f = p.f, fi = p.fi;
          const m = dadosEmail(c, f, 'pedido', L.formato);
          const ok = !!f.pedidoEnviadoEm;
          const marca = `data-marca-envio="${fi}" data-tipo="pedido"`;
          return `<tr class="${p === atual ? 'atual' : ''} ${ok ? 'feito' : ''}">
            <td class="c">${ok ? '<span class="ok-mark">✓</span>' : p === atual ? '▶' : ''}</td>
            <td><b>${esc(f.nome)}</b>${ok ? `<br><span class="small muted">enviado em ${fmtData(f.pedidoEnviadoEm)}</span>` : ''}</td>
            <td class="r">${fmtMoeda(p.total)}<br><span class="small muted">${p.itens.length} item(ns)</span></td>
            <td class="small">${f.email ? `${esc(f.email)} <button class="sm link" data-act="copiarTexto" data-texto="${esc(f.email)}" title="Copiar o e-mail">⧉</button>` : '<span class="badge warn">sem e-mail</span>'}</td>
            <td class="actions-cell">${f.email ? `
              <a class="btn sm${p === atual ? ' btn-primary' : ''}" href="${esc(m.gmail)}" target="_blank" rel="noopener" ${marca}>Gmail</a>
              <a class="btn sm" href="${esc(m.outlook)}" target="_blank" rel="noopener" ${marca}>Outlook</a>
              <a class="btn sm" href="${esc(m.mailto)}" ${marca}>Programa</a>
              <button class="sm link" data-act="copiarTexto" data-texto="${esc(m.corpo)}" title="Copiar o texto do e-mail">⧉ texto</button>` : '<span class="small muted">cadastre o e-mail em Fornecedores</span>'}</td>
            <td class="actions-cell">
              <button class="sm" data-act="baixarPedidoForn" data-forn="${esc(f.fornecedorId)}" title="${esc(nomePedido(c, f))}">⬇ Pedido</button>
              ${ok ? '' : `<button class="sm" data-act="marcarLote" data-f="${fi}" title="Marcar como enviado sem abrir o e-mail (ex.: mandou pelo WhatsApp)">✓</button>`}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="small muted" style="margin:6px 0 0">Ao abrir o e-mail de um fornecedor, o pedido fica marcado como enviado e o próximo da lista é destacado. O texto do e-mail pode ser mudado em Configurações.</p>
    </div>
    ${semEmail.length ? `<p class="small aviso-alertas" style="margin-top:10px">Sem e-mail cadastrado: ${semEmail.map(p => esc(p.f.nome)).join(', ')}. Baixe o pedido e mande pelo WhatsApp; depois marque com ✓.</p>` : ''}
  </section>`;
}

/** Painel de envio (ou cobrança) para vários fornecedores. */
function painelLote(c) {
  const L = ui.lote;
  if (L.tipo === 'pedido') return painelEnvioPedidos(c);
  const cob = L.tipo === 'cobranca';
  const lista = L.ids.map(id => c.fornecedores.findIndex(f => f.fornecedorId === id)).filter(fi => fi >= 0);
  if (!lista.length) return '';
  const feito = fi => (cob ? c.fornecedores[fi].cobradoEm && c.fornecedores[fi].cobradoEm >= L.inicio : c.fornecedores[fi].enviadoEm);
  const atual = lista.find(fi => !feito(fi) && c.fornecedores[fi].email) ?? -1;
  const nFeitos = lista.filter(feito).length;
  const semEmail = lista.filter(fi => !c.fornecedores[fi].email);
  const grupo = dadosEmailGrupo(c, lista.map(fi => c.fornecedores[fi]), L.tipo);
  const pasta = !nuvem.downloads && typeof window.showDirectoryPicker === 'function';
  return `
  <section class="card envio" id="painelLote">
    <div class="row-between">
      <h3>${cob ? 'Cobrar resposta' : 'Enviar a cotação'} · ${lista.length} fornecedor(es)</h3>
      <button class="sm" data-act="fecharLote">Fechar</button>
    </div>
    <div class="lote-opcao">
      <h4>Opção 1 · Um e-mail para cada fornecedor <span class="small muted">(${nFeitos} de ${lista.length} ${cob ? 'cobrado(s)' : 'enviado(s)'})</span></h4>
      ${!cob ? `<p class="small" style="margin:4px 0 8px">Primeiro baixe as planilhas. Cada uma já vem com o nome do fornecedor.</p>
      <div class="row" style="margin-bottom:10px">
        <button class="sm primary" data-act="zipLote">⬇ Baixar as ${lista.length} planilhas (.zip)</button>
        ${pasta ? '<button class="sm" data-act="pastaLote" title="Grava todas as planilhas numa pasta do computador">📁 Salvar numa pasta</button>' : ''}
        <span class="small muted">No .zip: botão direito → <b>Extrair tudo</b>, e anexe a planilha de cada um.</span>
      </div>` : '<p class="small" style="margin:4px 0 8px">O e-mail de lembrete já vai preenchido. Se o fornecedor pedir, reenvie a planilha (⬇ Excel).</p>'}
      <div class="table-wrap"><table class="tab-lote">
        <thead><tr><th></th><th>Fornecedor</th><th>E-mail</th><th>Abrir o e-mail ${cob ? '' : '(e anexar a planilha)'}</th><th></th></tr></thead>
        <tbody>${lista.map(fi => {
          const f = c.fornecedores[fi];
          const m = dadosEmail(c, f, L.tipo);
          const ok = feito(fi);
          const marca = `data-marca-envio="${fi}" data-tipo="${L.tipo}"`;
          return `<tr class="${fi === atual ? 'atual' : ''} ${ok ? 'feito' : ''}">
            <td class="c">${ok ? '<span class="ok-mark">✓</span>' : fi === atual ? '▶' : ''}</td>
            <td><b>${esc(f.nome)}</b>${ok ? `<br><span class="small muted">${cob ? 'cobrado' : 'enviado'} em ${fmtData(cob ? f.cobradoEm : f.enviadoEm)}</span>` : ''}</td>
            <td class="small">${f.email ? `${esc(f.email)} <button class="sm link" data-act="copiarTexto" data-texto="${esc(f.email)}" title="Copiar o e-mail">⧉</button>` : '<span class="badge warn">sem e-mail</span>'}</td>
            <td class="actions-cell">${f.email ? `
              <a class="btn sm${fi === atual ? ' btn-primary' : ''}" href="${esc(m.gmail)}" target="_blank" rel="noopener" ${marca}>Gmail</a>
              <a class="btn sm" href="${esc(m.outlook)}" target="_blank" rel="noopener" ${marca}>Outlook</a>
              <a class="btn sm" href="${esc(m.mailto)}" ${marca}>Programa</a>` : '<span class="small muted">cadastre o e-mail em Fornecedores</span>'}</td>
            <td class="actions-cell">
              <button class="sm" data-act="baixarPlanilha" data-f="${fi}" title="${esc(nomePlanilha(c, f))}">⬇ Excel</button>
              ${ok ? '' : `<button class="sm" data-act="marcarLote" data-f="${fi}" title="Marcar como ${cob ? 'cobrado' : 'enviado'} sem abrir o e-mail">✓</button>`}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="small muted" style="margin:6px 0 0">Ao abrir o e-mail de um fornecedor, ele fica marcado como ${cob ? 'cobrado' : 'enviado'} e o próximo da lista é destacado.</p>
    </div>
    <div class="lote-opcao">
      <h4>Opção 2 · Um e-mail só para todos, em cópia oculta</h4>
      <p class="small" style="margin:4px 0 8px">Mais rápido: um único e-mail, e um fornecedor não vê o endereço dos outros.
        ${cob ? '' : 'Anexe a <b>planilha da cotação</b> (sem nome): cada fornecedor escreve o nome dele no campo "Fornecedor". Se vier em branco, o sistema pergunta de quem é na hora de importar.'}</p>
      ${grupo.emails.length ? `<div class="row">
        ${cob ? '' : '<button class="sm" data-act="baixarGeral">⬇ Planilha da cotação</button>'}
        <a class="btn sm btn-primary" href="${esc(grupo.gmail)}" target="_blank" rel="noopener" data-marca-grupo data-tipo="${L.tipo}">Abrir no Gmail</a>
        <a class="btn sm" href="${esc(grupo.mailto)}" data-marca-grupo data-tipo="${L.tipo}">Programa de e-mail</a>
        <button class="sm" data-act="copiarTexto" data-texto="${esc(grupo.emails.join(', '))}">Copiar os ${grupo.emails.length} e-mails</button>
        <button class="sm" data-act="copiarTexto" data-texto="${esc(grupo.corpo)}">Copiar o texto</button>
      </div>` : '<p class="small muted">Nenhum destes fornecedores tem e-mail cadastrado.</p>'}
    </div>
    ${semEmail.length ? `<p class="small aviso-alertas" style="margin-top:10px">Sem e-mail cadastrado: ${semEmail.map(fi => esc(c.fornecedores[fi].nome)).join(', ')}. Mande pelo WhatsApp ou cadastre o e-mail em Fornecedores.</p>` : ''}
  </section>`;
}

function celTotal(l) {
  if (l.preco == null) return '—';
  const acima = l.estoque != null && l.q > l.estoque
    ? `<br><span class="acima-estoque" title="O fornecedor tem só ${fmtNum(l.estoque)} em estoque">⚠ acima do estoque (${fmtNum(l.estoque)})</span>` : '';
  // estoque informado pelo vencedor (Kaizen) e quanto ainda dá para pedir
  const est = l.estoque != null ? `<br><span class="estoque-info" title="Estoque informado pelo fornecedor na resposta">📦 estoque ${fmtNum(l.estoque)} · resta${Math.max(0, l.estoque - (l.q || 0)) === 1 ? '' : 'm'} ${fmtNum(Math.max(0, l.estoque - (l.q || 0)))}</span>` : '';
  const a = ui.alertaEstoque;
  const alerta = a && a.it === l.it && l.estoque != null
    ? `<div class="alerta-estoque" role="alert">⚠ <b>Estoque insuficiente</b>: você digitou <b>${fmtNum(a.digitado)}</b>${a.nomeLoja ? ` para ${esc(a.nomeLoja)}` : ''}, mas ${esc(a.forn)} informou só <b>${fmtNum(a.estoque)}</b> em estoque${a.outras ? ` (${fmtNum(a.outras)} já na outra loja)` : ''}. Ficou <b>${fmtNum(a.max)}</b>.</div>` : '';
  if (!l.q) return (l.naoComprar ? '<span class="nao-comprar" title="0 nas duas lojas: não vai em nenhum pedido">não comprar</span>' : '<span class="muted small">sem qtd.</span>') + est + alerta;
  return `${fmtMoeda(l.preco * l.q)}${l.q !== 1 ? `<br><span class="small muted">${fmtNum(l.q)} un.</span>` : ''}${acima}${est}${alerta}`;
}

/** Posições dos fornecedores da cotação em ordem alfabética (só a exibição muda; os dados continuam no lugar). */
/** Quadro "Fornecedores" da cotação aberto ou fechado (lembrado neste navegador; começa fechado). */
const CHAVE_FORN_ABERTO = 'cotacao.fornAberto';
function fornCotAberto() {
  try { return localStorage.getItem(CHAVE_FORN_ABERTO) === '1'; } catch (e) { return !!ui.fornAberto; }
}
function alternarFornCot(el) {
  const aberto = !fornCotAberto();
  ui.fornAberto = aberto;
  try { localStorage.setItem(CHAVE_FORN_ABERTO, aberto ? '1' : '0'); } catch (e) { /* só nesta sessão */ }
  // abre/fecha sem redesenhar a tela
  el.setAttribute('aria-expanded', String(aberto));
  el.title = `Clique para ${aberto ? 'fechar' : 'abrir'}`;
  el.querySelector('.seta-recolhe').textContent = aberto ? '▾' : '▸';
  const corpo = el.parentElement.querySelector('.corpo-recolhe');
  if (corpo) corpo.hidden = !aberto;
}

/**
 * Filtro do comparativo por fornecedor vencedor ("Mostrar itens de"): para digitar as quantidades
 * só dos itens de um fornecedor. '' = todos; '__sem' = sem preço / aguardando. Vale para a cotação aberta.
 */
function filtroVencedor(c) {
  return ui.filtroVenc && ui.filtroVenc.cotId === c.id ? ui.filtroVenc.valor : '';
}
function linhaNoFiltroVenc(c, l, valor = filtroVencedor(c)) {
  if (!valor) return true;
  if (valor === '__sem') return l.vencedor < 0;
  return l.vencedor >= 0 && c.fornecedores[l.vencedor].fornecedorId === valor;
}
/** Filtro pelas etiquetas de aviso ('aguardando', 'dif', 'marca', 'regra', 'demora', 'alertas'); '' = nenhum. */
function filtroAviso(c) {
  return ui.filtroAviso && ui.filtroAviso.cotId === c.id ? ui.filtroAviso.tipo : '';
}

/** Mostra só as linhas do fornecedor escolhido e do aviso escolhido (sem redesenhar a tabela). */
/** Busca do comparativo (código, descrição, similar ou marca pedida). */
function buscaComp(c) {
  return ui.buscaComp?.cotId === c.id ? ui.buscaComp.q : '';
}
function itemNaBuscaComp(it, q) {
  if (!q) return true;
  const t = semAcento(q);
  const k = normCod(q);
  return semAcento([it.codigo, it.descricao, it.similar, it.marca].filter(Boolean).join(' ')).includes(t)
    || (k.length >= 2 && (normCod(it.codigo).includes(k) || normCod(it.similar).includes(k)));
}

function aplicarFiltrosComp(c) {
  const fa = filtroAviso(c);
  const comp = comparar(c);
  const q = buscaComp(c);
  let vis = 0;
  for (const l of comp.linhas) {
    const tr = document.querySelector(`[data-comp-linha="${l.i}"]`);
    if (tr) tr.hidden = !(linhaNoFiltroVenc(c, l) && (!fa || tr.dataset.avisos.split(' ').includes(fa)) && itemNaBuscaComp(l.it, q));
    if (tr && !tr.hidden) vis++;
  }
  const cont = document.getElementById('buscaCompCont');
  if (cont) cont.textContent = q ? (vis ? `${vis} item(ns)` : 'nenhum item') : '';
  const barra = $('.avisos-comp');
  if (barra) {
    barra.dataset.filtro = fa;
    barra.querySelectorAll('.pill-aviso').forEach(b => b.classList.toggle('ativo', b.dataset.tipo === fa));
    const limpar = barra.querySelector('.limpar-aviso');
    if (limpar) { limpar.hidden = !fa; limpar.dataset.tipo = fa; }
  }
}

function opcoesVencedor(c, comp, atual = filtroVencedor(c)) {
  const cont = {};
  for (const l of comp.linhas) if (l.vencedor >= 0) cont[c.fornecedores[l.vencedor].fornecedorId] = (cont[c.fornecedores[l.vencedor].fornecedorId] || 0) + 1;
  const sem = comp.linhas.filter(l => l.vencedor < 0).length;
  const LJ = lojas();
  const falta = {};
  if (comp.porLoja) for (const l of comp.linhas) {
    if (l.vencedor < 0 || l.duvida) continue;
    if (!LJ.some(lj => c.qtds?.[l.i]?.[lj.id] != null)) { const id = c.fornecedores[l.vencedor].fornecedorId; falta[id] = (falta[id] || 0) + 1; }
  }
  const andamento = f => (f.concluidoEm ? ' · ✓ exportado' : !comp.porLoja ? '' : falta[f.fornecedorId] ? ` · faltam ${falta[f.fornecedorId]}` : ' · ✓ completo');
  const opcoes = ordemFornecedores(c).map(j => c.fornecedores[j]).filter(f => cont[f.fornecedorId])
    .map(f => `<option value="${esc(f.fornecedorId)}" ${atual === f.fornecedorId ? 'selected' : ''}>${esc(f.nome)} (${cont[f.fornecedorId]})${andamento(f)}</option>`).join('');
  return `<option value="">Todos os itens (${comp.linhas.length})</option>${opcoes}
      ${sem ? `<option value="__sem" ${atual === '__sem' ? 'selected' : ''}>Sem preço / aguardando (${sem})</option>` : ''}`;
}

/** Escolhe o fornecedor em "Mostrar itens de" (do comparativo ou da janela flutuante). */
function definirFiltroVencedor(c, valor) {
  ui.filtroVenc = { cotId: c.id, valor };
  anunciarPresenca();
  anotarUltimoLugar();
  setTimeout(atualizarPresencaTela, 300); // o aviso "também está em …" depende do meu fornecedor
  if (cotAtual() !== c) return;
  const sel = $('#filtroVencedor');
  if (sel && sel.value !== valor) sel.value = valor;
  const bt = $('#pedidoFiltro');
  if (bt) bt.outerHTML = botaoPedidoFiltro(c, valor);
  aplicarFiltrosComp(c);
}

function seletorVencedor(c, comp) {
  const atual = filtroVencedor(c);
  return `<label class="filtro-venc" title="Mostrar só os itens que um fornecedor ganhou"><span class="filtro-venc-rot">Itens de:</span>
    <select id="filtroVencedor" data-cot="${esc(c.id)}">
      ${opcoesVencedor(c, comp, atual)}
    </select></label>${botaoPedidoFiltro(c, atual)}<button type="button" class="sm btn-pip" data-act="abrirPip" title="Abre uma janela pequena com o item e as quantidades das lojas, para usar ao lado do DataCar (no Chrome/Edge ela fica sempre por cima). Enter vai para o próximo item.">🗗 Janela flutuante</button>`;
}

/**
 * Formas de mandar o pedido ao fornecedor:
 *  { tipo: 'individual' }            uma planilha por loja (quantidade e endereço de cada loja);
 *  { tipo: 'somada', lojaId }         uma planilha com as quantidades das lojas somadas, entregue numa loja
 *                                     (depois a loja transfere para a outra).
 */
/** Nome de arquivo válido no Windows, com a extensão certa. */
function nomeArquivoSeguro(nome, ext, padrao) {
  let n = String(nome || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (!n) n = padrao;
  return n.toLowerCase().endsWith(ext) ? n : n + ext;
}

/**
 * Checklist antes de exportar o pedido do fornecedor `fi`: o que ainda merece atenção nos itens que ele ganhou.
 * [{ nivel: 'erro'|'aviso'|'info', icone, texto, itens: [i] }]
 */
function checklistPedido(c, fi) {
  const comp = comparar(c);
  const f = c.fornecedores[fi];
  const LJ = lojas();
  const ganhos = comp.linhas.filter(l => l.vencedor === fi);
  const ultimos = ultimosPrecos(c.id);
  const itens = fn => ganhos.filter(fn).map(l => l.i);
  const lista = [];
  const add = (nivel, icone, texto, is) => { if (is.length) lista.push({ nivel, icone, texto, itens: is }); };
  if (comp.porLoja) {
    add('erro', '📦', 'sem quantidade (nenhuma loja digitada)', itens(l => !l.duvida && !LJ.some(lj => c.qtds?.[l.i]?.[lj.id] != null)));
  }
  add('erro', '📦', 'acima do estoque informado', itens(l => l.estoque != null && l.q > l.estoque));
  add('erro', '✗', 'com a marca recusada (comprando por não haver outro preço)', itens(l => l.recusadaGanhou));
  add('aviso', '🏷️', 'marca diferente da pedida ou para conferir', itens(l => (l.marcas[fi] === 'errada' || l.marcas[fi] === 'duvida') && !l.recusas[fi] && !l.permitidas[fi]));
  add('aviso', '⚠', 'preço fora do normal (último preço pago ou os outros fornecedores)', itens(l => {
    const o = f.respostas?.[l.i];
    const p = l.precos[fi];
    const ult = l.it.produtoId ? ultimos[l.it.produtoId] : null;
    return alertasPreco(p, ult, l.precos).length && !(o?.precoConferido != null && o.precoConferido === p);
  }));
  add('aviso', '⚠', 'mais de 100% de diferença para o 2º lugar (preço pode estar errado)', itens(l => difSuspeita(l)));
  add('info', '❓', 'em Dúvidas: ficam fora deste pedido até sair da fila', itens(l => l.duvida));
  add('info', '🐢', 'com entrega demorada (GO)', itens(l => entregaDemorada(f, f.respostas?.[l.i])));
  return lista;
}

function htmlChecklistPedido(c, lista, total) {
  if (!lista.length) return `<div class="check-pedido ok">✓ <b>Tudo conferido</b>: ${total} item(ns), nenhuma pendência.</div>`;
  const cod = i => esc(c.itens[i]?.codigo || `#${i + 1}`);
  const pend = lista.filter(x => x.nivel !== 'info').reduce((s, x) => s + x.itens.length, 0);
  return `<div class="check-pedido${pend ? ' pendente' : ' so-info'}">
    <b>${pend ? '⚠ Antes de exportar, confira:' : 'Para saber:'}</b>
    <ul>${lista.map(x => `<li class="nivel-${x.nivel}"><span>${x.icone}</span><span><b>${x.itens.length}</b> ${esc(x.texto)}<br><span class="small">${x.itens.slice(0, 6).map(cod).join(', ')}${x.itens.length > 6 ? ` e mais ${x.itens.length - 6}` : ''}</span></span></li>`).join('')}</ul>
  </div>`;
}

function dialogoFormatoPedido({ f, padrao, lojasComItens, porLoja, nomesArquivos = () => [], checklist = '', pendente = false, doc = document }) {
  const LJ = lojas();
  const opcoes = [
    { valor: 'individual', titulo: 'Planilhas individuais por loja', texto: `Um arquivo para cada loja, com a quantidade e o endereço de entrega dela${lojasComItens.length > 1 ? ` (${lojasComItens.map(x => x.nome).join(' e ')}, cada uma com o seu "Salvar como")` : ''}.`, desligada: !porLoja || !lojasComItens.length },
    ...LJ.map(lj => ({ valor: 'somada:' + lj.id, titulo: `Planilha somada — entregar em ${lj.nome}`, texto: `Um arquivo com as quantidades das lojas somadas, entregue em ${lj.nome}.` })),
  ];
  const atual = padrao ? (padrao.tipo === 'individual' ? 'individual' : 'somada:' + padrao.lojaId) : null;
  let marcada = opcoes.find(o => o.valor === atual && !o.desligada) || opcoes.find(o => !o.desligada);
  return new Promise(resolve => {
    const fundo = doc.createElement('div');
    fundo.className = 'dlg-fundo';
    fundo.innerHTML = `<div class="dlg dlg-formato" role="dialog" aria-modal="true" aria-label="Exportar pedido">
      <h3 style="margin:0 0 4px">⬇ Exportar pedido — ${esc(f.nome)}</h3>
      ${checklist}
      <p class="small muted" style="margin:0 0 10px">Como ${esc(f.nome)} recebe o pedido?${padrao ? ' (marcado: a forma usada da última vez)' : ''}</p>
      ${opcoes.map(o => `<label class="formato-opcao${o.desligada ? ' desligada' : ''}">
        <input type="radio" name="formatoExport" value="${esc(o.valor)}" ${o === marcada ? 'checked' : ''} ${o.desligada ? 'disabled' : ''}>
        <span><b>${esc(o.titulo)}</b><br><span class="small muted">${esc(o.desligada ? 'Digite as quantidades de cada loja no comparativo para usar esta opção.' : o.texto)}</span></span>
      </label>`).join('')}
      <div class="nomes-export"></div>
      <p class="small muted" style="margin:10px 0 0">Depois de salvar, a cotação de ${esc(f.nome)} fica marcada como <b>concluída</b>.</p>
      <div class="actions"><button type="button" data-r="0">Cancelar</button>${pendente ? '<button type="button" data-r="revisar">🔎 Revisar no comparativo</button>' : ''}<button type="button" class="primary" data-r="1">${pendente ? 'Exportar mesmo assim' : 'Exportar'}</button></div>
    </div>`;
    // nomes sugeridos para a forma marcada (trocar a forma sugere os nomes dela)
    const mostrarNomes = () => {
      const v = fundo.querySelector('input[name=formatoExport]:checked')?.value;
      const lista = v ? nomesArquivos(v) : [];
      fundo.querySelector('.nomes-export').innerHTML = lista.length ? `<h4>Nome do arquivo</h4>${lista.map(x => `<label class="nome-export"><span class="small muted">${esc(x.rotulo)}</span>
        <input data-nome-arq="${esc(x.id)}" value="${esc(x.nome)}" autocomplete="off" spellcheck="false"></label>`).join('')}` : '';
    };
    fundo.addEventListener('change', e => { if (e.target.name === 'formatoExport') mostrarNomes(); });
    const fechar = v => { fundo.remove(); doc.removeEventListener('keydown', tecla, true); resolve(v); };
    const confirmar = () => {
      const v = fundo.querySelector('input[name=formatoExport]:checked')?.value;
      if (!v) return;
      const nomes = Object.fromEntries([...fundo.querySelectorAll('[data-nome-arq]')].map(x => [x.dataset.nomeArq, x.value]));
      fechar({ formato: v === 'individual' ? { tipo: 'individual' } : { tipo: 'somada', lojaId: v.slice(7) }, nomes });
    };
    const tecla = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fechar(null); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); confirmar(); }
      else e.stopImmediatePropagation();
    };
    fundo.addEventListener('click', e => {
      e.stopPropagation();
      const b = e.target.closest('button[data-r]');
      if (b) { if (b.dataset.r === '1') confirmar(); else if (b.dataset.r === 'revisar') fechar({ revisar: true }); else fechar(null); }
    });
    doc.addEventListener('keydown', tecla, true);
    doc.body.appendChild(fundo);
    mostrarNomes();
    fundo.querySelector('input[name=formatoExport]:checked')?.focus();
  });
}

/** Exporta o pedido de um fornecedor no formato que ele usa e marca a cotação dele como concluída. */
async function exportarPedidoForn(c, fi, doc = document) {
  const f = c.fornecedores[fi];
  const LJ = lojas();
  const comp = comparar(c);
  const total = pedidosPorFornecedor(c).find(p => p.fi === fi);
  if (!f || !total) return avisar('Este fornecedor não ganhou nenhum item com quantidade.', doc);
  const porLoja = LJ.map(lj => ({ lj, ped: pedidosPorFornecedor(c, lj.id).find(p => p.fi === fi) })).filter(x => x.ped);
  const cad = db.fornecedores.find(x => x.id === f.fornecedorId);
  const nomeSomada = lj => `Pedido_${c.numero}_${slug(f.nome)}_entrega_${slug(lj.nome)}.xlsx`;
  const nomesArquivos = v => {
    if (v !== 'individual') {
      const lj = LJ.find(x => x.id === v.slice(7)) || LJ[0];
      return [{ id: 'somada', rotulo: `Planilha somada (entrega em ${lj.nome})`, nome: nomeSomada(lj) }];
    }
    return porLoja.map(({ lj }) => ({ id: lj.id, rotulo: `Planilha de ${lj.nome}`, nome: nomePedido(c, f, lj) }));
  };
  const lista = checklistPedido(c, fi);
  const ganhos = comp.linhas.filter(l => l.vencedor === fi).length;
  const pendente = lista.some(x => x.nivel !== 'info');
  const resp = await dialogoFormatoPedido({ f, padrao: f.formatoPedido || cad?.formatoPedido, lojasComItens: porLoja.map(x => x.lj), porLoja: comp.porLoja, nomesArquivos, checklist: htmlChecklistPedido(c, lista, ganhos), pendente, doc });
  if (!resp) return;
  if (resp.revisar) {
    // mostra só os itens deste fornecedor e leva até o primeiro com pendência
    const primeiro = lista.find(x => x.nivel !== 'info')?.itens[0];
    definirFiltroVencedor(c, f.fornecedorId);
    render();
    const tr = primeiro != null ? document.querySelector(`.tab-comp tr[data-comp-linha="${primeiro}"]`) : null;
    if (tr) { marcarLinhaComp(tr); tr.scrollIntoView({ block: 'center' }); }
    toast(`Mostrando os itens de ${f.nome}. Resolva as pendências e clique em Exportar de novo.`, 5000);
    return;
  }
  const escolha = resp.formato;
  const nomeDe = (id, padrao) => nomeArquivoSeguro(resp.nomes?.[id], padrao.slice(padrao.lastIndexOf('.')), padrao);
  await carregarExcel();
  const novoWb = () => { const wb = new ExcelJS.Workbook(); wb.creator = db.config.loja || 'Sistema de Cotação'; wb.created = new Date(); return wb; };
  let ok;
  if (escolha.tipo === 'individual') {
    const arquivos = porLoja.map(({ lj, ped }) => {
      const wb = novoWb();
      abaPedido(wb, c, ped, nomeAbaSeguro(lj.nome, new Set()), lj);
      return { nome: nomeDe(lj.id, nomePedido(c, f, lj)), wb };
    });
    // uma planilha Excel por loja; entre uma e outra, um clique seu abre o "Salvar como" da próxima
    // (o navegador só abre a janela de salvar depois de um clique)
    const salvas = [];
    for (const [k, a] of arquivos.entries()) {
      if (k > 0 && !(await confirmar(`✓ Planilha de ${porLoja[k - 1].lj.nome} salva.\n\nAgora salve a planilha de ${porLoja[k].lj.nome}.`, `Salvar a de ${porLoja[k].lj.nome}`, doc))) break;
      if (!(await baixarWorkbook(a.wb, a.nome))) break;
      salvas.push(porLoja[k].lj.nome);
    }
    ok = salvas.length === arquivos.length;
    if (!ok && salvas.length) return avisar(`Só a planilha de ${salvas.join(' e ')} foi salva. A cotação de ${f.nome} não foi marcada como concluída: exporte de novo para salvar as outras.`, doc);
  } else {
    const lj = LJ.find(x => x.id === escolha.lojaId) || LJ[0];
    const wb = novoWb();
    abaPedido(wb, c, total, nomeAbaSeguro(f.nome, new Set()), lj, { somada: true });
    ok = await baixarWorkbook(wb, nomeDe('somada', nomeSomada(lj)));
  }
  if (!ok) return; // cancelou a janela de salvar: não marca nada
  // lembra a forma deste fornecedor (nesta cotação e no cadastro, para as próximas)
  f.formatoPedido = escolha;
  if (cad) cad.formatoPedido = escolha;
  anotarPedidoExportado(c, fi);
  salvar();
  render();
  toast(`Pedido de ${f.nome} exportado. Cotação de ${f.nome} marcada como concluída.`);
}

/** "⬇ Pedido de X" para o fornecedor escolhido em "Mostrar itens de" (itens que ele ganhou + quantidades das lojas). */
function botaoPedidoFiltro(c, valor) {
  const fi = valor && valor !== '__sem' ? c.fornecedores.findIndex(f => f.fornecedorId === valor) : -1;
  if (fi < 0) return '<span id="pedidoFiltro"></span>';
  return `<span id="pedidoFiltro"><button class="sm primary" data-act="baixarPedido" data-f="${fi}" title="Só os itens que ${esc(c.fornecedores[fi].nome)} ganhou, com a quantidade de cada loja">⬇ Pedido de ${esc(c.fornecedores[fi].nome)}</button></span>`;
}

/**
 * Coluna "Dif. 1º × 2º": com o menor preço escolhido, mostra o 2º colocado; se você escolheu outro
 * fornecedor, mostra quem tem o menor preço e quanto o escolhido está mais caro.
 */
/** Diferença acima de 100% entre o 1º e o 2º (ou entre o escolhido e o menor): possível preço errado na planilha. */
const LIMITE_DIF_SUSPEITA = 1;
function difDaLinha(l) {
  if ((l.manual || l.preferencia) && l.minIdx >= 0 && l.min > 0) return l.preco / l.min - 1;
  return l.difSegundo;
}
const difGrande = l => difDaLinha(l) != null && difDaLinha(l) > LIMITE_DIF_SUSPEITA;
const difSuspeita = l => difGrande(l) && !l.difConferida;
const avisoDif = l => (l.difConferida
  ? '<br><span class="ok-conferido" title="Você conferiu esta diferença e marcou os preços como certos">✓ diferença conferida</span>'
  : `<br><button type="button" class="chip-alerta-dif" data-act="conferirDif" data-i="${l.i}" title="Diferença acima de 100%: um dos preços pode estar errado na planilha (preço da caixa em vez da unidade, vírgula no lugar errado…). Clique para marcar como certo.">⚠ confira o preço</button>`);

/** Marca que o fornecedor j respondeu no item (com a cor da conferência: certa, a conferir, diferente). */
function marcaAlternativa(c, l, j) {
  const m = c.fornecedores[j]?.respostas?.[l.i]?.marca;
  if (!m) return '<br><span class="marca-alt sem">sem marca</span>';
  const st = l.marcas[j];
  const cls = st === 'errada' ? ' errada' : st === 'duvida' ? ' conferir' : st === 'ok' || st === 'abrev' ? ' ok' : '';
  return `<br><span class="marca-alt${cls}" title="Marca que ${esc(c.fornecedores[j].nome)} respondeu${l.it.marca ? ` (pedida: ${esc(l.it.marca)})` : ''}">${esc(m)}</span>`;
}

function celulaDifSegundo(c, l) {
  const alerta = difGrande(l);
  const avisoDifSuspeita = alerta ? avisoDif(l) : '';
  // escolhido na mão (ou regra dos 5%): mostra o mais barato; senão, o 2º lugar
  const trocou = (l.manual || l.preferencia) && l.minIdx >= 0 && l.min > 0;
  if (!trocou && l.difSegundo == null) return '<span class="muted">—</span>';
  const j = trocou ? l.minIdx : l.segundoIdx;
  const preco = trocou ? l.min : l.segundo;
  const dif = trocou ? difDaLinha(l) : l.difSegundo;
  const f = c.fornecedores[j];
  const titulo = trocou
    ? (l.preferencia ? `Regra da Comando: ganha até 5% acima do menor preço. Menor preço: ${f.nome}, ${fmtMoeda(preco)}` : `Menor preço (ganharia sem a sua escolha): ${f.nome}, ${fmtMoeda(preco)}. O escolhido está ${fmtPct(dif)} mais caro.`)
    : `2º lugar: ${f.nome}, ${fmtMoeda(preco)} (${fmtPct(dif)} mais caro que o 1º, ${fmtMoeda(l.min)})`;
  return `<div class="dif-cel${trocou ? ' dif-menor' : ''}" title="${esc(titulo)}">
    <div class="dif-l1"><b class="dif-preco">${fmtMoeda(preco)}</b><span class="dif-seg${dif >= 0.1 ? ' grande' : ''}${alerta && !l.difConferida ? ' suspeita' : ''}">+${fmtPct(dif)}</span></div>
    <div class="dif-forn">${trocou ? '<span class="dif-tag">menor</span> ' : ''}${esc(f.nome)}</div>
    ${marcaAlternativa(c, l, j).replace('<br>', '')}${alerta ? avisoDifSuspeita : ''}
  </div>`;
}

/** Modo compacto do comparativo (meia tela): sem as colunas de cada fornecedor. Guardado neste computador. */
const CHAVE_COMPACTO = 'cotacao.compacto';
function modoCompacto() {
  let v = null;
  try { v = localStorage.getItem(CHAVE_COMPACTO); } catch (e) { /* sem acesso */ }
  return v == null ? window.innerWidth < 1000 : v === '1'; // sem escolha: compacto em janela estreita
}

/** Colunas de fornecedores do comparativo: esconde quem ainda não mandou nenhum preço (dá para mostrar). */
function fornecedoresVisiveisComp(c) {
  if (modoCompacto()) return [];
  const ordem = ordemFornecedores(c);
  if (ui.mostrarSemResposta) return ordem;
  const comPreco = ordem.filter(j => Object.values(c.fornecedores[j].respostas || {}).some(o => o?.preco > 0));
  return comPreco.length ? comPreco : ordem;
}

function ordemFornecedores(c) {
  return c.fornecedores.map((f, j) => j).sort((a, b) => COLLATOR.compare(c.fornecedores[a].nome || '', c.fornecedores[b].nome || ''));
}

function linhaTotalComp(c, comp) {
  const nf = c.fornecedores.length;
  const LJ = lojas();
  const qtdL = lj => comp.linhas.reduce((s, l) => s + qtdLoja(c, l.i, lj.id), 0);
  return `<tr class="total" id="totalComp">
    <td></td><td>Total dos itens cotados${comp.porLoja ? '<br><span class="small muted">com as quantidades das lojas</span>' : '<br><span class="small muted">1 unidade de cada</span>'}</td>
    ${fornecedoresVisiveisComp(c).map(j => comp.totais[j]).map(t => `<td class="r">${t.cotados ? fmtMoeda(t.total) : '—'}<br><span class="small muted">${t.cotados}/${c.itens.length} itens · ${t.vencidos} ganho(s)</span></td>`).join('')}
    <td class="fd">${comp.escolhasManuais ? 'Total com suas escolhas' : 'Melhor combinação'}</td>${nf > 1 ? '<td class="fd col-dif"></td>' : ''}
    ${LJ.map(lj => `<td class="c col-qtd fd">${qtdL(lj) ? `${fmtNum(qtdL(lj))} un.<br><span class="small">${fmtMoeda(comp.porLojaTotal[lj.id])}</span>` : '<span class="muted">—</span>'}</td>`).join('')}
    <td class="r fd">${fmtMoeda(comp.melhor)}${comp.escolhasManuais ? `<br><span class="small muted">menor possível ${fmtMoeda(comp.menorPossivel)}</span>` : ''}</td>
  </tr>`;
}

/* ---------------- pedido mínimo e frete ---------------- */

/** Regras do cadastro do fornecedor: pedido mínimo, frete e frete grátis a partir de um valor. */
function regrasForn(fornecedorId) {
  const f = db.fornecedores.find(x => x.id === fornecedorId) || {};
  return { minimo: Number(f.pedidoMinimo) || 0, frete: Number(f.frete) || 0, gratis: Number(f.freteGratisAcima) || 0 };
}

function custoFrete(r, total) {
  return r.frete && total > 0 && !(r.gratis && total >= r.gratis) ? r.frete : 0;
}

/** 2º colocado de um item, sem contar o fornecedor `fi` (evita marca errada quando dá). */
function alternativaItem(l, fi) {
  const cands = l.precos.map((p, j) => ({ j, preco: p })).filter(x => x.j !== fi && x.preco != null && !l.recusas?.[x.j]);
  const boas = cands.filter(x => l.marcas[x.j] !== 'errada' || l.permitidas?.[x.j]);
  const lista = (boas.length ? boas : cands).sort((a, b) => a.preco - b.preco);
  return lista[0] || null;
}

/**
 * Simula passar os itens ganhos pelo fornecedor `fi` para o 2º colocado de cada item:
 * quanto os itens ficam mais caros, como muda o frete e quem fica abaixo do mínimo.
 */
function simularMover(c, comp, fi) {
  const moves = [], presos = [];
  for (const l of comp.linhas) {
    if (l.vencedor !== fi || !l.q) continue;
    const alt = alternativaItem(l, fi);
    if (alt) moves.push({ l, j: alt.j, preco: alt.preco }); else presos.push(l);
  }
  if (!moves.length) return null;
  const antes = c.fornecedores.map((f, j) => comp.linhas.reduce((s, l) => s + (l.vencedor === j && l.q ? l.preco * l.q : 0), 0));
  const depois = [...antes];
  let extra = 0;
  for (const m of moves) {
    extra += (m.preco - m.l.preco) * m.l.q;
    depois[fi] -= m.l.preco * m.l.q;
    depois[m.j] += m.preco * m.l.q;
  }
  const regras = c.fornecedores.map(f => regrasForn(f.fornecedorId));
  const frete = tot => tot.reduce((s, t, j) => s + custoFrete(regras[j], t), 0);
  const freteAntes = frete(antes), freteDepois = frete(depois);
  const abaixoDepois = c.fornecedores.map((f, j) => j).filter(j => j !== fi && regras[j].minimo && depois[j] > 0 && depois[j] < regras[j].minimo && moves.some(m => m.j === j));
  return { moves, presos, extra, freteAntes, freteDepois, saldo: extra + freteDepois - freteAntes, abaixoDepois, depois };
}

/** Situação de cada pedido quanto a mínimo e frete, com a sugestão para os que ficaram abaixo. */
function analisarMinimos(c, comp) {
  const peds = pedidosPorFornecedor(c);
  const lista = peds.map(p => {
    const r = regrasForn(p.f.fornecedorId);
    const frete = custoFrete(r, p.total);
    const abaixo = r.minimo > 0 && p.total < r.minimo;
    return {
      p, r, frete, abaixo, falta: abaixo ? r.minimo - p.total : 0,
      faltaGratis: frete && r.gratis ? r.gratis - p.total : 0,
      ignorado: !!c.minimoOk?.[p.f.fornecedorId],
      sim: abaixo ? simularMover(c, comp, p.fi) : null,
    };
  });
  return { lista, freteTotal: lista.reduce((s, x) => s + x.frete, 0) };
}

function avisosMinimo(c, an) {
  const itens = an.lista.filter(x => (x.abaixo && !x.ignorado) || (x.frete && x.faltaGratis > 0 && !x.abaixo));
  if (!itens.length) return '';
  return `<div class="avisos-minimo">${itens.map(x => {
    const nome = esc(x.p.f.nome);
    if (!x.abaixo) {
      return `<p class="aviso-frete small">🚚 <b>${nome}</b> cobra frete de ${fmtMoeda(x.frete)}: faltam ${fmtMoeda(x.faltaGratis)} para o frete grátis (acima de ${fmtMoeda(x.r.gratis)}).</p>`;
    }
    const sim = x.sim;
    let sug = '';
    if (sim) {
      const tudo = !sim.presos.length;
      const qual = sim.moves.length === 1 ? (tudo ? 'o item' : '1 item') : `${tudo ? 'os ' : ''}${sim.moves.length} itens`;
      sug = `<br>Passar ${qual} para o 2º colocado: itens ${sim.extra >= 0 ? '+' : '−'}${fmtMoeda(Math.abs(sim.extra))}${sim.freteDepois !== sim.freteAntes ? `, frete ${sim.freteDepois > sim.freteAntes ? '+' : '−'}${fmtMoeda(Math.abs(sim.freteDepois - sim.freteAntes))}` : ''} → <b>${sim.saldo > 0 ? `custa ${fmtMoeda(sim.saldo)} a mais` : sim.saldo < 0 ? `economiza ${fmtMoeda(-sim.saldo)}` : 'mesmo valor'}</b>.
        ${sim.presos.length ? `<span class="muted">${sim.presos.length} item(ns) só ${nome} cotou e continuam com ele.</span>` : ''}
        ${sim.abaixoDepois.length ? `<span class="txt-ruim">Atenção: ${sim.abaixoDepois.map(j => esc(c.fornecedores[j].nome)).join(', ')} continuaria abaixo do mínimo.</span>` : ''}`;
    } else sug = '<br><span class="muted">Nenhum outro fornecedor cotou esses itens.</span>';
    return `<div class="aviso-minimo">
      <div>⚠ <b>${nome}</b>: pedido de ${fmtMoeda(x.p.total)}, abaixo do mínimo de ${fmtMoeda(x.r.minimo)} (faltam ${fmtMoeda(x.falta)}).${sug}</div>
      <div class="row">
        ${sim ? `<button class="sm primary" data-act="moverItensMinimo" data-f="${x.p.fi}">Passar os itens</button>` : ''}
        <button class="sm" data-act="manterMinimo" data-forn="${esc(x.p.f.fornecedorId)}" title="Vou completar o pedido ou o fornecedor aceita assim">Manter assim</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function celulaRecebimento(c, p, porLoja) {
  const LJ = lojas();
  const partes = [];
  const badge = (sit, rotulo) => {
    const [txt, cls] = ESTADO_REC[sit.estado];
    return `<span class="badge ${cls}" title="${sit.estado === 'parcial' ? `${sit.faltando} item(ns) ainda não chegaram` : ''}">${rotulo ? esc(rotulo) + ': ' : ''}${txt}</span>${sit.cobrar ? ` <span class="txt-ruim">cobrar ${fmtMoeda(sit.cobrar)}</span>` : ''}`;
  };
  const juntas = situacaoRecebimento(c, p.f.fornecedorId, null);
  if (porLoja) {
    for (const lj of LJ) {
      if (!p.itens.some(x => x.qtds[lj.id] > 0)) continue;
      const sit = situacaoRecebimento(c, p.f.fornecedorId, lj.id);
      if (sit.recs.length || !juntas.recs.length) partes.push(badge(sit, lj.nome));
    }
    if (juntas.recs.length) partes.push(badge(juntas, 'Lojas juntas'));
  } else partes.push(badge(juntas));
  const recs = (c.recebimentos || []).filter(r => r.fornecedorId === p.f.fornecedorId);
  const links = recs.map(r => `<button class="link" data-act="verNFe" data-rec="${r.id}">NF ${esc(r.nf.numero)}${nomeLojaRec(r) ? ' (' + esc(nomeLojaRec(r)) + ')' : ''}</button>`).join(' ');
  return partes.join('<br>') + (links ? `<br>${links}` : '');
}

function celulaFrete(x) {
  if (!x) return '';
  const partes = [];
  if (x.frete) partes.push(`frete ${fmtMoeda(x.frete)}`);
  else if (x.r.frete) partes.push('<span class="ok-mark">frete grátis</span>');
  if (x.r.minimo) partes.push(x.abaixo ? `<span class="txt-ruim">mín. ${fmtMoeda(x.r.minimo)}</span>` : `<span class="muted">mín. ${fmtMoeda(x.r.minimo)} ✓</span>`);
  return partes.join('<br>') || '—';
}

function secaoPedidos(c, comp) {
  const LJ = lojas();
  const peds = pedidosPorFornecedor(c);
  const semVencedor = comp.linhas.filter(l => l.vencedor < 0).length;
  const semQtd = comp.porLoja ? comp.linhas.filter(l => l.vencedor >= 0 && !l.q).length : 0;
  const emDuvida = comp.linhas.filter(l => l.duvida && l.vencedor >= 0).length;
  if (!peds.length) {
    return `<section class="card" id="secPedidos"><h3>Pedidos de compra</h3><p class="muted small">Nenhum item com quantidade ainda. Digite as quantidades das lojas no comparativo.</p></section>`;
  }
  const an = analisarMinimos(c, comp);
  const infoMin = fid => an.lista.find(x => x.p.f.fornecedorId === fid);
  const temFrete = an.lista.some(x => x.r.frete || x.r.minimo);
  const totLoja = (p, lj) => p.itens.reduce((s, x) => s + x.preco * (x.qtds[lj.id] || 0), 0);
  const itensLoja = (p, lj) => p.itens.filter(x => x.qtds[lj.id] > 0).length;
  return `
  <section class="card" id="secPedidos">
    <div class="row-between">
      <h3>Pedidos de compra</h3>
      <div class="row">
        ${comp.porLoja ? LJ.map(lj => `<button class="sm" data-act="baixarPedidos" data-loja="${esc(lj.id)}" title="Um arquivo com os pedidos de ${esc(lj.nome)}, uma aba por fornecedor">⬇ Todos de ${esc(lj.nome)}</button>`).join('') : ''}
        <button class="sm primary" data-act="enviarPedidos" title="Mandar o pedido de cada fornecedor por e-mail">✉ Enviar pedidos por e-mail</button>
        <label class="btn sm" style="margin:0" title="Conferir a nota fiscal (XML da NF-e) com o pedido">📥 Conferir NF-e (XML)<input type="file" class="hidden" accept=".xml,text/xml,application/xml" multiple data-import-nfe-cot></label>
        ${peds.length > 1 || comp.porLoja ? `<button class="sm" data-act="baixarPedidos" title="Um arquivo Excel com uma aba para cada fornecedor${comp.porLoja ? ', com a quantidade de cada loja' : ''}">⬇ Todos os pedidos${comp.porLoja ? ' (lojas juntas)' : ' (um arquivo)'}</button>` : ''}
      </div>
    </div>
    <p class="muted small" style="margin-top:0">Cada fornecedor recebe só os itens que ganhou no comparativo${comp.escolhasManuais ? `, incluindo as ${comp.escolhasManuais} escolha(s) feitas por você` : ''}.${semVencedor ? ` ${semVencedor} item(ns) ficaram sem preço.` : ''}${emDuvida ? ` <b class="txt-duvida">❓ ${emDuvida} item(ns) em Dúvidas ficam fora dos pedidos até saírem da fila.</b>` : ''}${semQtd ? ` ${semQtd} item(ns) com preço estão sem quantidade e não entram nos pedidos.` : ''}</p>
    ${avisosMinimo(c, an)}
    <div class="table-wrap"><table>
      <thead><tr><th>Fornecedor</th>${comp.porLoja ? LJ.map(lj => `<th class="r">${esc(lj.nome)}</th>`).join('') : ''}<th class="r">Total do pedido</th>${temFrete ? '<th class="r">Frete / mínimo</th>' : ''}<th>Pagamento / entrega</th><th>Recebimento</th><th></th></tr></thead>
      <tbody>${peds.map(p => `<tr>
        <td><b>${esc(p.f.nome)}</b><br><span class="small muted">${p.itens.length} item(ns)</span>${p.f.pedidoEnviadoEm ? `<br><span class="badge ok">✉ pedido enviado ${fmtData(p.f.pedidoEnviadoEm)}</span>` : ''}</td>
        ${comp.porLoja ? LJ.map(lj => `<td class="r">${itensLoja(p, lj) ? `${fmtMoeda(totLoja(p, lj))}<br><span class="small muted">${itensLoja(p, lj)} item(ns)</span>` : '<span class="muted">—</span>'}</td>`).join('') : ''}
        <td class="r"><b>${fmtMoeda(p.total)}</b></td>
        ${temFrete ? `<td class="r small">${celulaFrete(infoMin(p.f.fornecedorId))}</td>` : ''}
        <td class="small">${esc([p.f.cond?.pagamento, p.f.cond?.prazo].filter(Boolean).join(' · ') || '—')}</td>
        <td class="small">${celulaRecebimento(c, p, comp.porLoja)}</td>
        <td class="actions-cell">
          <label class="btn sm" style="margin:0" title="Conferir a nota fiscal deste fornecedor">📥 NF-e<input type="file" class="hidden" accept=".xml,text/xml,application/xml" multiple data-import-nfe="${p.fi}"></label>
          ${comp.porLoja ? LJ.map(lj => itensLoja(p, lj) ? `<button class="sm" data-act="baixarPedido" data-f="${p.fi}" data-loja="${esc(lj.id)}" title="Pedido só de ${esc(lj.nome)}">⬇ ${esc(lj.nome)}</button>` : '').join('') : ''}
          <button class="sm" data-act="baixarPedido" data-f="${p.fi}" title="${comp.porLoja ? 'Um pedido com as duas lojas (uma coluna de quantidade para cada)' : 'Pedido deste fornecedor'}">⬇ ${comp.porLoja ? 'Lojas juntas' : 'Pedido'}</button>
        </td>
      </tr>`).join('')}
      <tr class="total"><td>Total</td>${comp.porLoja ? LJ.map(lj => `<td class="r">${fmtMoeda(comp.porLojaTotal[lj.id])}</td>`).join('') : ''}<td class="r">${fmtMoeda(comp.melhor)}${an.freteTotal ? `<br><span class="small">+ frete ${fmtMoeda(an.freteTotal)} = <b>${fmtMoeda(comp.melhor + an.freteTotal)}</b></span>` : ''}</td>${temFrete ? '<td></td>' : ''}<td colspan="3"></td></tr>
      </tbody>
    </table></div>
  </section>`;
}

/** Atualiza totais e pedidos sem redesenhar a tabela (para não perder o campo em edição). */
/** Botão "⬇ Exportar (N)" do quadro Fornecedores (atualizado também enquanto se digitam as quantidades). */
function botaoExportarForn(f, fi, n) {
  return `<span class="exp-forn" data-exp-f="${fi}">${n
    ? `<button class="sm primary" data-act="exportarPedidoForn" data-f="${fi}" title="Exportar o pedido: só os itens que ${esc(f.nome)} ganhou (planilhas por loja ou somada) e marcar a cotação dele como concluída">⬇ Exportar (${n})</button>`
    : `<span class="btn-desligado" title="${f.respondidoEm ? `${esc(f.nome)} não ganhou nenhum item (com quantidade) no comparativo` : `${esc(f.nome)} ainda não respondeu: quando responder e ganhar itens, dá para exportar o pedido`}"><button class="sm" disabled>⬇ Exportar (0)</button></span>`}</span>`;
}
/** Administrador (ou uso local, sem login na nuvem). */
function ehAdmin() {
  return !nuvem.usuario || nuvem.admin === true;
}

/** Status da cotação em três botões (troca com confirmação). */
function seletorStatusCot(c) {
  return `<div class="status-cot" role="group" aria-label="Status da cotação">${Object.entries(STATUS).map(([k, [t, cls]]) => `<button type="button" class="st-${cls}${c.status === k ? ' ativo' : ''}" data-act="mudarStatusCot" data-status="${k}" aria-pressed="${c.status === k}">${c.status === k ? '● ' : ''}${esc(t)}</button>`).join('')}</div>`;
}

/** Próximo número livre: maior que o de todas as cotações (o contador pode estar atrasado em outro computador). */
function proximoNumeroCot() {
  const maior = Math.max(0, ...db.cotacoes.map(c => parseInt(c.numero, 10) || 0));
  return Math.max(Number(db.config.proxNumero) || 1, maior + 1);
}
/** Esta cotação tem o número repetido e é a mais nova das que o repetem (é ela que deve trocar). */
function numeroRepetidoCot(c) {
  const iguais = db.cotacoes.filter(x => x.numero === c.numero);
  if (iguais.length < 2) return false;
  const mais = [...iguais].sort((a, b) => String(b.criadoEm || b.data || '').localeCompare(String(a.criadoEm || a.data || '')))[0];
  return mais.id === c.id;
}

/** Cotação finalizada fica só para consulta (até você destravar nesta tela). */
function cotTravada(c) {
  return !!c && c.status === 'finalizada' && !ui.destravadas?.has(c.id);
}
const ACOES_TRAVADAS = new Set(['escolherVencedor', 'duvidaItem', 'marcaResposta', 'removerPreco', 'limparEscolhas', 'conferirPreco', 'conferirDif']);
function avisarTravada() {
  toast(ehAdmin() ? '🔒 Cotação finalizada: só para consulta. Para mudar algo, clique em "Editar mesmo assim" no comparativo.'
    : '🔒 Cotação finalizada: só para consulta. Para mudar algo, peça a um administrador.');
}

/** Números da cotação para o cabeçalho: pedido, economia, pedidos exportados, quantidades e dúvidas. */
function htmlResumoCot(c, comp = comparar(c)) {
  if (!comp.itensCotados) return '';
  const peds = pedidosPorFornecedor(c);
  const total = peds.reduce((t, p) => t + p.total, 0);
  let media = 0, base = 0;
  for (const l of comp.linhas) {
    if (l.preco == null || !l.q) continue;
    const validos = l.precos.filter(p => p != null);
    if (validos.length < 2) continue;
    media += (validos.reduce((a, b) => a + b, 0) / validos.length - l.preco) * l.q;
    base += l.preco * l.q;
  }
  const comPed = new Set([...peds.map(p => p.fi), ...c.fornecedores.map((f, fi) => (f.concluidoEm ? fi : -1)).filter(fi => fi >= 0)]);
  const exp = [...comPed].filter(fi => c.fornecedores[fi].concluidoEm).length;
  const itensVenc = comp.linhas.filter(l => l.vencedor >= 0 && !l.duvida);
  const comQtd = itensVenc.length - pendentesPip(c, itensVenc.map(l => l.i)).length;
  const nDuv = comp.linhas.filter(l => l.duvida).length;
  const fin = c.status === 'finalizada';
  const kpi = (rot, val, sub = '', cls = '', extra = '') => `<div class="rc-kpi ${cls}"${extra}><span class="rc-rot">${rot}</span><b>${val}</b>${sub ? `<span class="rc-sub">${sub}</span>` : ''}</div>`;
  return `<div class="resumo-cot">
    ${kpi('💰 Total do pedido', fmtMoeda(total), `${peds.reduce((t, p) => t + p.itens.length, 0)} itens · sem os em dúvida`)}
    ${kpi('📉 Economia vs média', media > 0 ? fmtMoeda(media) : '—', media > 0 && base ? `${fmtPct(media / (base + media))} a menos` : 'onde houve 2+ preços', media > 0 ? 'bom' : '')}
    ${kpi('📦 Pedidos exportados', comPed.size ? `${exp} de ${comPed.size}` : '—', comPed.size ? (exp === comPed.size ? '✓ todos' : `faltam ${comPed.size - exp}`) : 'ninguém com quantidade', comPed.size && exp === comPed.size ? 'bom' : '')}
    ${kpi('✏️ Itens com quantidade', `${comQtd} de ${itensVenc.length}`, itensVenc.length ? `<span class="rc-barra"><span style="width:${Math.round((comQtd / itensVenc.length) * 100)}%"></span></span>` : '', !fin && comQtd < itensVenc.length ? '' : 'bom')}
    ${kpi('❓ Dúvidas abertas', String(nDuv), nDuv ? 'clique para ver os itens' : 'nenhuma', nDuv ? 'atencao clicavel' : '', nDuv ? ' data-act="filtroAviso" data-tipo="duvida" role="button" tabindex="0" title="Mostrar só os itens em dúvida"' : '')}
  </div>`;
}

/** Resumo do quadro "Fornecedores" (fechado): respostas, pedidos exportados e quem falta exportar. */
function htmlResumoFornCot(c) {
  const nf = c.fornecedores.length;
  const resp = c.fornecedores.filter(respondeu).length;
  const peds = pedidosPorFornecedor(c);
  const comPed = new Set([...peds.map(p => p.fi), ...c.fornecedores.map((f, fi) => (f.concluidoEm ? fi : -1)).filter(fi => fi >= 0)]);
  const exp = [...comPed].filter(fi => c.fornecedores[fi].concluidoEm).length;
  const fin = c.status === 'finalizada';
  const pend = fin ? [] : peds.filter(p => !p.f.concluidoEm);
  const conf = c.fornecedores.filter(f => f.confirmadoEm).length;
  const partes = [`${nf} fornecedor(es)`];
  if (conf && resp < nf) partes.push(`${conf} de ${nf} confirmaram o recebimento`);
  partes.push(`${resp} de ${nf} responderam`);
  if (comPed.size) partes.push(`${exp} de ${comPed.size} pedidos exportados`);
  if (pend.length) partes.push(`faltam ${pend.length}`);
  else if (comPed.size && exp === comPed.size) partes.push('✓ todos exportados');
  return { texto: partes.join(' · '), chips: pend.length ? `<div class="forn-pend"><span class="small muted">Falta exportar:</span>${pend.map(p => `<button type="button" class="chip-forn-pend" data-act="filtrarFornComp" data-id="${esc(p.f.fornecedorId)}" title="Mostrar no comparativo só os itens de ${esc(p.f.nome)}">${esc(p.f.nome)} <b>${p.itens.length}</b> · ${fmtMoeda(p.total)}</button>`).join('')}</div>` : '' };
}

function atualizarResumosCot(c) {
  const r = document.getElementById('resumoCot');
  if (r) { const novo = htmlResumoCot(c); if (r.innerHTML !== novo) r.innerHTML = novo; }
  const rf = htmlResumoFornCot(c);
  const t = document.querySelector('.resumo-recolhe');
  if (t && t.textContent !== rf.texto) t.textContent = rf.texto;
  const ch = document.getElementById('fornPendCot');
  if (ch && ch.innerHTML !== rf.chips) ch.innerHTML = rf.chips;
}

function atualizarBotoesExportar(c) {
  const qtd = Object.fromEntries(pedidosPorFornecedor(c).map(p => [p.fi, p.itens.length]));
  for (const el of document.querySelectorAll('.exp-forn[data-exp-f]')) {
    const fi = +el.dataset.expF;
    const f = c.fornecedores[fi];
    if (!f) continue;
    const novo = botaoExportarForn(f, fi, qtd[fi] || 0);
    if (el.outerHTML !== novo) el.outerHTML = novo;
  }
}

/**
 * Comparativo: preço escolhido, dif., quantidades e total ficam presos à direita (como o produto à esquerda);
 * só as colunas dos fornecedores rolam no meio. Sem espaço para isso (tela estreita), a tabela rola inteira.
 */
function ajustarColunasFixas() {
  const tab = document.querySelector('.tab-comp');
  if (!tab) return;
  const wrapW = tab.parentElement?.clientWidth || 0;
  const ths = () => [...tab.querySelectorAll(':scope > thead > tr > th')];
  const nCols = ths().length;
  // uma leitura de layout: larguras do cabeçalho (as colunas presas são as últimas de cada linha)
  const medir = () => {
    const todos = ths();
    const fd = todos.filter(th => th.classList.contains('fd'));
    const larg = fd.map(th => th.getBoundingClientRect().width); // escondida (Dif. na versão estreita) = 0
    const esq = todos.slice(0, 2).reduce((x, th) => x + th.getBoundingClientRect().width, 0);
    const temForn = todos.length - fd.length > 2;
    return { larg, cabe: temForn && fd.length > 0 && esq + larg.reduce((x, y) => x + y, 0) + 100 <= wrapW };
  };
  const ant = ui.colFixas;
  let m;
  if (ant && ant.wrapW === wrapW && ant.nCols === nCols && (ant.fixa || ant.inteira)) {
    if (ant.inteira) { if (tab.scrollWidth <= wrapW + 1) return; ui.colFixas = null; return ajustarColunasFixas(); } // continua cabendo inteira na versão estreita
    // mesma largura e mesmas colunas: a tabela já veio com a decisão anterior (sem medir duas vezes)
    m = medir();
    if (!m.cabe) { tab.classList.remove('estreita'); m = medir(); if (!m.cabe) { tab.classList.add('estreita'); m = medir(); } }
  } else {
    // 1º: a tabela inteira cabe na largura? então nada fica preso (nada é coberto nem cortado)
    tab.classList.remove('fixa-dir', 'estreita');
    if (tab.scrollWidth <= wrapW + 1) m = { larg: [], cabe: false };
    else {
      tab.classList.add('estreita');
      if (tab.scrollWidth <= wrapW + 1) m = { larg: [], cabe: false, inteira: true };
      else {
        tab.classList.remove('estreita');
        m = medir();
        if (!m.cabe) {
          tab.classList.add('estreita');
          m = medir();
          if (!m.cabe) tab.classList.remove('estreita');
        }
      }
    }
  }
  tab.classList.toggle('fixa-dir', m.cabe);
  ui.colFixas = { wrapW, nCols, fixa: m.cabe, estreita: tab.classList.contains('estreita'), inteira: !!m.inteira };
  if (!m.cabe) return;
  // distância até a borda direita de cada coluna presa, pela posição a partir do fim (CSS :nth-last-child)
  let acc = 0;
  const vars = [];
  for (let k = m.larg.length - 1; k >= 0; k--) {
    vars.push(`--fd${m.larg.length - 1 - k}:${acc}px`);
    acc += m.larg[k];
  }
  ui.colFixas.vars = vars.join(';');
  if (tab.getAttribute('style') !== ui.colFixas.vars) tab.setAttribute('style', ui.colFixas.vars); // só mexe se mudou
}
/** Depois de a tela ser desenhada (aproveita o layout que o navegador já fez; não trava o redesenho). */
let quadroColFixas = 0;
function ajustarColunasFixasDepois() {
  cancelAnimationFrame(quadroColFixas);
  quadroColFixas = requestAnimationFrame(() => setTimeout(ajustarColunasFixas, 0));
}
let timerColFixas = null;
window.addEventListener('resize', () => { clearTimeout(timerColFixas); timerColFixas = setTimeout(ajustarColunasFixas, 150); });

function atualizarTotaisComp(c, i = null) {
  const comp = comparar(c);
  // quando as quantidades passam a valer (1ª digitada) todos os totais mudam; senão, só o da linha digitada
  const todas = i == null || ui.porLojaComp?.cotId !== c.id || ui.porLojaComp.v !== comp.porLoja;
  ui.porLojaComp = { cotId: c.id, v: comp.porLoja };
  for (const l of todas ? comp.linhas : [comp.linhas[i]]) {
    const td = l && document.getElementById('tot-' + l.i);
    if (td) td.innerHTML = celTotal(l);
  }
  const tot = $('#totalComp');
  if (tot) {
    tot.outerHTML = linhaTotalComp(c, comp);

  }
  // a seção de pedidos é pesada: atualiza quando a pessoa para de digitar
  clearTimeout(ui.timerPedidos);
  ui.timerPedidos = setTimeout(() => {
    const sec = $('#secPedidos');
    const atual = cotAtual();
    if (sec && atual === c) sec.outerHTML = secaoPedidos(c, comparar(c));
    if (atual === c) atualizarBotoesExportar(c); // "Exportar (N)" acende assim que o fornecedor tem itens com quantidade
    if (atual === c) atualizarResumosCot(c);
  }, 350);
}

function renderCotacao(id) {
  const c = db.cotacoes.find(x => x.id === id);
  if (!c) return `<section class="card"><p class="empty">Cotação não encontrada. <a href="#" data-route="cotacoes">Voltar</a></p></section>`;
  const comp = comparar(c);
  const naLista = new Set(c.fornecedores.map(f => f.fornecedorId));
  const disponiveis = db.fornecedores.filter(f => !naLista.has(f.id)).sort((a, b) => a.nome.localeCompare(b.nome));

  if (!ui.sel || ui.sel.cotId !== c.id) {
    // começa com os fornecedores que ainda não receberam a cotação
    ui.sel = { cotId: c.id, ids: new Set(c.fornecedores.filter(f => !f.enviadoEm).map(f => f.fornecedorId)) };
  }
  const prazo = situacaoPrazo(c);
  const nf = c.fornecedores.length;
  const pedidoDe = Object.fromEntries(pedidosPorFornecedor(c).map(p => [p.fi, p]));
  const fornRows = c.fornecedores.map((f, fi) => {
    const t = comp.totais[fi];
    const atrasado = prazo && prazo.pendentes.includes(fi);
    return `<tr>
      <td class="c"><input type="checkbox" class="sel-forn" data-sel-forn="${esc(f.fornecedorId)}" ${ui.sel.ids.has(f.fornecedorId) ? 'checked' : ''} aria-label="Marcar ${esc(f.nome)}"></td>
      <td class="forn-cot-nome">${(() => {
        const cad = db.fornecedores.find(x => x.id === f.fornecedorId);
        const atend = cad?.contato || f.contato || '';
        const subst = cad?.substituto || '';
        const email = cad?.email || f.email || '';
        return `<b>${esc(f.nome)}</b>${atend || subst || email ? `<br><span class="small muted" title="${esc([atend && 'Atendente: ' + atend, subst && 'Substituto: ' + subst, email].filter(Boolean).join(' · '))}">${atend ? esc(atend) : ''}${subst ? `${atend ? ' · ' : ''}<span class="subst-forn">subst. ${esc(subst)}</span>` : ''}${email ? `${atend || subst ? ' · ' : ''}${esc(email)}` : ''}</span>` : ''}`;
      })()}</td>
      <td class="envio-cot">${f.concluidoEm
        ? `<button type="button" class="badge concluida" data-act="reabrirForn" data-f="${fi}" title="Pedido exportado em ${fmtData(f.concluidoEm)}. Clique para reabrir.">✓ Concluída</button>`
        : `<label class="conf-receb" title="${f.confirmadoEm ? `Confirmou o recebimento em ${fmtData(f.confirmadoEm)} ${new Date(f.confirmadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Marque quando o fornecedor confirmar que recebeu a cotação'}"><input type="checkbox" data-confirmar-forn="${fi}" ${f.confirmadoEm ? 'checked' : ''} aria-label="${esc(f.nome)} confirmou que recebeu"></label>${f.confirmadoEm || respondeu(f) ? '<span class="badge ok">✓ recebeu</span>' : f.enviadoEm ? `<span class="badge ok">enviada ${fmtData(f.enviadoEm).slice(0, 5)}</span>` : '<span class="badge">não enviada</span>'}${pedidosPorFornecedor(c).some(p => p.fi === fi) ? `<br><button type="button" class="link small marcar-concluida" data-act="marcarConcluida" data-f="${fi}" title="Já exportou o pedido deste fornecedor por outro caminho? Marque a cotação dele como concluída">✓ marcar concluída</button>` : ''}`}</td>
      <td>${f.respondidoEm ? `<span class="badge ok">${t.cotados}/${c.itens.length} itens</span>` : `<span class="badge ${atrasado && prazo.dias < 0 ? 'danger' : 'warn'}" title="${atrasado ? esc(textoPrazo(prazo.dias, c.prazoHora)) : ''}">${atrasado && prazo.dias < 0 ? 'atrasada' : 'aguardando'}</span>`}${f.cobradoEm && !f.respondidoEm ? `<br><span class="small muted">cobrado em ${fmtData(f.cobradoEm)}</span>` : ''}</td>
      <td class="r">${f.respondidoEm ? fmtMoeda(t.total) : '—'}</td>
      <td class="actions-cell">
        ${botaoExportarForn(f, fi, pedidoDe[fi]?.itens.length || 0)}
        <label class="btn sm" style="margin:0" title="Importar a planilha que o fornecedor devolveu">📥<span class="rot-acao"> Importar</span><input type="file" class="hidden" accept=".xlsx,.xls" data-import="${fi}"></label>
        <details class="menu-acoes"><summary class="btn sm" title="Mais ações: digitar preços, baixar a planilha, remover">⋯</summary>
          <div class="menu-acoes-lista">
            <button class="sm" data-act="digitar" data-f="${fi}" title="Digitar os preços manualmente">✎ Digitar preços</button>
            <button class="sm" data-act="baixarPlanilha" data-f="${fi}" title="Baixar a planilha de cotação deste fornecedor (para enviar a ele)">⬇ Planilha (Excel)</button>
            <button class="sm danger" data-act="removerFornCot" data-f="${fi}" title="Remover da cotação">✕ Remover da cotação</button>
          </div>
        </details>
      </td>
    </tr>`;
  }).join('');

  let painel = '';
  if (ui.enviando && ui.enviando.cotId === c.id && c.fornecedores[ui.enviando.fi]) {
    const fi = ui.enviando.fi;
    const f = c.fornecedores[fi];
    const m = dadosEmail(c, f);
    painel += `
    <section class="card envio" id="painelEnvio">
      <div class="row-between">
        <h3>Enviar cotação para ${esc(f.nome)}</h3>
        <button class="sm" data-act="fecharEnvio">Fechar</button>
      </div>
      <ol class="passos">
        <li><span>Baixe a planilha deste fornecedor.</span>
          <button class="primary sm" data-act="baixarPlanilha" data-f="${fi}">⬇ Baixar ${esc(nomePlanilha(c, f))}</button></li>
        <li><span>Abra o e-mail já preenchido e <b>anexe a planilha baixada</b>.</span>
          <span class="row">
            <a class="btn sm" href="${esc(m.gmail)}" target="_blank" rel="noopener" data-marca-envio="${fi}">Abrir no Gmail</a>
            <a class="btn sm" href="${esc(m.outlook)}" target="_blank" rel="noopener" data-marca-envio="${fi}">Abrir no Outlook</a>
            <a class="btn sm" href="${esc(m.mailto)}" data-marca-envio="${fi}">Programa de e-mail</a>
          </span></li>
        <li><span>Depois de enviar, marque como enviada.</span>
          <button class="sm" data-act="marcarEnviado" data-f="${fi}">${f.enviadoEm ? '✓ Enviada em ' + fmtData(f.enviadoEm) : 'Marcar como enviada'}</button></li>
      </ol>
      <p class="small muted">Se o e-mail não abrir, copie os dados abaixo e cole no seu e-mail.</p>
      <div class="copia-grid">
        <div class="copiavel"><span class="muted small">Para</span><code class="copia-alvo">${esc(f.email || '(sem e-mail cadastrado)')}</code><button class="sm" data-act="copiar" data-campo="email">Copiar</button></div>
        <div class="copiavel"><span class="muted small">Assunto</span><code class="copia-alvo">${esc(m.assunto)}</code><button class="sm" data-act="copiar" data-campo="assunto">Copiar</button></div>
        <div class="copiavel"><span class="muted small">Texto</span><pre class="copia-alvo">${esc(m.corpo)}</pre><button class="sm" data-act="copiar" data-campo="corpo">Copiar</button></div>
      </div>
    </section>`;
  }
  if (ui.digitando && ui.digitando.cotId === c.id && c.fornecedores[ui.digitando.fi]) {
    const fi = ui.digitando.fi;
    const f = c.fornecedores[fi];
    // o que já foi digitado e ainda não salvo (o redesenho da tela não pode apagar)
    const rasc = ui.digitando.rasc || {};
    const val = (nome, salvo) => (nome in rasc ? rasc[nome] : salvo ?? '');
    painel = `
    <section class="card" id="painelDigitar">
      <h3>Digitar preços — ${esc(f.nome)}</h3>
      <form data-form="precosManuais" data-f="${fi}">
        <div class="table-wrap"><table>
          <thead><tr><th class="c">#</th><th>Código</th><th>Marca pedida</th><th>Descrição</th><th class="r">Qtd.</th><th class="r">Preço unit. (R$)</th><th>Marca</th><th>Prazo</th><th>Observação</th></tr></thead>
          <tbody>${c.itens.map((it, i) => {
            const rr = f.respostas?.[i] || {};
            return `<tr>
              <td class="c">${i + 1}</td>
              <td class="cod-digitar">${esc(it.codigo || '—')}</td>
              <td>${it.marca ? `<span class="marca-pedida">${esc(it.marca)}</span>` : '<span class="muted">—</span>'}</td>
              <td>${esc(it.descricao)} <span class="muted small">${esc(it.unidade)}</span></td>
              <td class="r">${fmtNum(it.quantidade)}</td>
              <td style="width:130px"><input class="price" inputmode="decimal" name="p_${i}" value="${esc(val(`p_${i}`, rr.preco != null ? rr.preco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : ''))}" autocomplete="off"></td>
              <td style="width:150px"><input class="marca-digitar" name="m_${i}" value="${esc(val(`m_${i}`, rr.marca))}" placeholder="marca" autocomplete="off" title="Marca que o fornecedor informou${f.nome && /kaizen/i.test(f.nome) ? ' (Kaizen: pode digitar MARCA/estoque)' : ''}"></td>
              <td style="width:110px"><input name="z_${i}" value="${esc(val(`z_${i}`, rr.prazo))}" autocomplete="off"></td>
              <td><input name="o_${i}" value="${esc(val(`o_${i}`, rr.obs))}" autocomplete="off"></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
        <p class="small muted" style="margin:8px 0 0">⌨ <kbd>↑</kbd> <kbd>↓</kbd> ou <kbd>Enter</kbd> mudam de item · <kbd>←</kbd> <kbd>→</kbd> no começo/fim do campo mudam de coluna.</p>
        <div class="grid" style="margin-top:12px">
          ${COND_CAMPOS.map(([k, label]) => `<label>${label}<input name="c_${k}" value="${esc(val(`c_${k}`, f.cond?.[k]))}"></label>`).join('')}
        </div>
        <div class="actions">
          <button type="button" data-act="fecharDigitar">Cancelar</button>
          <button class="primary">Salvar preços</button>
        </div>
      </form>
    </section>`;
  }

  if (ui.lote && ui.lote.cotId === c.id) painel = painelLote(c);
  const recAberto = ui.conferindo && ui.conferindo.cotId === c.id && (c.recebimentos || []).find(r => r.id === ui.conferindo.recId);
  if (recAberto) painel = painelNFe(c, recAberto);

  const temResposta = comp.itensCotados > 0;
  const ultimos = temResposta ? ultimosPrecos(c.id) : {};
  const chips = (avs, i, j) => avs.map(a => `<button type="button" class="alerta-preco ${a.tipo}" data-act="conferirPreco" data-i="${i}" data-f="${j}" title="${esc(a.texto)} Clique para marcar este preço como certo.">⚠ ${esc(a.curto)}</button>`).join('');
  const LJ = lojas();
  const repComp = parceirosCodigo(c.itens.map(it => it.codigo));
  let qtdAlertas = 0;
  const qtdMarcas = { errada: 0, duvida: 0 };
  let qtdDemora = 0; // Rio Juntas com marca GO
  const ordemForn = fornecedoresVisiveisComp(c); // colunas de fornecedores em ordem alfabética (sem quem não respondeu)
  const escondidos = c.fornecedores.length - ordemForn.length;
  const tabelaComp = `
    <div class="table-wrap painel-comp${cotTravada(c) ? ' travada' : ''}"><table class="tab-comp${modoCompacto() ? ' compacto' : ''}${ui.colFixas?.fixa ? ' fixa-dir' : ''}${ui.colFixas?.estreita ? ' estreita' : ''}"${ui.colFixas?.vars ? ` style="${ui.colFixas.vars}"` : ''}>
      <thead><tr>
        <th class="c">#</th><th>Produto</th>${temResposta ? '' : '<th class="r">Qtd.</th>'}
        ${ordemForn.map(j => `<th class="r">${esc(c.fornecedores[j].nome)}</th>`).join('')}
        ${temResposta ? `<th class="r col-escolhido fd">Preço escolhido</th>${nf > 1 ? '<th class="r fd col-dif" title="Quanto o 2º melhor preço é mais caro que o melhor">Dif. 1º × 2º</th>' : ''}
          ${LJ.map(lj => `<th class="c col-qtd fd" title="Quantidade para ${esc(lj.nome)}">Qtd.<br>${esc(lj.nome)}</th>`).join('')}<th class="r fd">Total</th>` : ''}
      </tr></thead>
      <tbody>
        ${comp.linhas.map(l => {
          const ult = l.it.produtoId ? ultimos[l.it.produtoId] : null;
          const avisosLinha = new Set(); // para as etiquetas de aviso levarem aos itens
          if (l.aguardando || l.recusadaGanhou) avisosLinha.add('aguardando');
          if (difSuspeita(l)) avisosLinha.add('dif');
          if (l.preferencia) avisosLinha.add('regra');
          if (l.duvida) avisosLinha.add('duvida');
          const celulas = ordemForn.map(j => {
            const p = l.precos[j];
            const o = c.fornecedores[j].respostas?.[l.i];
            const st = l.marcas[j];
            if (p != null && (st === 'errada' || st === 'duvida') && !l.recusas[j] && !l.permitidas[j]) { qtdMarcas[st]++; avisosLinha.add('marca'); }
            const extra = p == null ? '' : [o?.prazo, o?.obs].filter(Boolean).join(' · '); // sem preço: desconsidera a resposta
            const avsTodos = alertasPreco(p, ult, l.precos);
            const conferido = avsTodos.length && o?.precoConferido != null && o.precoConferido === p; // confirmado por você
            const avs = conferido ? [] : avsTodos;
            if (avs.length) avisosLinha.add('alertas');
            if (avs.length) qtdAlertas++;
            const venc = j === l.vencedor && (nf > 1 || l.manual);
            const demora = p != null && entregaDemorada(c.fornecedores[j], o);
            const pelaRegra = j === l.vencedor && l.preferencia;
            if (demora) { qtdDemora++; avisosLinha.add('demora'); }
            const cls = ['r', demora ? 'demora' : '', venc ? 'best' : '', venc && l.manual ? 'escolhido' : '', p != null && nf > 1 ? 'escolhivel' : '', p != null && p === l.min && !venc && nf > 1 ? 'menor' : '', st === 'errada' && p != null ? (l.permitidas[j] ? 'marca-permitida' : 'marca-errada') : '', l.recusas[j] && p != null ? (j === l.vencedor ? 'recusada-venc' : 'recusada') : ''].filter(Boolean).join(' ');
            const attrs = p != null && nf > 1 ? ` data-act="escolherVencedor" data-i="${l.i}" data-f="${j}"` : '';
            return `<td class="${cls}"${attrs}${p != null ? ` data-dica="${l.i}:${j}"` : ''}>${p != null ? fmtMoeda(p) : '<span class="muted">—</span>'}${venc && l.manual ? ' <span class="tag-escolha">escolhido</span>' : ''}${p != null && (o?.marca || st === 'sem') ? '<br>' + chipMarca(l, j, o) : ''}${o?.estoque != null && p != null ? `<br><span class="estoque" title="Estoque informado pelo fornecedor">estoque ${fmtNum(o.estoque)}</span>` : ''}${demora ? '<br>' + chipDemora : ''}${pelaRegra ? `<br><span class="chip-regra" title="Regra da Comando: ganha quando está até 5% acima do 1º lugar. Clique no preço do mais barato para escolher ele.">⭐ regra Comando · +${fmtPct(l.preco / l.min - 1)} do 1º</span>` : ''}${extra ? '<br><span class="small muted">' + esc(extra) + '</span>' : ''}${avs.length ? '<br>' + chips(avs, l.i, j) : ''}${conferido ? '<br><span class="ok-conferido" title="Você conferiu e marcou este preço como certo">✓ conferido</span>' : ''}</td>`;
          }).join('');
          const tiposLinha = [...avisosLinha].join(' ');
          const fa = filtroAviso(c);
          const situacao = l.aguardando || l.recusadaGanhou ? 'aguardando' : l.duvida ? 'duvida' : l.vencedor < 0 ? 'sem' : avisosLinha.size && [...avisosLinha].some(a => a !== 'regra') ? 'conferir' : 'ok';
          return `<tr class="${l.aguardando || l.recusadaGanhou ? 'linha-aguardando' : ''} sit-${situacao}${ui.linhaComp?.cotId === c.id && ui.linhaComp.i === l.i ? ' linha-atual' : ''}" data-comp-linha="${l.i}" data-avisos="${tiposLinha}" ${linhaNoFiltroVenc(c, l) && (!fa || avisosLinha.has(fa)) && itemNaBuscaComp(l.it, buscaComp(c)) ? '' : 'hidden'}>
          <td class="c">${l.i + 1}</td>
          <td>${l.duvida ? `<span class="chip-duvida" title="Este item está na fila de Dúvidas: não vai no pedido ${lojas().filter(x => l.duvida.has(x.id)).length === lojas().length ? '' : 'de ' + esc(lojas().filter(x => l.duvida.has(x.id)).map(x => x.nome).join(', ')) + ' '}ao exportar. Quando a loja responder, tire o item de Dúvidas.">❓ em dúvida${lojas().length > 1 ? ' · ' + esc(lojas().filter(x => l.duvida.has(x.id)).map(siglaLoja).join(' + ')) : ''} · fora do pedido</span><br>` : ''}<div class="prod-comp">${ehKit(l.it.codigo, l.it.descricao) ? '<span class="badge kit">KIT</span> ' : ''}<span class="cod-comp">${esc(l.it.codigo || '—')}</span>
            <span class="small muted desc-comp" title="${esc([l.it.descricao, l.it.similar && 'sim. ' + l.it.similar].filter(Boolean).join(' · '))}">${esc([l.it.descricao, l.it.similar && 'sim. ' + l.it.similar].filter(Boolean).join(' · '))}</span>
            <span class="prod-tags">${l.it.papelzinho ? '<span class="tag-papel" title="Veio dos papelzinhos de São Sebastião">PAPELZINHOS</span>' : ''}${l.it.marca ? `<span class="marca-pedida" title="Marca pedida: ${esc(l.it.marca)}">${esc(l.it.marca)}</span>` : ''}${repComp[l.i].length ? ` <span class="badge warn" title="Mesmo código que o item ${repComp[l.i].map(j => '#' + (j + 1)).join(', ')}">repetido</span>` : ''}</span></div></td>
          ${temResposta ? '' : `<td class="r">${fmtNum(l.it.quantidade)} ${esc(l.it.unidade)}</td>`}
          ${celulas}
          ${temResposta ? `${(() => {
            // preço escolhido + quem ganhou (antes numa coluna "Fornecedor" separada)
            const fv = l.vencedor >= 0 ? c.fornecedores[l.vencedor] : null;
            const marcaV = fv?.respostas?.[l.i]?.marca;
            const extras = !fv ? '' : [
              l.estoque != null ? `<span class="estoque">estoque ${fmtNum(l.estoque)}</span>` : '',
              entregaDemorada(fv, fv.respostas?.[l.i]) ? chipDemora : '',
              l.preferencia ? `<span class="chip-regra" title="O menor preço é ${fmtMoeda(l.min)} (${esc(c.fornecedores[l.minIdx].nome)})">pela regra dos 5% (+${fmtPct(l.preco / l.min - 1)} do 1º)</span>` : '',
              l.manual ? `<span class="small muted">+${fmtMoeda(l.preco - l.min)}/un. vs menor</span>` : '',
            ].filter(Boolean).join('<br>');
            // 2º lugar (ou o mais barato, se você escolheu outro) numa linha: aparece no lugar da coluna Dif. em tela estreita
            const alvoS = (l.manual || l.preferencia) && l.minIdx >= 0 ? l.minIdx : l.segundoIdx;
            const difS = (l.manual || l.preferencia) && l.minIdx >= 0 && l.min > 0 ? difDaLinha(l) : l.difSegundo;
            const segMini = alvoS >= 0 && alvoS !== l.vencedor && l.precos[alvoS] != null
              ? `<button type="button" class="seg-mini${difSuspeita(l) ? ' suspeita' : ''}" data-act="escolherVencedor" data-i="${l.i}" data-f="${alvoS}" title="Clique para comprar de ${esc(c.fornecedores[alvoS].nome)} (${fmtMoeda(l.precos[alvoS])})">${fmtMoeda(l.precos[alvoS])} · ${esc(c.fornecedores[alvoS].nome)}${difS != null ? ` · +${fmtPct(difS)}` : ''}</button>` : '';
            return `<td class="r col-escolhido fd"><div class="esc-linha"><b class="preco-escolhido">${l.preco != null ? fmtMoeda(l.preco) : l.aguardando ? '<span class="aguardando" title="A marca oferecida foi recusada. Quando chegar o preço de outro fornecedor, confira a marca.">⏳ aguardando</span>' : '<span class="muted">sem preço</span>'}</b>${fv ? `<button class="sm link btn-duvida" data-act="duvidaItem" data-i="${l.i}" title="Pôr em Dúvidas (perguntar à loja)">❓</button>` : ''}</div>${fv ? `<span class="nome-venc">${esc(fv.nome)}</span>` : ''}${marcaV ? ` <span class="marca-venc" title="Marca de ${esc(fv.nome)}">${esc(marcaV)}</span>` : ''}${l.recusadaGanhou ? '<br><span class="chip-recusada-venc" title="A marca foi recusada, mas não há outro preço: este está sendo comprado. Quando chegar o preço de outro fornecedor, ele passa a valer.">⚠ marca recusada · não é a pedida</span>' : ''}${extras ? '<br>' + extras : ''}${ult ? `<br><span class="small muted" title="Último preço pago: ${esc(ult.fornecedor)}, cotação nº ${esc(ult.numero)} (${fmtData(ult.data)})">último ${fmtMoeda(ult.preco)}</span>` : ''}${segMini}</td>`;
          })()}
            ${nf > 1 ? (() => {
              // clicar na diferença escolhe o 2º lugar (ou volta para o mais barato, se você já escolheu outro)
              const alvo = (l.manual || l.preferencia) && l.minIdx >= 0 ? l.minIdx : l.segundoIdx;
              const acao = alvo >= 0 && alvo !== l.vencedor ? ` class="r fd col-dif escolhe-dif" data-act="escolherVencedor" data-i="${l.i}" data-f="${alvo}" title="Clique para comprar de ${esc(c.fornecedores[alvo].nome)} (${fmtMoeda(l.precos[alvo])})"` : ' class="r fd col-dif"';
              return `<td${acao}>${celulaDifSegundo(c, l)}</td>`;
            })() : ''}
            ${LJ.map(lj => `<td class="c col-qtd fd"><input class="qtd-loja${qtdLoja(c, l.i, lj.id) ? ' preenchida' : c.qtds?.[l.i]?.[lj.id] === 0 ? ' zerada' : ''}${ui.alertaEstoque?.it === l.it && ui.alertaEstoque.loja === lj.id ? ' no-limite' : ''}" inputmode="numeric" autocomplete="off" data-qtd-loja="${esc(lj.id)}" data-i="${l.i}" value="${c.qtds?.[l.i]?.[lj.id] ?? ''}"${cotTravada(c) ? ' readonly' : ''} title="0 = não comprar nesta loja" placeholder="0" aria-label="Quantidade ${esc(lj.nome)}"></td>`).join('')}
            <td class="r fd" id="tot-${l.i}">${celTotal(l)}</td>` : ''}
        </tr>`;
        }).join('')}
        ${temResposta ? linhaTotalComp(c, comp) : ''}
        ${temResposta && ordemForn.length ? COND_CAMPOS.map(([k, label]) => ordemForn.some(j => c.fornecedores[j].cond?.[k]) ? `<tr>
          <td></td><td class="small muted">${label}</td>
          ${ordemForn.map(j => `<td class="r small">${esc(c.fornecedores[j].cond?.[k] || '—')}</td>`).join('')}
          <td colspan="${(nf > 1 ? 3 : 2) + LJ.length}"></td></tr>` : '').join('') : ''}
      </tbody>
    </table></div>`;

  return `
  <section class="card card-cab-cot">
    <a href="#" class="voltar-cot" data-route="cotacoes">← Cotações</a>
    <div class="cab-cot">
      <div class="cab-cot-titulo">
        <h2>Cotação nº ${esc(c.numero)}${c.arquivada ? ' <span class="badge">🗂️ arquivada</span>' : ''}</h2>
        <span class="titulo-cot">${c.titulo ? `<b>${esc(c.titulo)}</b>` : '<span class="muted">Sem título</span>'} <button type="button" class="link editar-titulo" data-act="editarTituloCot" data-id="${esc(c.id)}" title="${c.titulo ? 'Editar o título da cotação' : 'Dar um título à cotação'}">✎</button></span>
      </div>
      <div class="cab-cot-acoes">
        ${podeVerRelatorios() ? `<button type="button" class="sm" data-act="analiseCot" data-id="${esc(c.id)}" title="Nota dos fornecedores só nesta cotação">📊 Análise</button>` : ''}
        ${seletorStatusCot(c)}
      </div>
    </div>
    <div class="cab-cot-linha2">
      <p class="muted">Criada em ${fmtData(c.data)} · ${c.status === 'finalizada' ? '' : `<label class="prazo-inline">Responder até <input type="date" data-change="prazoCot" value="${esc(c.prazoResposta)}"><input type="time" data-change="prazoHoraCot" value="${esc(c.prazoHora || '')}" aria-label="Hora do prazo" title="Hora (opcional)"></label> · `}${c.itens.length} itens · ${c.fornecedores.length} fornecedor(es)</p>
      <div id="presencaCot" class="presenca" data-cot="${esc(c.id)}" ${htmlPresencaCot(c.id) ? '' : 'hidden'}>${htmlPresencaCot(c.id)}</div>
    </div>
    ${numeroRepetidoCot(c) ? `<p class="aviso-num-repetido">⚠ Outra cotação também tem o <b>nº ${esc(c.numero)}</b>. <button type="button" class="sm primary" data-act="renumerarCot">Trocar esta para nº ${String(proximoNumeroCot()).padStart(4, '0')}</button></p>` : ''}
    ${prazo ? `<p class="aviso-prazo ${prazo.dias < 0 ? 'vencido' : ''}">⏰ O prazo de resposta ${textoPrazo(prazo.dias, c.prazoHora)} (${textoDataPrazo(c)}) e ${prazo.pendentes.length === 1 ? 'falta 1 fornecedor responder' : `faltam ${prazo.pendentes.length} fornecedores responderem`}: <b>${prazo.pendentes.map(fi => esc(c.fornecedores[fi].nome)).join(', ')}</b>.
      <button class="sm" data-act="cobrarPendentes">📣 Cobrar quem falta</button></p>` : ''}
    ${c.obs ? `<p class="small" style="margin:6px 0 0;white-space:pre-wrap">${esc(c.obs)}</p>` : ''}
    <div id="resumoCot">${temResposta ? htmlResumoCot(c, comp) : ''}</div>
  </section>

  <section class="card">
    <h3 class="recolhe" data-act="recolherFornCot" role="button" tabindex="0" aria-expanded="${fornCotAberto() ? 'true' : 'false'}" title="Clique para ${fornCotAberto() ? 'fechar' : 'abrir'}">
      <span class="seta-recolhe">${fornCotAberto() ? '▾' : '▸'}</span> Fornecedores
      <span class="small muted resumo-recolhe">${htmlResumoFornCot(c).texto}</span>
    </h3>
    <div id="fornPendCot">${temResposta ? htmlResumoFornCot(c).chips : ''}</div>
    <div class="corpo-recolhe" ${fornCotAberto() ? '' : 'hidden'}>
    ${nf ? `<div class="table-wrap"><table>
      <thead><tr><th class="c"><input type="checkbox" class="sel-forn" data-sel-todos ${nf && ui.sel.ids.size === nf ? 'checked' : ''} title="Marcar todos" aria-label="Marcar todos"></th><th>Fornecedor</th><th title="Marque a caixinha quando o fornecedor confirmar que recebeu a cotação">Envio · recebeu?</th><th>Resposta</th><th class="r">Total</th><th>Ações</th></tr></thead>
      <tbody>${fornRows}</tbody></table></div>` : '<p class="empty">Nenhum fornecedor nesta cotação.</p>'}
    <div class="row" style="margin-top:10px">
      ${disponiveis.length ? `<select id="addFornCot" style="width:auto;max-width:280px">${disponiveis.map(f => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')}</select>
      <button class="sm" data-act="addFornCot">+ Adicionar fornecedor</button>` : ''}
      <button class="sm" data-act="baixarGeral" title="Planilha da cotação sem nome de fornecedor">⬇ Planilha da cotação</button>
      <label class="btn sm" style="margin:0" title="Importar uma planilha preenchida pelo fornecedor">📥 Importar planilhas respondidas<input type="file" class="hidden" accept=".xlsx,.xls" multiple data-import-cot></label>
    </div>
    ${nf ? `<div class="row barra-lote">
      <span class="small muted" id="qtdSel">${textoSel(c)}</span>
      <button class="sm primary" data-act="envioLote" data-sel-btn>✉ Enviar para os marcados</button>
      <button class="sm" data-act="zipMarcados" data-sel-btn title="Um arquivo .zip com a planilha de cada fornecedor marcado">⬇ Planilhas dos marcados (.zip)</button>
      <button class="sm" data-act="cobrarMarcados" data-sel-btn title="E-mail de lembrete para quem ainda não respondeu">📣 Cobrar os marcados</button>
    </div>` : ''}
    <details class="tip ajuda-envio"><summary>ⓘ Como enviar e receber as planilhas</summary><b>Para vários de uma vez:</b> marque os fornecedores e clique em <b>✉ Enviar para os marcados</b>: você baixa todas as planilhas num .zip e abre os e-mails um atrás do outro (ou um e-mail só, com todos em cópia oculta).<br>
    <b>Para um só:</b> clique em <b>✉ Enviar</b> na linha do fornecedor. Você baixa a planilha dele e abre o e-mail já com destinatário, assunto e texto. Só falta <b>anexar o arquivo baixado</b> e enviar.
    Quando o fornecedor devolver a planilha preenchida, use <b>📥 Importar</b> para lançar os preços automaticamente.</details>
    </div>
  </section>

  ${painel}

  <section class="card">
    <div class="row-between">
      <h3>${temResposta ? 'Comparativo de preços' : 'Itens da cotação'}</h3>
      ${temResposta ? `<div class="row"><span class="busca-comp-caixa"><input type="search" id="buscaComp" class="busca-comp" placeholder="🔎 Código ou descrição" value="${esc(buscaComp(c))}" autocomplete="off" aria-label="Buscar item no comparativo" title="Filtra as linhas enquanto você digita (Esc limpa)"><span id="buscaCompCont" class="small muted"></span></span>${seletorVencedor(c, comp)}<button type="button" class="sm btn-compacto${modoCompacto() ? ' ativo' : ''}" data-act="alternarCompacto" aria-pressed="${modoCompacto()}" title="${modoCompacto() ? 'Mostrar as colunas de todos os fornecedores' : 'Esconder as colunas de cada fornecedor: fica só o preço escolhido, o 2º lugar e as quantidades (bom para meia tela)'}">${modoCompacto() ? '▦ Compacto' : '▤ Compacto'}</button><button class="sm" data-act="exportarComparativo" title="Exportar o comparativo para o Excel">⬇ Excel</button></div>` : ''}
    </div>
    ${!temResposta ? '<div class="tip">⏳ <b>Aguardando as respostas dos fornecedores.</b> Assim que o primeiro responder (Importar ou Digitar, no quadro Fornecedores), aparecem aqui o <b>comparativo de preços</b>, as <b>quantidades das lojas</b>, o filtro <b>Mostrar itens de</b> e o botão <b>🗗 Janela flutuante</b>.</div>' : ''}
    <div class="faixa-comp">
    ${temResposta ? `<div class="barra-comp small">
      ${escondidos ? `<span class="muted">${escondidos} fornecedor(es) ainda sem resposta não aparecem na tabela.</span> <button type="button" class="link" data-act="mostrarSemResposta">mostrar</button>` : ui.mostrarSemResposta && c.fornecedores.some(f => !Object.values(f.respostas || {}).some(o => o?.preco > 0)) ? '<button type="button" class="link" data-act="mostrarSemResposta">esconder quem não respondeu</button>' : ''}
      <details class="ajuda-comp"><summary title="Como usar o comparativo${comp.escolhasManuais ? ' e mais opções' : ''}">ⓘ${comp.escolhasManuais ? ' mais opções' : ' Como usar'}</summary>
        ${comp.escolhasManuais ? `<p><button type="button" class="sm danger" data-act="limparEscolhas">↺ Desfazer as ${comp.escolhasManuais} escolha(s) feitas na mão</button> <span class="small muted">volta todos esses itens para o menor preço (pede confirmação)</span></p>` : ''}
        ${nf > 1 ? '<p>O vencedor de cada item fica em <b>verde</b>. Para comprar de outro fornecedor, <b>clique no preço dele</b>; clique de novo para voltar ao menor preço. Preços iguais: ganha quem respondeu primeiro.</p>' : ''}
        <p>📦 <b>Quantidades:</b> digite quantas unidades cada loja vai comprar nas colunas ${LJ.map(l => '<b>' + esc(l.nome) + '</b>').join(' e ')} (Enter ou ↓ vai para o item de baixo). Use <b>Mostrar itens de</b> para ver só os itens de um fornecedor. ${comp.porLoja ? '' : 'Enquanto nenhuma quantidade for digitada, os totais usam 1 unidade de cada item.'}</p>
      </details>
    </div>` : ''}
    ${temResposta && c.status === 'finalizada' ? (cotTravada(c)
      ? `<div class="aviso-travada" title="Escolhas, dúvidas e quantidades não mudam por acidente">🔒 <b>Finalizada</b> — só para consulta.${ehAdmin() ? ' <button type="button" class="sm" data-act="destravarCot">🔓 Editar mesmo assim</button>' : ' <span class="muted">Para mudar algo, peça a um administrador.</span>'}</div>`
      : '<div class="aviso-travada aberta">🔓 <b>Edição liberada</b> nesta cotação finalizada. <button type="button" class="sm" data-act="travarCot">🔒 Travar de novo</button></div>') : ''}
    ${(() => {
      // avisos do comparativo em etiquetas curtas, lado a lado (o texto completo aparece ao passar o mouse)
      const nAg = comp.linhas.filter(l => l.aguardando || l.recusadaGanhou).length;
      const nDif = comp.linhas.filter(difSuspeita).length;
      const nDuv = comp.linhas.filter(l => l.duvida).length;
      const et = [];
      if (nDuv) et.push(`<button type="button" data-act="filtroAviso" class="pill-aviso aviso-duvida" data-tipo="duvida" title="Clique para ver só esses itens. Itens na fila de Dúvidas não vão no pedido exportado até saírem da fila.">❓ ${nDuv} em dúvida</button>`);
      if (nAg) et.push(`<button type="button" data-act="filtroAviso" class="pill-aviso perigo aviso-recusa" data-tipo="aguardando" title="Clique para ver só esses itens. Linhas em vermelho: a marca foi recusada e não há outro preço, então o mais barato está sendo comprado assim mesmo. Quando chegar a resposta de outro fornecedor, ela passa a valer.">✗ ${nAg} marca recusada</button>`);
      if (nDif) et.push(`<button type="button" data-act="filtroAviso" class="pill-aviso perigo aviso-dif" data-tipo="dif" title="Clique para ver só esses itens. Pode ser preço errado na planilha (caixa em vez de unidade, vírgula no lugar errado…). Procure o aviso ⚠ confira o preço na coluna Dif. 1º × 2º.">⚠ ${nDif} dif. &gt;100%</button>`);
      if (qtdMarcas.errada || qtdMarcas.duvida) et.push(`<button type="button" data-act="filtroAviso" class="pill-aviso perigo aviso-marca" data-tipo="marca" title="Clique para ver só esses itens. Clique no aviso da marca de cada preço para dizer se é a mesma marca; o sistema aprende a abreviação para as próximas cotações.${db.config.marcaErradaNaoGanha !== false ? ' Preço com marca diferente não ganha automaticamente.' : ''}">🏷️ ${[qtdMarcas.errada ? `${qtdMarcas.errada} marca diferente` : '', qtdMarcas.duvida ? `${qtdMarcas.duvida} abrev. a conferir` : ''].filter(Boolean).join(' · ')}</button>`);
      const nRegra = comp.linhas.filter(l => l.preferencia).length;
      if (nRegra) et.push(`<button type="button" data-act="filtroAviso" class="pill-aviso regra" data-tipo="regra" title="Clique para ver só esses itens. A Comando ganha quando está até 5% acima do 1º lugar. Em cada item, clique no preço do mais barato para escolher ele.">⭐ ${nRegra} regra Comando</button>`);
      if (qtdDemora) et.push(`<button type="button" data-act="filtroAviso" class="pill-aviso demora" data-tipo="demora" title="Clique para ver só esses itens. Rio Juntas: os itens com marca GO demoram mais para chegar.">🐢 ${qtdDemora} GO (demora)</button>`);
      if (qtdAlertas) et.push(`<button type="button" data-act="filtroAviso" class="pill-aviso atencao aviso-alertas" data-tipo="alertas" title="Clique para ver só esses itens. Mais de ${Math.round(LIMITE_ALERTA * 100)}% de diferença do último preço pago, ou muito diferente dos outros fornecedores. Passe o mouse no aviso do preço para ver os detalhes.">⚠ ${qtdAlertas} fora do normal</button>`);
      const fa = filtroAviso(c);
      const ets = et.map(x => (fa && x.includes(`data-tipo="${fa}"`) ? x.replace('class="pill-aviso', 'class="pill-aviso ativo') : x));
      return et.length ? `<div class="avisos-comp${c.status === 'finalizada' ? ' discreto' : ''}" data-filtro="${fa}">${ets.join('')}<button type="button" class="link limpar-aviso" data-act="filtroAviso" data-tipo="${fa}" ${fa ? '' : 'hidden'}>✕ ver todos</button></div>` : '';
    })()}
    </div>
    ${tabelaComp}
  </section>

  ${temResposta ? secaoPedidos(c, comp) : ''}

  <div class="actions">
    <button data-act="duplicarCot">Duplicar como nova cotação</button>
    <button data-act="arquivarCot" title="${c.arquivada ? 'Volta para a lista de cotações' : 'Tira da lista de cotações (continua no histórico e nos relatórios)'}">${c.arquivada ? '↩ Desarquivar' : '🗂️ Arquivar'}</button>
    <button class="danger" data-act="excluirCot">Excluir cotação</button>
  </div>`;
}

function linhasProdutos() {
  const q = semAcento(ui.filtroProd);
  const hist = historicoPrecos();
  const termos = q ? q.split(/\s+/) : [];
  // o índice já vem em ordem de descrição: não precisa ordenar a cada tecla
  const lista = indiceBusca().filter(([p, t]) => (!ui.soComPreco || hist[p.id]) && termos.every(w => t.includes(w))).map(([p]) => p);
  const LIMITE = 100;
  const extra = lista.length > LIMITE
    ? `<tr><td colspan="7" class="empty">Mostrando ${LIMITE} de ${lista.length.toLocaleString('pt-BR')} produtos. Use a busca para encontrar o que precisa.</td></tr>`
    : '';
  if (!lista.length) return `<tr><td colspan="7" class="empty">${db.produtos.length ? (ui.soComPreco ? 'Nenhum produto com preço nas cotações.' : 'Nenhum produto encontrado.') : 'Nenhum produto cadastrado. Cadastre acima ou importe de uma planilha.'}</td></tr>`;
  return lista.slice(0, LIMITE).map(p => {
    const h = hist[p.id];
    const u = h?.[h.length - 1];
    const aberto = ui.histProd === p.id && h;
    return `<tr${aberto ? ' class="hist-aberto"' : ''}>
      <td class="cod-prod"><span class="cod-comp">${esc(p.codigo || '—')}</span>${p.similar ? `<br><span class="small muted">sim. ${esc(p.similar)}</span>` : ''}</td>
      <td>${esc(p.descricao)}${p.obs ? `<br><span class="small muted">${esc(p.obs)}</span>` : ''}</td>
      <td class="c">${esc(p.unidade)}</td>
      <td>${p.marca ? esc(p.marca) : '<span class="badge warn" title="Sem marca exigida: preencha (QUALQUER, SÓ COFAP…)">⚠ sem marca</span>'}</td>
      <td>${esc(p.categoria)}</td>
      <td class="r">${u ? `<div class="ult-preco">
          ${graficoPrecos(h, false)}
          <div>${fmtMoeda(u.preco)} ${setaVariacao(variacaoPreco(h))}<br><span class="small muted">${esc(u.fornecedor)} · ${fmtData(u.data)}</span></div>
        </div>` : '<span class="muted">—</span>'}</td>
      <td class="actions-cell">
        ${h ? `<button class="sm${aberto ? ' primary' : ''}" data-act="verHistorico" data-id="${p.id}" title="Ver todos os preços deste produto">📈 ${h.length}</button>` : ''}
        <button class="sm" data-act="editarProd" data-id="${p.id}">Editar</button>
        <button class="sm danger" data-act="excluirProd" data-id="${p.id}">✕</button>
      </td>
    </tr>${aberto ? `<tr class="hist-linha"><td colspan="7">${painelHistorico(h)}</td></tr>` : ''}`;
  }).join('') + extra;
}

/* ---------------- histórico de preço por fornecedor ---------------- */

const MAX_SERIES = 8; // paleta categórica de 8 cores (ordem fixa, nunca repetida)

/** Preços de cada fornecedor ao longo das cotações do produto, na ordem em que apareceram. */
function seriesFornecedores(h) {
  const mapa = new Map();
  h.forEach((x, k) => x.precos.forEach(p => {
    if (!mapa.has(p.nome)) mapa.set(p.nome, []);
    mapa.get(p.nome).push({ k, data: x.data, numero: x.numero, preco: p.preco, ganhou: p.nome === x.fornecedor });
  }));
  return [...mapa.entries()].map(([nome, pts], i) => ({ nome, pts, cor: i < MAX_SERIES ? i + 1 : 0 }));
}

function graficoFornecedores(h, series) {
  const noGrafico = series.filter(sr => sr.cor);
  const W = 640, H = 210, PL = 64, PR = noGrafico.length <= 4 ? 110 : 16, PT = 12, PB = 26;
  const vals = noGrafico.flatMap(sr => sr.pts.map(p => p.preco));
  let mn = Math.min(...vals), mx = Math.max(...vals);
  if (mn === mx) { mn *= 0.9; mx *= 1.1; }
  const X0 = PL + 18; // afasta a 1ª data do rótulo do eixo
  const x = k => (h.length === 1 ? (X0 + W - PR) / 2 : X0 + k * (W - X0 - PR) / (h.length - 1));
  const y = v => PT + (mx - v) * (H - PT - PB) / (mx - mn);
  const grade = [mn, (mn + mx) / 2, mx].map(v => `<line class="hf-grade" x1="${PL}" x2="${W - PR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
    <text class="hf-eixo" x="${PL - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(fmtMoeda(v))}</text>`).join('');
  const datas = h.map((c, k) => `<text class="hf-eixo" x="${x(k).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(fmtData(c.data).slice(0, 5))}</text>`).join('');
  const linhas = noGrafico.map(sr => {
    const pts = sr.pts.map(p => `${x(p.k).toFixed(1)},${y(p.preco).toFixed(1)}`).join(' ');
    const ult = sr.pts[sr.pts.length - 1];
    return `<g class="hf-serie" style="--c: var(--serie-${sr.cor})">
      ${sr.pts.length > 1 ? `<polyline points="${pts}"/>` : ''}
      ${sr.pts.map(p => `<circle cx="${x(p.k).toFixed(1)}" cy="${y(p.preco).toFixed(1)}" r="${p.ganhou ? 5 : 4}"${p.ganhou ? ' class="ganhou"' : ''}/>`).join('')}
      ${noGrafico.length <= 4 ? `<text class="hf-rotulo" x="${(x(ult.k) + 9).toFixed(1)}" y="${(y(ult.preco) + 4).toFixed(1)}">${esc(sr.nome.length > 14 ? sr.nome.slice(0, 13) + '…' : sr.nome)}</text>` : ''}
    </g>`;
  }).join('');
  // colunas invisíveis para a dica ao passar o mouse (todos os preços daquela cotação)
  const larg = h.length > 1 ? (W - X0 - PR) / (h.length - 1) : W - X0 - PR;
  const colunas = h.map((c, k) => {
    const linhasTip = series.map(sr => [sr, sr.pts.find(p => p.k === k)]).filter(([, p]) => p).sort((a, b) => a[1].preco - b[1].preco)
      .map(([sr, p]) => `${sr.cor}|${sr.nome}|${fmtMoeda(p.preco)}${p.ganhou ? ' ✓' : ''}`).join(';;');
    return `<rect class="hf-col" x="${(x(k) - larg / 2).toFixed(1)}" y="${PT}" width="${larg.toFixed(1)}" height="${H - PT - PB}" data-tip="${esc(`${fmtData(c.data)} · cotação nº ${c.numero}`)}" data-linhas="${esc(linhasTip)}" data-x="${x(k).toFixed(1)}"/>`;
  }).join('');
  return `<div class="hf-wrap">
    <svg class="hf-graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Preço de cada fornecedor por cotação">${grade}${datas}<line class="hf-cruz" x1="0" x2="0" y1="${PT}" y2="${H - PB}" style="display:none"/>${linhas}${colunas}</svg>
    <div class="hf-tip" hidden></div>
  </div>`;
}

function blocoFornecedoresHistorico(h) {
  const series = seriesFornecedores(h);
  if (series.length < 2 && h.length < 2) return '';
  const fora = series.filter(sr => !sr.cor).length;
  const resumo = series.map(sr => {
    const ps = sr.pts.map(p => p.preco);
    const a = sr.pts[0], b = sr.pts[sr.pts.length - 1];
    return { sr, n: sr.pts.length, ganhou: sr.pts.filter(p => p.ganhou).length, a, b, var: sr.pts.length > 1 && a.preco > 0 ? b.preco / a.preco - 1 : null, mn: Math.min(...ps), mx: Math.max(...ps) };
  }).sort((p, q) => p.b.k === q.b.k ? p.b.preco - q.b.preco : q.b.k - p.b.k);
  const swatch = sr => (sr.cor ? `<span class="hf-sw" style="--c: var(--serie-${sr.cor})"></span>` : '<span class="hf-sw vazio"></span>');
  return `<div class="hf-bloco">
    <h4>Preço de cada fornecedor</h4>
    <div class="hf-legenda">${series.filter(sr => sr.cor).map(sr => `<span>${swatch(sr)}${esc(sr.nome)}</span>`).join('')}<span class="small muted">● maior = ganhou naquela cotação</span></div>
    ${graficoFornecedores(h, series)}
    ${fora ? `<p class="small muted" style="margin:4px 0 0">${fora} fornecedor(es) a mais aparecem só na tabela.</p>` : ''}
    <div class="table-wrap"><table class="hf-tabela">
      <thead><tr><th>Fornecedor</th><th class="r">Cotou</th><th class="r">Ganhou</th><th class="r">Primeiro preço</th><th class="r">Último preço</th><th class="r">Variação</th><th class="r">Menor</th><th class="r">Maior</th></tr></thead>
      <tbody>${resumo.map(r => `<tr>
        <td>${swatch(r.sr)}<b>${esc(r.sr.nome)}</b></td>
        <td class="r">${r.n}×</td>
        <td class="r">${r.ganhou}×</td>
        <td class="r">${fmtMoeda(r.a.preco)}<br><span class="small muted">${fmtData(r.a.data)}</span></td>
        <td class="r"><b>${fmtMoeda(r.b.preco)}</b><br><span class="small muted">${fmtData(r.b.data)}</span></td>
        <td class="r">${r.var != null ? setaVariacao(r.var) : '—'}</td>
        <td class="r">${fmtMoeda(r.mn)}</td>
        <td class="r">${fmtMoeda(r.mx)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="small muted" style="margin:4px 0 0">Ordem: quem cotou mais recentemente e mais barato primeiro. A variação compara o primeiro e o último preço de cada fornecedor (↑ subiu, ↓ baixou).</p>
  </div>`;
}

function painelHistorico(h) {
  const vals = h.map(x => x.preco);
  const primeiro = h[0].preco, ultimo = h[h.length - 1].preco;
  return `<div class="hist-painel">
    <div class="hist-resumo">
      <div><span class="muted small">Último pago</span><b>${fmtMoeda(ultimo)}</b></div>
      <div><span class="muted small">Menor pago</span><b>${fmtMoeda(Math.min(...vals))}</b></div>
      <div><span class="muted small">Maior pago</span><b>${fmtMoeda(Math.max(...vals))}</b></div>
      ${h.length > 1 ? `<div><span class="muted small">Desde a 1ª cotação</span><b>${setaVariacao(primeiro > 0 ? ultimo / primeiro - 1 : null)}</b></div>` : ''}
    </div>
    ${h.length > 1 ? graficoPrecos(h, true) : ''}
    ${blocoFornecedoresHistorico(h)}
    <h4 style="margin:14px 0 4px">Cotações</h4>
    <div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Cotação</th><th>Comprado de</th><th class="r">Preço pago</th><th class="r">Dif. 1º × 2º</th><th>Todos os preços recebidos</th></tr></thead>
      <tbody>${[...h].reverse().map(x => `<tr>
        <td>${fmtData(x.data)}</td>
        <td><a href="#" data-route="cotacao" data-id="${x.cotId}">nº ${esc(x.numero)}</a></td>
        <td>${esc(x.fornecedor)}${x.manual ? ' <span class="badge blue">escolhido</span>' : ''}</td>
        <td class="r"><b>${fmtMoeda(x.preco)}</b></td>
        <td class="r">${x.difSegundo != null ? fmtPct(x.difSegundo) : '—'}</td>
        <td class="small">${x.precos.map(y => `${esc(y.nome)} ${fmtMoeda(y.preco)}`).join(' · ')}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

/** Produto sem marca exigida não pode ficar no banco. */
const semMarcaExigida = p => !String(p?.marca || '').trim();
const produtosSemMarca = () => db.produtos.filter(semMarcaExigida);

/** Troca uma marca por outra só quando ela aparece como palavra inteira ("SÓ FREEMAX", "FREEMAX-COBREQ"). */
function trocadorDeMarca(de, para) {
  const alvo = String(de || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^A-Za-z0-9])${alvo}(?=[^A-Za-z0-9]|$)`, 'gi');
  return s => String(s || '').replace(re, (_, antes) => antes + para);
}

function cartaoLimpezaProdutos() {
  const sem = produtosSemMarca();
  return `<section class="card">
    <details class="limpeza-cad"><summary><b>🧹 Limpeza do cadastro</b> ${sem.length ? `<span class="badge warn">⚠ ${sem.length} sem marca exigida</span>` : '<span class="badge ok">✓ todos com marca</span>'} <span class="small muted">· trocar marca em todos os produtos</span></summary>
    ${sem.length ? `<div class="aviso-recusa small" style="margin-bottom:10px">⚠ <b>${sem.length} produto(s) sem marca exigida.</b> Preencha a marca na cotação (ela fica salva no cadastro) ou edite aqui (QUALQUER, SÓ COFAP…).
      <div style="margin:6px 0">${sem.slice(0, 10).map(p => `<span class="badge">${esc(p.codigo || '—')}</span> ${esc(p.descricao)}`).join('<br>')}${sem.length > 10 ? `<br>… e mais ${sem.length - 10}` : ''}</div>
      <button type="button" class="sm danger" data-act="excluirSemMarca">🗑 Excluir os ${sem.length} produto(s) sem marca</button>
      <span class="muted"> ou edite cada um e preencha a marca.</span></div>` : '<p class="small muted" style="margin-top:0">✓ Todos os produtos têm marca exigida.</p>'}
    <form data-form="trocarMarca" class="row troca-marca">
      <b class="small">Trocar marca em todos os produtos:</b>
      <label>De<input name="de" required placeholder="Ex.: FREEMAX" autocomplete="off"></label>
      <label>Para<input name="para" required placeholder="Ex.: FREMAX" autocomplete="off"></label>
      <button class="sm primary">Trocar…</button>
    </form>
    </details>
  </section>`;
}

function renderProdutos() {
  const p = ui.editProd ? db.produtos.find(x => x.id === ui.editProd) : null;
  const v = p || { unidade: 'UN' };
  return `
  <section class="card cab-cadastro">
    <div class="row-between"><h2 style="margin:0">${p ? 'Editar produto' : 'Produtos'} <span class="badge">${db.produtos.length}</span></h2></div>
    <details class="form-novo"${p ? ' open' : ''}>
    <summary class="btn${p ? '' : ' btn-primary'}">${p ? '✎ Editando: ' + esc(p.codigo || p.descricao) : '+ Adicionar produto'}</summary>
    <form data-form="produto" class="grid">
      <label>Código<input name="codigo" value="${esc(v.codigo)}"></label>
      <label style="grid-column:span 2">Descrição *<input name="descricao" required value="${esc(v.descricao)}"></label>
      <label>Unidade<input name="unidade" value="${esc(v.unidade)}" placeholder="UN, CX, KG, M…"></label>
      <label>Similar (códigos equivalentes)<input name="similar" value="${esc(v.similar)}"></label>
      <label>Marca exigida * <span class="muted small">(QUALQUER, SÓ COFAP, NAK-COF-TRW…)</span><input name="marca" required value="${esc(v.marca)}"></label>
      <label>Categoria<input name="categoria" value="${esc(v.categoria)}" list="categorias"></label>
      <label style="grid-column:1/-1">Observação<input name="obs" value="${esc(v.obs)}"></label>
      <datalist id="categorias">${[...new Set(db.produtos.map(x => x.categoria).filter(Boolean))].sort().map(cat => `<option value="${esc(cat)}">`).join('')}</datalist>
      <div class="actions" style="grid-column:1/-1">
        ${p ? '<button type="button" data-act="cancelarProd">Cancelar</button>' : ''}
        <button class="primary">${p ? 'Salvar alterações' : '+ Adicionar produto'}</button>
      </div>
    </form>
    </details>
  </section>
  ${cartaoLimpezaProdutos()}
  <section class="card">
    <div class="row-between" style="margin-bottom:10px">
      <input class="grow" id="filtroProd" placeholder="Buscar produto…" value="${esc(ui.filtroProd)}">
      <label class="check-inline"><input type="checkbox" id="soComPreco" ${ui.soComPreco ? 'checked' : ''}> Só com preço</label>
      <div class="row">
        <label class="btn sm" style="margin:0" title="Colunas: Código, Descrição, Unidade, Marca, Categoria">📥 Importar Excel/CSV<input type="file" class="hidden" accept=".xlsx,.csv,.txt" data-import-produtos></label>
        <button class="sm" data-act="exportarProdutos">⬇ Exportar Excel</button>
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Código</th><th>Descrição</th><th class="c">Unid.</th><th>Marca exigida</th><th>Categoria</th><th class="r">Último preço pago</th><th></th></tr></thead>
      <tbody id="tbProd">${linhasProdutos()}</tbody>
    </table></div>
    <p class="tip">Para importar sua lista de produtos, use uma planilha com as colunas <b>Código, Descrição, Unidade, Similar, Marca, Categoria</b> (a primeira linha é o cabeçalho). Produtos com o mesmo código são atualizados.</p>
  </section>`;
}

/* ---------------- backup ---------------- */

/** Dias desde o último backup (null = nunca fez). */
function diasSemBackup() {
  if (!db.ultimoBackup) return null;
  return Math.floor((Date.now() - new Date(db.ultimoBackup).getTime()) / 86400000);
}

function precisaBackup() {
  const n = Number(db.config.backupDias ?? 7);
  if (!n) return false;
  if (!db.produtos.length && !db.cotacoes.length) return false;
  if (db.backupAdiadoAte && hojeISO() < db.backupAdiadoAte) return false;
  const d = diasSemBackup();
  return d == null || d >= n;
}

function avisoBackup() {
  if (nuvem.supabase) return ''; // no Supabase o backup é automático (duas vezes por dia)
  if (!precisaBackup()) return '';
  const d = diasSemBackup();
  return `<div class="aviso-backup" role="status">
    <span>💾 ${d == null ? '<b>Você ainda não fez nenhum backup.</b>' : `<b>Último backup há ${d} dia(s)</b> (${fmtData(db.ultimoBackup)}).`}
      Guarde uma cópia dos dados (${db.produtos.length.toLocaleString('pt-BR')} produtos, ${db.cotacoes.length} cotações) no computador ou no Google Drive.</span>
    <span class="row">
      <button class="sm primary" data-act="backup">⬇ Baixar backup agora</button>
      <button class="sm" data-act="adiarBackup">Lembrar amanhã</button>
    </span>
  </div>`;
}

async function fazerBackup() {
  const nome = `backup_cotacoes_${hojeISO()}.json`;
  const copia = { ...db, ultimoBackup: new Date().toISOString() };
  const ok = await salvarComo(nome, async () => new Blob([JSON.stringify(copia, null, 2)], { type: 'application/json' }),
    { description: 'Backup do sistema', accept: { 'application/json': ['.json'] } });
  if (!ok) return;
  db.ultimoBackup = copia.ultimoBackup;
  db.backupAdiadoAte = null;
  salvar();
  render();
  toast('Backup salvo. Guarde o arquivo num lugar seguro (Google Drive, pendrive…).');
}

/* ---------------- relatórios ---------------- */

const PERIODOS = [['', 'Todo o período'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['365', 'Últimos 12 meses']];

/** Data inicial do período escolhido em Relatórios ('' = todo o período). */
function inicioPeriodo() {
  if (!ui.periodoRel) return '';
  const d = new Date();
  d.setDate(d.getDate() - Number(ui.periodoRel));
  return d.toISOString().slice(0, 10);
}

function dadosRelatorio() {
  const desde = inicioPeriodo();
  const cots = db.cotacoes.filter(c => c.status !== 'cancelada' && (!desde || c.data >= desde))
    .sort((a, b) => (b.data + b.numero).localeCompare(a.data + a.numero));
  const forn = {};
  const porCot = [];
  const res = { cotacoes: 0, itens: 0, total: 0, media: 0, maior: 0, difs: [] };
  for (const c of cots) {
    const comp = comparar(c);
    if (!comp.itensCotados) continue;
    const r = { c, itens: 0, total: 0, media: 0, maior: 0, comparaveis: 0 };
    for (const l of comp.linhas) {
      const q = l.preco == null ? 0 : qtdComprada(c, l, comp.porLoja);
      if (!q) continue; // sem quantidade ou todo em Dúvidas: não foi comprado
      const validos = l.precos.filter(p => p != null);
      r.itens++;
      r.total += l.preco * q;
      if (validos.length > 1) {
        // economia só faz sentido onde houve concorrência (2 ou mais preços)
        r.comparaveis++;
        r.media += (validos.reduce((a, b) => a + b, 0) / validos.length - l.preco) * q;
        r.maior += (Math.max(...validos) - l.preco) * q;
        res.difs.push(l.difSegundo);
      }
    }
    c.fornecedores.forEach((f, fi) => {
      const k = f.fornecedorId || f.nome;
      const x = forn[k] ||= { id: k, nome: f.nome, participou: 0, respondeu: 0, cotados: 0, ganhos: 0, valor: 0, difs: [] };
      x.participou++;
      if (f.respondidoEm || comp.totais[fi].cotados) x.respondeu++;
      x.cotados += comp.totais[fi].cotados;
      x.ganhos += comp.totais[fi].vencidos;
      x.valor += comp.linhas.reduce((t, l) => t + (l.vencedor === fi && l.preco != null ? l.preco * qtdComprada(c, l, comp.porLoja) : 0), 0);
      for (const l of comp.linhas) if (l.vencedor === fi && !l.manual && !l.preferencia && l.difSegundo != null) x.difs.push(l.difSegundo);
    });
    porCot.push(r);
    res.cotacoes++;
    res.itens += r.itens;
    res.total += r.total;
    res.media += r.media;
    res.maior += r.maior;
  }
  const fornecedores = Object.values(forn).sort((a, b) => b.ganhos - a.ganhos || b.valor - a.valor || COLLATOR.compare(a.nome, b.nome));
  return { res, porCot, fornecedores };
}

const media = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

const COLS_REL_FORN = [
  ['nome', 'Fornecedor', ''], ['respondeu', 'Respondeu', 'c'], ['cotados', 'Itens cotados', 'r'],
  ['ganhos', 'Itens ganhos', 'r'], ['pctGanhos', '% ganhos', 'r'], ['valor', 'Valor ganho', 'r'], ['vantagem', 'Vantagem média', 'r'],
];
function ordenarRelForn(lista) {
  const o = ui.ordemRelForn;
  if (!o) return lista;
  const val = f => (o.campo === 'pctGanhos' ? (f.cotados ? f.ganhos / f.cotados : -1) : o.campo === 'vantagem' ? (media(f.difs) ?? -1) : f[o.campo]);
  return [...lista].sort((a, b) => (o.campo === 'nome' ? COLLATOR.compare(a.nome, b.nome) : (val(a) - val(b))) * o.dir || COLLATOR.compare(a.nome, b.nome));
}

/** Relatório em Excel: resumo, fornecedores, por cotação e a nota dos fornecedores. */
async function exportarRelatorio() {
  const { res, porCot, fornecedores } = dadosRelatorio();
  const wb = await novoLivroExcel();
  const per = PERIODOS.find(([v]) => v === (ui.periodoRel || ''))?.[1] || 'Todo o período';
  const aba = (nome, cab, linhas, larg) => {
    const ws = wb.addWorksheet(nome);
    ws.addRow(cab).font = { bold: true };
    linhas.forEach(l => ws.addRow(l));
    ws.columns.forEach((col, i) => { col.width = larg[i] || 14; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return ws;
  };
  aba('Resumo', ['Indicador', 'Valor'], [
    ['Período', per], ['Cotações com resposta', res.cotacoes], ['Itens comprados', res.itens], ['Total das compras (R$)', res.total],
    ['Economia vs média dos preços (R$)', res.media], ['Economia vs preço mais caro (R$)', res.maior], ['Dif. média 1º × 2º', media(res.difs)],
  ], [36, 20]);
  aba('Fornecedores', ['Fornecedor', 'Cotações', 'Respondeu', 'Itens cotados', 'Itens ganhos', '% ganhos', 'Valor ganho (R$)', 'Vantagem média'],
    fornecedores.map(f => [f.nome, f.participou, f.respondeu, f.cotados, f.ganhos, f.cotados ? f.ganhos / f.cotados : null, f.valor, media(f.difs)]), [26, 10, 11, 13, 13, 11, 16, 15]);
  aba('Por cotação', ['Nº', 'Título', 'Data', 'Status', 'Itens', 'Total comprado (R$)', 'Economia vs média (R$)', 'Economia vs mais caro (R$)'],
    porCot.map(r => [r.c.numero, r.c.titulo || '', r.c.data, STATUS[r.c.status]?.[0] || r.c.status, r.itens, r.total, r.media, r.maior]), [8, 34, 12, 11, 8, 18, 20, 22]);
  const notas = desempenhoFornecedores(inicioPeriodo());
  aba('Nota dos fornecedores', ['Fornecedor', 'Nota', 'Respondeu', 'No prazo', 'Itens cotados', 'Marca errada', 'Notas com divergência', 'Cobrado a mais (R$)'],
    notas.map(x => [x.nome, x.nota, `${x.respondidas}/${x.recebidas}`, x.comPrazo ? `${x.noPrazo}/${x.comPrazo}` : '', `${x.itensCotados}/${x.itensPedidos}`, x.marcaErrada, x.notas ? `${x.notasDiv}/${x.notas}` : '', x.cobrado]), [26, 8, 11, 10, 13, 13, 20, 18]);
  // formatos: colunas "(R$)" em dinheiro, "%"/"Vantagem" em porcentagem; no Resumo, pela linha
  const formato = txt => (/\(R\$\)/.test(txt) ? '#,##0.00' : /%|Vantagem|Dif\. média/.test(txt) ? '0.0%' : null);
  for (const ws of wb.worksheets) {
    ws.eachRow((row, i) => {
      if (i === 1) return;
      row.eachCell(cell => {
        if (typeof cell.value !== 'number') return;
        const f = formato(String(ws.name === 'Resumo' ? row.getCell(1).value : ws.getRow(1).getCell(cell.col).value));
        if (f) cell.numFmt = f;
      });
    });
  }
  await baixarWorkbook(wb, `Relatorio_${(per || '').replace(/\s+/g, '_')}_${hojeISO()}.xlsx`);
}

function renderRelatorios() {
  const { res, porCot, fornecedores: fornBase } = dadosRelatorio();
  const fornecedores = ordenarRelForn(fornBase);
  const pct = (v, base) => base > 0 ? fmtPct(v / base) : '—';
  const top = fornBase[0];
  const melhorCot = [...porCot].filter(r => r.comparaveis).sort((a, b) => b.media - a.media)[0];
  const o = ui.ordemRelForn;
  return `
  <section class="card">
    <div class="row-between">
      <h2>Relatórios</h2>
      <div class="row">
        <select id="periodoRel" style="width:auto">${PERIODOS.map(([v, t]) => `<option value="${v}" ${ui.periodoRel === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
        ${res.cotacoes ? '<button type="button" class="sm" data-act="exportarRelatorio" title="Resumo, fornecedores, por cotação e a nota dos fornecedores numa planilha">⬇ Excel</button>' : ''}
      </div>
    </div>
    ${res.cotacoes ? `<div class="stats stats-rel">
      <div class="stat"><span class="muted small">Cotações com resposta</span><b>${res.cotacoes}</b></div>
      <div class="stat"><span class="muted small">Itens comprados</span><b>${res.itens}</b></div>
      <div class="stat"><span class="muted small">Total das compras</span><b>${fmtMoeda(res.total)}</b></div>
      <div class="stat" title="Diferença entre a média dos preços recebidos e o preço escolhido, nos itens com 2 ou mais preços"><span class="muted small">Economia vs média dos preços</span><b class="ok">${fmtMoeda(res.media)}</b><span class="small muted">${pct(res.media, res.total + res.media)} a menos</span></div>
      <div class="stat" title="Diferença entre o preço mais caro recebido e o preço escolhido"><span class="muted small">Economia vs preço mais caro</span><b class="ok">${fmtMoeda(res.maior)}</b><span class="small muted">${pct(res.maior, res.total + res.maior)} a menos</span></div>
      <div class="stat" title="Em média, quanto o 2º melhor preço é mais caro que o melhor"><span class="muted small">Dif. média 1º × 2º</span><b>${fmtPct(media(res.difs))}</b></div>
    </div>
    <ul class="destaques-rel">
      ${top ? `<li>🏆 Quem mais ganhou: <button type="button" class="link" data-act="analiseForn" data-id="${esc(top.id)}"><b>${esc(top.nome)}</b></button> — ${top.ganhos} itens · ${fmtMoeda(top.valor)}</li>` : ''}
      ${melhorCot ? `<li>💰 Maior economia: <a href="#" data-route="cotacao" data-id="${esc(melhorCot.c.id)}"><b>cotação nº ${esc(melhorCot.c.numero)}</b></a>${melhorCot.c.titulo ? ` (${esc(melhorCot.c.titulo)})` : ''} — ${fmtMoeda(melhorCot.media)} abaixo da média</li>` : ''}
      <li>🧾 Média por cotação: ${fmtMoeda(res.total / res.cotacoes)} · ${Math.round(res.itens / res.cotacoes)} itens</li>
    </ul>
    <nav class="atalhos-rel small"><span class="muted">Ir para:</span><a href="#" data-act="irSecaoRel" data-alvo="relForn">Fornecedores</a><a href="#" data-act="irSecaoRel" data-alvo="relCot">Por cotação</a><a href="#" data-act="irSecaoRel" data-alvo="notaFornecedores">Nota dos fornecedores</a></nav>` : '<p class="empty">Ainda não há cotações com preços neste período. Os relatórios aparecem assim que os fornecedores responderem (as cotações canceladas não entram).</p>'}
  </section>
  ${fornecedores.length && res.cotacoes ? `<section class="card" id="relForn">
    <h3>Fornecedores</h3>
    <p class="muted small" style="margin-top:0">Quem ganha mais itens. "Vantagem média" é quanto, em média, o 2º colocado estava mais caro nos itens que o fornecedor ganhou pelo menor preço. Clique no título de uma coluna para ordenar e no fornecedor para a análise detalhada.</p>
    <div class="table-wrap"><table class="tab-rel">
      <thead><tr>${COLS_REL_FORN.map(([k, rot, cls]) => `<th${cls ? ` class="${cls}"` : ''}><button type="button" class="th-ordem${o?.campo === k ? ' ativa' : ''}" data-act="ordemRelForn" data-campo="${k}" title="Ordenar por ${rot.toLowerCase()}">${rot}${o?.campo === k ? (o.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}</tr></thead>
      <tbody>${fornecedores.map(f => `<tr>
        <td class="nome-rel"><button type="button" class="link nome-forn-analise" data-act="analiseForn" data-id="${esc(f.id)}"><b>${esc(f.nome)}</b></button></td>
        <td class="c" title="Respondeu ${f.respondeu} das ${f.participou} cotações que recebeu">${f.respondeu}/${f.participou}</td>
        <td class="r">${f.cotados}</td>
        <td class="r">${f.ganhos}</td>
        <td class="r"><span class="pct-barra"><span class="barra"><span style="width:${f.cotados ? Math.round(100 * f.ganhos / f.cotados) : 0}%"></span></span>${pct(f.ganhos, f.cotados)}</span></td>
        <td class="r">${fmtMoeda(f.valor)}</td>
        <td class="r">${fmtPct(media(f.difs))}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </section>
  <section class="card" id="relCot">
    <h3>Por cotação</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Nº</th><th>Data</th><th class="r">Itens</th><th class="r">Total comprado</th><th class="r">Economia vs média</th><th class="r">Economia vs mais caro</th></tr></thead>
      <tbody>${porCot.map(r => `<tr>
        <td><a href="#" data-route="cotacao" data-id="${r.c.id}"><b>${esc(r.c.numero)}</b></a> ${statusBadge(r.c.status)}${r.c.titulo ? `<br><span class="small muted">${esc(r.c.titulo)}</span>` : ''}</td>
        <td>${fmtData(r.c.data)}</td>
        <td class="r">${r.itens}</td>
        <td class="r">${fmtMoeda(r.total)}</td>
        <td class="r">${r.comparaveis ? `${fmtMoeda(r.media)} <span class="small muted">(${pct(r.media, r.total + r.media)})</span>` : '—'}</td>
        <td class="r">${r.comparaveis ? `${fmtMoeda(r.maior)} <span class="small muted">(${pct(r.maior, r.total + r.maior)})</span>` : '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </section>` : ''}
  ${secaoNotaFornecedores()}`;
}

/* ---------------- nota dos fornecedores ---------------- */

const PESOS_NOTA = [
  ['resposta', 0.25, 'Responde às cotações'],
  ['prazo', 0.15, 'Responde no prazo'],
  ['cobertura', 0.20, 'Cota os itens pedidos'],
  ['marca', 0.20, 'Manda a marca exigida'],
  ['notas', 0.20, 'Notas fiscais sem divergência'],
];

/**
 * Desempenho de cada fornecedor do cadastro nas cotações do período (canceladas não contam):
 * resposta, prazo, tempo de resposta, cobertura, marca, notas fiscais e nota de 0 a 10.
 */
function desempenhoFornecedores(desde = inicioPeriodo(), cotId = null) {
  const st = {};
  const pega = (id, nome) => (st[id] ||= {
    id, nome, recebidas: 0, respondidas: 0, comPrazo: 0, noPrazo: 0, horas: [], itensPedidos: 0, itensCotados: 0,
    comExigencia: 0, marcaErrada: 0, semMarca: 0, notas: 0, notasDiv: 0, cobrado: 0, faltas: 0,
  });
  // uma cotação só (análise individual) ou todas do período (análise geral)
  const cots = cotId ? db.cotacoes.filter(c => c.id === cotId) : db.cotacoes.filter(c => c.status !== 'cancelada' && (!desde || c.data >= desde));
  for (const c of cots) {
    const comp = comparar(c);
    c.fornecedores.forEach((f, j) => {
      const x = pega(f.fornecedorId || f.nome, f.nome);
      const resp = respondeu(f);
      if (!f.enviadoEm && !resp) return; // ainda não recebeu a cotação
      x.recebidas++;
      if (!resp) return;
      x.respondidas++;
      if (c.prazoResposta && f.respondidoEm) {
        x.comPrazo++;
        if (respondeuNoPrazo(c, f)) x.noPrazo++; // data e hora do prazo
      }
      if (f.enviadoEm && f.respondidoEm && f.respondidoEm > f.enviadoEm) x.horas.push((new Date(f.respondidoEm) - new Date(f.enviadoEm)) / 3600000);
      x.itensPedidos += c.itens.length;
      for (const l of comp.linhas) {
        if (l.precos[j] == null) continue;
        x.itensCotados++;
        const m = l.marcas[j];
        if (m == null) continue;
        x.comExigencia++;
        if (m === 'errada') x.marcaErrada++;
        if (m === 'sem') x.semMarca++;
      }
    });
    for (const rec of c.recebimentos || []) {
      const f = c.fornecedores.find(y => y.fornecedorId === rec.fornecedorId);
      const x = pega(rec.fornecedorId, f?.nome || rec.nf.emitente.nome);
      const { resumo } = conferirNFe(c, rec);
      x.notas++;
      if (resumo.precoMaior || resumo.qtd || resumo.naoPedidos) x.notasDiv++;
      x.cobrado += resumo.cobrar;
      x.faltas += resumo.naoVeio;
    }
  }
  for (const x of Object.values(st)) {
    const cad = db.fornecedores.find(f => f.id === x.id);
    if (cad) x.nome = cad.nome;
    x.partes = {
      resposta: x.recebidas ? x.respondidas / x.recebidas : null,
      prazo: x.comPrazo ? x.noPrazo / x.comPrazo : null,
      cobertura: x.itensPedidos ? x.itensCotados / x.itensPedidos : null,
      marca: x.comExigencia ? 1 - (x.marcaErrada + x.semMarca * 0.5) / x.comExigencia : null,
      notas: x.notas ? 1 - x.notasDiv / x.notas : null,
    };
    const usados = PESOS_NOTA.filter(([k]) => x.partes[k] != null);
    const peso = usados.reduce((s2, [, w]) => s2 + w, 0);
    x.nota = peso ? Math.round((usados.reduce((s2, [k, w]) => s2 + x.partes[k] * w, 0) / peso) * 100) / 10 : null;
    x.horasMedia = x.horas.length ? x.horas.reduce((a, b) => a + b, 0) / x.horas.length : null;
  }
  return Object.values(st).filter(x => x.recebidas || x.notas)
    .sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1) || COLLATOR.compare(a.nome, b.nome));
}

function fmtHoras(h) {
  if (h == null) return '—';
  if (h < 1) return 'menos de 1 h';
  if (h < 48) return `${Math.round(h)} h`;
  return `${(h / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`;
}

function badgeNota(nota, titulo = '') {
  if (nota == null) return '<span class="muted">—</span>';
  const cls = nota >= 8 ? 'ok' : nota >= 6 ? 'warn' : 'danger';
  return `<span class="nota-forn ${cls}" title="${esc(titulo)}">${nota.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>`;
}

function tituloNota(x) {
  return PESOS_NOTA.map(([k, w, rot]) => `${rot} (${Math.round(w * 100)}%): ${x.partes[k] == null ? 'sem dados' : fmtPct(x.partes[k], 0)}`).join('\n');
}

function secaoNotaFornecedores() {
  const cotsSel = [...db.cotacoes].filter(c => c.status !== 'cancelada' && c.fornecedores.length)
    .sort((a, b) => (b.data + b.numero).localeCompare(a.data + a.numero));
  if (ui.notaCot && !cotsSel.some(c => c.id === ui.notaCot)) ui.notaCot = '';
  const cot = ui.notaCot ? db.cotacoes.find(c => c.id === ui.notaCot) : null;
  const lista = desempenhoFornecedores(inicioPeriodo(), cot?.id || null);
  if (!lista.length && !cot) return '';
  const pct = (a, b) => (b ? `${a}/${b} <span class="small muted">(${fmtPct(a / b, 0)})</span>` : '—');
  return `<section class="card" id="notaFornecedores">
    <div class="row-between">
      <h3 style="margin:0">Nota dos fornecedores${cot ? ` — cotação nº ${esc(cot.numero)}` : ''}</h3>
      <label class="check-inline">Analisar:
        <select id="notaCot" style="width:auto">
          <option value="">Geral (todas as cotações${ui.periodoRel ? ' do período' : ''})</option>
          ${cotsSel.map(c => `<option value="${esc(c.id)}" ${ui.notaCot === c.id ? 'selected' : ''}>Cotação nº ${esc(c.numero)}${c.titulo ? ' · ' + esc(c.titulo) : ''} · ${fmtData(c.data)}</option>`).join('')}
        </select></label>
    </div>
    ${cot ? `<p class="small" style="margin:8px 0 0">Só a cotação nº ${esc(cot.numero)}${cot.titulo ? ` (${esc(cot.titulo)})` : ''} de ${fmtData(cot.data)} · ${cot.itens.length} itens · ${cot.fornecedores.length} fornecedores · <a href="#" data-route="cotacao" data-id="${esc(cot.id)}">abrir a cotação</a></p>` : ''}
    <p class="muted small" style="margin-top:0"><b>Clique no fornecedor para ver a análise detalhada.</b> Nota de 0 a 10: responde às cotações (25%), no prazo (15%), cota os itens pedidos (20%), manda a marca exigida (20%; sem marca conta meio erro) e notas fiscais sem divergência (20%). O que não tem dados fica fora da conta. Passe o mouse na nota para ver cada parte.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Fornecedor</th><th class="c">Nota</th><th class="r">Respondeu</th><th class="r">No prazo</th><th class="r">Tempo médio</th><th class="r">Itens cotados</th><th class="r">Marca errada</th><th class="r">Sem marca</th><th class="r">Notas com divergência</th><th class="r">Cobrado a mais</th></tr></thead>
      <tbody>${lista.map(x => `<tr class="linha-forn-analise" data-act="analiseForn" data-id="${esc(x.id)}" title="Clique para ver a análise detalhada de ${esc(x.nome)}">
        <td><button type="button" class="link nome-forn-analise" data-act="analiseForn" data-id="${esc(x.id)}"><b>${esc(x.nome)}</b></button></td>
        <td class="c">${badgeNota(x.nota, tituloNota(x))}</td>
        <td class="r">${pct(x.respondidas, x.recebidas)}</td>
        <td class="r">${pct(x.noPrazo, x.comPrazo)}</td>
        <td class="r">${fmtHoras(x.horasMedia)}</td>
        <td class="r">${pct(x.itensCotados, x.itensPedidos)}</td>
        <td class="r">${x.comExigencia ? `${x.marcaErrada} <span class="small muted">de ${x.comExigencia}</span>` : '—'}</td>
        <td class="r">${x.comExigencia ? x.semMarca : '—'}</td>
        <td class="r">${x.notas ? `${x.notasDiv} de ${x.notas}${x.faltas ? `<br><span class="small muted">${x.faltas} item(ns) não vieram</span>` : ''}` : '—'}</td>
        <td class="r">${x.cobrado ? `<span class="txt-ruim">${fmtMoeda(x.cobrado)}</span>` : '—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="small muted" style="margin:6px 0 0">O tempo de resposta vai do envio (marcado quando você abre o e-mail) até a importação da planilha respondida.</p>
  </section>`;
}

/**
 * Análise detalhada de um fornecedor (mesmo período/cotação da tabela da nota): participação,
 * competitividade (itens ganhos, quanto fica acima do melhor preço), marcas, notas fiscais e histórico.
 */
function analiseFornecedor(id, desde = inicioPeriodo(), cotId = null) {
  const cots = cotId ? db.cotacoes.filter(c => c.id === cotId) : db.cotacoes.filter(c => c.status !== 'cancelada' && (!desde || c.data >= desde));
  const r = { hist: [], cotados: 0, ganhos: 0, ganhosPreco: 0, segundo: 0, valorGanho: 0, acima: [], perdas: [], marcas: {}, marcasGanhas: {}, erradas: [], recebidas: 0, confirmadas: 0, comPedido: 0, exportados: 0 };
  for (const c of [...cots].sort((a, b) => (b.data + b.numero).localeCompare(a.data + a.numero))) {
    const j = c.fornecedores.findIndex(f => (f.fornecedorId || f.nome) === id);
    if (j < 0) continue;
    const f = c.fornecedores[j];
    const resp = respondeu(f);
    const h = { c, f, resp, enviada: !!f.enviadoEm || resp, noPrazo: c.prazoResposta && f.respondidoEm ? respondeuNoPrazo(c, f) : null, cotados: 0, ganhos: 0, valor: 0, acima: [] };
    if (resp) {
      const comp = comparar(c);
      for (const l of comp.linhas) {
        const p = l.precos[j];
        if (p == null) continue;
        h.cotados++;
        const m = f.respostas?.[l.i]?.marca;
        if (m) { const k = String(m).trim().toUpperCase(); r.marcas[k] = (r.marcas[k] || 0) + 1; }
        if (l.marcas[j] === 'errada') r.erradas.push({ c, it: l.it, pedida: l.it.marca, mandou: m });
        if (l.vencedor === j) {
          h.ganhos++;
          h.valor += p * qtdComprada(c, l, comp.porLoja);
          if (l.minIdx === j) r.ganhosPreco++;
          if (m) { const k = String(m).trim().toUpperCase(); r.marcasGanhas[k] = (r.marcasGanhas[k] || 0) + 1; }
        }
        else if (l.segundoIdx === j) r.segundo++;
        if (l.min > 0 && l.minIdx !== j) {
          const dif = p / l.min - 1;
          h.acima.push(dif);
          if (dif > 0) r.perdas.push({ c, it: l.it, preco: p, min: l.min, dif, quem: c.fornecedores[l.minIdx]?.nome || '' });
        } else if (l.min > 0) h.acima.push(0);
      }
    }
    r.cotados += h.cotados;
    r.ganhos += h.ganhos;
    if (h.enviada) r.recebidas++;
    if (f.confirmadoEm || resp) r.confirmadas++;
    // pedido só existe com quantidade (o mesmo critério do quadro Fornecedores e da exportação)
    h.temPedido = resp && pedidosPorFornecedor(c).some(pp => pp.fi === j);
    if (h.temPedido || f.concluidoEm) { r.comPedido++; if (f.concluidoEm) r.exportados++; }
    r.valorGanho += h.valor;
    r.acima.push(...h.acima);
    h.mediaAcima = h.acima.length ? h.acima.reduce((a, b) => a + b, 0) / h.acima.length : null;
    r.hist.push(h);
  }
  r.mediaAcima = r.acima.length ? r.acima.reduce((a, b) => a + b, 0) / r.acima.length : null;
  r.vezesMelhor = r.acima.filter(d => d === 0).length;
  r.perdas.sort((a, b) => b.dif - a.dif);
  r.perto = r.perdas.filter(x => x.dif <= 0.05).length; // perdeu por até 5%: dá para negociar
  return r;
}

async function abrirAnaliseFornecedor(id) {
  const cot = ui.notaCot ? db.cotacoes.find(c => c.id === ui.notaCot) : null;
  const desemp = desempenhoFornecedores(inicioPeriodo(), cot?.id || null);
  const x = desemp.find(y => y.id === id);
  if (!x) return;
  const a = analiseFornecedor(id, inicioPeriodo(), cot?.id || null);
  const cad = db.fornecedores.find(f => f.id === id);
  const pct = (v, d = 0) => fmtPct(v, d);
  const escopo = cot ? `cotação nº ${esc(cot.numero)}` : ui.periodoRel ? `últimos ${esc(ui.periodoRel)} dias` : 'todas as cotações';
  // comparação com os outros fornecedores do mesmo período
  const outros = desemp.map(y => ({ id: y.id, nota: y.nota, a: y.id === id ? a : analiseFornecedor(y.id, inicioPeriodo(), cot?.id || null) }));
  const posNota = [...outros].filter(o => o.nota != null).sort((p, q) => q.nota - p.nota).findIndex(o => o.id === id) + 1;
  const posGanhos = [...outros].sort((p, q) => q.a.ganhos - p.a.ganhos).findIndex(o => o.id === id) + 1;
  const taxa = o => (o.a.cotados ? o.a.ganhos / o.a.cotados : null);
  const taxas = outros.map(taxa).filter(v => v != null);
  const mediaTaxa = taxas.length ? taxas.reduce((p, q) => p + q, 0) / taxas.length : null;
  const minhaTaxa = a.cotados ? a.ganhos / a.cotados : null;
  const n = outros.length;
  const linha = (rot, val, sub = '', cls = '') => `<div class="af-linha ${cls}"><span>${rot}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const barra = v => (v == null ? '<span class="muted small">sem dados</span>'
    : `<span class="af-barra"><span style="width:${Math.round(v * 100)}%" class="${v >= 0.8 ? 'ok' : v >= 0.6 ? 'warn' : 'danger'}"></span></span><b class="af-pct">${pct(v)}</b>`);
  // pontos fortes e de atenção, em frases
  const fortes = [], atencao = [];
  for (const [k, , rot] of PESOS_NOTA) {
    const v = x.partes[k];
    if (v == null) continue;
    if (v >= 0.9) fortes.push(`${rot}: ${pct(v)}`);
    else if (v < 0.7) atencao.push(`${rot}: só ${pct(v)}`);
  }
  if (minhaTaxa != null && mediaTaxa != null && n > 1) {
    if (minhaTaxa >= mediaTaxa * 1.2) fortes.push(`Ganha mais que a média: ${pct(minhaTaxa)} dos itens que cota (média ${pct(mediaTaxa)})`);
    else if (minhaTaxa <= mediaTaxa * 0.6) atencao.push(`Ganha pouco: ${pct(minhaTaxa)} dos itens que cota (média ${pct(mediaTaxa)})`);
  }
  if (a.mediaAcima != null && a.mediaAcima <= 0.03) fortes.push(`Preço muito competitivo: em média ${pct(a.mediaAcima, 1)} acima do melhor`);
  if (a.mediaAcima != null && a.mediaAcima > 0.15) atencao.push(`Preço alto: em média ${pct(a.mediaAcima, 1)} acima do melhor preço`);
  if (a.perto) fortes.push(`${a.perto} item(ns) perdidos por até 5% — dá para negociar`);
  if (x.horasMedia != null && x.horasMedia > 48) atencao.push(`Demora para responder (${fmtHoras(x.horasMedia)} em média)`);
  if (a.comPedido && a.exportados < a.comPedido) atencao.push(`${a.comPedido - a.exportados} pedido(s) ainda não exportado(s)`);
  if (x.cobrado) atencao.push(`Cobrou ${fmtMoeda(x.cobrado)} a mais nas notas fiscais`);
  if (x.faltas) atencao.push(`${x.faltas} item(ns) pedidos não vieram na nota`);
  const top = (obj, k = 10) => Object.entries(obj).sort((p, q) => q[1] - p[1]).slice(0, k);
  const marcas = top(a.marcas);
  const marcasGanhas = top(a.marcasGanhas, 8);
  const statusResp = h => (!h.enviada ? '<span class="muted">não enviada</span>' : !h.resp ? '<span class="txt-ruim">não respondeu</span>'
    : h.noPrazo === false ? '<span class="txt-atencao">fora do prazo</span>' : h.noPrazo ? '<span class="txt-bom">no prazo</span>' : 'respondeu');
  const maxGanhos = Math.max(1, ...a.hist.map(h => h.ganhos));
  const html = `<div class="af-topo">
      <div class="af-ident"><h3 style="margin:0">${esc(x.nome)}</h3>
        <p class="small muted" style="margin:2px 0 0">${cad ? [cad.contato && '👤 ' + esc(cad.contato), cad.substituto && `<span class="subst-forn">subst. ${esc(cad.substituto)}</span>`, cad.telefone && '📞 ' + esc(cad.telefone), cad.email && '✉ ' + esc(cad.email)].filter(Boolean).join(' · ') : ''}</p>
        <p class="small muted" style="margin:2px 0 0">Análise de ${escopo}${n > 1 ? ` · comparado com ${n - 1} outro(s) fornecedor(es)` : ''}</p></div>
      <div class="af-nota">${badgeNota(x.nota, tituloNota(x))}<span class="small muted">nota${posNota ? ` · ${posNota}º de ${outros.filter(o => o.nota != null).length}` : ''}</span></div>
      <button type="button" class="af-fechar" title="Fechar (Esc)" aria-label="Fechar">✕</button>
    </div>
    <div class="af-grupos">
      <section class="af-grupo"><h4>📨 Participação</h4>
        ${linha('Recebeu', `${a.recebidas} cotação(ões)`)}
        ${linha('Confirmou o recebimento', a.recebidas ? `${a.confirmadas}/${a.recebidas}` : '—')}
        ${linha('Cotações respondidas', `${x.respondidas}/${x.recebidas}`, x.recebidas ? pct(x.respondidas / x.recebidas) : '')}
        ${linha('No prazo', x.comPrazo ? `${x.noPrazo}/${x.comPrazo}` : '—', x.comPrazo ? `${pct(x.noPrazo / x.comPrazo)} · pela hora da importação` : 'sem prazo definido')}
        ${linha('Tempo médio de resposta', fmtHoras(x.horasMedia), x.horasMedia == null ? 'marque o envio para medir' : '')}
      </section>
      <section class="af-grupo"><h4>🏷️ Competitividade</h4>
        ${linha('Itens cotados', `${x.itensCotados}/${x.itensPedidos}`, x.itensPedidos ? pct(x.itensCotados / x.itensPedidos) : '')}
        ${linha('Itens ganhos', `${a.ganhos}`, `${a.cotados ? pct(a.ganhos / a.cotados) + ' dos cotados' : ''}${mediaTaxa != null && n > 1 ? ` · média ${pct(mediaTaxa)}` : ''}`, 'destaque')}
        ${linha('Menor preço', `${a.vezesMelhor}`, a.acima.length ? `em ${pct(a.vezesMelhor / a.acima.length)} dos itens` : '')}
        ${linha('Ficou em 2º', `${a.segundo}`, 'item(ns)')}
        ${linha('Acima do melhor', a.mediaAcima == null ? '—' : pct(a.mediaAcima, 1), 'em média', a.mediaAcima > 0.15 ? 'ruim' : '')}
      </section>
      <section class="af-grupo"><h4>🛒 Compras</h4>
        ${linha('Valor ganho', fmtMoeda(a.valorGanho), 'preço × quantidade')}
        ${linha('Ranking de itens ganhos', n > 1 ? `${posGanhos}º de ${n}` : '—')}
        ${linha('Pedidos exportados', a.comPedido ? `${a.exportados}/${a.comPedido}` : '—', a.comPedido && a.exportados < a.comPedido ? 'falta exportar' : '')}
        ${linha('Média por cotação', a.comPedido ? fmtMoeda(a.valorGanho / a.comPedido) : '—', 'nas que ganhou itens')}
      </section>
    </div>
    <div class="af-cols">
      <section><h4>Composição da nota</h4>
        <table class="af-tab">${PESOS_NOTA.map(([k, w, rot]) => `<tr><td>${rot} <span class="small muted">(${Math.round(w * 100)}%)</span></td><td class="af-barra-cel">${barra(x.partes[k])}</td></tr>`).join('')}</table>
      </section>
      <section><h4>Resumo</h4>
        ${fortes.length ? `<ul class="af-lista bom">${fortes.map(t => `<li>✓ ${esc(t)}</li>`).join('')}</ul>` : ''}
        ${atencao.length ? `<ul class="af-lista ruim">${atencao.map(t => `<li>⚠ ${esc(t)}</li>`).join('')}</ul>` : ''}
        ${!fortes.length && !atencao.length ? '<p class="small muted">Sem destaques no período.</p>' : ''}
      </section>
    </div>
    <div class="af-cols">
      <section><h4>Marcas em que mais ganha</h4>
        ${marcasGanhas.length ? `<p class="af-marcas">${marcasGanhas.map(([m, q]) => `<span class="af-chip ganha">${esc(m)} <b>${q}</b></span>`).join('')}</p>` : '<p class="small muted">Ainda não ganhou itens.</p>'}
        <h4 style="margin-top:12px">Marcas que mais manda</h4>
        ${marcas.length ? `<p class="af-marcas">${marcas.map(([m, q]) => `<span class="af-chip">${esc(m)} <b>${q}</b></span>`).join('')}</p>` : '<p class="small muted">—</p>'}
        <p class="small">Marca errada: <b>${x.marcaErrada}</b>${x.comExigencia ? ` de ${x.comExigencia}` : ''} · sem marca: <b>${x.semMarca}</b></p>
        ${a.erradas.length ? `<details><summary class="small">ver itens com marca errada (${a.erradas.length})</summary><ul class="small af-mini">${a.erradas.slice(0, 15).map(e => `<li>nº ${esc(e.c.numero)} · <b>${esc(e.it.codigo || e.it.descricao)}</b>: pedida ${esc(e.pedida || '—')}, mandou ${esc(e.mandou || '—')}</li>`).join('')}</ul></details>` : ''}
      </section>
      <section><h4>Notas fiscais</h4>
        ${x.notas ? `<p class="small">Notas recebidas: <b>${x.notas}</b> · com divergência: <b>${x.notasDiv}</b><br>Cobrado a mais: <b class="${x.cobrado ? 'txt-ruim' : ''}">${fmtMoeda(x.cobrado)}</b> · itens que não vieram: <b>${x.faltas}</b></p>` : '<p class="small muted">Nenhuma nota fiscal conferida no período.</p>'}
      </section>
    </div>
    ${a.perdas.length ? `<section><h4>Onde ficou mais caro <span class="small muted">(para negociar)</span></h4>
      <div class="table-wrap af-rolar"><table class="af-tab"><thead><tr><th>Cotação</th><th>Item</th><th class="r">Preço dele</th><th class="r">Melhor</th><th class="r">Dif.</th><th>Quem ganhou</th></tr></thead>
      <tbody>${a.perdas.slice(0, 12).map(q => `<tr><td>nº ${esc(q.c.numero)}</td><td><b>${esc(q.it.codigo || '')}</b> <span class="small muted">${esc(q.it.descricao || '')}</span></td><td class="r">${fmtMoeda(q.preco)}</td><td class="r">${fmtMoeda(q.min)}</td><td class="r ${q.dif > 0.15 ? 'txt-ruim' : ''}">+${pct(q.dif, 1)}</td><td>${esc(q.quem)}</td></tr>`).join('')}</tbody></table></div>
    </section>` : ''}
    <section><h4>Histórico por cotação</h4>
      <div class="table-wrap af-rolar"><table class="af-tab"><thead><tr><th>Cotação</th><th>Data</th><th>Resposta</th><th class="r">Cotou</th><th>Ganhou</th><th class="r">Valor ganho</th><th class="r">Acima do melhor</th><th>Pedido</th></tr></thead>
      <tbody>${a.hist.map(h => `<tr><td><a href="#" data-route="cotacao" data-id="${esc(h.c.id)}" class="af-abrir"><b>nº ${esc(h.c.numero)}</b></a></td><td>${fmtData(h.c.data)}</td><td>${statusResp(h)}</td>
        <td class="r">${h.resp ? `${h.cotados}/${h.c.itens.length}` : '—'}</td><td>${h.resp ? `<span class="af-mini-barra" title="${h.ganhos} item(ns) ganhos"><span style="width:${Math.round((h.ganhos / maxGanhos) * 100)}%"></span></span> ${h.ganhos}` : '—'}</td><td class="r">${h.valor ? fmtMoeda(h.valor) : '—'}</td>
        <td class="r">${h.mediaAcima == null ? '—' : pct(h.mediaAcima, 1)}</td><td>${h.f.concluidoEm ? '<span class="txt-bom">✓ exportado</span>' : h.temPedido ? '<span class="muted">pendente</span>' : '—'}</td></tr>`).join('')}</tbody></table></div>
    </section>`;
  const p = abrirDialogo('', [{ txt: 'Fechar', valor: null, cls: 'primary' }]);
  const dlg = [...document.querySelectorAll('.dlg')].at(-1);
  dlg.classList.add('dlg-analise-forn');
  dlg.setAttribute('aria-label', `Análise de ${x.nome}`);
  dlg.querySelector('p').outerHTML = `<div class="af-corpo">${html}</div>`;
  dlg.addEventListener('click', e => {
    if (e.target.closest('.af-fechar')) { dlg.querySelector('.actions button').click(); return; }
    // abrir uma cotação do histórico fecha a análise
    const lk = e.target.closest('.af-abrir');
    if (!lk) return;
    e.preventDefault();
    dlg.querySelector('.actions button').click();
    ir('cotacao', lk.dataset.id);
  });
  await p;
}

function linhasFornecedores() {
  const q = semAcento(ui.filtroForn);
  const lista = db.fornecedores
    .filter(f => !q || semAcento(`${f.nome} ${f.contato} ${f.email} ${f.telefone} ${f.obs}`).includes(q))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  if (!lista.length) return `<tr><td colspan="7" class="empty">${db.fornecedores.length ? 'Nenhum fornecedor encontrado.' : 'Nenhum fornecedor cadastrado.'}</td></tr>`;
  const notas = Object.fromEntries(desempenhoFornecedores('').map(x => [x.id, x]));
  return lista.map(f => {
    const n = db.cotacoes.filter(c => c.fornecedores.some(x => x.fornecedorId === f.id)).length;
    const d = notas[f.id];
    return `<tr>
      <td><b>${esc(f.nome)}</b>${f.obs ? `<br><span class="small muted">${esc(f.obs)}</span>` : ''}${f.pedidoMinimo || f.frete ? `<br><span class="small">${[f.pedidoMinimo && `mínimo ${fmtMoeda(f.pedidoMinimo)}`, f.frete && `frete ${fmtMoeda(f.frete)}${f.freteGratisAcima ? ` (grátis acima de ${fmtMoeda(f.freteGratisAcima)})` : ''}`].filter(Boolean).join(' · ')}</span>` : ''}</td>
      <td>${esc(f.contato || '—')}${f.substituto ? `<br><span class="small muted">subst.: ${esc(f.substituto)}</span>` : ''}</td>
      <td>${f.email ? `<a href="mailto:${esc(f.email)}">${esc(f.email)}</a>` : '—'}</td>
      <td>${esc(f.telefone || '—')}</td>
      <td class="c">${n}</td>
      <td class="c">${d ? (podeVerRelatorios() ? `<a href="#" data-route="relatorios" class="link-nota">${badgeNota(d.nota, tituloNota(d))}</a>` : badgeNota(d.nota, tituloNota(d))) : '<span class="muted">—</span>'}</td>
      <td class="actions-cell">
        <button class="sm" data-act="editarForn" data-id="${f.id}">Editar</button>
        <button class="sm danger" data-act="excluirForn" data-id="${f.id}">✕</button>
      </td>
    </tr>`;
  }).join('');
}

/* ---------------- início: o que fazer agora ---------------- */

/** Pendências de todas as cotações ativas, na ordem do fluxo. */
function pendencias() {
  const lista = [];
  const add = (nivel, texto, detalhe, rota, id, botao) => lista.push({ nivel, texto, detalhe, rota, id, botao });
  const r = db.rascunho;
  if (r && r.itens?.length) add('info', `Nova cotação em andamento com ${r.itens.length} item(ns)`, 'Ainda não foi criada.', 'nova', null, 'Continuar');
  // finalizada = concluída: não pede mais nada (nem pedidos, nem notas); cancelada também não
  const ativas = db.cotacoes.filter(c => !c.arquivada && c.status === 'aberta')
    .sort((a, b) => (b.data + b.numero).localeCompare(a.data + a.numero));
  for (const c of ativas) {
    const nome = `Cotação nº ${c.numero}${c.titulo ? ' · ' + c.titulo : ''}`;
    const comp = comparar(c);
    const naoEnviados = c.fornecedores.filter(f => !f.enviadoEm && !respondeu(f));
    const prazo = situacaoPrazo(c);
    if (c.status === 'aberta' && !c.fornecedores.length) add('aviso', `${nome}: nenhum fornecedor escolhido`, 'Adicione os fornecedores e envie a planilha.', 'cotacao', c.id, 'Abrir');
    else if (c.status === 'aberta' && naoEnviados.length) add('aviso', `${nome}: ${naoEnviados.length} fornecedor(es) ainda sem a planilha`, naoEnviados.map(f => f.nome).join(', '), 'cotacao', c.id, 'Enviar');
    if (prazo) add(prazo.dias < 0 ? 'urgente' : 'aviso', `${nome}: prazo de resposta ${textoPrazo(prazo.dias, c.prazoHora)}`, `Faltam responder: ${prazo.pendentes.map(fi => c.fornecedores[fi].nome).join(', ')}`, 'cotacao', c.id, 'Cobrar');
    if (!comp.itensCotados) continue;
    if (!comp.porLoja) { add('aviso', `${nome}: respostas chegaram, faltam as quantidades das lojas`, `${comp.itensCotados} item(ns) com preço.`, 'cotacao', c.id, 'Definir quantidades'); continue; }
    const peds = pedidosPorFornecedor(c);
    const semEnvio = peds.filter(p => !p.f.pedidoEnviadoEm);
    if (semEnvio.length) add('aviso', `${nome}: ${semEnvio.length} pedido(s) de compra não enviado(s)`, semEnvio.map(p => `${p.f.nome} ${fmtMoeda(p.total)}`).join(' · '), 'cotacao', c.id, 'Enviar pedidos');
    const an = analisarMinimos(c, comp);
    const abaixo = an.lista.filter(x => x.abaixo && !x.ignorado);
    if (abaixo.length) add('aviso', `${nome}: ${abaixo.length} pedido(s) abaixo do mínimo`, abaixo.map(x => x.p.f.nome).join(', '), 'cotacao', c.id, 'Ver');
    const aguardando = [], divergencia = [];
    let cobrar = 0;
    for (const p of peds) {
      if (!p.f.pedidoEnviadoEm) continue;
      const lojasP = lojas().filter(lj => p.itens.some(x => x.qtds[lj.id] > 0));
      const sits = [situacaoRecebimento(c, p.f.fornecedorId, null), ...lojasP.map(lj => situacaoRecebimento(c, p.f.fornecedorId, lj.id))];
      const recebeu = sits.some(x => x.recs.length);
      if (!recebeu) aguardando.push(p.f.nome);
      if (sits.some(x => x.estado === 'divergencia')) divergencia.push(p.f.nome);
      cobrar += sits.reduce((t, x) => t + (x.cobrar || 0), 0);
    }
    if (divergencia.length) add('urgente', `${nome}: nota(s) com divergência${cobrar ? ` — cobrar ${fmtMoeda(cobrar)}` : ''}`, divergencia.join(', '), 'cotacao', c.id, 'Ver notas');
    if (aguardando.length) add('info', `${nome}: aguardando nota fiscal`, aguardando.join(', '), 'cotacao', c.id, 'Conferir NF-e');
  }
  const duvPend = gruposDuvidas(duvidasPendentes()).length;
  if (duvPend) add('aviso', `${duvPend} item(ns) em dúvida esperando a resposta da loja`, 'Copie o texto e mande no WhatsApp.', 'duvidas', null, 'Abrir Dúvidas');
  const ordem = { urgente: 0, aviso: 1, info: 2 };
  return lista.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
}

/** "Bom dia" + dia da semana e data (o Início abre com o dia de hoje). */
function saudacaoInicio() {
  const d = new Date();
  const h = d.getHours();
  const oi = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `${oi} · ${dia}`;
}

/** Nova cotação em montagem: o que já tem e o que falta (itens, marcas, fornecedores, prazo, papelzinhos). */
function cartaoRascunhoInicio() {
  const r = db.rascunho;
  if (!r || !r.itens?.length) return '';
  const prod = prodPorId();
  const itens = r.itens.filter(x => prod[x.produtoId]);
  const semMarca = itens.filter(x => !(x.marca || prod[x.produtoId].marca)).length;
  const nf = (r.fornecedorIds || []).length;
  const passo = (ok, txt, opcional) => `<li class="${ok ? 'ok' : opcional ? 'opcional' : 'falta'}">${ok ? '✓' : opcional ? '○' : '•'} ${txt}</li>`;
  return `<section class="card cartao-rascunho">
    <div class="row-between">
      <div><h3 style="margin:0">📝 Nova cotação em montagem</h3>
        <p class="small muted" style="margin:2px 0 0">${esc(r.titulo || 'sem título')}${r.prazoResposta ? ` · responder até ${fmtData(r.prazoResposta)}${r.prazoHora ? ' ' + esc(r.prazoHora) : ''}` : ''}</p></div>
      <a class="btn btn-primary" href="#" data-route="nova">Continuar →</a>
    </div>
    <ul class="passos-rascunho">
      ${passo(true, `<b>${itens.length}</b> ${itens.length === 1 ? 'item' : 'itens'}`)}
      ${passo(!semMarca, semMarca ? `<b>${semMarca}</b> sem marca pedida` : 'todas as marcas preenchidas')}
      ${passo(nf > 0, nf ? `<b>${nf}</b> fornecedor(es)` : 'nenhum fornecedor marcado')}
      ${passo(!!r.prazoResposta, r.prazoResposta ? 'prazo definido' : 'sem prazo')}
      ${passo(!!r.papelzinhos, r.papelzinhos ? `papelzinhos importados (${r.papelzinhos.adicionados})` : 'papelzinhos de São Sebastião (opcional)', true)}
    </ul>
  </section>`;
}

/** Últimas cotações (acesso rápido, mesmo quando não há nenhuma aberta). */
function ultimasCotacoesInicio() {
  const cs = [...db.cotacoes].filter(c => c.status !== 'cancelada')
    .sort((a, b) => (b.data + b.numero).localeCompare(a.data + a.numero)).slice(0, 5);
  if (!cs.length) return '';
  return `<section class="card">
    <div class="row-between"><h3 style="margin:0">Últimas cotações</h3><a href="#" class="small" data-route="cotacoes">ver todas →</a></div>
    <div class="ultimas-cot">${cs.map(c => {
      const peds = pedidosPorFornecedor(c);
      const total = peds.reduce((t, p) => t + p.total, 0);
      const comPed = new Set([...peds.map(p => p.fi), ...c.fornecedores.map((f, fi) => (f.concluidoEm ? fi : -1)).filter(fi => fi >= 0)]);
      const exp = [...comPed].filter(fi => c.fornecedores[fi].concluidoEm).length;
      return `<a href="#" class="ultima-cot" data-route="cotacao" data-id="${esc(c.id)}">
        <span class="uc-num">nº ${esc(c.numero)}</span>
        <span class="uc-tit">${esc(c.titulo || '—')}<br><span class="small muted">${fmtData(c.data)} · ${c.itens.length} itens · ${c.fornecedores.length} fornecedores</span></span>
        <span class="uc-info small">${total ? `<b>${fmtMoeda(total)}</b><br>` : ''}${comPed.size ? `${exp}/${comPed.size} pedidos` : ''}</span>
        ${statusBadge(c.status)}
      </a>`;
    }).join('')}</div>
  </section>`;
}

function renderInicio() {
  const pend = pendencias();
  const ativas = db.cotacoes.filter(c => !c.arquivada && c.status === 'aberta');
  const icone = { urgente: '🔴', aviso: '🟡', info: '🔵' };
  const cartaoRasc = cartaoRascunhoInicio();
  const pendLista = cartaoRasc ? pend.filter(p => p.rota !== 'nova') : pend; // a nova cotação já tem o cartão dela
  const nDuv = gruposDuvidas(duvidasPendentes()).length;
  return `
  <section class="card">
    <div class="row-between">
      <div><h2 style="margin:0">Início</h2><p class="small muted saudacao">${esc(saudacaoInicio())}</p></div>
      <div class="row">
        <a class="btn btn-primary" href="#" data-route="nova">+ Nova cotação</a>
        <label class="btn" style="margin:0" title="Conferir a nota fiscal (XML da NF-e) com o pedido">🧾 Conferir NF-e<input type="file" class="hidden" accept=".xml,text/xml,application/xml" multiple data-import-nfe-geral></label>
        ${ativas.length ? '<label class="btn" style="margin:0" title="Importar as planilhas que os fornecedores devolveram (o sistema acha a cotação e o fornecedor de cada uma)">📥 Importar respostas<input type="file" class="hidden" accept=".xlsx,.xls" multiple data-import-geral></label>' : ''}
      </div>
    </div>
    ${htmlContinuar()}
    <div class="stats stats-inicio">
      <a href="#" class="stat stat-link" data-route="produtos" title="Ver o cadastro de produtos"><span class="muted small">Itens no banco</span><b>${db.produtos.length.toLocaleString('pt-BR')}</b></a>
      <a href="#" class="stat stat-link" data-route="cotacoes" title="Ver as cotações"><span class="muted small">Cotações abertas</span><b>${ativas.length}</b></a>
      <a href="#" class="stat stat-link${nDuv ? ' stat-atencao' : ''}" data-route="duvidas" title="Ver a fila de dúvidas"><span class="muted small">Itens em dúvida</span><b>${nDuv}</b></a>
      <a href="#" class="stat stat-link${pendLista.some(p => p.nivel === 'urgente') ? ' stat-ruim' : ''}" data-act="irPendencias" title="Ver o que fazer agora"><span class="muted small">Pendências</span><b>${pendLista.length}</b></a>
    </div>
  </section>
  ${cartaoRasc}
  ${ativas.length ? `<section class="card">
    <h3>Andamento das cotações abertas</h3>
    <div class="cartoes-cot">${[...ativas].sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))).map(cartaoAndamento).join('')}</div>
  </section>` : ''}
  <section class="card" id="presencaInicioCard" ${presenca.outros.length ? '' : 'hidden'}>
    <h3>👥 Trabalhando agora</h3>
    <div id="presencaInicio">${htmlPresencaInicio()}</div>
  </section>
  ${!pendLista.length && cartaoRasc ? '' : `<section class="card" id="pendenciasInicio">
    <h3>O que fazer agora</h3>
    ${pendLista.length ? `<ul class="lista-pend">${pendLista.map(p => `<li class="pend-${p.nivel}">
      <span class="pend-icone">${icone[p.nivel]}</span>
      <div class="pend-texto"><b>${esc(p.texto)}</b>${p.detalhe ? `<br><span class="small muted">${esc(p.detalhe)}</span>` : ''}</div>
      <a class="btn sm" href="#" data-route="${p.rota}"${p.id ? ` data-id="${esc(p.id)}"` : ''}>${esc(p.botao)} →</a>
    </li>`).join('')}</ul>` : '<p class="tudo-em-dia">✓ Tudo em dia. 🎉</p>'}
  </section>`}
  ${ultimasCotacoesInicio()}`;
}

/* ---------------- Início: andamento, prazo, continuar e quem está trabalhando ---------------- */

const CHAVE_ULTIMO_LUGAR = 'cotacao.ultimoLugar';
function lerUltimoLugar() {
  try { return JSON.parse(localStorage.getItem(CHAVE_ULTIMO_LUGAR) || 'null'); } catch (e) { return null; }
}
/** Guarda onde a pessoa estava (cotação e fornecedor escolhido, ou a nova cotação), neste computador. */
function anotarUltimoLugar() {
  const { nome, id } = rota();
  let lugar = null;
  if (nome === 'cotacao') {
    const c = db.cotacoes.find(x => x.id === id);
    if (c) lugar = { rota: 'cotacao', id, filtro: filtroVencedor(c) || '' };
  } else if (nome === 'nova') lugar = { rota: 'nova' };
  if (!lugar) return;
  const ant = lerUltimoLugar();
  if (ant && ant.rota === lugar.rota && ant.id === lugar.id && ant.filtro === lugar.filtro && Date.now() - ant.quando < 60000) return;
  try { localStorage.setItem(CHAVE_ULTIMO_LUGAR, JSON.stringify({ ...lugar, quando: Date.now() })); } catch (e) { /* sem acesso */ }
}

const haQuanto = t => {
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} dia(s)`;
};

function htmlContinuar() {
  const u = lerUltimoLugar();
  if (!u) return '';
  let texto = '';
  if (u.rota === 'cotacao') {
    const c = db.cotacoes.find(x => x.id === u.id);
    if (!c || c.status !== 'aberta') return '';
    const forn = u.filtro && u.filtro !== '__sem' ? c.fornecedores.find(f => f.fornecedorId === u.filtro)?.nome : u.filtro === '__sem' ? 'sem preço' : '';
    texto = `Cotação nº ${esc(c.numero)}${c.titulo ? ` · ${esc(c.titulo)}` : ''}${forn ? ` · <b>${esc(forn)}</b>` : ''}`;
  } else if (u.rota === 'nova') {
    const n = rascunho().itens.length;
    if (!n) return '';
    texto = `Nova cotação em montagem · ${n} item(ns)`;
  } else return '';
  return `<button type="button" class="continuar" data-act="continuarDeOndeParei">
    <span class="continuar-icone">▶</span>
    <span><span class="small muted">Continuar de onde parei (${esc(haQuanto(u.quando))})</span><br>${texto}</span>
  </button>`;
}

/** Tempo até o prazo de resposta: "faltam 2 h 10 min" / "venceu há 1 dia". */
function textoAtePrazo(c) {
  const lim = limitePrazo(c);
  if (!lim) return null;
  const ms = lim - Date.now();
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60000);
  const txt = min < 60 ? `${min} min` : min < 1440 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${Math.round(min / 1440)} dia(s)`;
  return { vencido: ms < 0, perto: ms >= 0 && ms < 3 * 3600000, texto: ms < 0 ? `venceu há ${txt}` : `faltam ${txt}` };
}

function barraAndamento(rotulo, feito, total, detalhe, parte, cotId) {
  const pct = total ? Math.round((feito / total) * 100) : 0;
  return `<button type="button" class="andamento${total && feito >= total ? ' completo' : ''}" data-act="irCotParte" data-id="${esc(cotId)}" data-parte="${parte}" title="Abrir: ${esc(rotulo)}">
    <span class="andamento-topo"><span>${rotulo}</span><b>${feito}/${total}</b></span>
    <span class="andamento-barra"><span style="width:${pct}%"></span></span>
    ${detalhe ? `<span class="andamento-det">${detalhe}</span>` : ''}
  </button>`;
}

function cartaoAndamento(c) {
  const nf = c.fornecedores.length;
  const pend = c.fornecedores.filter(f => !respondeu(f));
  const resp = nf - pend.length;
  const comp = comparar(c);
  const LJ = lojas();
  const comPreco = comp.linhas.filter(l => l.vencedor >= 0);
  const comQtd = comPreco.filter(l => LJ.some(lj => c.qtds?.[l.i]?.[lj.id] != null)).length;
  const peds = resp ? pedidosPorFornecedor(c) : [];
  const exportados = peds.filter(p => p.f.concluidoEm).length;
  const prazo = textoAtePrazo(c);
  const nomes = l => l.slice(0, 3).map(f => esc(f.nome)).join(', ') + (l.length > 3 ? ` e mais ${l.length - 3}` : '');
  const quem = pessoasNaCot(c.id);
  return `<article class="cartao-cot">
    <div class="cartao-cot-topo">
      <a href="#" data-route="cotacao" data-id="${esc(c.id)}"><b>Cotação nº ${esc(c.numero)}</b></a>
      <span class="small muted">${esc(c.titulo || '')}${c.titulo ? ' · ' : ''}${fmtData(c.data)} · ${c.itens.length} itens</span>
      ${quem.length ? `<span class="presenca-lista">${htmlPresencaLista(c.id)}</span>` : ''}
    </div>
    ${prazo ? `<div class="cartao-prazo${prazo.vencido ? ' vencido' : prazo.perto ? ' perto' : ''}">
      ⏰ Responder até ${esc(textoDataPrazo(c))} · <b>${esc(prazo.texto)}</b>
      ${pend.length && (prazo.vencido || prazo.perto) ? `<button type="button" class="sm" data-act="cobrarCot" data-id="${esc(c.id)}">📣 Cobrar quem falta (${pend.length})</button>` : ''}
    </div>` : ''}
    <div class="andamentos">
      ${pend.length ? (() => {
        // quem confirmou que recebeu a cotação (quem já respondeu, recebeu)
        const conf = c.fornecedores.filter(f => f.confirmadoEm || respondeu(f));
        const naoConf = c.fornecedores.filter(f => !f.confirmadoEm && !respondeu(f));
        const det = `${conf.length ? `✓ ${conf.map(f => esc(f.nome)).join(', ')}` : 'ninguém confirmou ainda'}${naoConf.length && conf.length ? ` · falta: ${nomes(naoConf)}` : ''}`;
        return barraAndamento('Confirmaram o recebimento', conf.length, nf, det, 'fornecedores', c.id);
      })() : ''}
      ${barraAndamento('Respostas', resp, nf, pend.length ? `falta: ${nomes(pend)}` : '✓ todos responderam', 'fornecedores', c.id)}
      ${resp ? barraAndamento('Quantidades', comQtd, comPreco.length, comQtd < comPreco.length ? `${comPreco.length - comQtd} item(ns) sem quantidade` : '✓ todos com quantidade', 'comparativo', c.id) : ''}
      ${peds.length ? barraAndamento('Pedidos exportados', exportados, peds.length, exportados < peds.length ? `falta: ${nomes(peds.filter(p => !p.f.concluidoEm).map(p => p.f))}` : '✓ todos exportados', 'pedidos', c.id) : ''}
    </div>
  </article>`;
}

const NOMES_TELA = { inicio: 'Início', nova: 'Nova cotação', cotacoes: 'Cotações', produtos: 'Produtos', fornecedores: 'Fornecedores', duvidas: 'Dúvidas', relatorios: 'Relatórios', config: 'Configurações' };
function htmlPresencaInicio() {
  if (!presenca.outros.length) return '';
  return `<ul class="trabalhando">${presenca.outros.map(x => {
    const c = x.cotId ? db.cotacoes.find(y => y.id === x.cotId) : null;
    const onde = c ? `<a href="#" data-route="cotacao" data-id="${esc(c.id)}">cotação nº ${esc(c.numero)}</a>${x.forn ? ` · ${esc(x.forn)}` : ''}${x.janela ? ' · janela flutuante' : ''}` : esc(NOMES_TELA[x.tela] || x.tela || '');
    return `<li><span class="presenca-ponto"></span><b>${esc(nomePessoa(x))}</b> <span class="muted">·</span> ${onde}</li>`;
  }).join('')}</ul>`;
}

/* ---------------- dúvidas (texto para o WhatsApp, padrão do DISPPAR) ---------------- */

function empresasDuvida() {
  return [...lojas().map(siglaLoja), 'N/A'];
}

/** Dúvidas que ainda pedem resposta: as de cotações finalizadas (ou canceladas) não contam mais. */
function duvidasPendentes() {
  const status = new Map(db.cotacoes.map(c => [c.id, c.status]));
  return db.duvidas.filter(d => !d.origem?.cotId || !status.has(d.origem.cotId) || status.get(d.origem.cotId) === 'aberta');
}
/** Dúvidas mostradas na tela de Dúvidas (as das cotações finalizadas só com "mostrar"). */
const duvidasDaTela = () => (ui.verDuvFinal ? db.duvidas : duvidasPendentes());

/** Dúvidas iguais (mesmo código, valor, marca, observação e origem) viram uma linha só, com a quantidade de cada loja. */
const chaveDuvida = x => [String(x.codigo || '').toUpperCase().trim(), Number(x.valor) || 0, String(x.marca || '').toUpperCase().trim(),
  String(x.obs || '').toUpperCase().trim(), x.origem?.cotId || '', x.origem?.fornecedor || ''].join('|');
function gruposDuvidas(lista = duvidasDaTela()) {
  const ordem = empresasDuvida();
  const pos = e => (ordem.indexOf(e) < 0 ? ordem.length : ordem.indexOf(e));
  const m = new Map();
  for (const x of lista) {
    const k = chaveDuvida(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return [...m.values()].map(g => g.sort((a, b) => pos(a.empresa) - pos(b.empresa)));
}
/** Quantidade por loja do grupo: [{ empresa, qtd }] (a mesma loja repetida é somada). */
function qtdsGrupoDuvida(g) {
  const m = new Map();
  for (const x of g) m.set(x.empresa || 'N/A', (m.get(x.empresa || 'N/A') || 0) + (Number(x.qtd) || 1));
  return [...m].map(([empresa, qtd]) => ({ empresa, qtd }));
}
const pedeDuvida = g => qtdsGrupoDuvida(g).map(x => `${x.qtd}${x.empresa !== 'N/A' ? ' ' + String(x.empresa).toUpperCase() : ''}`).join(' E ');

/** Fornecedor da dúvida (as digitadas à mão não têm). */
const SEM_FORN_DUV = 'Digitadas à mão';
const fornDuvida = x => x.origem?.fornecedor || SEM_FORN_DUV;

/** Dúvidas do fornecedor escolhido no filtro da fila (sem filtro: todas). */
function duvidasFiltradas() {
  const base = duvidasDaTela();
  return ui.duvForn ? base.filter(x => fornDuvida(x) === ui.duvForn) : base;
}

/** Um item no formato do DISPPAR: "- *CÓDIGO. OBS*" / "R$ 10,00 - MARCA" / "*PEDE 2 DPR E 5 DSS ?*". */
function textoItemDuvida(g) {
  if (!Array.isArray(g)) g = [g];
  const x = g[0];
  const cod = String(x.codigo || '').toUpperCase().trim() || '-';
  const obs = String(x.obs || '').toUpperCase().trim();
  const marca = String(x.marca || '').toUpperCase().trim() || '-';
  return [
    `- *${obs ? `${cod}. ${obs}` : cod}*`,
    `${fmtMoeda(Number(x.valor) || 0)} - ${marca}`,
    `*PEDE ${pedeDuvida(g)} ?*`,
  ].join('\n');
}

/** Com um fornecedor escolhido no filtro, o topo do texto vira "*FORNECEDOR - DÚVIDA*". */
const cabDuvidasForn = () => (ui.duvForn && ui.duvForn !== SEM_FORN_DUV ? `*${ui.duvForn.toUpperCase()} - DÚVIDA*` : null);

function textoDuvidas() {
  const cab = cabDuvidasForn() || (db.config.duvidasCabecalho ?? DEFAULT_DB.config.duvidasCabecalho).trim();
  return [cab, ...gruposDuvidas(duvidasFiltradas()).map(textoItemDuvida)].filter(Boolean).join('\n\n');
}

/**
 * Janela do ❓: para qual loja perguntar (pode marcar as duas), a quantidade de cada uma e a observação.
 * Devolve { lojas: [{ sigla, qtd }], obs } ou null se cancelar.
 */
function dialogoDuvida({ titulo, detalhe, opcoes, obs = '', doc = document }) {
  return new Promise(resolve => {
    const fundo = doc.createElement('div');
    fundo.className = 'dlg-fundo';
    fundo.innerHTML = `<div class="dlg dlg-duvida" role="dialog" aria-modal="true" aria-label="Pôr em Dúvidas">
      <h3 style="margin:0 0 4px">❓ Pôr em Dúvidas</h3>
      <p style="margin:0"><b>${esc(titulo)}</b></p>
      <p class="small muted" style="margin:2px 0 12px">${esc(detalhe)}</p>
      <p class="small" style="margin:0 0 6px">Perguntar para qual loja? Pode marcar as duas.</p>
      ${opcoes.map((o, k) => `<div class="duv-loja">
        <label class="duv-marcar"><input type="checkbox" data-duv-loja="${k}" ${o.marcada ? 'checked' : ''}> <b>${esc(o.sigla)}</b> <span class="muted">${esc(o.nome)}</span></label>
        <label class="duv-qtd">Qtd <input data-duv-qtd="${k}" inputmode="numeric" value="${esc(o.qtd)}" aria-label="Quantidade ${esc(o.sigla)}"></label>
      </div>`).join('')}
      <label style="margin-top:10px">Observação<input id="duvObs" value="${esc(obs)}" placeholder="Ex.: MARCA DIFERENTE, SÓ TEM ESSA" autocomplete="off"></label>
      <p class="small erro-duv" id="duvErro" hidden>Marque pelo menos uma loja com quantidade.</p>
      <div class="actions"><button type="button" data-r="0">Cancelar</button><button type="button" class="primary" data-r="1">Pôr em Dúvidas</button></div>
    </div>`;
    const q = s => fundo.querySelector(s);
    const fechar = v => { fundo.remove(); doc.removeEventListener('keydown', tecla, true); resolve(v); };
    const confirmar = () => {
      const lojasEscolhidas = opcoes.map((o, k) => ({ sigla: o.sigla, qtd: Math.max(0, parseNum(q(`[data-duv-qtd="${k}"]`).value) || 0), ok: q(`[data-duv-loja="${k}"]`).checked }))
        .filter(x => x.ok && x.qtd > 0).map(({ sigla, qtd }) => ({ sigla, qtd }));
      if (!lojasEscolhidas.length) { q('#duvErro').hidden = false; return; }
      fechar({ lojas: lojasEscolhidas, obs: q('#duvObs').value.trim() });
    };
    const tecla = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fechar(null); }
      else if (e.key === 'Enter' && !e.target.matches('button')) { e.preventDefault(); e.stopImmediatePropagation(); confirmar(); }
      else e.stopImmediatePropagation();
    };
    // digitar a quantidade marca a loja
    fundo.addEventListener('input', e => {
      const k = e.target.dataset.duvQtd;
      if (k != null) q(`[data-duv-loja="${k}"]`).checked = (parseNum(e.target.value) || 0) > 0;
      q('#duvErro').hidden = true;
    });
    fundo.addEventListener('click', e => {
      e.stopPropagation();
      const b = e.target.closest('button[data-r]');
      if (b) { if (b.dataset.r === '1') confirmar(); else fechar(null); }
    });
    doc.addEventListener('keydown', tecla, true);
    doc.body.appendChild(fundo);
    const primeira = opcoes.findIndex(o => o.marcada);
    const campo = q(`[data-duv-qtd="${Math.max(0, primeira)}"]`);
    campo.focus();
    campo.select();
  });
}

/**
 * Leva um item do comparativo para as dúvidas: preço e marca do fornecedor `fi` (ou do vencedor).
 * Pergunta a loja (uma ou as duas), a quantidade e a observação. Devolve quantas dúvidas entraram.
 */
async function duvidasDoItem(c, i, fi, obsSugerida = '', doc = document) {
  const comp = comparar(c);
  const l = comp.linhas[i];
  const j = fi ?? l?.vencedor;
  const f = l && c.fornecedores[j];
  if (!l || !f || l.precos[j] == null) return 0;
  const o = f.respostas?.[i] || {};
  const lj = lojas();
  const opcoes = lj.length
    ? lj.map(x => ({ sigla: siglaLoja(x), nome: x.nome, qtd: qtdLoja(c, i, x.id) || 1, marcada: qtdLoja(c, i, x.id) > 0 }))
    : [{ sigla: 'N/A', nome: 'sem loja', qtd: l.q || 1, marcada: true }];
  if (!opcoes.some(x => x.marcada)) opcoes[0].marcada = true;
  const escolha = await dialogoDuvida({
    titulo: `${l.it.codigo || '—'} · ${l.it.descricao || ''}`,
    detalhe: `${f.nome} · ${fmtMoeda(l.precos[j])} · marca ${o.marca || '—'}${l.it.marca ? ` (exigida ${l.it.marca})` : ''}`,
    opcoes,
    obs: obsSugerida,
    doc,
  });
  if (!escolha) return -1;
  const base = { codigo: l.it.codigo || '', valor: l.precos[j], marca: o.marca || '', obs: escolha.obs, origem: { cotId: c.id, numero: c.numero, i, fornecedor: f.nome, marcaExigida: l.it.marca || '' } };
  const novas = escolha.lojas.map(x => ({ ...base, id: uid(), empresa: x.sigla, qtd: x.qtd }));
  db.duvidas = [...db.duvidas, ...novas];
  salvar();
  return novas.length;
}

function renderDuvidas() {
  const grupoEd = ui.editDuvida ? gruposDuvidas().find(g => g.some(x => x.id === ui.editDuvida)) : null;
  const ed = grupoEd ? grupoEd[0] : null;
  const v = ed || { empresa: ui.ultimaEmpresa || empresasDuvida()[0], qtd: 1 };
  const qtdEd = e => (grupoEd ? qtdsGrupoDuvida(grupoEd).find(x => x.empresa === e)?.qtd ?? '' : '');
  const emps = empresasDuvida();
  if (ui.duvForn && !duvidasDaTela().some(x => fornDuvida(x) === ui.duvForn)) ui.duvForn = null; // o fornecedor filtrado não tem mais dúvidas
  const lista = duvidasFiltradas();
  const grupos = gruposDuvidas(lista);
  // fornecedores com dúvidas, em ordem alfabética (as digitadas à mão no fim); conta os itens (linhas da fila)
  const todosGrupos = gruposDuvidas();
  const fornsNaFila = [...new Set(duvidasDaTela().map(fornDuvida))]
    .sort((a, b) => (a === SEM_FORN_DUV) - (b === SEM_FORN_DUV) || COLLATOR.compare(a, b));
  const contaForn = fo => todosGrupos.filter(g => fornDuvida(g[0]) === fo).length;
  return `
  <section class="card cab-cadastro">
    <div class="row-between"><h2 style="margin:0">Dúvidas <span class="badge">${duvidasDaTela().length}</span></h2></div>
    <p class="muted small" style="margin-top:0">Itens que dependem da confirmação da loja (marca diferente, preço estranho…). No comparativo, o botão ❓ manda o item para cá; depois é só copiar o texto para o WhatsApp.</p>
    <details class="form-novo"${ed ? ' open' : ''}>
    <summary class="btn${ed ? '' : ' btn-primary'}">${ed ? '✎ Editando a dúvida' : '+ Inserir item à mão'}</summary>
    <form data-form="duvida" class="grid form-duvida">
      ${ed ? '' : `<label>Empresa<select name="empresa">${emps.map(e => `<option ${v.empresa === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></label>`}
      <label>Código do produto<input name="codigo" required value="${esc(v.codigo)}" autocomplete="off"></label>
      ${ed ? emps.map(e => `<label>Qtd ${esc(e)}<input name="qtd_${esc(e)}" inputmode="numeric" value="${esc(qtdEd(e))}" placeholder="—" title="Vazio ou 0: tira ${esc(e)} desta dúvida"></label>`).join('') : `<label>Quantidade<input name="qtd" inputmode="numeric" value="${esc(v.qtd)}"></label>`}
      <label>Valor (R$)<input name="valor" inputmode="decimal" value="${v.valor ? esc(fmtNum(v.valor, 2)) : ''}"></label>
      <label>Marca<input name="marca" value="${esc(v.marca)}"></label>
      <label style="grid-column:span 2">Observação<input name="obs" value="${esc(v.obs)}" placeholder="Ex.: MARCA DIFERENTE, SÓ TEM ESSA"></label>
      <div class="actions" style="grid-column:1/-1">
        ${ed ? '<button type="button" data-act="cancelarDuvida">Cancelar edição</button>' : ''}
        <button class="primary">${ed ? 'Salvar alteração' : '+ Inserir item'}</button>
      </div>
    </form>
    </details>
  </section>
  <div class="duvidas-grid">
    <section class="card">
      <div class="row-between"><h3>Fila de dúvidas</h3>${duvidasFiltradas().length ? `<button class="sm danger" data-act="limparDuvidas">${ui.duvForn ? `Limpar as de ${esc(ui.duvForn)}` : 'Limpar tudo'}</button>` : ''}</div>
      ${db.duvidas.length > duvidasPendentes().length ? `<p class="small muted" style="margin:0 0 8px">${ui.verDuvFinal ? 'Mostrando também' : 'Ocultas:'} ${db.duvidas.length - duvidasPendentes().length} dúvida(s) de cotações finalizadas. <button type="button" class="link" data-act="alternarDuvFinal">${ui.verDuvFinal ? 'Ocultar' : 'Mostrar'}</button></p>` : ''}
      ${fornsNaFila.length ? `<div class="filtro-duv" role="group" aria-label="Fornecedor">
        <button type="button" data-act="filtroDuvForn" data-forn="" class="${ui.duvForn ? '' : 'ativo'}">Todos <span class="badge">${todosGrupos.length}</span></button>
        ${fornsNaFila.map(fo => `<button type="button" data-act="filtroDuvForn" data-forn="${esc(fo)}" class="${ui.duvForn === fo ? 'ativo' : ''}">${esc(fo)} <span class="badge">${contaForn(fo)}</span></button>`).join('')}
      </div>` : ''}
      ${grupos.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Pede</th><th>Código</th><th class="r">Valor</th><th>Marca</th><th>Observação</th><th></th></tr></thead>
        <tbody>${grupos.map(g => { const x = g[0]; return `<tr class="${g.some(y => y.id === ui.editDuvida) ? 'hist-aberto' : ''}">
          <td class="pede-duv">${qtdsGrupoDuvida(g).map(q => `<span class="nowrap"><b>${esc(q.qtd)}</b> ${esc(q.empresa)}</span>`).join(' <span class="muted">e</span> ')}</td>
          <td>${esc(x.codigo)}${x.origem ? `<br><span class="small muted">nº ${esc(x.origem.numero)} · ${esc(x.origem.fornecedor)}${x.origem.marcaExigida ? ' · exigida ' + esc(x.origem.marcaExigida) : ''}</span>` : ''}</td>
          <td class="r">${fmtMoeda(Number(x.valor) || 0)}</td>
          <td>${esc(x.marca || '—')}</td>
          <td class="small">${esc(x.obs || '')}</td>
          <td class="actions-cell"><button class="sm" data-act="editarDuvida" data-id="${x.id}">Editar</button> <button class="sm danger" data-act="removerDuvida" data-id="${g.map(y => y.id).join(',')}" title="Resolvido${g.length > 1 ? ` (${esc(g.map(y => y.empresa).join(' e '))})` : ''}">✕</button></td>
        </tr>`; }).join('')}</tbody>
      </table></div>` : '<p class="empty">Nenhum item em dúvida.</p>'}
    </section>
    <section class="card">
      <div class="row-between"><h3>Texto para WhatsApp</h3><button class="sm primary" data-act="copiarDuvidas" ${lista.length ? '' : 'disabled'}>⧉ Copiar para o WhatsApp${ui.duvForn ? ' (' + esc(ui.duvForn) + ')' : ''}</button></div>
      <label>Texto fixo no topo<input id="duvidasCabecalho" value="${esc(db.config.duvidasCabecalho ?? DEFAULT_DB.config.duvidasCabecalho)}"></label>
      ${cabDuvidasForn() ? `<p class="small muted" style="margin:4px 0 0">Com <b>${esc(ui.duvForn)}</b> escolhido, o texto começa com <b>${esc(cabDuvidasForn())}</b>. Clique em <b>Todos</b> para voltar ao texto fixo.</p>` : ''}
      <pre class="texto-whats" id="textoDuvidas">${esc(textoDuvidas())}</pre>
    </section>
  </div>`;
}

function renderFornecedores() {
  const f = ui.editForn ? db.fornecedores.find(x => x.id === ui.editForn) : null;
  const v = f || {};
  return `
  <section class="card cab-cadastro">
    <div class="row-between"><h2 style="margin:0">${f ? 'Editar fornecedor' : 'Fornecedores'} <span class="badge">${db.fornecedores.length}</span></h2></div>
    <details class="form-novo"${f ? ' open' : ''}>
    <summary class="btn${f ? '' : ' btn-primary'}">${f ? '✎ Editando: ' + esc(f.nome) : '+ Adicionar fornecedor'}</summary>
    <form data-form="fornecedor" class="grid">
      <label>Nome / empresa *<input name="nome" required value="${esc(v.nome)}"></label>
      <label>Atendente (pessoa)<input name="contato" value="${esc(v.contato)}"></label>
      <label>Substituto <span class="muted small">(quando o atendente falta)</span><input name="substituto" value="${esc(v.substituto)}"></label>
      <label>E-mail<input name="email" type="email" value="${esc(v.email)}"></label>
      <label>Telefone / WhatsApp<input name="telefone" value="${esc(v.telefone)}"></label>
      <label>CNPJ <span class="muted small">(para reconhecer a NF-e)</span><input name="cnpj" value="${esc(v.cnpj)}"></label>
      <label>Pedido mínimo (R$)<input name="pedidoMinimo" inputmode="decimal" value="${v.pedidoMinimo ? esc(fmtNum(v.pedidoMinimo, 2)) : ''}" placeholder="sem mínimo"></label>
      <label>Frete (R$)<input name="frete" inputmode="decimal" value="${v.frete ? esc(fmtNum(v.frete, 2)) : ''}" placeholder="sem frete"></label>
      <label>Frete grátis acima de (R$)<input name="freteGratisAcima" inputmode="decimal" value="${v.freteGratisAcima ? esc(fmtNum(v.freteGratisAcima, 2)) : ''}" placeholder="—"></label>
      <label style="grid-column:1/-1">Observação (o que fornece, condições…)<input name="obs" value="${esc(v.obs)}"></label>
      <div class="actions" style="grid-column:1/-1">
        ${f ? '<button type="button" data-act="cancelarForn">Cancelar</button>' : ''}
        <button class="primary">${f ? 'Salvar alterações' : '+ Adicionar fornecedor'}</button>
      </div>
    </form>
    </details>
  </section>
  <section class="card">
    <input id="filtroForn" placeholder="Buscar fornecedor…" value="${esc(ui.filtroForn)}" style="margin-bottom:10px">
    <div class="table-wrap"><table>
      <thead><tr><th>Fornecedor</th><th>Contato</th><th>E-mail</th><th>Telefone</th><th class="c">Cotações</th><th class="c" title="Nota de 0 a 10 (detalhes em Relatórios)">Nota</th><th></th></tr></thead>
      <tbody id="tbForn">${linhasFornecedores()}</tbody>
    </table></div>
  </section>`;
}

function linhaLojaCfg(l) {
  return `<tr class="loja-cfg" data-id="${esc(l.id)}">
    <td><input name="lj_nome" data-c="nome" value="${esc(l.nome)}" placeholder="Nome da loja"></td>
    <td><input name="lj_sigla" data-c="sigla" value="${esc(siglaLoja(l))}" placeholder="DSS" style="width:80px;min-width:0"></td>
    <td><input name="lj_cnpj" data-c="cnpj" value="${esc(l.cnpj)}"></td>
    <td><input name="lj_end" data-c="endereco" value="${esc(l.endereco)}"></td>
    <td><button type="button" class="sm danger" data-act="removerLojaCfg" title="Remover loja">✕</button></td>
  </tr>`;
}

function renderMarcasCfg() {
  const eq = db.config.marcasEquivalentes || {};
  const dif = db.config.marcasDiferentes || {};
  const chaves = [...new Set([...Object.keys(eq), ...Object.keys(dif)])].sort(COLLATOR.compare);
  return `<section class="card">
    <h2>Abreviações de marcas</h2>
    <p class="muted small">Os fornecedores costumam escrever a marca abreviada. O sistema já reconhece abreviações comuns (COF = COFAP, MM = MAGNETI MARELLI, NKT = NAKATA) e aprende as que você confirmar no comparativo. Aqui você vê e corrige o que foi aprendido.</p>
    <form data-form="equivMarca" class="row" style="align-items:flex-end">
      <label style="margin:0">Marca<input name="marca" placeholder="Ex.: MAGNETI MARELLI" required></label>
      <label class="grow" style="margin:0">Abreviações aceitas (separe por vírgula)<input name="abrevs" placeholder="Ex.: MM, MAG, M.MARELLI" required></label>
      <button class="sm primary">+ Adicionar</button>
    </form>
    ${chaves.length ? `<div class="table-wrap" style="margin-top:10px"><table>
      <thead><tr><th>Marca</th><th>Aceitas como a mesma marca</th><th>Marcadas como outra marca</th></tr></thead>
      <tbody>${chaves.map(k => `<tr>
        <td><b>${esc(k)}</b></td>
        <td>${(eq[k] || []).map(r => `<span class="chip-marca ok">${esc(r)} <button class="link" data-act="esquecerMarca" data-op="${esc(k)}" data-r="${esc(r)}" data-tipo="eq" title="Esquecer">✕</button></span>`).join(' ') || '<span class="muted">—</span>'}</td>
        <td>${(dif[k] || []).map(r => `<span class="chip-marca errada">${esc(r)} <button class="link" data-act="esquecerMarca" data-op="${esc(k)}" data-r="${esc(r)}" data-tipo="dif" title="Esquecer">✕</button></span>`).join(' ') || '<span class="muted">—</span>'}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<p class="muted small" style="margin-top:10px">Nenhuma abreviação aprendida ainda.</p>'}
  </section>`;
}

/** Abas das Configurações (uma de cada vez, em vez de uma página enorme). */
const ABAS_CONFIG = [
  ['aparencia', '🎨 Aparência'], ['loja', '🏪 Loja e planilha'], ['emails', '✉️ E-mails'], ['marcas', '🏷️ Marcas'], ['conta', '👥 Conta e usuários'], ['backup', '💾 Backup'],
];
function abaConfig() {
  if (ui.abaConfig == null) { try { ui.abaConfig = localStorage.getItem('cotacao.abaConfig') || ''; } catch (e) { ui.abaConfig = ''; } }
  const a = ui.abaConfig;
  return ABAS_CONFIG.some(([k]) => k === a) ? a : 'aparencia';
}

function renderConfig() {
  const c = db.config;
  const aba = abaConfig();
  const ver = k => (aba === k ? '' : ' hidden');
  return `
  <nav class="abas-cfg" role="tablist" aria-label="Configurações">${ABAS_CONFIG.map(([k, rot]) => `<button type="button" role="tab" class="aba-cfg${aba === k ? ' ativa' : ''}" data-act="abaConfig" data-aba="${k}" aria-selected="${aba === k}">${rot}</button>`).join('')}</nav>
  <section class="card" data-aba-cfg="aparencia"${ver('aparencia')}>
    <h2>Aparência</h2>
    <p class="muted small" style="margin-top:0">Escolha o tema deste computador (cada pessoa escolhe o seu). Também dá para trocar pelo botão 🎨 no topo.</p>
    ${htmlTemas()}
  </section>
  <form data-form="config" class="form-cfg">
  <section class="card" data-aba-cfg="loja"${ver('loja')}>
    <h2>Dados da loja</h2>
    <p class="muted small">Esses dados aparecem no cabeçalho da planilha enviada aos fornecedores e no e-mail.</p>
      <div class="grid">
        <label>Nome da loja<input name="loja" value="${esc(c.loja)}"></label>
        <label>CNPJ<input name="cnpj" value="${esc(c.cnpj)}"></label>
        <label>Seu nome (comprador)<input name="comprador" value="${esc(c.comprador)}"></label>
        <label>Telefone / WhatsApp<input name="telefone" value="${esc(c.telefone)}"></label>
        <label>E-mail<input name="email" type="email" value="${esc(c.email)}"></label>
        <label>Próximo nº de cotação<input name="proxNumero" type="number" min="1" value="${esc(c.proxNumero)}"></label>
      </div>
      <label>Endereço<input name="endereco" value="${esc(c.endereco)}"></label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" name="protegerPlanilha" ${c.protegerPlanilha ? 'checked' : ''}>
        Proteger a planilha (o fornecedor só consegue editar as colunas VALOR e MARCA)</label>
      <label>Título da planilha enviada aos fornecedores<input name="tituloPlanilha" value="${esc(c.tituloPlanilha ?? DEFAULT_DB.config.tituloPlanilha)}"></label>
      <h3 style="margin-top:16px">Lojas</h3>
      <p class="muted small">A compra é dividida entre estas lojas: no comparativo aparece uma coluna de quantidade para cada uma, e os pedidos saem separados. O endereço vai no pedido como local de entrega.</p>
      <div class="table-wrap"><table class="tab-lojas">
        <thead><tr><th>Loja</th><th>Sigla</th><th>CNPJ</th><th>Endereço de entrega</th><th></th></tr></thead>
        <tbody id="lojasCfg">${lojas().map(linhaLojaCfg).join('')}</tbody>
      </table></div>
      <button type="button" class="sm" data-act="addLojaCfg" style="margin-top:6px">+ Adicionar loja</button>
  </section>
  <section class="card" data-aba-cfg="marcas"${ver('marcas')}>
      <h2>Marcas</h2>
      <label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" name="marcaErradaNaoGanha" ${c.marcaErradaNaoGanha !== false ? 'checked' : ''}>
        Preço com marca diferente da pedida não ganha automaticamente (você ainda pode escolher clicando no preço)</label>
  </section>
  <section class="card" data-aba-cfg="emails"${ver('emails')}>
      <h2>Modelo do e-mail</h2>
      <p class="muted small">Você pode usar: {fornecedor} {numero} {loja} {comprador} {telefone} {email} {prazo} {titulo}</p>
      <label>Assunto<input name="assuntoEmail" value="${esc(c.assuntoEmail)}"></label>
      <label>Texto<textarea name="corpoEmail" rows="9">${esc(c.corpoEmail)}</textarea></label>
      <h3 style="margin-top:18px">E-mail do pedido de compra</h3>
      <p class="muted small">Além dos campos acima: {totalPedido} {itensPedido} {entrega} (lojas e endereços de entrega) {pagamento}</p>
      <label>Assunto do pedido<input name="assuntoPedido" value="${esc(c.assuntoPedido)}"></label>
      <label>Texto do pedido<textarea name="corpoPedido" rows="9">${esc(c.corpoPedido)}</textarea></label>
      <h3 style="margin-top:16px">Cobrança de resposta</h3>
      <label style="max-width:360px">Avisar quantos dias antes do prazo<input name="diasAviso" type="number" min="0" max="30" value="${esc(c.diasAviso ?? 1)}"></label>
      <p class="muted small">Com 0, o aviso aparece só no dia do prazo e depois dele. O modelo do lembrete usa os mesmos campos acima.</p>
      <label>Assunto do lembrete<input name="assuntoCobranca" value="${esc(c.assuntoCobranca)}"></label>
      <label>Texto do lembrete<textarea name="corpoCobranca" rows="7">${esc(c.corpoCobranca)}</textarea></label>
  </section>
    <div class="barra-salvar-cfg"${['loja', 'emails', 'marcas'].includes(aba) ? '' : ' hidden'}><span class="small muted">As mudanças das abas Loja, E-mails e Marcas são salvas juntas.</span><button class="primary">Salvar configurações</button></div>
  </form>
  <div data-aba-cfg="conta"${ver('conta')}>${renderConta()}</div>
  <div data-aba-cfg="marcas"${ver('marcas')}>${renderMarcasCfg()}</div>
  <section class="card" data-aba-cfg="backup"${ver('backup')}>
    <h2>Backup dos dados</h2>
    <p class="muted small">${nuvem.db
      ? `Os dados ficam salvos <b>na nuvem${nuvem.supabase ? ' (Supabase)' : ', junto com esta página'}</b>, e aparecem em qualquer computador em que você ${nuvem.supabase ? 'entrar' : 'abrir o link'}. Mesmo assim, baixe um backup de vez em quando.`
      : 'Os dados ficam salvos <b>somente neste navegador</b>. Faça backup com frequência e guarde o arquivo (Google Drive, pendrive…). Com o backup você também passa os dados para outro computador.'}</p>
    <div class="row">
      <button data-act="backup">⬇ Baixar backup</button>
      <label class="check-inline">Lembrar a cada
        <select id="backupDias" style="width:auto">${[[3, '3 dias'], [7, '7 dias'], [15, '15 dias'], [30, '30 dias'], [0, 'nunca']].map(([v, t]) => `<option value="${v}" ${Number(db.config.backupDias ?? 7) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="btn" style="margin:0">📥 Restaurar backup<input type="file" class="hidden" accept=".json" data-restaurar></label>
      <button class="danger" data-act="apagarTudo">Apagar todos os dados</button>
    </div>
    <p class="small muted" style="margin-top:10px">${db.produtos.length} produtos · ${db.fornecedores.length} fornecedores · ${db.cotacoes.length} cotações${db.ultimoBackup ? ` · último backup em ${fmtData(db.ultimoBackup)}` : ''}</p>
    ${renderBackupsNuvem()}
  </section>`;
}

/** Cópias automáticas no Supabase (backup.sql): lista, fazer agora, baixar e restaurar (administradores). */
function renderBackupsNuvem() {
  if (!nuvem.supabase) return '';
  const intro = `<h3 style="margin:18px 0 4px">☁️ Cópias automáticas</h3>
    <p class="muted small" style="margin-top:0">O Supabase guarda sozinho uma cópia de todos os dados <b>duas vezes por dia</b> (12h e 23h), sempre que algo mudou. As cópias ficam <b>30 dias</b>.${nuvem.admin ? '' : ' Um administrador pode baixar ou restaurar uma cópia.'}</p>`;
  if (!nuvem.admin) return intro;
  const B = ui.backupsNuvem;
  if (!B) { ui.backupsNuvem = { carregando: true }; carregarBackupsNuvem().then(() => { if (rota().nome === 'config') render(); }); }
  const fmtQuando = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtTam = b => (b >= 1048576 ? `${(b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  return `${intro}
    <div class="row" style="margin-bottom:8px"><button class="sm primary" data-act="backupNuvemAgora">☁️ Fazer uma cópia agora</button></div>
    ${!B || B.carregando ? '<p class="muted small">Carregando as cópias…</p>' : B.erro ? `<p class="aviso-erro small">Não consegui ler as cópias: ${esc(B.erro)}</p>` : !B.lista.length ? '<p class="muted small">Nenhuma cópia ainda.</p>' : `<div class="table-wrap"><table>
      <thead><tr><th>Quando</th><th>Motivo</th><th class="r">Documentos</th><th class="r">Tamanho</th><th></th></tr></thead>
      <tbody>${B.lista.map((b, k) => `<tr>
        <td><b>${esc(fmtQuando(b.criado_em))}</b>${k === 0 ? ' <span class="badge ok">mais nova</span>' : ''}</td>
        <td class="small">${esc(b.motivo)}</td>
        <td class="r">${fmtNum(b.documentos)}</td>
        <td class="r small">${esc(fmtTam(b.tamanho))}</td>
        <td class="actions-cell"><button class="sm" data-act="baixarBackupNuvem" data-id="${b.id}">⬇ Baixar</button> <button class="sm danger" data-act="restaurarBackupNuvem" data-id="${b.id}">↺ Restaurar</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`}`;
}

async function carregarBackupsNuvem() {
  const { data, error } = await nuvem.supabase.rpc('cotacao_listar_backups');
  ui.backupsNuvem = error ? { erro: error.message } : { lista: data || [] };
}

async function lerBackupNuvem(id) {
  const { data, error } = await nuvem.supabase.rpc('cotacao_ler_backup', { p_id: Number(id) });
  if (error) throw new Error(error.message);
  return data;
}

/* ---------------- roteamento ---------------- */

const navegacao = { nome: 'inicio', id: null };

function rota() {
  return navegacao;
}

function ir(nome, id = null) {
  navegacao.nome = nome;
  navegacao.id = id;
  ui.digitando = null;
  ui.cfgSujo = false; // saiu da tela: o que não foi salvo ficou para trás
  ui.enviando = null;
  ui.lote = null;
  ui.conferindo = null;
  render();
  window.scrollTo(0, 0);
}

let telaDesenhada = null; // tela do último render (para manter a rolagem ao redesenhar a mesma tela)

/** Posição de rolagem da página e das tabelas com rolagem própria (comparativo, listas). */
/**
 * Seções "▸ abrir" (details) continuam como a pessoa deixou depois de redesenhar a tela
 * (antes, um redesenho — ex.: um colega salvou algo — fechava o que tinha acabado de ser aberto).
 */
function chaveDetalhe(el, k) {
  const sim = el.querySelector('[data-similar-prod]');
  return el.id || (sim ? 'sim:' + sim.dataset.similarProd : `${el.className}#${k}`);
}
function guardarAbertos() {
  const conta = {};
  return new Map([...document.querySelectorAll('#app details')].map(el => {
    const k = (conta[el.className] = (conta[el.className] ?? -1) + 1);
    return [chaveDetalhe(el, k), el.open];
  }));
}
function voltarAbertos(m) {
  if (!m?.size) return;
  const conta = {};
  for (const el of document.querySelectorAll('#app details')) {
    const k = (conta[el.className] = (conta[el.className] ?? -1) + 1);
    const v = m.get(chaveDetalhe(el, k));
    if (v != null && el.open !== v) el.open = v;
  }
}

function guardarRolagem() {
  return { y: window.scrollY, x: window.scrollX, tabelas: [...document.querySelectorAll('#app .table-wrap')].map(el => [el.scrollTop, el.scrollLeft]) };
}
function voltarRolagem(r) {
  document.querySelectorAll('#app .table-wrap').forEach((el, k) => {
    const [t, l] = r.tabelas[k] || [0, 0];
    if (t || l) { el.scrollTop = t; el.scrollLeft = l; }
  });
  window.scrollTo(r.x, r.y);
}

/** Campo com o cursor (para voltar a ele depois de redesenhar a tela, ex.: ao voltar com Alt+Tab). */
function guardarFoco() {
  const el = document.activeElement;
  if (!el || !$('#app')?.contains(el)) return null;
  // campos e áreas navegáveis pelo teclado com id (ex.: a lista de itens da nova cotação)
  if (!el.matches?.('input, textarea, select') && !el.id) return null;
  let sel = el.id ? '#' + CSS.escape(el.id) : '';
  if (!sel) {
    const dados = Object.keys(el.dataset);
    if (!dados.length) return null;
    sel = el.tagName.toLowerCase() + dados.map(k => `[data-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}="${CSS.escape(el.dataset[k])}"]`).join('');
  }
  let ini = null, fim = null;
  try { ini = el.selectionStart; fim = el.selectionEnd; } catch (e) { /* campo sem seleção */ }
  return { sel, ini, fim };
}
function voltarFoco(f) {
  const el = f && document.querySelector('#app ' + f.sel);
  if (!el) return;
  el.focus({ preventScroll: true });
  try { if (f.ini != null) el.setSelectionRange(f.ini, f.fim); } catch (e) { /* campo sem seleção */ }
}

function render() {
  const { nome, id } = rota();
  const app = $('#app');
  // redesenhar a mesma tela (ex.: escolher o preço de outra empresa) não pode jogar a rolagem para o começo
  const tela = `${nome}|${id ?? ''}`;
  const rolagem = telaDesenhada === tela ? guardarRolagem() : null;
  const foco = telaDesenhada === tela ? guardarFoco() : null;
  const abertos = telaDesenhada === tela ? guardarAbertos() : null;
  telaDesenhada = tela;
  atualizarNavAdmin();
  const views = {
    inicio: renderInicio,
    nova: renderNova,
    cotacoes: renderCotacoes,
    cotacao: () => renderCotacao(id),
    produtos: renderProdutos,
    fornecedores: renderFornecedores,
    relatorios: () => (podeVerRelatorios() ? renderRelatorios() : `<section class="card"><h2>🔒 Relatórios</h2>
      <p class="muted">Esta tela é só para administradores${nuvem.admin == null ? ' (verificando o seu acesso…)' : ''}. Peça a um administrador se precisar de alguma informação daqui.</p>
      <p><a class="btn" href="#" data-route="inicio">← Ir para o Início</a></p></section>`),
    duvidas: renderDuvidas,
    config: renderConfig,
  };
  app.dataset.tela = nome;
  try {
    app.innerHTML = avisoBackup() + (views[nome] || renderCotacoes)();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<section class="card"><h2>Não foi possível abrir esta tela</h2>
      <p class="muted">Ocorreu um erro: ${esc(e.message)}</p>
      <p class="muted small">Tente recarregar a página. Se continuar, avise com a mensagem acima.</p></section>`;
  }
  if (abertos) voltarAbertos(abertos);
  if (rolagem) voltarRolagem(rolagem);
  if (foco) voltarFoco(foco);
  if (pip.win) desenharPip(false);
  if (nome === 'cotacao') ajustarColunasFixasDepois();
  anunciarPresenca();
  anotarUltimoLugar();
  const cotTela = nome === 'cotacao' ? db.cotacoes.find(x => x.id === id) : null;
  ui.telaCot = cotTela ? { cotId: cotTela.id, sig: assinaturaSemQtd(cotTela) } : null;
  const ativo = nome === 'cotacao' ? 'cotacoes' : nome;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === ativo));
  $('#brand').textContent = db.config.loja ? `Cotações · ${db.config.loja}` : 'Cotações';
  const navDuv = $('#nav a[data-route="duvidas"]');
  const nDuv = gruposDuvidas(duvidasPendentes()).length;
  if (navDuv) navDuv.innerHTML = `Dúvidas${nDuv ? ` <span class="nav-alerta nav-info">${nDuv}</span>` : ''}`;
  const navCot = $('#nav a[data-route="cotacoes"]');
  if (navCot) {
    const n = cotacoesComPrazo().length;
    navCot.innerHTML = `Cotações${n ? ` <span class="nav-alerta" title="${n} cotação(ões) com resposta atrasada ou perto do prazo">${n}</span>` : ''}`;
  }
}

document.addEventListener('click', e => {
  const linhaGrupo = e.target.closest('[data-g-idx]');
  if (linhaGrupo && ui.datacar && !e.target.closest('button')) {
    const gi = +linhaGrupo.dataset.gIdx;
    if (e.target.closest('.cg-sel') || e.ctrlKey || e.metaKey) selecionarGrupoDc(gi, 'um');
    else if (e.shiftKey) selecionarGrupoDc(gi, 'faixa');
    else { ui.datacar.ancoraG = gi; moverGrupoDataCar(gi); }
  }
  const linhaItem = e.target.closest('[data-item-linha]');
  if (linhaItem) {
    const campo = e.target.closest('[data-marca-item], [data-similar-prod], [data-codigo-item], [data-codigo-papel]');
    if (campo) { ui.cursorItem = +linhaItem.dataset.itemLinha; moverCursorItem(ui.cursorItem, false); campo.dataset.original = campo.value; }
    else if (!e.target.closest('button')) moverCursorItem(+linhaItem.dataset.itemLinha);
  }
  const link = e.target.closest('[data-route]');
  if (link) {
    e.preventDefault();
    ir(link.dataset.route, link.dataset.id || null);
    return;
  }
  const envio = e.target.closest('[data-marca-envio]');
  if (envio) {
    const c = cotAtual();
    if (c) { marcarEnviado(c, +envio.dataset.marcaEnvio, envio.dataset.tipo); setTimeout(render, 400); }
  }
  const grupo = e.target.closest('[data-marca-grupo]');
  if (grupo && ui.lote) {
    const c = cotAtual();
    if (c) {
      for (const id of ui.lote.ids) {
        const fi = c.fornecedores.findIndex(f => f.fornecedorId === id);
        if (fi >= 0 && c.fornecedores[fi].email) marcarEnviado(c, fi, grupo.dataset.tipo);
      }
      setTimeout(render, 400);
    }
  }
});

/* ---------------- ações ---------------- */

function cotAtual() {
  const { nome, id } = rota();
  return nome === 'cotacao' ? db.cotacoes.find(c => c.id === id) : null;
}

function formDados(form) {
  return Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
}

/**
 * Você corrigiu um preço do item i: a diferença grande entre o 1º e o 2º fica aceita com os preços novos
 * (o aviso "confira o preço" não volta a pedir conferência por causa da correção).
 */
function aceitarDifCorrigida(c, i) {
  const precos = c.fornecedores.map(f => { const p = f.respostas?.[i]?.preco; return p != null && p > 0 ? p : null; });
  c.difConferida = { ...(c.difConferida || {}), [i]: assinaturaPrecos(precos) };
}

/** Altera o preço que o fornecedor respondeu (guarda o valor original). */
async function alterarPrecoResposta(c, i, fi) {
  const f = c.fornecedores[fi];
  const o = f?.respostas?.[i];
  if (!o) return;
  const it = c.itens[i];
  const v = await pedirValor(`Valor correto de ${f.nome} para ${it.codigo || it.descricao}:${o.precoOriginal != null ? ` (valor original ${fmtMoeda(o.precoOriginal)})` : ''}`, { valor: fmtNum(o.preco, 2), ok: 'Salvar' });
  if (v == null) return;
  const novo = parseNum(v);
  if (!(novo > 0)) return avisar('Valor inválido. Para tirar o preço, use "Remover o preço".');
  f.respostas = { ...f.respostas, [i]: { ...o, preco: novo, precoOriginal: o.precoOriginal ?? o.preco } };
  aceitarDifCorrigida(c, i);
  salvar();
  render();
  toast(`Preço de ${f.nome} alterado: ${fmtMoeda(o.preco)} → ${fmtMoeda(novo)}.`);
}

/** Tira o preço do fornecedor deste item (fica como se não tivesse respondido). */
function removerPrecoResposta(c, i, fi) {
  const f = c.fornecedores[fi];
  const o = f?.respostas?.[i];
  if (!o) return;
  const it = c.itens[i];
  const r = { ...f.respostas };
  delete r[i];
  f.respostas = r;
  if (c.escolhas?.[i] === f.fornecedorId) { c.escolhas = { ...c.escolhas }; delete c.escolhas[i]; }
  aceitarDifCorrigida(c, i);
  salvar();
  render();
  toast(`Preço de ${f.nome} (${fmtMoeda(o.preco)}) removido do item ${it.codigo || it.descricao}.`);
}

const acoes = {
  dcDecidir: el => decidirDataCar(el.dataset.d),
  dcEditarMarca: () => editarMarcaDataCar(),
  dcSugestoes: () => aplicarSugestoesDataCar(),
  dcSelVai: () => decidirSelecionadosDc('vai'),
  dcSelNao: () => decidirSelecionadosDc('nao'),
  dcSelLimpar: () => { ui.datacar.selG = new Set(); ui.datacar.ancoraG = null; desenharConferencia(); },
  dcRestVai: () => decidirRestantesDc('vai'),
  dcRestNao: () => decidirRestantesDc('nao'),
  dcGVai: el => decidirGrupoDataCar(+el.dataset.i, 'vai'),
  dcGNao: el => decidirGrupoDataCar(+el.dataset.i, 'nao'),
  dcGAbrir: el => abrirGrupoDataCar(+el.dataset.i),
  dcGFechar: () => fecharGrupoDataCar(false),

  dcCancelar: async () => {
    const d = ui.datacar;
    if (!d) return;
    const sel = d.linhas.filter(l => l.sel).length;
    const msg = sel
      ? `Sair desta tela? Os ${sel} item(ns) marcado(s) para ir não serão adicionados à cotação.`
      : 'Sair desta tela sem adicionar itens à cotação?';
    if (!(await abrirDialogo(msg, [{ txt: 'Continuar aqui', valor: false }, { txt: 'Sair', valor: true, cls: 'danger' }]))) {
      focarDataCar();
      return;
    }
    ui.datacar = null;
    render();
  },
  dcAdicionar: () => {
    const d = ui.datacar;
    const escolhidas = d.linhas.filter(l => l.sel && (l.codigo || l.chave));
    const rr = rascunho();
    const papel = d.modo === 'papel';
    const mapaObs = { ...(rr.obsPorCodigo || {}) };
    const vistos = {};
    for (const l of papel ? [] : d.linhas) {
      const k = chaveCodigo(l.codigo || '');
      if (!k) continue;
      if (!vistos[k]) { vistos[k] = true; mapaObs[k] = []; } // este arquivo substitui o anterior para o código
      mapaObs[k].push(l.chave || '');
    }
    rr.obsPorCodigo = mapaObs;
    if (!escolhidas.length) return avisar('Marque pelo menos um item.');
    const r = rascunho();
    const txt = (l, c) => (c >= 0 ? l.cels[c] : '');
    // código novo sem marca exigida também entra: a marca é preenchida na cotação (e fica salva no cadastro)
    const novosSemMarca = escolhidas.filter(l => !l.produtoId && !String(l.marca ?? txt(l, d.colMarca) ?? '').trim()).length;
    let novos = 0, somados = 0;
    const criadosAgora = {}; // código novo que aparece em mais de uma linha (ex.: "01" e "01 XX") vira um produto só
    for (const l of escolhidas) {
      const qtd = 1; // o fornecedor informa o preço unitário
      const codArq = l.codigo;
      let id = l.produtoId || (codArq && criadosAgora[chaveCodigo(codArq)]);
      if (!id) {
        // Produto novo: código = coluna de código do arquivo; a OBS (grupo) vai no campo Observação.
        const p = {
          id: uid(), codigo: codArq || l.chave, similar: '', obsDataCar: codArq || papel ? '' : l.chave, descricao: l.desc || txt(l, d.colDesc) || codArq || l.chave, unidade: 'UN',
          marca: (l.marca ?? txt(l, d.colMarca)).trim(), categoria: '', obs: papel ? '' : l.chave, criadoEm: new Date().toISOString(),
        };
        db.produtos.push(p);
        id = p.id;
        if (codArq) criadosAgora[chaveCodigo(codArq)] = id;
        novos++;
      }
      // Marca: produto sem marca no cadastro recebe a marca informada (fica salva);
      // produto que já tem marca mantém a do cadastro e a informada vale só nesta cotação.
      const existente = db.produtos.find(p => p.id === id);
      const informada = (l.marca ?? '').trim();
      let marcaCotacao = '';
      if (existente && informada) {
        if (!existente.marca) existente.marca = informada;
        else if (informada !== existente.marca) marcaCotacao = informada;
      }
      const ja = r.itens.find(x => x.produtoId === id);
      const codigoArquivo = codArq;
      if (ja && papel) { somados++; continue; } // papelzinho que já está na cotação: não acrescenta
      if (ja) {
        ja.quantidade = qtd;
        ja.obsArquivo = [...(ja.obsArquivo || []), l.chave || ''];
        if (!ja.codigoArquivo) ja.codigoArquivo = codigoArquivo;
        if (l.marca !== undefined) ja.marca = marcaCotacao;
        somados++;
      } else {
        r.itens.push({ produtoId: id, quantidade: qtd, codigoArquivo, marca: marcaCotacao, obsArquivo: papel ? [] : [l.chave || ''], ...(papel ? { papelzinho: true } : {}), ...(l.produtoId ? {} : { novoCadastro: true }) });
      }
    }
    if (papel) {
      const jaAntes = d.jaNaCotacao || 0;
      r.papelzinhos = { arquivo: d.arquivo, em: new Date().toISOString(), adicionados: escolhidas.length - somados, jaEstavam: jaAntes + somados };
    }
    ui.datacar = null;
    salvar();
    render();
    toast(`${escolhidas.length} item(ns) adicionado(s)${novos ? `, ${novos} produto(s) novo(s) cadastrado(s)` : ''}${somados ? `, ${somados} já estava(m) na cotação` : ''}.${novosSemMarca ? ` ${novosSemMarca} sem marca: preencha a marca na lista (campos amarelos).` : ''}`, 7000);
  },

  irNovoSemMarca: () => {
    const pend = novosSemMarcaNaLista();
    if (!pend.length) return;
    const i = pend.find(k => k > ui.cursorItem) ?? pend[0];
    moverCursorItem(i);
    const tr = document.querySelector(`[data-item-linha="${i}"]`);
    if (tr) { tr.scrollIntoView({ block: 'center' }); tr.querySelector('[data-marca-item]')?.focus(); }
  },
  irItem: el => {
    const i = +el.dataset.i;
    moverCursorItem(i);
    const tr = document.querySelector(`[data-item-linha="${i}"]`);
    if (tr) {
      tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
      tr.classList.remove('piscar');
      void tr.offsetWidth;
      tr.classList.add('piscar');
    }
  },

  manterItem: el => {
    const r = rascunho();
    const x = r.itens[+el.dataset.i];
    if (!x) return;
    x.dupVisto = true; // analisado: fica na cotação e sai do destaque
    salvar();
    render();
  },

  removerItem: el => perguntarRemoverItem(+el.dataset.i, false, !!el.closest('.painel-dup')),
  incluirDaBusca: el => incluirNaLista(el.dataset.id),
  recolherFornCot: el => alternarFornCot(el),
  filtroAviso: el => {
    // etiqueta de aviso: mostra só os itens dela (clicar de novo, ou em "ver todos", volta tudo)
    const c = cotAtual();
    if (!c) return;
    const tipo = el.dataset.tipo || '';
    ui.filtroAviso = tipo && filtroAviso(c) !== tipo ? { cotId: c.id, tipo } : null;
    aplicarFiltrosComp(c);
    const painel = $('.painel-comp');
    if (painel) {
      painel.scrollTop = 0;
      painel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    const n = document.querySelectorAll('[data-comp-linha]:not([hidden])').length;
    if (ui.filtroAviso) toast(n ? `Mostrando ${n} item(ns). Clique de novo na etiqueta ou em "ver todos" para voltar.` : 'Nenhum item com este aviso entre os itens mostrados.');
  },
  conferirPreco: async el => {
    // preço muito acima/abaixo: você confere e marca como certo (o aviso some; volta se o preço mudar)
    const c = cotAtual();
    const i = +el.dataset.i, fi = +el.dataset.f;
    const f = c?.fornecedores[fi];
    const o = f?.respostas?.[i];
    if (!o) return;
    const it = c.itens[i];
    const l = comparar(c).linhas[i];
    const ult = it.produtoId ? ultimosPrecos(c.id)[it.produtoId] : null;
    const motivos = alertasPreco(o.preco, ult, l.precos).map(a => '• ' + a.texto).join('\n');
    const escolha = await abrirDialogo(`${it.codigo || '—'} · ${it.descricao}\n${f.nome}: ${fmtMoeda(o.preco)}${o.marca ? ` · marca ${o.marca}` : ''}\n\n${motivos}\n\nEste preço está certo?`, [
      { txt: 'Cancelar', valor: null },
      { txt: 'Remover o preço', valor: 'remover', cls: 'danger' },
      { txt: 'Alterar o preço…', valor: 'alterar' },
      { txt: 'Sim, o preço está certo', valor: 'certo', cls: 'primary' },
    ]);
    if (escolha === 'alterar') return alterarPrecoResposta(c, i, fi);
    if (escolha === 'remover') return removerPrecoResposta(c, i, fi);
    if (escolha !== 'certo') return;
    f.respostas = { ...f.respostas, [i]: { ...o, precoConferido: o.preco } };
    salvar();
    render();
    toast(`Preço de ${f.nome} marcado como certo.`);
  },
  conferirDif: async el => {
    // diferença acima de 100% entre o 1º e o 2º: você confere e marca como certo
    const c = cotAtual();
    const i = +el.dataset.i;
    const l = comparar(c).linhas[i];
    if (!l) return;
    const it = c.itens[i];
    const linhas = l.precos.map((p, j) => [p, j]).filter(([p]) => p != null).sort((a, b) => a[0] - b[0])
      .map(([p, j]) => `• ${c.fornecedores[j].nome}: ${fmtMoeda(p)}`).join('\n');
    const ok = await abrirDialogo(`${it.codigo || '—'} · ${it.descricao}\n\n${linhas}\n\nA diferença passa de 100%. Os preços estão certos?`, [
      { txt: 'Cancelar', valor: false },
      { txt: 'Sim, os preços estão certos', valor: true, cls: 'primary' },
    ]);
    if (!ok) return;
    c.difConferida = { ...(c.difConferida || {}), [i]: assinaturaPrecos(l.precos) };
    salvar();
    render();
    toast('Diferença marcada como conferida. Se algum preço mudar, o aviso volta.');
  },
  removerPreco: async el => {
    // o fornecedor respondeu um valor errado: tira o preço dele deste item (ou corrige o valor)
    const c = cotAtual();
    const i = +el.dataset.i, fi = +el.dataset.f;
    const f = c?.fornecedores[fi];
    const o = f?.respostas?.[i];
    if (!o) return;
    const it = c.itens[i];
    const escolha = await abrirDialogo(`${it.codigo || '—'} · ${it.descricao}\n${f.nome}: ${fmtMoeda(o.preco)}${o.marca ? ` · marca ${o.marca}` : ''}${o.precoOriginal != null ? ` (valor original ${fmtMoeda(o.precoOriginal)})` : ''}\n\nEste preço está errado?`, [
      { txt: 'Cancelar', valor: null },
      { txt: 'Corrigir o valor…', valor: 'corrigir' },
      { txt: 'Remover o preço', valor: 'remover', cls: 'danger' },
    ]);
    if (!escolha) return;
    if (escolha === 'corrigir') return alterarPrecoResposta(c, i, fi);
    return removerPrecoResposta(c, i, fi);
  },
  mostrarSemResposta: () => { ui.mostrarSemResposta = !ui.mostrarSemResposta; render(); },
  exportarPedidoForn: el => exportarPedidoForn(cotAtual(), +el.dataset.f),
  reabrirForn: async el => {
    const c = cotAtual();
    const f = c?.fornecedores[+el.dataset.f];
    if (!f || !(await confirmar(`Reabrir a cotação de ${f.nome}? (Tira a marca de concluída.)`, 'Reabrir'))) return;
    delete f.concluidoEm;
    delete f.exportadoLojas;
    salvar();
    render();
  },
  cadastrarDaBusca: () => cadastrarEIncluir(codigoParaCadastrar(ui.filtroItens)),

  preencherPadraoNova: () => {
    const r = rascunho();
    const pad = novoRascunho();
    const feitos = [];
    if (!r.titulo) { r.titulo = pad.titulo; feitos.push('título'); }
    if (!r.prazoResposta) { r.prazoResposta = pad.prazoResposta; r.prazoHora = r.prazoHora || pad.prazoHora; feitos.push('prazo'); }
    if (!r.obs && pad.obs) { r.obs = pad.obs; feitos.push('observações'); }
    salvar();
    render();
    toast(feitos.length ? `Preenchido: ${feitos.join(', ')}.` : 'Nada para preencher.');
  },
  fornDeSempre: () => {
    const r = rascunho();
    r.fornecedorIds = [...new Set([...r.fornecedorIds, ...fornecedoresDeSempre()])];
    salvar();
    render();
  },
  fornTodos: () => {
    rascunho().fornecedorIds = db.fornecedores.map(f => f.id);
    salvar();
    render();
  },
  fornNenhum: () => {
    rascunho().fornecedorIds = [];
    salvar();
    render();
  },
  limparRascunho: async () => {
    if (!(await confirmar('Limpar todos os itens e fornecedores desta nova cotação?'))) return;
    db.rascunho = null;
    salvar();
    render();
  },

  criarCotacao: async () => {
    const r = rascunho();
    const prod = prodPorId();
    const forn = byId(db.fornecedores);
    const itens = r.itens.filter(x => prod[x.produtoId]);
    ordenarItensRascunho({ itens }, prod);
    if (!itens.length) return avisar('Adicione pelo menos um item.');
    const fornecedores = r.fornecedorIds.map(id => forn[id]).filter(Boolean);
    const ck = checklistNova(r);
    if (ck.length && !(await confirmar(`Antes de criar, confira:\n\n${ck.map(x => '⚠ ' + x.txt).join('\n')}\n\nCriar a cotação mesmo assim?`, 'Criar mesmo assim'))) return;

    const cfg = db.config;
    const numero = String(proximoNumeroCot()).padStart(4, '0');
    const c = {
      id: uid(),
      numero,
      titulo: r.titulo,
      data: hojeISO(),
      prazoResposta: r.prazoResposta,
      prazoHora: r.prazoHora || '',
      obs: r.obs,
      status: 'aberta',
      criadoEm: new Date().toISOString(),
      itens: itens.map(x => {
        const p = prod[x.produtoId];
        return { produtoId: p.id, codigo: x.codigoArquivo || p.codigo, codigoArquivo: x.codigoArquivo || '', codigoCadastro: p.codigo, similar: p.similar || '', descricao: p.descricao, unidade: p.unidade, marca: x.marca || p.marca, marcaCotacao: x.marca || '', quantidade: 1, ...(lojaPelaObs(x.obsArquivo) ? { lojaObs: lojaPelaObs(x.obsArquivo) } : {}), ...(x.papelzinho ? { papelzinho: true } : {}) };
      }),
      fornecedores: fornecedores.map(novoFornCot),
    };
    // Pergunta onde salvar e grava a planilha em Excel (com as colunas VALOR e MARCA no final).
    let salvo;
    try {
      salvo = await salvarComo(nomePlanilha(c, null), async () => new Blob([await (await gerarPlanilha(c, null)).xlsx.writeBuffer()], { type: TIPO_XLSX }));
    } catch (e) {
      console.error(e);
      return avisar('Não foi possível salvar a planilha: ' + e.message);
    }
    if (salvo === false) {
      toast('Cotação não criada: o salvamento foi cancelado.');
      return;
    }
    cfg.proxNumero = Number(numero) + 1;
    db.cotacoes.push(c);
    db.rascunho = null;
    salvar();
    ir('cotacao', c.id);
    toast(`Cotação nº ${numero} criada e planilha salva.`, 5000);
  },

  baixarPlanilha: async el => {
    const c = cotAtual();
    await baixarPlanilha(c, +el.dataset.f);
  },

  baixarGeral: async () => {
    const c = cotAtual();
    await baixarWorkbook(await gerarPlanilha(c, null), nomePlanilha(c, null));
  },

  enviar: el => {
    const c = cotAtual();
    ui.enviando = { cotId: c.id, fi: +el.dataset.f };
    ui.digitando = null;
    ui.lote = null;
    render();
    $('#painelEnvio')?.scrollIntoView({ behavior: 'smooth' });
  },
  fecharEnvio: () => { ui.enviando = null; render(); },

  envioLote: () => {
    const c = cotAtual();
    const m = fornecedoresMarcados(c);
    if (!m.length) return avisar('Marque os fornecedores que vão receber a cotação (primeira coluna da tabela).');
    abrirLote(c, m.map(x => x.fi), 'cotacao');
  },
  cobrarMarcados: () => {
    const c = cotAtual();
    const m = fornecedoresMarcados(c);
    if (!m.length) return avisar('Marque os fornecedores que você quer cobrar (primeira coluna da tabela).');
    const pend = m.filter(x => !respondeu(x.f));
    if (!pend.length) return avisar('Todos os fornecedores marcados já responderam.');
    abrirLote(c, pend.map(x => x.fi), 'cobranca');
  },
  cobrarPendentes: () => {
    const c = cotAtual();
    const pend = c.fornecedores.map((f, fi) => (respondeu(f) ? -1 : fi)).filter(fi => fi >= 0);
    if (!pend.length) return avisar('Todos os fornecedores já responderam.');
    abrirLote(c, pend, 'cobranca');
  },
  fecharLote: () => { ui.lote = null; render(); },
  enviarPedidos: () => {
    const c = cotAtual();
    const peds = pedidosPorFornecedor(c);
    if (!peds.length) return avisar('Ainda não há pedidos: digite as quantidades no comparativo.');
    ui.lote = { cotId: c.id, tipo: 'pedido', ids: peds.map(p => p.f.fornecedorId), inicio: new Date().toISOString(), formato: ui.formatoPedido || 'lojas' };
    ui.enviando = null; ui.digitando = null; ui.conferindo = null;
    render();
    $('#painelLote')?.scrollIntoView({ behavior: 'smooth' });
  },
  baixarPedidoForn: async el => {
    const c = cotAtual();
    const g = await gerarPedidoFornecedor(c, el.dataset.forn, ui.lote?.formato);
    if (!g || !(await baixarWorkbook(g.wb, g.nome))) return;
    anotarPedidoExportado(c, c.fornecedores.findIndex(f => f.fornecedorId === el.dataset.forn));
    salvar();
    render();
  },
  zipPedidos: async () => {
    const c = cotAtual();
    const ok = await salvarComo(`Pedidos_${c.numero}.zip`, async () => {
      const arquivos = [];
      for (const id of ui.lote.ids) {
        const g = await gerarPedidoFornecedor(c, id, ui.lote.formato);
        if (g) arquivos.push({ nome: g.nome, dados: new Uint8Array(await g.wb.xlsx.writeBuffer()) });
      }
      return criarZip(arquivos);
    }, TIPO_ZIP);
    if (!ok) return;
    for (const id of ui.lote.ids) anotarPedidoExportado(c, c.fornecedores.findIndex(f => f.fornecedorId === id));
    salvar();
    render();
    if (nuvem.downloads) toast('Pedidos baixados no arquivo .zip.');
  },
  marcarLote: el => {
    marcarEnviado(cotAtual(), +el.dataset.f, ui.lote?.tipo);
    render();
  },
  zipMarcados: () => {
    const c = cotAtual();
    return salvarZip(c, fornecedoresMarcados(c).map(x => x.fi));
  },
  zipLote: () => {
    const c = cotAtual();
    return salvarZip(c, ui.lote.ids.map(id => c.fornecedores.findIndex(f => f.fornecedorId === id)).filter(fi => fi >= 0));
  },
  pastaLote: () => {
    const c = cotAtual();
    return salvarNaPasta(c, ui.lote.ids.map(id => c.fornecedores.findIndex(f => f.fornecedorId === id)).filter(fi => fi >= 0));
  },
  copiarTexto: el => copiar(el.dataset.texto, el),
  marcarEnviado: el => { marcarEnviado(cotAtual(), +el.dataset.f); render(); toast('Marcada como enviada.'); },
  copiar: el => {
    const c = cotAtual();
    const f = c.fornecedores[ui.enviando.fi];
    const m = dadosEmail(c, f);
    return copiar({ email: f.email || '', assunto: m.assunto, corpo: m.corpo }[el.dataset.campo], el);
  },

  digitar: el => {
    const c = cotAtual();
    ui.digitando = { cotId: c.id, fi: +el.dataset.f };
    ui.enviando = null;
    ui.lote = null;
    render();
    $('#painelDigitar')?.scrollIntoView({ behavior: 'smooth' });
  },

  fecharDigitar: () => { ui.digitando = null; render(); },

  removerFornCot: async el => {
    const c = cotAtual();
    const f = c.fornecedores[+el.dataset.f];
    if (!(await confirmar(`Remover ${f.nome} desta cotação? Os preços lançados dele serão perdidos.`))) return;
    c.fornecedores.splice(+el.dataset.f, 1);
    ui.digitando = null;
    salvar();
    render();
  },

  addFornCot: () => {
    const c = cotAtual();
    const f = db.fornecedores.find(x => x.id === $('#addFornCot').value);
    if (!f) return;
    c.fornecedores.push(novoFornCot(f));
    salvar();
    render();
  },

  exportarComparativo: () => exportarComparativo(cotAtual()),

  escolherVencedor: el => escolherVencedorItem(cotAtual(), +el.dataset.i, +el.dataset.f),

  marcaResposta: async el => {
    const c = cotAtual();
    const i = +el.dataset.i, fi = +el.dataset.f;
    const it = c.itens[i], f = c.fornecedores[fi];
    const o = f.respostas?.[i];
    if (!o) return;
    const jaRecusada = recusada(c, i, f);
    const jaPermitida = permitida(c, i, f);
    const errada = statusMarca(it.marca, o.marca) === 'errada';
    const escolha = await abrirDialogo(
      `${it.descricao}\nMarca pedida: ${it.marca}\n${f.nome} respondeu: ${o.marca}${jaRecusada ? '\n\n✗ Você recusou esta marca: o preço não entra neste item.' : ''}${jaPermitida ? '\n\n✓ Marca errada, mas PERMITIDA nesta cotação: o preço disputa normalmente.' : errada ? '\n\n"Permitir marca" aceita este preço só nesta cotação; a marca continua contando como errada.' : ''}\n\n"${o.marca}" é a marca ${it.marca}?`,
      [
        { txt: 'Cancelar', valor: undefined },
        { txt: 'Corrigir a marca…', valor: 'corrigir' },
        { txt: '❓ Perguntar à loja', valor: 'duvida' },
        ...(jaPermitida ? [{ txt: 'Tirar a permissão', valor: 'tirarPermissao' }]
          : errada ? [{ txt: '✓ Permitir marca', valor: 'permitir', cls: 'btn-permitir' }] : []),
        { txt: 'Não, é outra marca', valor: 'diferente', cls: 'danger' },
        { txt: `Sim, é ${it.marca}`, valor: 'igual', cls: 'primary' },
      ]);
    if (!escolha) return;
    if (escolha === 'permitir' || escolha === 'tirarPermissao') {
      if (escolha === 'permitir') { desfazerRecusa(c, i, f); permitirMarca(c, i, f); } else desfazerPermissao(c, i, f);
      salvar();
      render();
      toast(escolha === 'permitir'
        ? `Marca "${o.marca}" permitida só nesta cotação. Continua contando como marca errada de ${f.nome}.`
        : `Permissão tirada: "${o.marca}" volta a ser marca errada nesta cotação.`, 5000);
      return;
    }
    if (escolha === 'duvida') {
      const n = await duvidasDoItem(c, i, fi, 'MARCA DIFERENTE');
      if (n <= 0) return;
      render();
      toast(`${n} item(ns) em Dúvidas (${db.duvidas.length} na fila).`);
      return;
    }
    if (escolha === 'corrigir') {
      const nova = await pedirValor(`Qual é a marca correta que ${f.nome} vai fornecer? (O que ele escreveu: "${o.marca}")`, { valor: o.marca, ok: 'Salvar' });
      if (nova == null || nova.trim() === o.marca) return;
      f.respostas = { ...f.respostas, [i]: { ...o, marca: nova.trim(), marcaOriginal: o.marcaOriginal || o.marca } };
      toast('Marca corrigida.');
    } else if (escolha === 'igual') {
      aprenderMarca(it.marca, o.marca, escolha);
      desfazerRecusa(c, i, f);
      toast(`Anotado: "${o.marca}" = ${it.marca}. Vale para as próximas cotações.`);
    } else {
      aprenderMarca(it.marca, o.marca, escolha);
      desfazerPermissao(c, i, f);
      recusarMarca(c, i, f);
      const l = comparar(c).linhas[i];
      toast(l.recusadaGanhou
        ? `Marca "${o.marca}" recusada. Não há outro preço: o mais barato (${c.fornecedores[l.vencedor].nome}) fica como escolhido, com o aviso de marca recusada.`
        : l.vencedor >= 0
          ? `Marca "${o.marca}" recusada. Agora vale o preço de ${c.fornecedores[l.vencedor].nome}: confira a marca dele.`
          : `Marca "${o.marca}" recusada. O item fica aguardando outro preço.`, 6000);
    }
    salvar();
    render();
  },

  verNFe: el => {
    const c = cotAtual();
    ui.conferindo = { cotId: c.id, recId: el.dataset.rec };
    ui.digitando = null; ui.enviando = null; ui.lote = null;
    render();
    $('#painelNFe')?.scrollIntoView({ behavior: 'smooth' });
  },
  fecharNFe: () => { ui.conferindo = null; render(); },
  excluirNFe: async () => {
    const c = cotAtual();
    const rec = (c.recebimentos || []).find(r => r.id === ui.conferindo?.recId);
    if (!rec || !(await confirmar(`Excluir a conferência da NF-e nº ${rec.nf.numero}? O pedido volta a ficar aguardando esta nota.`, 'Excluir'))) return;
    c.recebimentos = c.recebimentos.filter(r => r.id !== rec.id);
    ui.conferindo = null;
    salvar();
    render();
  },
  desvincularNFe: el => {
    const c = cotAtual();
    const rec = (c.recebimentos || []).find(r => r.id === ui.conferindo?.recId);
    if (!rec) return;
    vincularItemNFe(c, rec, +el.dataset.k, -1);
  },
  copiarCobranca: el => {
    const c = cotAtual();
    const rec = (c.recebimentos || []).find(r => r.id === ui.conferindo?.recId);
    if (rec) return copiar(textoCobranca(c, rec), el);
  },
  exportarDivergencias: () => {
    const c = cotAtual();
    const rec = (c.recebimentos || []).find(r => r.id === ui.conferindo?.recId);
    if (rec) return exportarDivergencias(c, rec);
  },

  moverItensMinimo: async el => {
    const c = cotAtual();
    const fi = +el.dataset.f;
    const sim = simularMover(c, comparar(c), fi);
    if (!sim) return;
    const f = c.fornecedores[fi];
    if (!(await confirmar(`Passar ${sim.moves.length} item(ns) de ${f.nome} para o 2º colocado?\n\n${sim.moves.map(m => `• ${m.l.it.descricao}: ${fmtMoeda(m.l.preco)} → ${c.fornecedores[m.j].nome} ${fmtMoeda(m.preco)}`).join('\n')}\n\nDiferença total (itens + frete): ${sim.saldo >= 0 ? '+' : '−'}${fmtMoeda(Math.abs(sim.saldo))}. Dá para desfazer clicando nos preços ou em "Desfazer as escolhas".`, 'Passar os itens'))) return;
    c.escolhas = { ...(c.escolhas || {}) };
    for (const m of sim.moves) c.escolhas[m.l.i] = c.fornecedores[m.j].fornecedorId;
    salvar();
    render();
    toast(`${sim.moves.length} item(ns) passados para o 2º colocado.`);
  },
  manterMinimo: el => {
    const c = cotAtual();
    c.minimoOk = { ...(c.minimoOk || {}), [el.dataset.forn]: true };
    salvar();
    render();
  },

  limparEscolhas: async () => {
    const c = cotAtual();
    const comp = comparar(c);
    const itens = comp.linhas.filter(l => l.manual || c.escolhas?.[l.i]);
    const lista = itens.slice(0, 12).map(l => `• ${l.it.codigo || '#' + (l.i + 1)}: ${c.fornecedores[l.vencedor]?.nome || '—'} ${fmtMoeda(l.preco)}`).join('\n');
    if (!(await confirmar(`Desfazer ${itens.length} escolha(s) feitas na mão?\n\nEsses itens voltam para o menor preço:\n${lista}${itens.length > 12 ? `\n… e mais ${itens.length - 12}` : ''}`, 'Desfazer as escolhas'))) return;
    c.escolhas = {};
    salvar();
    render();
  },

  baixarPedido: el => baixarPedidos(cotAtual(), +el.dataset.f, el.dataset.loja || null),
  baixarPedidos: el => baixarPedidos(cotAtual(), null, el.dataset.loja || null),

  duplicarCot: async () => {
    const c = cotAtual();
    const prod = prodPorId();
    const forn = byId(db.fornecedores);
    const r = rascunho();
    if (r.itens.length && !(await confirmar('Já existe uma nova cotação em andamento. Substituir pelos itens desta?'))) return;
    db.rascunho = {
      titulo: c.titulo,
      prazoResposta: '',
      obs: c.obs,
      itens: c.itens.filter(i => prod[i.produtoId]).map(i => ({ produtoId: i.produtoId, quantidade: i.quantidade, codigoArquivo: i.codigoArquivo || '', marca: i.marcaCotacao || '' })),
      fornecedorIds: c.fornecedores.map(f => f.fornecedorId).filter(id => forn[id]),
    };
    salvar();
    ir('nova');
  },

  excluirCot: async () => {
    const c = cotAtual();
    if (!(await confirmar(`Excluir a cotação nº ${c.numero}? Isso não pode ser desfeito.`))) return;
    db.cotacoes = db.cotacoes.filter(x => x.id !== c.id);
    salvar();
    ir('cotacoes');
  },

  verHistorico: el => {
    ui.histProd = ui.histProd === el.dataset.id ? null : el.dataset.id;
    $('#tbProd').innerHTML = linhasProdutos();
  },

  addLojaCfg: () => {
    $('#lojasCfg').insertAdjacentHTML('beforeend', linhaLojaCfg({ id: uid(), nome: '', cnpj: '', endereco: '' }));
    $('#lojasCfg tr:last-child input').focus();
  },
  removerLojaCfg: el => {
    if ($('#lojasCfg').children.length <= 1) return avisar('É preciso ter pelo menos uma loja.');
    el.closest('tr').remove();
    toast('Loja removida. Clique em "Salvar configurações" para confirmar.');
  },
  esquecerMarca: el => {
    const mapa = el.dataset.tipo === 'eq' ? 'marcasEquivalentes' : 'marcasDiferentes';
    const m = { ...(db.config[mapa] || {}) };
    m[el.dataset.op] = (m[el.dataset.op] || []).filter(x => x !== el.dataset.r);
    if (!m[el.dataset.op].length) delete m[el.dataset.op];
    db.config[mapa] = m;
    salvar();
    render();
  },

  editarDuvida: el => { ui.editDuvida = el.dataset.id; render(); window.scrollTo(0, 0); },
  cancelarDuvida: () => { ui.editDuvida = null; render(); },
  filtroDuvForn: el => { ui.duvForn = el.dataset.forn || null; render(); },
  alternarDuvFinal: () => { ui.verDuvFinal = !ui.verDuvFinal; render(); },
  removerDuvida: el => {
    const ids = new Set(el.dataset.id.split(','));
    db.duvidas = db.duvidas.filter(x => !ids.has(x.id));
    if (ids.has(ui.editDuvida)) ui.editDuvida = null;
    salvar();
    render();
  },
  limparDuvidas: async () => {
    // só o que está na tela: com um fornecedor escolhido, só as dúvidas dele
    const alvo = duvidasFiltradas();
    if (!alvo.length) return;
    const itens = gruposDuvidas(alvo).length;
    const de = ui.duvForn ? ` de ${ui.duvForn}` : '';
    if (!(await confirmar(`Remover os ${itens} item(ns) em dúvida${de}?${ui.duvForn ? '\n\nAs dúvidas dos outros fornecedores continuam na fila.' : ''}`, 'Remover'))) return;
    const ids = new Set(alvo.map(x => x.id));
    db.duvidas = db.duvidas.filter(x => !ids.has(x.id));
    ui.editDuvida = null;
    toast(`${itens} item(ns) em dúvida${de} removido(s).`);
    salvar();
    render();
  },
  copiarDuvidas: el => copiar(textoDuvidas(), el).then(() => toast('Texto copiado para colar no WhatsApp.')),
  duvidaItem: async el => {
    const c = cotAtual();
    const n = await duvidasDoItem(c, +el.dataset.i, el.dataset.f != null ? +el.dataset.f : null);
    if (!n) return avisar('Este item ainda não tem preço.');
    if (n < 0) return; // cancelou
    render();
    toast(`${n} item(ns) em Dúvidas (${db.duvidas.length} na fila).`);
  },

  editarProd: el => { ui.editProd = el.dataset.id; render(); window.scrollTo(0, 0); },
  cancelarProd: () => { ui.editProd = null; render(); },
  excluirProd: async el => {
    const p = db.produtos.find(x => x.id === el.dataset.id);
    if (!(await confirmar(`Excluir o produto "${p.descricao}"? (As cotações antigas não são alteradas.)`))) return;
    db.produtos = db.produtos.filter(x => x.id !== p.id);
    salvar();
    render();
  },
  exportarProdutos: () => exportarProdutos(),
  excluirSemMarca: async () => {
    const lista = produtosSemMarca();
    if (!lista.length) return;
    const amostra = lista.slice(0, 15).map(p => `${p.codigo || '—'} · ${p.descricao}`).join('\n');
    const ok = await abrirDialogo(`Excluir do banco ${lista.length} produto(s) sem marca exigida?\n\n${amostra}${lista.length > 15 ? `\n… e mais ${lista.length - 15}` : ''}\n\nNão dá para desfazer (as cotações antigas não mudam). Se quiser guardar, baixe um backup antes em Configurações.`,
      [{ txt: 'Cancelar', valor: false }, { txt: `Excluir ${lista.length} produto(s)`, valor: true, cls: 'danger' }]);
    if (!ok) return;
    const ids = new Set(lista.map(p => p.id));
    db.produtos = db.produtos.filter(p => !ids.has(p.id));
    if (db.rascunho?.itens) db.rascunho.itens = db.rascunho.itens.filter(x => !ids.has(x.produtoId));
    salvar();
    render();
    toast(`${lista.length} produto(s) sem marca exigida excluído(s) do banco.`);
  },

  editarForn: el => { ui.editForn = el.dataset.id; render(); window.scrollTo(0, 0); },
  cancelarForn: () => { ui.editForn = null; render(); },
  excluirForn: async el => {
    const f = db.fornecedores.find(x => x.id === el.dataset.id);
    if (!(await confirmar(`Excluir o fornecedor "${f.nome}"? (As cotações antigas não são alteradas.)`))) return;
    db.fornecedores = db.fornecedores.filter(x => x.id !== f.id);
    salvar();
    render();
  },

  backup: () => fazerBackup(),
  backupNuvemAgora: async el => {
    el.disabled = true;
    const { error } = await nuvem.supabase.rpc('cotacao_backup_agora', { p_motivo: 'manual' });
    el.disabled = false;
    if (error) return avisar('Não consegui fazer a cópia: ' + error.message);
    await carregarBackupsNuvem();
    render();
    toast('Cópia feita no Supabase.');
  },
  baixarBackupNuvem: async el => {
    try {
      const b = ui.backupsNuvem?.lista?.find(x => String(x.id) === el.dataset.id);
      const estado = estadoDeBackup(await lerBackupNuvem(el.dataset.id));
      const quando = b ? new Date(b.criado_em) : new Date();
      const nome = `backup_cotacoes_${quando.getFullYear()}-${pad(quando.getMonth() + 1)}-${pad(quando.getDate())}_${pad(quando.getHours())}h${pad(quando.getMinutes())}.json`;
      await salvarComo(nome, async () => new Blob([JSON.stringify(estado, null, 2)], { type: 'application/json' }),
        { description: 'Backup do sistema', accept: { 'application/json': ['.json'] } });
    } catch (e) {
      avisar('Não consegui baixar a cópia: ' + e.message);
    }
  },
  restaurarBackupNuvem: async el => {
    const b = ui.backupsNuvem?.lista?.find(x => String(x.id) === el.dataset.id);
    const quando = b ? new Date(b.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    let estado;
    try {
      estado = estadoDeBackup(await lerBackupNuvem(el.dataset.id));
    } catch (e) {
      return avisar('Não consegui ler a cópia: ' + e.message);
    }
    if (!(await confirmar(`Voltar os dados para a cópia de ${quando}?\n\n${estado.produtos.length.toLocaleString('pt-BR')} produtos, ${estado.fornecedores.length} fornecedores, ${estado.cotacoes.length} cotações.\n\nTudo o que foi feito depois disso será substituído, em todos os computadores. Antes, o sistema guarda uma cópia do estado atual (dá para desfazer).`, 'Restaurar esta cópia'))) return;
    // cópia de segurança do estado atual antes de voltar
    if (nuvem.timer || nuvem.gravando) await sincronizar();
    const { error } = await nuvem.supabase.rpc('cotacao_backup_agora', { p_motivo: 'antes de restaurar' });
    if (error) return avisar('Não consegui guardar o estado atual antes de restaurar, então não restaurei nada: ' + error.message);
    db = estado;
    cacheBusca = null;
    versaoDados++;
    salvar();
    await sincronizar();
    await carregarBackupsNuvem();
    render();
    toast(`Dados restaurados para ${quando}. O estado anterior ficou guardado nas cópias ("antes de restaurar").`, 7000);
  },
  sairSupabase: () => sairSupabase(),
  abrirBusca: () => abrirBusca(),
  ordemItens: el => {
    ui.ordemItens = el.dataset.ordem || 'desc';
    ui.cursorItem = 0;
    render();
  },
  tipoItens: el => {
    ui.tipoItens = el.dataset.tipo || '';
    const t = document.getElementById('tiposItens');
    if (t) t.innerHTML = htmlTiposItens(contextoNova());
    aplicarFiltroItens();
  },
  alternarCompacto: () => {
    try { localStorage.setItem(CHAVE_COMPACTO, modoCompacto() ? '0' : '1'); } catch (e) { /* sem acesso */ }
    render();
    toast(modoCompacto() ? 'Modo compacto: só o preço escolhido, o 2º lugar e as quantidades. Clique no 2º lugar para trocar.' : 'Modo completo: todas as colunas de fornecedores.');
  },
  marcarConcluida: el => {
    const c = cotAtual();
    const f = c?.fornecedores[+el.dataset.f];
    if (!f) return;
    f.concluidoEm = new Date().toISOString();
    salvar();
    render();
    toast(`Cotação de ${f.nome} marcada como concluída.`);
  },
  abrirTemas: () => abrirTemas(),
  escolherTema: el => aplicarTema(el.dataset.tema),
  analiseForn: el => abrirAnaliseFornecedor(el.dataset.id),
  abaConfig: el => {
    // troca de aba sem redesenhar: o que foi digitado e ainda não foi salvo continua nos campos
    const aba = el.dataset.aba;
    ui.abaConfig = aba;
    try { localStorage.setItem('cotacao.abaConfig', aba); } catch (e) { /* sem acesso */ }
    document.querySelectorAll('[data-aba-cfg]').forEach(x => { x.hidden = x.dataset.abaCfg !== aba; });
    document.querySelectorAll('.aba-cfg').forEach(b => { const on = b.dataset.aba === aba; b.classList.toggle('ativa', on); b.setAttribute('aria-selected', String(on)); });
    const barra = document.querySelector('.barra-salvar-cfg');
    if (barra) barra.hidden = !['loja', 'emails', 'marcas'].includes(aba);
    window.scrollTo(0, 0);
  },
  exportarRelatorio: () => exportarRelatorio(),
  irSecaoRel: el => document.getElementById(el.dataset.alvo)?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
  ordemRelForn: el => {
    const campo = el.dataset.campo;
    const o = ui.ordemRelForn;
    // 1º clique: maior primeiro (nome: A→Z); 2º: inverte; 3º: volta à ordem padrão
    if (!o || o.campo !== campo) ui.ordemRelForn = { campo, dir: campo === 'nome' ? 1 : -1 };
    else if (o.dir === (campo === 'nome' ? 1 : -1)) ui.ordemRelForn = { campo, dir: -o.dir };
    else ui.ordemRelForn = null;
    render();
  },
  renumerarCot: async () => {
    const c = cotAtual();
    if (!c) return;
    const novo = String(proximoNumeroCot()).padStart(4, '0');
    if (!(await confirmar(`Trocar o número desta cotação (${c.titulo || 'sem título'}, de ${fmtData(c.data)}) de nº ${c.numero} para nº ${novo}?\n\nAs respostas dos fornecedores continuam sendo reconhecidas normalmente. Só as planilhas já enviadas mostram o número antigo.`, `Trocar para nº ${novo}`))) return;
    c.numero = novo;
    db.config.proxNumero = Number(novo) + 1;
    salvar();
    render();
    toast(`Agora é a cotação nº ${novo}.`);
  },
  mudarStatusCot: async el => {
    const c = cotAtual();
    const novo = el.dataset.status;
    if (!c || !STATUS[novo] || c.status === novo) return;
    // tirar do "finalizada" libera a edição: só administrador
    if (c.status === 'finalizada' && !ehAdmin()) return avisar('Só um administrador pode reabrir ou cancelar uma cotação finalizada.');
    let msg;
    if (novo === 'finalizada') {
      const pend = pedidosPorFornecedor(c).filter(p => !p.f.concluidoEm);
      msg = pend.length
        ? `Ainda falta exportar ${pend.length === 1 ? 'o pedido de' : `${pend.length} pedidos:`} ${pend.map(p => p.f.nome).join(', ')}.\n\nFinalizar a cotação nº ${c.numero} mesmo assim? Ela fica só para consulta e sai das pendências.`
        : `Finalizar a cotação nº ${c.numero}?\n\nEla fica só para consulta (sem mudanças por acidente) e sai das pendências.`;
    } else if (novo === 'cancelada') {
      msg = `Cancelar a cotação nº ${c.numero}?\n\nEla sai das pendências e dos relatórios.`;
    } else {
      msg = `Reabrir a cotação nº ${c.numero}?\n\nEla volta a poder ser editada e a aparecer nas pendências.`;
    }
    if (!(await confirmar(msg, novo === 'finalizada' ? 'Finalizar' : novo === 'cancelada' ? 'Cancelar a cotação' : 'Reabrir'))) return;
    c.status = novo;
    ui.destravadas?.delete(c.id);
    salvar();
    render();
    toast(`Cotação nº ${c.numero}: ${STATUS[novo][0].toLowerCase()}.`);
  },
  destravarCot: el => {
    const c = cotAtual();
    if (!c) return;
    if (!ehAdmin()) return avisar('Só um administrador pode editar uma cotação finalizada.');
    ui.destravadas = new Set([...(ui.destravadas || []), c.id]);
    render();
    toast('🔓 Edição liberada nesta tela. A cotação continua finalizada.');
  },
  travarCot: () => {
    const c = cotAtual();
    if (!c) return;
    ui.destravadas?.delete(c.id);
    render();
  },
  filtrarFornComp: el => {
    // chip "falta exportar": mostra no comparativo só os itens desse fornecedor
    const c = cotAtual();
    if (!c) return;
    definirFiltroVencedor(c, el.dataset.id);
    $('.painel-comp')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },
  analiseCot: el => {
    ui.notaCot = el.dataset.id;
    ir('relatorios');
    document.getElementById('notaFornecedores')?.scrollIntoView({ block: 'start' });
  },
  irPendencias: () => document.getElementById('pendenciasInicio')?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
  continuarDeOndeParei: () => {
    const u = lerUltimoLugar();
    if (!u) return;
    if (u.rota === 'cotacao') {
      const c = db.cotacoes.find(x => x.id === u.id);
      if (!c) return;
      if (u.filtro) ui.filtroVenc = { cotId: c.id, valor: u.filtro };
      ir('cotacao', c.id);
      document.querySelector('.tab-comp')?.scrollIntoView({ block: 'start' });
      const primeiro = [...document.querySelectorAll('.tab-comp tbody tr[data-comp-linha]:not([hidden])')]
        .find(tr => [...tr.querySelectorAll('input[data-qtd-loja]')].every(x => x.value === ''));
      if (primeiro) { marcarLinhaComp(primeiro); primeiro.scrollIntoView({ block: 'center' }); primeiro.querySelector('input[data-qtd-loja]')?.focus({ preventScroll: true }); }
    } else ir(u.rota);
  },
  irCotParte: el => {
    const c = db.cotacoes.find(x => x.id === el.dataset.id);
    if (!c) return;
    const parte = el.dataset.parte;
    if (parte === 'fornecedores') { try { localStorage.setItem(CHAVE_FORN_ABERTO, '1'); } catch (e) { ui.fornAberto = true; } }
    ir('cotacao', c.id);
    const alvo = parte === 'fornecedores' ? document.querySelector('.corpo-recolhe')?.closest('section')
      : parte === 'pedidos' ? document.getElementById('secPedidos') : document.querySelector('.tab-comp');
    alvo?.scrollIntoView({ block: 'start' });
    if (parte === 'comparativo') {
      const sem = [...document.querySelectorAll('.tab-comp tbody tr[data-comp-linha]:not([hidden])')]
        .find(tr => tr.querySelector('input[data-qtd-loja]') && [...tr.querySelectorAll('input[data-qtd-loja]')].every(x => x.value === ''));
      if (sem) { marcarLinhaComp(sem); sem.scrollIntoView({ block: 'center' }); sem.querySelector('input[data-qtd-loja]')?.focus({ preventScroll: true }); }
    }
  },
  filtroStatusCot: el => {
    ui.statusCot = el.dataset.status || '';
    render();
  },
  cobrarCot: el => {
    ir('cotacao', el.dataset.id);
    acoes.cobrarPendentes();
  },
  abrirAtalhos: () => abrirAtalhos(),
  editarTituloCot: async el => {
    const c = db.cotacoes.find(x => x.id === el.dataset.id);
    if (!c) return;
    const novo = await pedirValor(`Título da cotação nº ${c.numero}:`, { valor: c.titulo || '', ok: 'Salvar título' });
    if (novo == null) return;
    const titulo = novo.trim();
    if (titulo === (c.titulo || '')) return;
    c.titulo = titulo;
    salvar();
    render();
    toast(titulo ? `Título da cotação nº ${c.numero}: ${titulo}` : `Cotação nº ${c.numero} ficou sem título.`);
  },
  atualizarSistema: () => atualizarSistema(),
  abrirPip: () => abrirPip(),
  senhaUsuario: async el => {
    const email = el.dataset.email;
    const senha = await pedirValor(`Nova senha para ${email} (mínimo 6 caracteres). Passe a senha para a pessoa; ela pode trocar depois.`, { ok: 'Trocar a senha' });
    if (senha == null) return;
    if (senha.length < 6) return avisar('A senha precisa ter pelo menos 6 caracteres.');
    const { error } = await nuvem.supabase.rpc('cotacao_definir_senha', { p_email: email, p_senha: senha });
    if (error) return avisar('Não consegui trocar a senha: ' + msgErroSb(error));
    toast(`Senha de ${email} trocada.`);
  },
  alternarAdmin: async el => {
    const email = el.dataset.email;
    const vira = el.dataset.admin === '1';
    const msg = vira
      ? `Tornar ${email} administrador?\n\nA pessoa vai poder cadastrar e tirar usuários, trocar senhas, ver os Relatórios, editar cotações finalizadas e restaurar backups.`
      : `Tirar de ${email} o acesso de administrador?\n\nA pessoa continua usando o sistema normalmente, sem as funções de administrador.`;
    if (!(await confirmar(msg, vira ? 'Tornar administrador' : 'Tirar administrador'))) return;
    const { error } = await nuvem.supabase.rpc('cotacao_definir_admin', { p_email: email, p_admin: vira });
    if (error) {
      if (/cotacao_definir_admin|function|PGRST202/i.test(String(error.message || error.code))) return avisar('Falta ativar esta função no banco (Supabase): rode o arquivo cotacao-supabase/admin.sql no SQL Editor.');
      return avisar('Não consegui mudar: ' + msgErroSb(error));
    }
    await carregarUsuarios();
    render();
    toast(vira ? `${email} agora é administrador.` : `${email} não é mais administrador.`);
  },
  removerUsuario: async el => {
    const email = el.dataset.email;
    if (!(await confirmar(`Tirar o acesso de ${email}?\n\nA pessoa não consegue mais entrar no sistema. Dá para liberar de novo depois, adicionando o e-mail outra vez.`, 'Tirar acesso'))) return;
    const { error } = await nuvem.supabase.rpc('cotacao_remover_usuario', { p_email: email });
    if (error) return avisar('Não consegui tirar o acesso: ' + msgErroSb(error));
    await carregarUsuarios();
    render();
    toast(`${email} não tem mais acesso.`);
  },
  adiarBackup: () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    db.backupAdiadoAte = d.toISOString().slice(0, 10);
    salvar();
    render();
  },
  arquivarCot: () => {
    const c = cotAtual();
    if (c.arquivada) { delete c.arquivada; c.manterNaLista = true; toast(`Cotação nº ${c.numero} voltou para a lista.`); }
    else { c.arquivada = new Date().toISOString(); delete c.manterNaLista; toast(`Cotação nº ${c.numero} arquivada. Ela continua no histórico e nos relatórios.`); }
    salvar();
    render();
  },
  arquivarSugeridas: async () => {
    const lista = paraArquivar();
    if (!lista.length) return;
    if (!(await confirmar(`Arquivar ${lista.length} cotação(ões)?\n${lista.map(c => `nº ${c.numero} (${STATUS[c.status]?.[0] || c.status})`).join(', ')}\n\nElas saem da lista, mas continuam no histórico de preços e nos relatórios. Dá para ver e desarquivar quando quiser.`, 'Arquivar'))) return;
    const agora = new Date().toISOString();
    for (const c of lista) c.arquivada = agora;
    salvar();
    render();
    toast(`${lista.length} cotação(ões) arquivada(s).`);
  },

  apagarTudo: async () => {
    if (!(await confirmar('Apagar TODOS os produtos, fornecedores e cotações?', 'Apagar'))) return;
    if (!(await confirmar('Tem certeza mesmo? Todos os dados serão apagados para sempre.', 'Apagar tudo'))) return;
    db = structuredClone(DEFAULT_DB);
    salvar();
    render();
    toast('Todos os dados foram apagados.');
  },
};

const formularios = {
  fornecedorRapido: form => {
    const d = formDados(form);
    if (!d.nome) return;
    const f = { id: uid(), nome: d.nome, email: d.email, contato: d.contato, telefone: '', obs: '' };
    db.fornecedores.push(f);
    rascunho().fornecedorIds.push(f.id);
    salvar();
    render();
    toast('Fornecedor cadastrado e selecionado.');
  },

  trocarMarca: async form => {
    const d = formDados(form);
    const de = d.de, para = (d.para || '').toUpperCase();
    if (!de || !para) return;
    const troca = trocadorDeMarca(de, para);
    const afetados = db.produtos.filter(p => troca(p.marca) !== p.marca);
    if (!afetados.length) return avisar(`Nenhum produto com a marca "${de}".`);
    const ex = afetados.slice(0, 8).map(p => `${p.codigo || '—'}: ${p.marca} → ${troca(p.marca)}`).join('\n');
    if (!(await confirmar(`Trocar "${de}" por "${para}" em ${afetados.length} produto(s)?\n\n${ex}${afetados.length > 8 ? `\n… e mais ${afetados.length - 8}` : ''}`, 'Trocar'))) return;
    for (const p of afetados) p.marca = troca(p.marca);
    for (const x of db.rascunho?.itens || []) if (x.marca) x.marca = troca(x.marca);
    salvar();
    render();
    toast(`Marca "${de}" trocada por "${para}" em ${afetados.length} produto(s).`);
  },

  produto: async form => {
    const d = formDados(form);
    if (!d.descricao) return;
    if (!d.marca) return avisar('Informe a marca exigida (ex.: QUALQUER, SÓ COFAP). Produto sem marca exigida não entra no banco.');
    d.unidade = (d.unidade || 'UN').toUpperCase();
    const dup = d.codigo && db.produtos.find(p => p.id !== ui.editProd && semAcento(p.codigo) === semAcento(d.codigo));
    if (dup && !(await confirmar(`O código ${d.codigo} já é usado por "${dup.descricao}". Salvar mesmo assim?`))) return;
    if (ui.editProd) {
      Object.assign(db.produtos.find(p => p.id === ui.editProd), d);
      ui.editProd = null;
      toast('Produto atualizado.');
    } else {
      db.produtos.push({ id: uid(), ...d, criadoEm: new Date().toISOString() });
      toast('Produto adicionado.');
    }
    salvar();
    render();
    form.ownerDocument.querySelector('[data-form=produto] input[name=codigo]')?.focus();
  },

  minhaSenha: async form => {
    const d = formDados(form);
    if ((d.senha || '').length < 6) return avisar('A senha precisa ter pelo menos 6 caracteres.');
    if (d.senha !== d.senha2) return avisar('As duas senhas não são iguais.');
    const { error } = await nuvem.supabase.auth.updateUser({ password: d.senha });
    if (error) return avisar('Não consegui trocar a senha: ' + msgErroSb(error));
    form.reset();
    form.closest('details').open = false;
    toast('Senha trocada. Use a nova senha no próximo login.');
  },
  usuario: async form => {
    const d = formDados(form);
    const email = String(d.email || '').trim().toLowerCase();
    if (!email || (d.senha || '').length < 6) return avisar('Informe o e-mail e uma senha com pelo menos 6 caracteres.');
    const botao = form.querySelector('button.primary');
    botao.disabled = true;
    const { error } = await nuvem.supabase.rpc('cotacao_adicionar_usuario', { p_email: email, p_senha: d.senha, p_nome: d.nome || null, p_admin: !!form.admin.checked });
    botao.disabled = false;
    if (error) return avisar('Não consegui adicionar: ' + msgErroSb(error));
    await carregarUsuarios();
    render();
    avisar(`✓ ${email} pode usar o sistema.\n\nPasse para a pessoa:\n• endereço: ${location.origin}\n• e-mail: ${email}\n• senha: a que você definiu\n\nEla pode trocar a senha em Configurações → Conta.`);
  },
  duvida: form => {
    const d = formDados(form);
    if (!d.codigo) return avisar('Informe empresa e código do produto.');
    const comum = { codigo: d.codigo.toUpperCase(), valor: parseNum(d.valor) || 0, marca: (d.marca || '').toUpperCase(), obs: d.obs || '' };
    const grupo = ui.editDuvida ? gruposDuvidas().find(g => g.some(x => x.id === ui.editDuvida)) : null;
    if (grupo) {
      // editar a linha inteira: dados comuns + a quantidade de cada loja (vazio ou 0 tira a loja)
      const ids = new Set(grupo.map(x => x.id));
      const novas = [];
      for (const e of empresasDuvida()) {
        const q = parseInt(d['qtd_' + e], 10) || 0;
        if (q <= 0) continue;
        const atual = grupo.find(x => x.empresa === e);
        novas.push({ ...(atual || { id: uid(), origem: grupo[0].origem }), ...comum, empresa: e, qtd: q });
      }
      const pos = db.duvidas.findIndex(x => ids.has(x.id));
      const resto = db.duvidas.filter(x => !ids.has(x.id));
      resto.splice(pos, 0, ...novas);
      db.duvidas = resto;
      ui.editDuvida = null;
      toast(novas.length ? 'Item duvidoso atualizado.' : 'Item tirado das dúvidas (nenhuma loja com quantidade).');
    } else {
      const item = { empresa: d.empresa || 'N/A', qtd: Math.max(1, parseInt(d.qtd, 10) || 1), ...comum };
      ui.ultimaEmpresa = item.empresa;
      db.duvidas = [...db.duvidas, { id: uid(), ...item }];
      toast('Item duvidoso adicionado.');
    }
    salvar();
    render();
    form.ownerDocument.querySelector('[data-form=duvida] [name=codigo]')?.focus();
  },

  fornecedor: form => {
    const d = formDados(form);
    if (!d.nome) return;
    for (const k of ['pedidoMinimo', 'frete', 'freteGratisAcima']) d[k] = Math.max(0, parseNum(d[k]) || 0);
    if (ui.editForn) {
      Object.assign(db.fornecedores.find(f => f.id === ui.editForn), d);
      ui.editForn = null;
      toast('Fornecedor atualizado.');
    } else {
      db.fornecedores.push({ id: uid(), ...d });
      toast('Fornecedor adicionado.');
    }
    salvar();
    render();
  },

  precosManuais: form => {
    const c = cotAtual();
    const fi = +form.dataset.f;
    const f = c.fornecedores[fi];
    const d = formDados(form);
    const respostas = {};
    c.itens.forEach((_, i) => {
      const preco = parseNum(d[`p_${i}`]);
      const prazo = d[`z_${i}`] || '';
      const obs = d[`o_${i}`] || '';
      const marca = (d[`m_${i}`] ?? '').trim();
      // 0,00 ou vazio: sem resposta; o resto do que já havia (estoque…) continua
      if (preco != null && preco > 0) {
        const ant = f.respostas?.[i] || {};
        const r = { ...ant, preco, prazo, obs };
        if (marca !== (ant.marca || '')) { r.marca = marca; delete r.marcaOriginal; delete r.estoque; } // marca trocada aqui: vale a digitada
        respostas[i] = r;
      }
    });
    // preço corrigido (já tinha outro valor): a diferença do item fica aceita com o valor novo
    const antes = f.respostas || {};
    f.respostas = respostas;
    c.itens.forEach((_, i) => {
      const velho = antes[i]?.preco;
      if (velho > 0 && Math.round(velho * 100) !== Math.round((respostas[i]?.preco || 0) * 100)) aceitarDifCorrigida(c, i);
    });
    f.cond = Object.fromEntries(COND_CAMPOS.map(([k]) => [k, d[`c_${k}`] || '']));
    f.respondidoEm = Object.keys(respostas).length ? f.respondidoEm || new Date().toISOString() : null;
    ajustarKaizen(c); // Kaizen: "NGK/685" = marca NGK e estoque 685
    ui.digitando = null;
    salvar();
    render();
    toast(`Preços de ${f.nome} salvos.`);
  },

  equivMarca: form => {
    const d = formDados(form);
    const op = normMarca(d.marca);
    const abrevs = String(d.abrevs || '').split(/[,;]/).map(normMarca).filter(Boolean);
    if (!op || !abrevs.length) return;
    for (const r of abrevs) aprenderMarca(op, r, 'igual');
    salvar();
    render();
    toast(`${abrevs.length} abreviação(ões) de ${op} salvas.`);
  },

  config: form => {
    ui.cfgSujo = false;
    const d = formDados(form);
    for (const k of Object.keys(d)) if (k.startsWith('lj_')) delete d[k];
    const novasLojas = [...form.querySelectorAll('.loja-cfg')].map(tr => ({
      id: tr.dataset.id,
      nome: tr.querySelector('[data-c=nome]').value.trim(),
      sigla: tr.querySelector('[data-c=sigla]').value.trim().toUpperCase(),
      cnpj: tr.querySelector('[data-c=cnpj]').value.trim(),
      endereco: tr.querySelector('[data-c=endereco]').value.trim(),
    })).filter(l => l.nome);
    if (!novasLojas.length) return avisar('Cadastre pelo menos uma loja.');
    d.lojas = novasLojas;
    d.marcaErradaNaoGanha = form.marcaErradaNaoGanha.checked;
    Object.assign(db.config, d, {
      proxNumero: Math.max(1, parseInt(d.proxNumero, 10) || 1),
      diasAviso: Math.max(0, Math.min(30, parseInt(d.diasAviso, 10) || 0)),
      protegerPlanilha: form.protegerPlanilha.checked,
    });
    salvar();
    render();
    toast('Configurações salvas.');
  },
};

/** Dica de uma célula de preço do comparativo (montada quando o mouse para em cima). */
function dicaPrecoComp(c, l, j) {
  const p = l.precos[j];
  if (p == null) return '';
  const o = c.fornecedores[j].respostas?.[l.i];
  const venc = j === l.vencedor && (c.fornecedores.length > 1 || l.manual);
  const pelaRegra = j === l.vencedor && l.preferencia;
  const dica = pelaRegra ? `Regra da Comando: ganha estando ${fmtPct(l.preco / l.min - 1)} acima do menor preço (${fmtMoeda(l.min)}). Clique no preço do mais barato para escolher ele.`
    : l.recusas[j] ? (j === l.vencedor ? 'Marca recusada, mas é o único preço: está sendo comprado (a marca não é a pedida). Clique na marca para desfazer a recusa.' : 'Marca recusada: este preço não entra. Clique na marca para desfazer.')
    : venc ? (l.manual ? 'Escolhido por você. Clique para voltar ao menor preço.' : 'Menor preço (vencedor).')
    : (p === l.min ? 'Menor preço. ' : '') + 'Clique para escolher este fornecedor para este item.';
  const extra = [o?.prazo, o?.obs].filter(Boolean).join(' · ');
  return [dica, extra].filter(Boolean).join('\n');
}
/** Botão ✕ (remover ou corrigir o preço): criado quando o mouse chega na célula (3 mil botões a menos por tela). */
function botaoRmPreco(td) {
  if (td.querySelector('.rm-preco')) return;
  const [i, j] = td.dataset.dica.split(':');
  td.insertAdjacentHTML('afterbegin', `<button type="button" class="rm-preco" data-act="removerPreco" data-i="${i}" data-f="${j}" title="Preço errado? Remover ou corrigir" aria-label="Remover ou corrigir este preço"></button>`);
}
document.addEventListener('mouseover', e => {
  const alvo = e.target.closest?.('[data-dica]');
  if (!alvo) return;
  botaoRmPreco(alvo);
  if (alvo.title) return;
  const c = cotAtual();
  const [i, j] = alvo.dataset.dica.split(':').map(Number);
  const l = c && comparar(c).linhas[i];
  if (l) alvo.title = dicaPrecoComp(c, l, j);
});

/* ---------------- temas (cada computador escolhe o seu) ---------------- */

const TEMAS = [
  ['auto', 'Automático', 'Segue o Windows: claro de dia, escuro se o Windows estiver no modo escuro', ['#ffffff', '#f4f6fa', '#ffffff', '#253d83']],
  ['claro', 'Claro', 'O padrão, com o azul da DISPPAR', ['#ffffff', '#f4f6fa', '#ffffff', '#253d83']],
  ['suave', 'Suave', 'Claro em tons quentes, cansa menos a vista', ['#fffdf9', '#f4f1eb', '#fffdf9', '#2e4a7d']],
  ['escuro', 'Escuro', 'Fundo azul-escuro, bom para pouca luz', ['#151c30', '#0d1222', '#1a2238', '#7b95e3']],
  ['grafite', 'Grafite', 'Escuro neutro, minimalista', ['#19191c', '#111113', '#212125', '#8ab4ff']],
];
const CHAVE_TEMA = 'cotacao.tema';
function temaAtual() {
  try { return localStorage.getItem(CHAVE_TEMA) || 'auto'; } catch (e) { return 'auto'; }
}
function aplicarTema(t) {
  if (!TEMAS.some(([k]) => k === t)) t = 'auto';
  try { localStorage.setItem(CHAVE_TEMA, t); } catch (e) { /* sem acesso */ }
  for (const d of [document, pip.win && !pip.win.closed ? pip.win.document : null].filter(Boolean)) {
    if (t === 'auto') delete d.documentElement.dataset.theme; else d.documentElement.dataset.theme = t;
  }
  document.querySelectorAll('.tema-opcao').forEach(b => b.classList.toggle('ativo', b.dataset.tema === t));
}
function htmlTemas() {
  const atual = temaAtual();
  return `<div class="temas">${TEMAS.map(([k, nome, desc, [bar, bg, card, pri]]) => `<button type="button" class="tema-opcao${k === atual ? ' ativo' : ''}" data-act="escolherTema" data-tema="${k}" aria-pressed="${k === atual}">
    <span class="tema-previa" style="--p-bar:${bar};--p-bg:${bg};--p-card:${card};--p-primary:${pri}">${k === 'auto' ? '<span></span><span style="background:linear-gradient(135deg,#f4f6fa 50%,#0d1222 50%)"><i></i><i></i></span>' : '<span></span><span><i></i><i></i></span>'}</span>
    <span class="tema-nome">${nome}</span><span class="tema-desc">${desc}</span>
  </button>`).join('')}</div>`;
}
function abrirTemas() {
  abrirDialogo('', [{ txt: 'Fechar', valor: null, cls: 'primary' }]);
  const dlg = [...document.querySelectorAll('.dlg')].at(-1);
  dlg.classList.add('dlg-temas');
  dlg.querySelector('p').outerHTML = `<h3 style="margin:0 0 4px">🎨 Tema</h3><p class="small muted" style="margin:0 0 12px">Vale só para este computador: cada pessoa escolhe o seu.</p>${htmlTemas()}`;
  // a janela não repassa os cliques para o resto do sistema: escolhe o tema aqui mesmo
  dlg.addEventListener('click', e => { const b = e.target.closest('.tema-opcao'); if (b) aplicarTema(b.dataset.tema); });
}

/* ---------------- busca rápida (Ctrl+K) e atalhos (?) ---------------- */

const TELAS_BUSCA = [['inicio', 'Início'], ['nova', 'Nova cotação'], ['cotacoes', 'Cotações'], ['produtos', 'Produtos'], ['fornecedores', 'Fornecedores'], ['duvidas', 'Dúvidas'], ['relatorios', 'Relatórios'], ['config', 'Configurações']];

/** Resultados da busca rápida, em grupos. Cada um: { grupo, titulo, detalhe, ir() }. */
function resultadosBusca(texto) {
  const q = semAcento(texto);
  const tem = v => semAcento(v).includes(q);
  const out = [];
  const add = (grupo, titulo, detalhe, ir) => out.push({ grupo, titulo, detalhe, ir });
  // itens da cotação aberta (ou da nova cotação em montagem)
  const { nome, id } = rota();
  const c = nome === 'cotacao' ? db.cotacoes.find(x => x.id === id) : null;
  if (q && c) {
    const achados = c.itens.map((it, i) => [it, i]).filter(([it]) => tem(`${it.codigo} ${it.descricao} ${it.marca}`));
    achados.sort((a, b) => (semAcento(a[0].codigo).startsWith(q) ? 0 : 1) - (semAcento(b[0].codigo).startsWith(q) ? 0 : 1));
    for (const [it, i] of achados.slice(0, 8)) add(`Itens desta cotação (nº ${c.numero})`, `#${i + 1} ${it.codigo || '—'}`, `${it.descricao || ''}${it.marca ? ' · ' + it.marca : ''}`, () => irParaItemCot(c, i));
  }
  if (q && nome === 'nova') {
    const r = rascunho();
    const prod = byId(db.produtos);
    const achados = r.itens.map((x, i) => [x, i, prod[x.produtoId]]).filter(([x, , p]) => p && tem(`${x.codigoArquivo || p.codigo} ${p.descricao} ${x.marca || p.marca}`));
    for (const [x, i, p] of achados.slice(0, 8)) add('Itens da nova cotação', `#${i + 1} ${x.codigoArquivo || p.codigo || '—'}`, `${p.descricao || ''}${x.marca || p.marca ? ' · ' + (x.marca || p.marca) : ''}`, () => irParaItemNova(i));
  }
  // cotações
  const cots = [...db.cotacoes].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  for (const x of cots.filter(x => !q || tem(`${x.numero} ${x.titulo} ${fmtData(x.data)}`)).slice(0, q ? 6 : 4)) {
    add('Cotações', `Cotação nº ${x.numero}`, `${x.titulo || 'sem título'} · ${fmtData(x.data)} · ${x.itens.length} itens`, () => ir('cotacao', x.id));
  }
  if (q) {
    // fornecedores
    for (const f of db.fornecedores.filter(f => tem(`${f.nome} ${f.contato || ''} ${f.email || ''}`)).slice(0, 5)) {
      add('Fornecedores', f.nome, [f.contato, f.email].filter(Boolean).join(' · '), () => { ui.filtroForn = f.nome; ir('fornecedores'); });
    }
    // produtos do cadastro (código primeiro)
    const prods = [];
    for (const p of db.produtos) {
      if (prods.length >= 60) break;
      if (tem(`${p.codigo} ${p.similar || ''} ${p.descricao} ${p.marca}`)) prods.push(p);
    }
    prods.sort((a, b) => (semAcento(a.codigo).startsWith(q) ? 0 : 1) - (semAcento(b.codigo).startsWith(q) ? 0 : 1));
    for (const p of prods.slice(0, 8)) add('Produtos do cadastro', p.codigo || '—', `${p.descricao || ''}${p.marca ? ' · ' + p.marca : ''}`, () => { ui.filtroProd = p.codigo || p.descricao; ir('produtos'); });
  }
  // telas
  for (const [r, t] of TELAS_BUSCA.filter(([r2, t]) => (!q || tem(t)) && (r2 !== 'relatorios' || podeVerRelatorios()))) add('Telas', t, '', () => ir(r));
  return out;
}

/** Leva até o item i do comparativo (tira os filtros que o escondem) e marca a linha. */
function irParaItemCot(c, i) {
  if (rota().nome !== 'cotacao' || rota().id !== c.id) ir('cotacao', c.id);
  let tr = document.querySelector(`[data-comp-linha="${i}"]`);
  if (tr?.hidden) { ui.filtroVenc = null; ui.filtroAviso = null; render(); tr = document.querySelector(`[data-comp-linha="${i}"]`); }
  if (!tr) return;
  marcarLinhaComp(tr);
  tr.scrollIntoView({ block: 'center' });
  const campo = tr.querySelector('input[data-qtd-loja]');
  if (campo) campo.focus({ preventScroll: true });
}

function irParaItemNova(i) {
  if (rota().nome !== 'nova') ir('nova');
  if (ui.filtroItens) { ui.filtroItens = ''; render(); }
  moverCursorItem(i);
  document.querySelector(`[data-item-linha="${i}"]`)?.scrollIntoView({ block: 'center' });
}

function abrirBusca() {
  if (document.getElementById('buscaRapida')) return;
  const fundo = document.createElement('div');
  fundo.className = 'dlg-fundo busca-fundo';
  fundo.id = 'buscaRapida';
  fundo.innerHTML = `<div class="dlg busca-rapida" role="dialog" aria-modal="true" aria-label="Busca rápida">
    <input id="buscaCampo" autocomplete="off" spellcheck="false" placeholder="🔎 Buscar código, descrição, cotação, fornecedor ou tela…">
    <div class="busca-lista" id="buscaLista" role="listbox"></div>
    <div class="busca-rodape small muted"><kbd>↑</kbd><kbd>↓</kbd> escolher · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> fechar</div>
  </div>`;
  let lista = [];
  let sel = 0;
  const campo = fundo.querySelector('#buscaCampo');
  const caixa = fundo.querySelector('#buscaLista');
  const desenhar = () => {
    lista = resultadosBusca(campo.value);
    sel = Math.min(sel, Math.max(0, lista.length - 1));
    let grupo = '';
    caixa.innerHTML = lista.length ? lista.map((x, k) => {
      const cab = x.grupo !== grupo ? `<div class="busca-grupo">${esc(x.grupo)}</div>` : '';
      grupo = x.grupo;
      return `${cab}<button type="button" class="busca-item${k === sel ? ' ativo' : ''}" data-k="${k}" role="option" aria-selected="${k === sel}"><b>${esc(x.titulo)}</b>${x.detalhe ? `<span>${esc(x.detalhe)}</span>` : ''}</button>`;
    }).join('') : '<p class="muted small" style="padding:10px">Nada encontrado.</p>';
    caixa.querySelector('.busca-item.ativo')?.scrollIntoView({ block: 'nearest' });
  };
  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', tecla, true); };
  const abrir = k => { const x = lista[k]; if (!x) return; fechar(); x.ir(); };
  const tecla = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fechar(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + lista.length) % Math.max(1, lista.length); desenhar(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); abrir(sel); }
    else e.stopImmediatePropagation(); // as letras vão só para a busca
  };
  campo.addEventListener('input', () => { sel = 0; desenhar(); });
  fundo.addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('.busca-item');
    if (b) abrir(+b.dataset.k);
    else if (e.target === fundo) fechar();
  });
  document.addEventListener('keydown', tecla, true);
  document.body.appendChild(fundo);
  desenhar();
  campo.focus();
}

function abrirAtalhos() {
  if (document.querySelector('.dlg-atalhos')) return;
  const k = t => t.split('+').map(x => `<kbd>${esc(x)}</kbd>`).join('+');
  const grupo = (titulo, linhas) => `<section><h4>${titulo}</h4><dl>${linhas.map(([t, d]) => `<dt>${t.split(' / ').map(k).join(' <span class="muted">ou</span> ')}</dt><dd>${esc(d)}</dd>`).join('')}</dl></section>`;
  abrirDialogo('', [{ txt: 'Fechar', valor: null, cls: 'primary' }]);
  const dlg = [...document.querySelectorAll('.dlg')].at(-1);
  dlg.classList.add('dlg-atalhos');
  dlg.querySelector('p').outerHTML = `<h3 style="margin:0 0 10px">⌨ Atalhos do teclado</h3><div class="atalhos-grade">
    ${grupo('Em qualquer tela', [['Ctrl+K', 'Busca rápida: código, descrição, cotação, fornecedor ou tela'], ['?', 'Esta lista de atalhos'], ['Alt+Tab', 'Sair e voltar para o sistema: o cursor continua no mesmo campo']])}
    ${grupo('Nova cotação (lista de itens)', [['↑ / ↓', 'Anda pelos itens (mesmo com o cursor fora da lista)'], ['Home / End', 'Primeiro / último item'], ['qualquer letra', 'Começa a preencher a marca do item'], ['Enter', 'Salva a marca só nesta cotação e desce'], ['Enter+Enter', 'Enter duas vezes: grava a marca como padrão no cadastro'], ['F2', 'Editar a marca do item'], ['Backspace', 'Limpar a marca'], ['Esc', 'Desfaz a edição do campo'], ['Ctrl+Delete', 'Tirar o item da cotação']])}
    ${grupo('Comparativo (quantidades)', [['Enter / ↓', 'Mesma loja, próximo item'], ['↑', 'Item anterior'], ['← / →', 'Troca de loja na mesma linha'], ['Tab', 'Próxima loja; na última, o próximo item'], ['número', 'Fora dos campos: vai direto para a quantidade da linha marcada'], ['0', 'Não comprar nesta loja']])}
    ${grupo('Janela flutuante', [['Enter / ↓', 'Próximo item'], ['↑', 'Item anterior'], ['← / → / Tab', 'Troca de loja'], ['C', 'Copia o código (para colar no DataCar)'], ['D', 'Põe o item em Dúvida'], ['S / 2', 'Escolhe o 2º lugar (o 2 fora do campo de quantidade)'], ['/', 'Vai para um item pelo código']])}
    ${grupo('Janelas de confirmação', [['Enter', 'Confirma'], ['Esc', 'Cancela']])}
  </div>`;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && e.target.id === 'buscaComp' && e.target.value) {
    e.preventDefault();
    e.target.value = '';
    e.target.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (!document.querySelector('.dlg-fundo:not(#buscaRapida)')) abrirBusca();
    return;
  }
  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const t = e.target;
    if (t.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('.dlg-fundo')) return;
    e.preventDefault();
    abrirAtalhos();
  }
}, true);

/* ---------------- eventos (delegação) ---------------- */

/*
 * Clique que não se perde: ao sair de um campo (ex.: a marca), o sistema salva e redesenha a linha — se isso
 * acontece entre apertar e soltar o mouse num botão, o botão é trocado por um igual e o clique sumia
 * (era preciso clicar duas vezes). Aqui, se o botão apertado saiu da tela, o clique vai para o novo.
 */
let botaoApertado = null;
function seletorDoBotao(b) {
  const attrs = Object.entries(b.dataset).filter(([k]) => k !== 'vigiado');
  if (!attrs.length) return null; // sem como achar o substituto
  return b.tagName.toLowerCase() + (b.type === 'checkbox' || b.type === 'radio' ? `[type="${b.type}"]` : '')
    + attrs.map(([k, v]) => `[data-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}="${CSS.escape(v)}"]`).join('');
}
/** Botão, caixinha de marcar (ou a etiqueta em volta dela) apertados: se forem trocados no meio do clique, o clique vai para o novo. */
document.addEventListener('pointerdown', e => {
  let b = e.button === 0 ? e.target.closest?.('button[data-act], input[type=checkbox], input[type=radio]') : null;
  if (!b && e.button === 0) b = e.target.closest?.('label')?.querySelector('input[type=checkbox], input[type=radio]') || null;
  const sel = b && seletorDoBotao(b);
  botaoApertado = sel ? { b, sel } : null;
}, true);
document.addEventListener('pointerup', e => {
  const a = botaoApertado;
  botaoApertado = null;
  if (!a || a.b.isConnected) return; // o clique normal acontece
  const novo = document.querySelector(a.sel);
  const sob = document.elementFromPoint(e.clientX, e.clientY);
  if (novo && sob && (novo.contains(sob) || sob.closest('label')?.contains(novo))) setTimeout(() => novo.click(), 0);
}, true);

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !acoes[el.dataset.act]) return;
  e.preventDefault();
  if (ACOES_TRAVADAS.has(el.dataset.act) && el.closest('#app') && cotTravada(cotAtual())) { avisarTravada(); return; }
  Promise.resolve(acoes[el.dataset.act](el, e)).catch(err => {
    console.error(err);
    avisar('Ocorreu um erro: ' + err.message);
  });
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]');
  if (!form || !formularios[form.dataset.form]) return;
  e.preventDefault();
  formularios[form.dataset.form](form);
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.closest?.('.form-cfg')) ui.cfgSujo = true;
  if (ui.digitando && t.name && t.closest?.('#painelDigitar')) (ui.digitando.rasc ||= {})[t.name] = t.value;
  if (t.id === 'filtroItens') {
    ui.filtroItens = t.value;
    aplicarFiltroItens();
    return;
  }
  if (t.id === 'dcBusca' && ui.datacar) {
    ui.datacar.busca = t.value;
    ui.datacar.selG = new Set();
    desenharConferencia();
    return;
  }
  if (t.id === 'buscaComp') {
    const c = cotAtual();
    if (!c) return;
    ui.buscaComp = { cotId: c.id, q: t.value.trim() };
    aplicarFiltrosComp(c);
    return;
  }
  if (t.dataset.marcaItem != null) {
    if (e.inputType && e.inputType.startsWith('insert')) sugerirMarca(t); // apagando, não completa
    return;
  }
  if (t.id === 'duvidasCabecalho') {
    db.config.duvidasCabecalho = t.value;
    salvar();
    const pre = $('#textoDuvidas');
    if (pre) pre.textContent = textoDuvidas();
    return;
  }
  if (t.dataset.qtdLoja != null) {
    aplicarQtdLoja(t, cotAtual());
    return;
  }
  if (t.dataset.draft) {
    rascunho()[t.dataset.draft] = t.value;
    salvar();
    atualizarBarraCriar();
  } else if (t.dataset.qtd != null) {
    rascunho().itens[+t.dataset.qtd].quantidade = parseNum(t.value);
    salvar();
  } else if (t.dataset.dcDesc != null && ui.datacar) {
    const l = filaDataCar()[ui.datacar.pos];
    if (l) l.desc = t.value.trim();
  } else if (t.dataset.dcMarca != null) {
    // a marca é gravada ao sair do campo (Enter, Tab, setas ou clique fora)
  } else if (t.id === 'filtroProd') {
    ui.filtroProd = t.value;
    clearTimeout(ui.timerFiltroProd); // espera uma pausa na digitação (não trava a cada tecla)
    ui.timerFiltroProd = setTimeout(() => { const tb = $('#tbProd'); if (tb) tb.innerHTML = linhasProdutos(); }, 90);
  } else if (t.id === 'filtroForn') {
    ui.filtroForn = t.value;
    $('#tbForn').innerHTML = linhasFornecedores();
  } else if (t.id === 'filtroCot') {
    ui.filtroCot = t.value;
    $('#tbCot').innerHTML = linhasCotacoes();
  }
});

document.addEventListener('focusout', e => {
  const t = e.target;
  if (t.dataset && t.dataset.dcMarca != null && t.isConnected) fecharMarcaDataCar(t, true);
  // marca completada pela sugestão e o "change" não veio: salva do mesmo jeito
  if (t.dataset && t.dataset.sugerido && t.isConnected) {
    delete t.dataset.sugerido;
    t.dispatchEvent(new Event('change', { bubbles: true }));
  }
});

/* ---------------- lista de itens da cotação: setas + digitar direto na marca ---------------- */

function moverCursorItem(i, focarTabela = true) {
  const tab = $('#tabItens');
  const total = tab ? tab.querySelectorAll('[data-item-linha]').length : 0;
  if (!total) return;
  ui.cursorItem = Math.max(0, Math.min(total - 1, i));
  // só troca a marcação da linha anterior e da nova (e não das centenas de linhas)
  const nova = tab.querySelector(`[data-item-linha="${ui.cursorItem}"]`);
  tab.querySelectorAll('tr.item-atual').forEach(tr => { if (tr !== nova) tr.classList.remove('item-atual'); });
  nova.classList.add('item-atual');
  nova.scrollIntoView({ block: 'nearest' });
  if (focarTabela) tab.focus({ preventScroll: true });
}

/** Põe o foco num campo (marca ou similar) da linha i. modo: 'fim' | 'tudo' | texto inicial. */
function focarCampoItem(i, campo, modo) {
  const attr = { similar: 'data-similar-prod', codigo: 'data-codigo-item', codigoPapel: 'data-codigo-papel' }[campo] || 'data-marca-item';
  const tr = document.querySelector(`[data-item-linha="${i}"]`);
  const inp = tr && tr.querySelector(`[${attr}]`);
  if (!inp) { moverCursorItem(i); return; } // linha sem esse campo (código só nos KIT CORREIA/TENSOR)
  inp.closest('details')?.setAttribute('open', ''); // similar fica recolhido: abre para digitar
  moverCursorItem(i, false);
  inp.dataset.original = inp.value;
  inp.focus();
  if (modo === 'tudo') inp.select();
  else {
    if (modo !== 'fim' && modo != null) inp.value = modo;
    inp.setSelectionRange(inp.value.length, inp.value.length);
    if (campo === 'marca' && modo !== 'fim' && modo) sugerirMarca(inp); // abriu digitando uma letra
  }
}

/* sugestão de marca ao digitar: as marcas do cadastro, as mais usadas primeiro */
const dobrarMarca = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
let cacheMarcas = null;
function marcasConhecidas() {
  if (cacheMarcas && cacheMarcas.versao === versaoDados) return cacheMarcas.lista;
  const cont = new Map();
  for (const p of db.produtos) {
    const m = String(p.marca || '').trim();
    if (m) cont.set(m, (cont.get(m) || 0) + 1);
  }
  const lista = [...cont].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0])).map(([m]) => ({ m, d: dobrarMarca(m) }));
  cacheMarcas = { versao: versaoDados, lista };
  return lista;
}

/** Completa a marca digitada com a mais usada que começa igual; o que foi completado fica selecionado. */
function sugerirMarca(inp) {
  const digitado = inp.value;
  if (!digitado.trim() || inp.selectionStart !== digitado.length) return;
  const d = dobrarMarca(digitado);
  const achada = marcasConhecidas().find(x => x.d.length > d.length && x.d.startsWith(d));
  if (!achada) return;
  inp.value = achada.m;
  inp.setSelectionRange(digitado.length, achada.m.length);
  inp.dataset.sugerido = '1'; // valor posto pelo código: o navegador pode não disparar "change" ao sair

}

const ENTER_PADRAO_MS = 1500; // tempo para o segundo Enter (marca vira padrão no cadastro)

/** Enter duas vezes na marca: a marca desta cotação passa a ser a marca do cadastro do produto. */
function marcaComoPadrao(i) {
  const item = rascunho().itens[i];
  const p = item && db.produtos.find(x => x.id === item.produtoId);
  if (!p) return;
  const nome = p.codigo || p.descricao;
  if (!item.marca) {
    toast(p.marca ? `"${p.marca}" já é a marca padrão no cadastro de ${nome}.` : 'Sem marca para salvar no cadastro.');
    return;
  }
  const antiga = p.marca;
  p.marca = item.marca;
  item.marca = '';
  salvar();
  atualizarLinhaItem(i);
  moverCursorItem(ui.cursorItem); // o cursor fica no item seguinte
  toast(`Marca "${p.marca}" agora é o padrão no cadastro de ${nome}${antiga ? ` (antes: "${antiga}")` : ''}.`);
}

/** Linhas que aparecem na busca (índices dos itens). */
function itensVisiveis() {
  return [...document.querySelectorAll('[data-item-linha]:not([hidden])')].map(tr => +tr.dataset.itemLinha);
}

/** Item encontrado mais próximo de i na direção d (+1 desce, -1 sobe); pula os escondidos pela busca. */
function itemVizinho(i, d) {
  const v = itensVisiveis();
  if (!v.length) return i;
  const pos = v.indexOf(i);
  if (pos < 0) return d > 0 ? (v.find(j => j > i) ?? v.at(-1)) : ([...v].reverse().find(j => j < i) ?? v[0]);
  return v[Math.max(0, Math.min(v.length - 1, pos + d))];
}

function aplicarFiltroItens() {
  const r = rascunho();
  const prod = prodPorId();
  const pals = palavrasBusca(ui.filtroItens);
  const ctx = ui.tipoItens ? contextoNova() : null;
  document.querySelectorAll('[data-item-linha]').forEach(tr => {
    const i = +tr.dataset.itemLinha;
    const x = r.itens[i];
    const esconder = !itemNaBusca(x, x && prod[x.produtoId], null, pals) || (ctx && !itemNoTipo(ctx, x, i));
    if (tr.hidden !== esconder) tr.hidden = esconder;
  });
  const c = $('#contaFiltroItens');
  if (c) c.textContent = contaFiltroItens();
  const fora = $('#foraDaLista');
  if (fora) fora.innerHTML = htmlForaDaLista();
  const v = itensVisiveis();
  if (v.length && !v.includes(ui.cursorItem)) moverCursorItem(v[0], false);
}

/** Tira um item da cotação depois de confirmar (o produto continua no cadastro). */
async function perguntarRemoverItem(i, focar = true, doPainel = false) {
  const r = rascunho();
  const x = r.itens[i];
  if (!x) return;
  const p = db.produtos.find(y => y.id === x.produtoId);
  const nome = `${x.codigoArquivo || p?.codigo || ''}${p ? ' · ' + p.descricao : ''}`;
  if (!(await confirmar(`Tirar este item da cotação?\n\n${nome}\n\nO produto continua no cadastro.`, 'Tirar da cotação'))) {
    if (focar) moverCursorItem(i);
    return;
  }
  const pos = r.itens.indexOf(x);
  if (pos < 0) return;
  r.itens.splice(pos, 1);
  salvar();
  if (doPainel) {
    // tirado pelo painel de repetidos: a tela fica onde está (não pula para a linha na lista)
    ui.cursorItem = Math.max(0, Math.min(ui.cursorItem > pos ? ui.cursorItem - 1 : ui.cursorItem, r.itens.length - 1));
    render();
  } else {
    render();
    const v = itensVisiveis();
    if (v.length) moverCursorItem(v.find(j => j >= pos) ?? v.at(-1), focar);
  }
  toast(`Removido só o item ${nome}. Os outros continuam na cotação.`, 5000);
}

function teclaItens(e) {
  const t = e.target;
  const tab = $('#tabItens');
  const noCampo = t.matches('[data-marca-item], [data-similar-prod], [data-codigo-item], [data-codigo-papel]');
  const linha = t.closest('[data-item-linha]');
  const atual = linha ? +linha.dataset.itemLinha : ui.cursorItem;
  if (noCampo) {
    const campo = t.matches('[data-similar-prod]') ? 'similar' : t.matches('[data-codigo-item]') ? 'codigo' : t.matches('[data-codigo-papel]') ? 'codigoPapel' : 'marca';
    // a lista é reordenada ao salvar (descrição, código): acha a linha do item depois de salvar
    const obj = rascunho().itens[atual];
    const posicao = () => Math.max(0, rascunho().itens.indexOf(obj));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      t.blur(); // salva (dispara "change") e redesenha
      focarCampoItem(itemVizinho(posicao(), e.key === 'ArrowDown' ? 1 : -1), campo, 'tudo');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      t.blur(); // salva nesta cotação
      moverCursorItem(itemVizinho(posicao(), 1)); // e vai para o item de baixo (entre os encontrados na busca)
      // um segundo Enter logo em seguida grava a marca do item salvo como padrão no cadastro
      if (campo === 'marca') ui.enterPadrao = { i: posicao(), cursor: ui.cursorItem, ate: Date.now() + ENTER_PADRAO_MS };
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (t.dataset.original != null) t.value = t.dataset.original;
      t.blur();
      moverCursorItem(atual);
    }
    return;
  }
  if (t !== tab) return;
  const armado = ui.enterPadrao;
  ui.enterPadrao = null;
  if (e.key === 'Enter' && armado && armado.cursor === ui.cursorItem && Date.now() < armado.ate) {
    e.preventDefault();
    marcaComoPadrao(armado.i);
    return;
  }
  const letra = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    moverCursorItem(itemVizinho(ui.cursorItem, e.key === 'ArrowDown' ? 1 : -1));
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    const v = itensVisiveis();
    if (v.length) moverCursorItem(e.key === 'Home' ? v[0] : v.at(-1));
  } else if (e.key === 'F2' || e.key === 'Enter') {
    e.preventDefault();
    focarCampoItem(ui.cursorItem, 'marca', 'fim');
  } else if (letra && e.key !== ' ') {
    e.preventDefault();
    focarCampoItem(ui.cursorItem, 'marca', e.key);
  } else if (e.key === 'Delete' && e.ctrlKey) {
    e.preventDefault();
    perguntarRemoverItem(ui.cursorItem);
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    focarCampoItem(ui.cursorItem, 'marca', '');
  }
}

/* dica do gráfico de preço por fornecedor: todos os preços da cotação sob o mouse */
document.addEventListener('mouseover', e => {
  const col = e.target.closest?.('.hf-col');
  const wrap = e.target.closest?.('.hf-wrap');
  if (!wrap) return;
  const tip = wrap.querySelector('.hf-tip');
  const cruz = wrap.querySelector('.hf-cruz');
  if (!col) { tip.hidden = true; cruz.style.display = 'none'; return; }
  const linhas = (col.dataset.linhas || '').split(';;').filter(Boolean).map(l => {
    const [cor, nome, preco] = l.split('|');
    return `<div class="hf-tip-linha"><span class="hf-sw" style="--c: var(--serie-${cor})"></span><span>${esc(nome)}</span><b>${esc(preco)}</b></div>`;
  }).join('');
  tip.innerHTML = `<div class="hf-tip-tit">${esc(col.dataset.tip)}</div>${linhas}`;
  tip.hidden = false;
  const svg = wrap.querySelector('svg');
  const escala = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
  const px = Number(col.dataset.x) * escala;
  cruz.setAttribute('x1', col.dataset.x);
  cruz.setAttribute('x2', col.dataset.x);
  cruz.style.display = '';
  const larguraTip = tip.offsetWidth;
  tip.style.left = `${Math.max(0, Math.min(px + 12, wrap.clientWidth - larguraTip))}px`;
});
document.addEventListener('mouseout', e => {
  const wrap = e.target.closest?.('.hf-wrap');
  if (wrap && !wrap.contains(e.relatedTarget)) {
    wrap.querySelector('.hf-tip').hidden = true;
    wrap.querySelector('.hf-cruz').style.display = 'none';
  }
});

/**
 * Quantidade digitada numa loja (campo do comparativo ou da janela flutuante): respeita o estoque
 * do vencedor (Kaizen), grava (0 = não comprar; vazio = não informado) e atualiza os totais.
 */
function aplicarQtdLoja(t, c) {
  if (!c) return;
  const i = +t.dataset.i;
  if (cotTravada(c)) { t.value = c.qtds?.[i]?.[t.dataset.qtdLoja] ?? ''; avisarTravada(); return; }
  let v = Math.max(0, parseNum(t.value) || 0);
  t.classList.toggle('preenchida', v > 0);
  t.classList.toggle('zerada', t.value.trim() !== '' && v === 0);
  const l = comparar(c).linhas[i];
  // um novo número neste campo apaga o aviso de estoque dele
  if (ui.alertaEstoque?.it === c.itens[i] && ui.alertaEstoque.loja === t.dataset.qtdLoja) ui.alertaEstoque = null;
  t.classList.remove('no-limite');
  if (l?.estoque != null) {
    // o vencedor informou o estoque (Kaizen): a soma das lojas não passa dele
    const LJ = lojas();
    const outras = LJ.filter(lj => lj.id !== t.dataset.qtdLoja).reduce((soma, lj) => soma + qtdLoja(c, i, lj.id), 0);
    const max = Math.max(0, l.estoque - outras);
    if (v > max) {
      // fica marcado no item (campo vermelho + aviso ao lado) até digitar de novo
      ui.alertaEstoque = {
        it: c.itens[i], loja: t.dataset.qtdLoja, nomeLoja: LJ.find(lj => lj.id === t.dataset.qtdLoja)?.nome || '',
        digitado: v, max, estoque: l.estoque, outras, forn: c.fornecedores[l.vencedor].nome,
      };
      v = max;
      t.value = String(max);
      t.classList.add('no-limite');
      t.classList.toggle('preenchida', v > 0);
      t.classList.toggle('zerada', v === 0);
    }
  }
  c.qtds = { ...(c.qtds || {}) };
  const o = { ...(c.qtds[i] || {}) };
  // 0 digitado = não comprar nesta loja (fica gravado); campo vazio = ainda não informado
  if (t.value.trim() === '') delete o[t.dataset.qtdLoja]; else o[t.dataset.qtdLoja] = v;
  if (Object.keys(o).length) c.qtds[i] = o; else delete c.qtds[i];
  salvar();
  atualizarTotaisComp(c, i);
  espelharQtd(t, c, i);
}

/**
 * Escolhe o fornecedor `fi` para o item `i` (com confirmação). Clicar no escolhido volta ao automático.
 * `doc`: onde a confirmação aparece (a janela flutuante usa a dela). Devolve true se mudou.
 */
async function escolherVencedorItem(c, i, fi, doc = document) {
  if (!c) return false;
  const f = c.fornecedores[fi];
  if (!f) return false;
  const l = comparar(c).linhas[i];
  if (l.recusas[fi]) return toast('Esta marca foi recusada. Para usar este preço, clique na marca e desfaça a recusa.');
  const it = c.itens[i];
  const nome = j => c.fornecedores[j].nome;
  const titulo = `${it.codigo || '—'} · ${it.descricao}`;
  if (l.vencedor === fi) {
    // clicar no vencedor escolhido volta ao automático
    if (!c.escolhas?.[i]) return toast(`${f.nome} já é o vencedor deste item.`);
    const semEscolha = { ...c, escolhas: { ...c.escolhas } };
    delete semEscolha.escolhas[i];
    const auto = comparar(semEscolha).linhas[i];
    const volta = auto.vencedor >= 0 ? `${nome(auto.vencedor)} por ${fmtMoeda(auto.preco)}` : 'o automático';
    if (!(await confirmar(`${titulo}\n\nTirar a sua escolha (${f.nome}, ${fmtMoeda(l.precos[fi])}) e voltar para ${volta}?`, 'Voltar', doc))) return;
    c.escolhas = { ...c.escolhas };
    delete c.escolhas[i];
  } else {
    const p = l.precos[fi];
    const atual = l.vencedor >= 0 ? `\nHoje: ${nome(l.vencedor)} por ${fmtMoeda(l.preco)}.` : '';
    const menor = l.minIdx >= 0 && l.minIdx !== fi && l.min > 0 ? `\nMenor preço: ${nome(l.minIdx)} ${fmtMoeda(l.min)} (${f.nome} está +${fmtPct(p / l.min - 1)}).` : '';
    if (!(await confirmar(`${titulo}\n\nComprar este item de ${f.nome} por ${fmtMoeda(p)}?${atual}${menor}`, `Escolher ${f.nome}`, doc))) return;
    c.escolhas = { ...(c.escolhas || {}), [i]: f.fornecedorId };
  }
  salvar();
  render();
  return true;
}

/* ---------------- janela flutuante (Picture-in-Picture) ----------------
 * Para quem usa uma tela só, dividida com o DataCar: uma janelinha sempre por cima das outras
 * com o item atual e as quantidades das lojas. Chrome/Edge 116+ (documentPictureInPicture). */

const pip = { win: null, cotId: null, i: null, loja: 0, flutuante: false, soFaltam: (() => { try { return localStorage.getItem('cotacao.pipSoFaltam') === '1'; } catch (e) { return false; } })() };
window.addEventListener('pagehide', () => { try { pip.win?.close(); } catch (e) { /* já fechada */ } });
const pipSuportado = () => typeof window.documentPictureInPicture?.requestWindow === 'function';

/** Itens na ordem do comparativo, respeitando os filtros ("Mostrar itens de", etiquetas de aviso). */
function itensPip(c) {
  const linhas = [...document.querySelectorAll('.tab-comp tbody tr[data-comp-linha]')];
  if (linhas.length && cotAtual() === c) return linhas.filter(tr => !tr.hidden).map(tr => +tr.dataset.compLinha);
  const valor = filtroVencedor(c);
  return comparar(c).linhas.filter(l => linhaNoFiltroVenc(c, l, valor)).map(l => l.i);
}

async function abrirPip() {
  const c = cotAtual();
  if (!c) return;
  if (pip.win && !pip.win.closed) { pip.cotId = c.id; desenharPip(true); pip.win.focus(); return; }
  let w = null;
  pip.flutuante = pipSuportado();
  try {
    if (pip.flutuante) {
      // Chrome/Edge: janela que fica sempre por cima das outras
      w = await window.documentPictureInPicture.requestWindow({ width: 340, height: 400 });
    } else {
      // Firefox e outros: janelinha separada (o Windows pode deixá-la por cima: veja a dica no rodapé dela)
      w = window.open('', 'cotacaoJanelaQtd', 'popup=yes,width=350,height=400');
      if (!w) return avisar('O navegador bloqueou a janela. Permita janelas pop-up para este site (ícone na barra de endereço) e clique de novo.');
      w.document.open();
      w.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quantidades</title></head><body></body></html>');
      w.document.close();
    }
  } catch (e) {
    console.error(e);
    return avisar('Não consegui abrir a janela flutuante: ' + (e.message || e));
  }
  pip.win = w;
  pip.cotId = c.id;
  const lista = itensPip(c);
  pip.i = ui.linhaComp?.cotId === c.id && lista.includes(ui.linhaComp.i) ? ui.linhaComp.i : lista[0] ?? 0;
  const d = w.document;
  // mesmo visual do sistema
  for (const ss of document.styleSheets) {
    try {
      const st = d.createElement('style');
      st.textContent = [...ss.cssRules].map(r => r.cssText).join('\n');
      d.head.appendChild(st);
    } catch (e) {
      if (ss.href) { const l = d.createElement('link'); l.rel = 'stylesheet'; l.href = ss.href; d.head.appendChild(l); }
    }
  }
  if (document.documentElement.dataset.theme) d.documentElement.dataset.theme = document.documentElement.dataset.theme;
  d.title = `Quantidades · cotação nº ${c.numero || ''}`;
  d.body.className = 'pip-corpo';
  d.body.innerHTML = '<div id="pip"></div>';
  d.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.qtdLoja == null) return;
    const cot = db.cotacoes.find(x => x.id === pip.cotId);
    aplicarQtdLoja(t, cot);
  });
  d.addEventListener('focusin', e => {
    const t = e.target;
    if (t.dataset?.qtdLoja == null) return;
    t.select();
    pip.loja = Math.max(0, lojas().findIndex(lj => lj.id === t.dataset.qtdLoja));
  });
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-pip]');
    if (!b) return;
    const acao = b.dataset.pip;
    if (acao === 'ant') irPip(-1);
    else if (acao === 'prox') irPip(1);
    else if (acao === 'copiar') copiarCodigoPip(b);
    else if (acao === 'duvida') duvidaPip();
    else if (acao === 'escolher') escolherPip(+b.dataset.f);
    else if (acao === 'exportar') exportarPip(+b.dataset.f);
    else if (acao === 'ir') { const cot = db.cotacoes.find(x => x.id === pip.cotId); if (cot) irParaItemPip(cot, +b.dataset.i); }
  });
  d.addEventListener('keydown', marcarTecla, true);
  d.addEventListener('input', marcarTecla, true);
  d.addEventListener('keydown', e => teclaPip(e, d));
  d.addEventListener('focusout', e => {
    // saiu da lista de fornecedores sem escolher: faz o redesenho que ficou esperando
    if (e.target.id === 'pipForn' && pip.redesenharDepois) setTimeout(() => desenharPip(false), 0);
  });
  d.addEventListener('change', e => {
    if (e.target.dataset?.pipSofaltam != null) {
      pip.soFaltam = e.target.checked;
      try { localStorage.setItem('cotacao.pipSoFaltam', pip.soFaltam ? '1' : '0'); } catch (err) { /* sem acesso */ }
      const cot = db.cotacoes.find(x => x.id === pip.cotId);
      // ligou: se o item atual já tem quantidade, vai para o próximo que falta
      if (pip.soFaltam && cot && !pendentesPip(cot, [pip.i]).length) irPip(1); else desenharPip(true);
      return;
    }
    if (e.target.id !== 'pipForn') return;
    e.target.blur(); // escolheu: a lista sai de foco para a janela poder se redesenhar
    const cot = db.cotacoes.find(x => x.id === pip.cotId);
    if (!cot) return;
    definirFiltroVencedor(cot, e.target.value);
    pip.i = itensPip(cot)[0] ?? pip.i;
    pip.loja = 0;
    desenharPip(true);
  });
  w.addEventListener('pagehide', () => { if (pip.win === w) pip.win = null; anunciarPresenca(); });
  desenharPip(true);
  w.focus();
}

function teclaPip(e, d) {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target;
  if (t.tagName === 'SELECT' || d.querySelector('.dlg-fundo')) return; // lista de fornecedores ou diálogo aberto
  // atalhos de uma tecla (as quantidades só aceitam números, então as letras ficam livres)
  const naQtd = t.dataset?.qtdLoja != null;
  const atalho = e.key === '/' ? 'buscar' : /^[cC]$/.test(e.key) ? 'copiar' : /^[dD]$/.test(e.key) ? 'duvida'
    : /^[sS]$/.test(e.key) || (e.key === '2' && !naQtd) ? 'segundo' : null;
  if (atalho && !(t.matches?.('input, textarea') && !naQtd)) {
    e.preventDefault();
    if (atalho === 'copiar') { const b = d.querySelector('.pip-cod'); if (b) copiarCodigoPip(b); }
    else if (atalho === 'duvida') { if (d.querySelector('.pip-btn-duv')) duvidaPip(); }
    else if (atalho === 'segundo') { const b = d.querySelector('.pip-segundo'); if (b) escolherPip(+b.dataset.f); }
    else buscarPip();
    return;
  }
  const campos = [...d.querySelectorAll('input[data-qtd-loja]')];
  const k = campos.indexOf(t);
  if (k < 0) {
    // fora dos campos: número ou seta leva para a quantidade
    const ehNumero = /^[0-9]$/.test(e.key);
    if (!ehNumero && !['Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (t.closest?.('button') && e.key === 'Enter') return;
    const campo = campos[Math.min(pip.loja, campos.length - 1)];
    if (!campo) return;
    e.preventDefault();
    campo.focus();
    if (ehNumero) { campo.value = e.key; campo.setSelectionRange(1, 1); campo.dispatchEvent(new Event('input', { bubbles: true })); }
    return;
  }
  const mover = (delta, loja) => { e.preventDefault(); pip.loja = loja; irPip(delta); };
  if (e.key === 'Enter' || e.key === 'ArrowDown') mover(1, k);
  else if (e.key === 'ArrowUp') mover(-1, k);
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    campos[k + (e.key === 'ArrowRight' ? 1 : -1)]?.focus();
  } else if (e.key === 'Tab') {
    // Tab: próxima loja; na última, o próximo item (Shift+Tab volta)
    const prox = k + (e.shiftKey ? -1 : 1);
    if (campos[prox]) { e.preventDefault(); campos[prox].focus(); }
    else mover(e.shiftKey ? -1 : 1, e.shiftKey ? campos.length - 1 : 0);
  }
}

/** Vai para outro item (delta: +1 próximo, -1 anterior) e marca a mesma linha no comparativo. */
/** Itens da lista ainda sem quantidade em nenhuma loja (0 conta como informado: "não comprar"). */
function pendentesPip(c, lista) {
  const LJ = lojas();
  return lista.filter(i => !LJ.some(lj => c.qtds?.[i]?.[lj.id] != null));
}

/** Situação do item na janela flutuante (cor do cartão): dúvida, quantidade informada, marca diferente ou falta. */
function estadoPip(c, l) {
  const st = l.vencedor >= 0 ? l.marcas[l.vencedor] : null;
  if (l.duvida) return ['duvida', '❓ em dúvida · fora do pedido'];
  if (!pendentesPip(c, [l.i]).length) return ['ok', '✓ informado'];
  if ((st === 'errada' && !l.permitidas?.[l.vencedor]) || l.recusadaGanhou) return ['marca', '✗ marca diferente'];
  if (st === 'duvida' || st === 'sem') return ['marca', '? conferir marca'];
  return ['falta', 'falta quantidade'];
}

/** Estoque do ganhador (Kaizen) ao lado das quantidades: fica vermelho quando a soma das lojas passa dele. */
function estoquePip(c, l) {
  if (l.estoque == null) return '';
  const soma = lojas().reduce((t, lj) => t + qtdLoja(c, l.i, lj.id), 0);
  const passou = soma > l.estoque;
  return `<div class="pip-estoque${passou ? ' passou' : soma === l.estoque ? ' no-limite' : ''}" title="Estoque informado por ${esc(c.fornecedores[l.vencedor]?.nome || '')}${soma ? ` · pedido: ${fmtNum(soma)}` : ''}"><span>📦 estoque</span><b>${fmtNum(l.estoque)}</b>${soma ? `<small>${passou ? `passou ${fmtNum(soma - l.estoque)}` : `restam ${fmtNum(l.estoque - soma)}`}</small>` : ''}</div>`;
}

/** Marca pedida × marca do ganhador, lado a lado. */
function marcasPip(l, marcaVenc) {
  const st = l.marcas[l.vencedor];
  const [cls, ic, tit] = st === 'errada' && l.permitidas?.[l.vencedor] ? ['errada permitida', '✓', 'marca diferente da pedida, mas permitida nesta cotação']
    : st === 'errada' ? ['errada', '✗', 'marca diferente da pedida'] : st === 'duvida' ? ['conferir', '?', 'abreviação: confira']
    : st === 'sem' ? ['conferir', '?', 'não informou a marca'] : st === 'ok' || st === 'abrev' ? ['ok', '✓', 'marca pedida'] : ['', '', 'sem exigência de marca'];
  return `<div class="pip-marcas" title="${tit}"><span class="pip-marca-pedida"><small>pedida</small><b>${esc(l.it.marca || 'qualquer')}</b></span><span class="pip-seta">→</span><span class="pip-marca ${cls}">${esc(marcaVenc || 'sem marca')}${ic ? ` <i>${ic}</i>` : ''}</span></div>`;
}

/** "Todos os itens de X já têm quantidade informada" (ou quantos faltam). */
function avisoConcluidoPip(c, lista) {
  if (!lista.length) return '';
  const falta = pendentesPip(c, lista).length;
  const valor = filtroVencedor(c);
  const de = valor === '__sem' ? 'sem preço' : valor ? c.fornecedores.find(f => f.fornecedorId === valor)?.nome || '' : 'da cotação';
  const fi = valor && valor !== '__sem' ? c.fornecedores.findIndex(f => f.fornecedorId === valor) : -1;
  if (!falta) {
    const f = c.fornecedores[fi];
    const exp = !f ? '' : f.concluidoEm ? ' <span class="pip-exportado">· ✓ pedido exportado</span>'
      : `<br><button type="button" class="sm primary pip-exportar" data-pip="exportar" data-f="${fi}" title="Exportar o pedido de ${esc(f.nome)} (com o checklist) sem sair desta janela">⬇ Exportar pedido de ${esc(f.nome)}</button>`;
    return `<div class="pip-concluido" role="status">✓ Todos os itens ${fi >= 0 ? `de <b>${esc(de)}</b>` : esc(de)} já têm a quantidade informada.${exp}</div>`;
  }
  const feitos = lista.length - falta;
  return `<div class="pip-faltam">
    <div class="pip-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${lista.length}" aria-valuenow="${feitos}" title="${feitos} de ${lista.length} itens com quantidade"><span style="width:${Math.round((feitos / lista.length) * 100)}%"></span></div>
    <span class="pip-prog-txt">faltam <b>${falta}</b> de ${lista.length}</span>
    <label class="pip-sofaltam" title="Enter e as setas passam só pelos itens ainda sem quantidade"><input type="checkbox" data-pip-sofaltam ${pip.soFaltam ? 'checked' : ''}> só faltam</label>
  </div>`;
}

/** Item seguinte (delta 1) ou anterior (-1) a partir de `atual`, respeitando o "só os que faltam". */
function vizinhoPip(c, lista, atual, delta) {
  const pos = lista.indexOf(atual);
  let novo = lista[pos < 0 ? 0 : pos + delta];
  if (pip.soFaltam) {
    // só os que faltam: pula os itens que já têm quantidade
    const pend = pendentesPip(c, lista).filter(i => i !== atual);
    const ordem = i => lista.indexOf(i);
    novo = delta > 0 ? pend.find(i => ordem(i) > pos) : [...pend].reverse().find(i => ordem(i) < pos);
  }
  return novo;
}

/** Os próximos itens (os que o Enter vai mostrar), para adiantar a busca no DataCar. */
function proximosPip(c, lista, n = 3) {
  const r = [];
  let at = pip.i;
  while (r.length < n) {
    const x = vizinhoPip(c, lista, at, 1);
    if (x == null || r.includes(x)) break;
    r.push(x);
    at = x;
  }
  return r;
}

function htmlProximosPip(c, lista) {
  const prox = proximosPip(c, lista);
  if (!prox.length) return '';
  return `<div class="pip-proximos"><span class="pip-prox-rot">próximos</span>${prox.map(i => {
    const it = c.itens[i];
    const feito = !pendentesPip(c, [i]).length;
    return `<button type="button" class="pip-prox${feito ? ' feito' : ''}" data-pip="ir" data-i="${i}" title="#${i + 1} · ${esc(it.descricao || '')}${feito ? ' · já tem quantidade' : ''}">${esc(it.codigo || '#' + (i + 1))}</button>`;
  }).join('')}</div>`;
}

/** Pedido do fornecedor escolhido na janela: valor, itens e o pedido mínimo do cadastro. */
/**
 * Quadro do pedido na janela flutuante: total (do fornecedor escolhido, ou da cotação inteira)
 * e o valor de cada loja — a mesma conta do pedido exportado (itens em Dúvidas ficam fora).
 */
function htmlPedidoPip(c) {
  const valor = filtroVencedor(c);
  if (valor === '__sem') return '';
  const LJ = lojas();
  const porLoja = temQtdLojas(c) && LJ.length > 1;
  const fi = valor ? c.fornecedores.findIndex(f => f.fornecedorId === valor) : -1;
  if (valor && fi < 0) return '';
  const somar = lojaId => {
    const ps = pedidosPorFornecedor(c, lojaId).filter(p => fi < 0 || p.fi === fi);
    return { total: ps.reduce((t, p) => t + p.total, 0), itens: ps.reduce((t, p) => t + p.itens.length, 0) };
  };
  const tudo = somar(null);
  if (fi < 0 && !tudo.itens) return '';
  const f = fi >= 0 ? c.fornecedores[fi] : null;
  const min = f ? Number(db.fornecedores.find(x => x.id === f.fornecedorId)?.pedidoMinimo) || 0 : 0;
  const falta = min && tudo.total < min ? min - tudo.total : 0;
  const lojasHtml = porLoja ? LJ.map(lj => {
    const r = somar(lj.id);
    return `<span class="pip-ped-loja${r.itens ? '' : ' vazia'}" title="${esc(lj.nome)}: ${r.itens} item(ns) · ${fmtMoeda(r.total)}"><b>${esc(siglaLoja(lj))}</b> ${fmtMoeda(r.total)} <small>${r.itens} ${r.itens === 1 ? 'item' : 'itens'}</small></span>`;
  }).join('') : '';
  return `<div class="pip-pedido${falta ? ' abaixo' : ''}${f ? '' : ' geral'}" title="${f ? `Pedido de ${esc(f.nome)}` : 'Total da cotação'} até agora (itens com quantidade, sem os que estão em Dúvidas)${min ? ` · pedido mínimo ${fmtMoeda(min)}` : ''}">
    <span class="pip-ped-nome">🧾 ${f ? esc(f.nome) : 'Total da cotação'}</span><b class="pip-ped-total">${fmtMoeda(tudo.total)}</b><span class="pip-ped-itens">${tudo.itens} ${tudo.itens === 1 ? 'item' : 'itens'}</span>${falta ? `<span class="pip-ped-min">faltam ${fmtMoeda(falta)} p/ o mínimo</span>` : ''}
    ${lojasHtml ? `<span class="pip-ped-lojas">${lojasHtml}</span>` : ''}
  </div>`;
}

/** Valor do item em cada loja (preço × quantidade), embaixo do campo da quantidade. */
function subLojaPip(c, l, lj) {
  const q = qtdLoja(c, l.i, lj.id);
  if (l.preco == null || !q) return '';
  if (l.duvida?.has(lj.id)) return '<span class="pip-sub-duv">em dúvida</span>';
  return fmtMoeda(l.preco * q);
}

function irPip(delta) {
  const c = db.cotacoes.find(x => x.id === pip.cotId);
  if (!c) return;
  const lista = itensPip(c);
  let novo = vizinhoPip(c, lista, pip.i, delta);
  // Enter no último item: volta para o primeiro que ainda está sem quantidade
  if (novo == null && delta > 0) novo = pendentesPip(c, lista).find(i => i !== pip.i);
  if (novo == null) { desenharPip(true); return; } // já é o primeiro/último
  irParaItemPip(c, novo);
}

/** Mostra o item i na janela; o comparativo acompanha (sem tirar o cursor de lá). */
function irParaItemPip(c, novo) {
  pip.i = novo;
  // o comparativo acompanha (sem tirar o cursor de lá)
  if (cotAtual() === c) {
    ui.linhaComp = { cotId: c.id, i: novo };
    const tr = document.querySelector(`.tab-comp tr[data-comp-linha="${novo}"]`);
    document.querySelectorAll('tr.linha-atual').forEach(x => { if (x !== tr) x.classList.remove('linha-atual'); });
    if (tr) { tr.classList.add('linha-atual'); tr.scrollIntoView({ block: 'center' }); }
  }
  desenharPip(true);
}

/** Clicar no 2º lugar (ou no mais barato) da janela flutuante: vira o escolhido, com confirmação ali mesmo. */
async function escolherPip(fi) {
  if (cotTravada(db.cotacoes.find(x => x.id === pip.cotId))) { avisarTravada(); return; }
  const c = db.cotacoes.find(x => x.id === pip.cotId);
  if (!c || !pip.win) return;
  const antes = pip.i;
  const mudou = await escolherVencedorItem(c, antes, fi, pip.win.document);
  if (!mudou) { desenharPip(true); return; }
  // escolhido: segue para o próximo item sem quantidade (a partir de onde estava), sem voltar ao começo
  const lista = itensPip(c);
  const pend = pendentesPip(c, lista).filter(i => i !== antes);
  const prox = pend.find(i => i > antes) ?? pend[0] ?? lista.find(i => i > antes) ?? lista.find(i => i !== antes) ?? antes;
  pip.i = prox;
  if (cotAtual() === c) {
    ui.linhaComp = { cotId: c.id, i: prox };
    const tr = document.querySelector(`.tab-comp tr[data-comp-linha="${prox}"]`);
    document.querySelectorAll('tr.linha-atual').forEach(x => { if (x !== tr) x.classList.remove('linha-atual'); });
    if (tr) { tr.classList.add('linha-atual'); tr.scrollIntoView({ block: 'center' }); }
  }
  desenharPip(true);
  toast(`Item ${c.itens[antes]?.codigo || ''}: comprando de ${c.fornecedores[comparar(c).linhas[antes].vencedor]?.nome || ''}.${prox !== antes ? ` Próximo: ${c.itens[prox]?.codigo || ''}.` : ''}`);
}

/** Exportar o pedido pela janela flutuante: formato, checklist e "Salvar como" abrem nela mesma. */
async function exportarPip(fi) {
  const c = db.cotacoes.find(x => x.id === pip.cotId);
  if (!c || !pip.win) return;
  janelaSalvar = pip.win;
  try {
    await exportarPedidoForn(c, fi, pip.win.document);
  } finally {
    janelaSalvar = null;
  }
  desenharPip(true);
}

/** "/" na janela flutuante: vai direto para um item pelo código (ou pela descrição). */
async function buscarPip() {
  const c = db.cotacoes.find(x => x.id === pip.cotId);
  if (!c || !pip.win) return;
  const txt = await pedirValor('Ir para o item (código ou descrição):', { ok: 'Ir', doc: pip.win.document, opcoes: c.itens.map(it => it.codigo).filter(Boolean) });
  if (!txt) { desenharPip(true); return; }
  const q = normCod(txt), qd = semAcento(txt);
  const acha = i => normCod(c.itens[i].codigo) === q;
  const parecido = i => normCod(c.itens[i].codigo).includes(q) || semAcento(c.itens[i].descricao).includes(qd);
  let lista = itensPip(c);
  let i = lista.find(acha) ?? lista.find(parecido);
  if (i == null) {
    const todos = c.itens.map((_, k) => k);
    i = todos.find(acha) ?? todos.find(parecido);
    if (i != null) definirFiltroVencedor(c, ''); // está com outro fornecedor: mostra todos
  }
  if (i == null) { await avisar(`Nenhum item com "${txt}" nesta cotação.`, pip.win.document); desenharPip(true); return; }
  pip.i = i;
  if (cotAtual() === c) {
    ui.linhaComp = { cotId: c.id, i };
    const tr = document.querySelector(`.tab-comp tr[data-comp-linha="${i}"]`);
    document.querySelectorAll('tr.linha-atual').forEach(x => { if (x !== tr) x.classList.remove('linha-atual'); });
    if (tr) { tr.classList.add('linha-atual'); tr.scrollIntoView({ block: 'center' }); }
  }
  desenharPip(true);
}

/** ❓ na janela flutuante: a janela de perguntar à loja abre nela mesma (fica por cima do DataCar). */
async function duvidaPip() {
  if (cotTravada(db.cotacoes.find(x => x.id === pip.cotId))) { avisarTravada(); return; }
  const c = db.cotacoes.find(x => x.id === pip.cotId);
  if (!c || !pip.win) return;
  const n = await duvidasDoItem(c, pip.i, null, '', pip.win.document);
  if (n <= 0) { desenharPip(true); return; }
  render();
  desenharPip(true);
  toast(`${n} item(ns) em Dúvidas (${db.duvidas.length} na fila).`);
}

function copiarCodigoPip(b) {
  const c = db.cotacoes.find(x => x.id === pip.cotId);
  const cod = c?.itens[pip.i]?.codigo || '';
  if (!cod) return;
  const feito = () => { b.classList.add('copiado'); setTimeout(() => b.classList.remove('copiado'), 1200); };
  (pip.win.navigator.clipboard || navigator.clipboard).writeText(cod).then(feito, () => {
    const ta = pip.win.document.createElement('textarea');
    ta.value = cod;
    pip.win.document.body.appendChild(ta);
    ta.select();
    pip.win.document.execCommand('copy');
    ta.remove();
    feito();
  });
}

/** Desenha a janela flutuante. `focar`: põe o cursor na quantidade (senão só mantém onde estava). */
function desenharPip(focar) {
  if (!pip.win || pip.win.closed) { pip.win = null; return; }
  const d = pip.win.document;
  const raiz = d.getElementById('pip');
  if (!raiz) return;
  // escolhendo o fornecedor na lista: redesenhar agora fecharia a lista; espera a escolha (ou sair dela)
  if (d.activeElement?.id === 'pipForn') { pip.redesenharDepois = true; return; }
  pip.redesenharDepois = false;
  const c = db.cotacoes.find(x => x.id === pip.cotId);
  if (!c) { raiz.innerHTML = '<p class="muted">Esta cotação não existe mais. Feche a janela.</p>'; return; }
  const ativo = d.activeElement?.dataset?.qtdLoja != null ? d.activeElement : null;
  const sel = ativo ? [ativo.dataset.qtdLoja, ativo.selectionStart, ativo.selectionEnd] : null;
  const comp = comparar(c);
  const lista = itensPip(c);
  if (!c.itens[pip.i]) pip.i = lista[0] ?? 0;
  if (lista.length && !lista.includes(pip.i)) pip.i = lista[0];
  const l = comp.linhas[pip.i];
  if (!l) { raiz.innerHTML = '<p class="muted">Nenhum item.</p>'; return; }
  const pos = lista.indexOf(pip.i);
  const f = l.vencedor >= 0 ? c.fornecedores[l.vencedor] : null;
  const marcaVenc = f?.respostas?.[l.i]?.marca;
  const LJ = lojas();
  const [estado, rotEstado] = estadoPip(c, l);
  raiz.innerHTML = `
    <div class="pip-barra">
      <select id="pipForn" title="Mostrar só os itens que este fornecedor ganhou">${opcoesVencedor(c, comp)}</select>
      <button type="button" data-pip="ant" title="Item anterior (↑)" ${pos <= 0 ? 'disabled' : ''}>◀</button>
      <span class="pip-pos" title="Item da cotação · posição na lista">#${l.i + 1} <span class="muted">· ${pos < 0 ? '—' : pos + 1} de ${lista.length}</span></span>
      <button type="button" data-pip="prox" title="Próximo item (Enter ou ↓)" ${pos >= lista.length - 1 ? 'disabled' : ''}>▶</button>
    </div>
    <div class="pip-topo2"><div id="pipPedido">${htmlPedidoPip(c)}</div><div id="pipAviso">${avisoConcluidoPip(c, lista)}</div></div>
    <div id="pipPresenca" class="presenca" ${htmlPresencaCot(c.id) ? '' : 'hidden'}>${htmlPresencaCot(c.id)}</div>
    <div class="pip-grade">
      <div class="pip-item estado-${estado}" id="pipItem">
        <div class="pip-cab">
          <button type="button" class="pip-cod" data-pip="copiar" title="Clique (ou C) para copiar o código e colar no DataCar"><span class="pip-cod-txt">${esc(l.it.codigo || '—')}</span><span class="pip-copiar">⧉</span></button>
        </div>
        <div class="pip-linha-desc"><span class="pip-desc" title="${esc(l.it.descricao || '')}">${esc(l.it.descricao || '')}</span><span class="pip-estado" id="pipEstado">${rotEstado}</span></div>
        ${f ? (() => {
          const tags = [
            l.recusadaGanhou ? '<span class="pip-tag recusada">⚠ marca recusada</span>' : '',
            l.manual ? '<span class="pip-tag">escolhido por você</span>' : '',
            l.preferencia ? `<span class="pip-tag regra">⭐ regra 5% (+${fmtPct(l.preco / l.min - 1)})</span>` : '',
            entregaDemorada(f, f.respostas?.[l.i]) ? '<span class="pip-tag">🐢 GO demora</span>' : '',
          ].filter(Boolean).join('');
          // alternativa: o 2º lugar; se você escolheu outro (ou vale a regra dos 5%), o mais barato
          const trocou = (l.manual || l.preferencia) && l.minIdx >= 0 && l.minIdx !== l.vencedor;
          const alvo = trocou ? l.minIdx : l.segundoIdx;
          let seg = '';
          if (alvo >= 0 && alvo !== l.vencedor) {
            const fa = c.fornecedores[alvo];
            const pa = l.precos[alvo];
            const dif = trocou ? l.preco / l.min - 1 : l.difSegundo;
            const txtDif = dif == null ? '' : trocou ? `escolhido +${fmtPct(dif)}` : `+${fmtPct(dif)} que o 1º`;
            seg = `<button type="button" class="pip-segundo${dif > LIMITE_DIF_SUSPEITA ? ' suspeita' : ''}" data-pip="escolher" data-f="${alvo}" title="${trocou ? 'Menor preço' : '2º lugar'}: clique (ou S) para comprar de ${esc(fa.nome)} por ${fmtMoeda(pa)}${trocou ? ` (o escolhido está +${fmtPct(dif)} mais caro)` : dif != null ? ` (+${fmtPct(dif)} mais caro que o 1º)` : ''}">
              <span class="pip-seg-info"><span class="pip-seg-rot">${trocou ? '1º · menor preço' : '2º lugar'}</span><span class="pip-seg-preco">${fmtMoeda(pa)}</span>${marcaAlternativa(c, l, alvo).replace('<br>', '')}<span class="pip-seg-forn">${esc(fa.nome)}</span>${txtDif ? `<span class="pip-seg-dif">${txtDif}</span>` : ''}</span><span class="pip-seg-acao">Escolher ›</span>
            </button>`;
          }
          return `<div class="pip-ganhador">
            <div class="pip-preco-linha"><span class="pip-preco">${fmtMoeda(l.preco)}</span><span class="pip-forn">🏆 ${esc(f.nome)}</span><button type="button" class="pip-btn-duv" data-pip="duvida" title="Pôr em Dúvidas (perguntar à loja) · tecla D">❓</button></div>
            ${marcasPip(l, marcaVenc)}
            ${tags ? `<div class="pip-tags">${tags}</div>` : ''}
          </div>${seg}`;
        })() : `<div class="pip-ganhador vazio">${l.aguardando ? '<span class="aguardando">⏳ aguardando outro preço</span>' : '<span class="muted">sem preço</span>'}</div>`}
      </div>
      <div class="pip-col-qtd">
        <div class="pip-qtds">${LJ.map(lj => {
          const v = c.qtds?.[l.i]?.[lj.id];
          return `<label title="Quantidade ${esc(lj.nome)} · Enter/↓ próximo · ↑ anterior · ←→ ou Tab troca a loja"><span class="pip-loja-nome">${esc(lj.nome)}</span><span class="pip-loja-sigla">${esc(siglaLoja(lj))}</span><span class="pip-campo-qtd"><input class="qtd-loja${v > 0 ? ' preenchida' : v === 0 ? ' zerada' : ''}${ui.alertaEstoque?.it === l.it && ui.alertaEstoque.loja === lj.id ? ' no-limite' : ''}" inputmode="numeric" autocomplete="off" data-qtd-loja="${esc(lj.id)}" data-i="${l.i}" value="${v ?? ''}"${cotTravada(c) ? ' readonly' : ''} placeholder="0"><small class="pip-sub" data-sub-loja="${esc(lj.id)}">${subLojaPip(c, l, lj)}</small></span></label>`;
        }).join('')}<div id="pipEstoque">${estoquePip(c, l)}</div></div>
        <div class="pip-total" id="pipTotal">${celTotal(l)}</div>
      </div>
    </div>
    <div id="pipProximos">${htmlProximosPip(c, lista)}</div>
    <p class="pip-ajuda" title="Atalhos de uma tecla">C copia · D dúvida · S 2º lugar · / buscar${pip.flutuante ? '' : ' · sempre por cima: <b>Win + Ctrl + T</b> (PowerToys)'}</p>`;
  const campos = [...d.querySelectorAll('input[data-qtd-loja]')];
  if (sel) {
    const el = campos.find(x => x.dataset.qtdLoja === sel[0]);
    if (el) { el.focus(); try { el.setSelectionRange(sel[1], sel[2]); } catch (e) { /* sem seleção */ } }
  } else if (focar) {
    const el = campos[Math.min(pip.loja, campos.length - 1)];
    if (el) { el.focus(); el.select(); }
  }
}

/** Mesma quantidade nos dois lugares (comparativo e janela flutuante) sem redesenhar tudo. */
function espelharQtd(t, c, i) {
  if (pip.win?.closed) pip.win = null;
  const outros = [document];
  if (pip.win) outros.push(pip.win.document);
  for (const d of outros) {
    const el = d.querySelector(`input[data-qtd-loja="${CSS.escape(t.dataset.qtdLoja)}"][data-i="${i}"]`);
    if (el && el !== t) {
      el.value = t.value;
      el.classList.toggle('preenchida', t.classList.contains('preenchida'));
      el.classList.toggle('zerada', t.classList.contains('zerada'));
      el.classList.toggle('no-limite', t.classList.contains('no-limite'));
    }
  }
  if (pip.win && pip.cotId === c.id) {
    if (pip.i === i) {
      const pd = pip.win.document;
      const lin = comparar(c).linhas[i];
      const tot = pd.getElementById('pipTotal');
      if (tot) tot.innerHTML = celTotal(lin);
      const est = pd.getElementById('pipEstoque');
      if (est) est.innerHTML = estoquePip(c, lin);
      for (const lj of lojas()) { const sub = pd.querySelector(`[data-sub-loja="${CSS.escape(lj.id)}"]`); if (sub) sub.innerHTML = subLojaPip(c, lin, lj); }
      const [estado, rot] = estadoPip(c, lin);
      const cartao = pd.getElementById('pipItem');
      if (cartao) cartao.className = `pip-item estado-${estado}`;
      const rotulo = pd.getElementById('pipEstado');
      if (rotulo) rotulo.textContent = rot;
    }
    const lista = itensPip(c);
    const av = pip.win.document.getElementById('pipAviso');
    if (av) av.innerHTML = avisoConcluidoPip(c, lista);
    const ped = pip.win.document.getElementById('pipPedido');
    if (ped) ped.innerHTML = htmlPedidoPip(c);
    const px = pip.win.document.getElementById('pipProximos');
    if (px) px.innerHTML = htmlProximosPip(c, lista);
  }
}

/** Linha atual do comparativo: fica marcada para o olho não se perder (clique ou foco numa quantidade). */
function marcarLinhaComp(tr) {
  const c = cotAtual();
  if (!tr || !c) return;
  ui.linhaComp = { cotId: c.id, i: +tr.dataset.compLinha };
  document.querySelectorAll('tr.linha-atual').forEach(x => { if (x !== tr) x.classList.remove('linha-atual'); });
  tr.classList.add('linha-atual');
  if (pip.win && pip.cotId === c.id && pip.i !== ui.linhaComp.i) { pip.i = ui.linhaComp.i; desenharPip(false); }
}
document.addEventListener('click', e => marcarLinhaComp(e.target.closest?.('[data-comp-linha]')), true);
document.addEventListener('focusin', e => marcarLinhaComp(e.target.closest?.('[data-comp-linha]')));

document.addEventListener('focusin', e => {
  if (e.target.dataset?.qtdLoja != null) {
    e.target.select();
    const c = cotAtual();
    if (c) ui.ultQtd = { cotId: c.id, i: e.target.dataset.i, loja: e.target.dataset.qtdLoja }; // para voltar a ela pelo teclado
  }
});

/*
 * Nova cotação: setas andam pelos itens e qualquer letra começa a preencher a marca do item atual,
 * mesmo quando o cursor não está na lista (depois de um clique fora ou de a tela ser atualizada).
 */
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || rota().nome !== 'nova' || ui.datacar || document.querySelector('.dlg-fundo')) return;
  const tab = document.getElementById('tabItens');
  const t = e.target;
  if (!tab || tab.contains(t) || t.closest?.('input, textarea, select, [contenteditable], #telaLogin')) return;
  const letra = e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey;
  const navega = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Backspace', 'Delete'].includes(e.key) && !e.altKey;
  const abre = (e.key === 'Enter' || e.key === 'F2') && !t.closest?.('button, a, label, summary');
  if (!letra && !navega && !abre) return;
  tab.focus({ preventScroll: true });
  // a tecla vale como se tivesse sido apertada na lista
  teclaItens({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, target: tab, preventDefault: () => e.preventDefault() });
});

/* Digitar preços: setas e Enter andam pela tabela (Enter não salva o formulário no meio da digitação). */
document.addEventListener('keydown', e => {
  const t = e.target;
  const m = t.name?.match?.(/^([pmzo])_(\d+)$/);
  if (!m || !t.closest('#painelDigitar') || e.ctrlKey || e.altKey || e.metaKey) return;
  const cols = ['p', 'm', 'z', 'o'];
  const col = m[1], i = +m[2];
  const form = t.form;
  const campo = (c, k) => form.querySelector(`[name="${c}_${k}"]`);
  let alvo = null;
  if (e.key === 'ArrowDown' || e.key === 'Enter') alvo = campo(col, i + 1) || (e.key === 'Enter' ? form.querySelector('button.primary') : null);
  else if (e.key === 'ArrowUp') alvo = campo(col, i - 1);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const noInicio = t.selectionStart === 0 && t.selectionEnd === 0;
    const noFim = t.selectionStart === t.value.length && t.selectionEnd === t.value.length;
    const tudo = t.selectionStart === 0 && t.selectionEnd === t.value.length && t.value.length > 0;
    if (e.key === 'ArrowLeft' && (noInicio || tudo)) alvo = campo(cols[cols.indexOf(col) - 1], i);
    if (e.key === 'ArrowRight' && (noFim || tudo)) alvo = campo(cols[cols.indexOf(col) + 1], i);
  }
  if (e.key === 'Enter') e.preventDefault();
  if (!alvo) return;
  e.preventDefault();
  alvo.focus();
  if (alvo.select) alvo.select();
  alvo.scrollIntoView({ block: 'nearest' });
});

/** Campo de quantidade para onde vai o teclado: o último usado, senão o da linha marcada, senão o 1º item mostrado. */
function campoQtdAtual() {
  const c = cotAtual();
  if (!c || rota().nome !== 'cotacao') return null;
  const visivel = x => x && !x.closest('tr').hidden;
  const loja = ui.ultQtd?.cotId === c.id ? ui.ultQtd.loja : null; // continua na loja em que estava
  const naLinha = i => {
    const campos = [...document.querySelectorAll(`[data-qtd-loja][data-i="${CSS.escape(String(i))}"]`)];
    return campos.find(x => x.dataset.qtdLoja === loja) || campos[0];
  };
  // a linha marcada (clicada por último) manda; senão a da última quantidade; senão o 1º item mostrado
  const linha = ui.linhaComp?.cotId === c.id ? naLinha(ui.linhaComp.i) : null;
  if (visivel(linha)) return linha;
  const ult = loja ? naLinha(ui.ultQtd.i) : null;
  if (visivel(ult)) return ult;
  return [...document.querySelectorAll('[data-qtd-loja]')].find(visivel) || null;
}

// no comparativo, fora de qualquer campo: número digitado vai para a quantidade; as setas voltam para ela
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
  const ehNumero = /^[0-9]$/.test(e.key);
  if (!ehNumero && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const t = e.target;
  if (t.closest?.('input, textarea, select, [contenteditable], .dlg-fundo') || document.querySelector('.dlg-fundo') || ui.datacar) return;
  const campo = campoQtdAtual();
  if (!campo) return;
  e.preventDefault();
  campo.focus();
  if (ehNumero) {
    campo.value = e.key;
    campo.setSelectionRange(1, 1);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  }
});

document.addEventListener('keydown', e => {
  if (e.target.dataset?.qtdLoja != null) {
    // Tab: próxima quantidade na linha (Paranoá → São Sebastião → item de baixo); Shift+Tab volta.
    // Enter / ↓: item de baixo na mesma loja; ↑ sobe. ← → trocam de loja na mesma linha.
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey) {
      e.preventDefault();
      const naLinha = [...document.querySelectorAll(`[data-qtd-loja][data-i="${e.target.dataset.i}"]`)];
      naLinha[naLinha.indexOf(e.target) + (e.key === 'ArrowRight' ? 1 : -1)]?.focus();
      return;
    }
    const tab = e.key === 'Tab';
    const d = tab ? (e.shiftKey ? -1 : 1) : e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const todos = [...document.querySelectorAll('[data-qtd-loja]')].filter(x => (tab || x.dataset.qtdLoja === e.target.dataset.qtdLoja) && !x.closest('tr').hidden);
    const prox = todos[todos.indexOf(e.target) + d];
    if (prox) prox.focus();
    return;
  }
  if (!ui.datacar && e.target.closest && e.target.closest('#tabItens')) {
    teclaItens(e);
    return;
  }
  if (ui.datacar && $('#dlgDataCar') && !document.querySelector('.dlg-fundo:not(#dlgDataCar)')) {
    teclaDataCar(e);
    return;
  }
  if (e.target.matches?.('[data-act=recolherFornCot]') && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    alternarFornCot(e.target);
    return;
  }
  if (e.target.id === 'filtroItens') {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const v = itensVisiveis();
      if (v.length) moverCursorItem(v.includes(ui.cursorItem) && e.key === 'ArrowDown' ? ui.cursorItem : v[0]);
      else if (e.key === 'Enter') {
        const [p] = foraDaLista(ui.filtroItens, 1).lista; // não está na lista: inclui o primeiro do cadastro
        if (p) incluirNaLista(p.id);
        else cadastrarEIncluir(codigoParaCadastrar(ui.filtroItens)); // nem no banco: cadastra
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.target.value = '';
      ui.filtroItens = '';
      aplicarFiltroItens();
    }
    return;
  }
});

/*
 * Escolher arquivo: ao voltar da janela do Windows, o sistema pode redesenhar a tela (alterações de outro
 * computador) e trocar o campo de arquivo antes de o navegador avisar qual arquivo foi escolhido — a escolha
 * se perdia e era preciso escolher de novo. Enquanto a janela está aberta não redesenha; e o campo antigo
 * continua sendo ouvido mesmo se sair da tela.
 */
document.addEventListener('click', e => {
  const inp = e.target.closest?.('input[type=file]');
  if (!inp || inp.dataset.vigiado) return;
  inp.dataset.vigiado = '1';
  ui.escolhendoArquivo = Date.now();
  inp.addEventListener('change', ev => {
    ui.escolhendoArquivo = 0;
    delete inp.dataset.vigiado;
    if (!inp.isConnected) aoMudarCampo(ev); // saiu da tela: a delegação no document não recebe
  }, { once: true });
}, true);
window.addEventListener('focus', () => {
  // cancelou a janela de arquivo: libera o redesenho logo depois
  if (ui.escolhendoArquivo) setTimeout(() => { if (Date.now() - ui.escolhendoArquivo > 1500) ui.escolhendoArquivo = 0; }, 2000);
});

document.addEventListener('change', e => aoMudarCampo(e));
async function aoMudarCampo(e) {
  const t = e.target;
  if (t.dataset.forn) {
    const ids = rascunho().fornecedorIds;
    if (t.checked) { if (!ids.includes(t.dataset.forn)) ids.push(t.dataset.forn); }
    else ids.splice(ids.indexOf(t.dataset.forn), 1);
    t.closest('label').classList.toggle('on', t.checked);
    salvar();
    const h3 = t.closest('.card').querySelector('h3');
    if (h3) h3.textContent = `2. Fornecedores que vão receber (${ids.length})`;
  } else if (t.dataset.similarProd) {
    const p = db.produtos.find(x => x.id === t.dataset.similarProd);
    if (!p) return;
    p.similar = t.value.trim();
    salvar();
    const sum = t.closest('details')?.querySelector('summary');
    if (sum) sum.innerHTML = p.similar ? `<b>${esc(p.similar)}</b> ✎` : '+ similar';
    toast(p.similar ? `Similar salvo no cadastro de ${p.codigo || p.descricao}.` : 'Similar removido do cadastro.');
  } else if (t.dataset.codigoPapel != null) {
    corrigirCodigoPapel(+t.dataset.codigoPapel, t.value);
  } else if (t.dataset.codigoItem != null) {
    const item = rascunho().itens[+t.dataset.codigoItem];
    const p = item && db.produtos.find(x => x.id === item.produtoId);
    if (!p) return;
    const valor = t.value.trim();
    item.codigoArquivo = valor && valor !== p.codigo ? valor : '';
    toast(item.codigoArquivo ? `Código "${valor}" vale só nesta cotação. O cadastro continua "${p.codigo}".` : `Voltou para o código do cadastro: "${p.codigo}".`);
    salvar();
    render();
  } else if (t.dataset.marcaItem != null) {
    delete t.dataset.sugerido;
    const item = rascunho().itens[+t.dataset.marcaItem];
    const p = item && db.produtos.find(x => x.id === item.produtoId);
    if (!p) return;
    const valor = t.value.trim();
    if (!p.marca) {
      p.marca = valor;
      item.marca = '';
      toast(valor ? `Marca "${valor}" salva no cadastro de ${p.codigo || p.descricao}.` : 'Marca removida.');
    } else {
      item.marca = valor && valor !== p.marca ? valor : '';
      toast(item.marca ? `Marca "${valor}" vale só nesta cotação. O cadastro continua "${p.marca}" (Enter de novo grava como padrão).` : `Voltou para a marca do cadastro: "${p.marca}".`);
    }
    salvar();
    atualizarLinhaItem(+t.dataset.marcaItem); // a marca não muda a ordem da lista
    const av = document.getElementById('avisoNovosCad');
    if (av) av.innerHTML = htmlAvisoNovosCad();
    atualizarBarraCriar();
  } else if (t.id === 'dcColCod' || t.id === 'dcCol') {
    if (t.id === 'dcColCod') ui.datacar.colCod = +t.value; else ui.datacar.col = +t.value;
    casarLinhasDataCar();
    aplicarOrdemDataCar();
    Object.assign(ui.datacar, { pos: 0, gcur: 0, grupoAberto: null });
    renderSoDataCar();
    focarDataCar();
  } else if (t.id === 'filtroVencedor') {
    const c = cotAtual();
    if (!c) return;
    definirFiltroVencedor(c, t.value);
    // a janela flutuante passa a mostrar os mesmos itens
    if (pip.win && pip.cotId === c.id) { pip.i = itensPip(c)[0] ?? pip.i; desenharPip(false); }
    // já deixa o cursor na 1ª quantidade da 1ª loja dos itens mostrados
    const primeiro = [...document.querySelectorAll('[data-qtd-loja]')].find(x => !x.closest('tr').hidden);
    primeiro?.focus();
  } else if (t.id === 'verArquivadas') {
    ui.verArquivadas = t.checked;
    render();
  } else if (t.id === 'backupDias') {
    db.config.backupDias = Number(t.value);
    salvar();
    render();
  } else if (t.id === 'soComPreco') {
    ui.soComPreco = t.checked;
    $('#tbProd').innerHTML = linhasProdutos();
  } else if (t.id === 'periodoRel') {
    ui.periodoRel = t.value;
    render();
  } else if (t.id === 'notaCot') {
    ui.notaCot = t.value;
    render();
    document.getElementById('notaFornecedores')?.scrollIntoView({ block: 'start' });
  } else if (t.id === 'statusCot') {
    ui.statusCot = t.value;
    $('#tbCot').innerHTML = linhasCotacoes();
  } else if (t.dataset.confirmarForn != null) {
    const c = cotAtual();
    const f = c?.fornecedores[+t.dataset.confirmarForn];
    if (!f) return;
    f.confirmadoEm = t.checked ? new Date().toISOString() : null;
    salvar();
    atualizarResumosCot(c);
    toast(t.checked ? `${f.nome}: recebimento confirmado.` : `${f.nome}: confirmação desmarcada.`);
  } else if (t.dataset.selForn || t.hasAttribute('data-sel-todos')) {
    const c = cotAtual();
    if (!c || !ui.sel) return;
    if (t.hasAttribute('data-sel-todos')) {
      ui.sel.ids = new Set(t.checked ? c.fornecedores.map(f => f.fornecedorId) : []);
      document.querySelectorAll('[data-sel-forn]').forEach(x => { x.checked = t.checked; });
    } else {
      if (t.checked) ui.sel.ids.add(t.dataset.selForn); else ui.sel.ids.delete(t.dataset.selForn);
      const todos = $('[data-sel-todos]');
      if (todos) todos.checked = ui.sel.ids.size === c.fornecedores.length;
    }
    const q = $('#qtdSel');
    if (q) q.textContent = textoSel(c);
  } else if (t.name === 'formatoPedido') {
    ui.formatoPedido = t.value;
    if (ui.lote) ui.lote.formato = t.value;
    render();
  } else if (t.dataset.change === 'prazoCot') {
    cotAtual().prazoResposta = t.value;
    salvar();
    render();
  } else if (t.dataset.change === 'prazoHoraCot') {
    cotAtual().prazoHora = t.value;
    salvar();
    render();
  } else if (t.id === 'dcSoPend' && ui.datacar) {
    ui.datacar.soPend = t.checked;
    ui.datacar.selG = new Set();
    desenharConferencia();
    focarDataCar();
  } else if (t.dataset.change === 'statusCot') {
    cotAtual().status = t.value;
    salvar();
    render();
  } else if (t.type === 'file' && t.files.length && (t.dataset.importNfe != null || t.hasAttribute('data-import-nfe-cot') || t.hasAttribute('data-import-nfe-geral'))) {
    const files = [...t.files];
    t.value = '';
    if (t.dataset.importNfe != null) await importarNFes(files, cotAtual()?.id, +t.dataset.importNfe);
    else if (t.hasAttribute('data-import-nfe-cot')) await importarNFes(files, cotAtual()?.id, null);
    else await importarNFes(files, null, null);
  } else if (t.dataset.vincularNfe != null) {
    const c = cotAtual();
    const rec = c && (c.recebimentos || []).find(r => r.id === ui.conferindo?.recId);
    if (!rec || t.value === '') return;
    vincularItemNFe(c, rec, +t.dataset.vincularNfe, +t.value);
  } else if (t.type === 'file' && t.files.length) {
    const files = [...t.files];
    const file = files[0];
    t.value = '';
    if (t.dataset.import != null) await importarResposta(file, cotAtual()?.id, +t.dataset.import);
    else if (t.hasAttribute('data-import-geral')) await importarRespostas(files, null);
    else if (t.hasAttribute('data-import-cot')) await importarRespostas(files, cotAtual()?.id);
    else if (t.hasAttribute('data-import-produtos')) await importarProdutos(file);
    else if (t.hasAttribute('data-import-datacar')) await abrirArquivoDataCar(file);
    else if (t.hasAttribute('data-import-papel')) await abrirArquivoPapel(file);
    else if (t.hasAttribute('data-restaurar')) {
      try {
        const dados = JSON.parse(await file.text());
        if (!dados || !Array.isArray(dados.produtos) || !dados.config) throw new Error('Arquivo não é um backup deste sistema.');
        if (!(await confirmar(`Restaurar backup com ${dados.produtos.length} produtos, ${(dados.fornecedores || []).length} fornecedores e ${(dados.cotacoes || []).length} cotações? Os dados atuais serão substituídos.`))) return;
        db = normalizar(dados);
        salvar();
        render();
        toast('Backup restaurado.');
      } catch (err) {
        avisar('Não foi possível restaurar: ' + err.message);
      }
    }
  }
}

navegacao.nome = db.config.loja ? 'cotacoes' : 'config';
render();
mostrarStatus(nuvem.status);
iniciarNuvem();
