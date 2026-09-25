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
      'Por favor, preencha os preços unitários (campos em amarelo) e nos devolva a planilha por e-mail até {prazo}.\n\n' +
      'Obrigado,\n{comprador}\n{loja}\n{telefone}',
  },
  produtos: [],
  fornecedores: [],
  cotacoes: [],
  rascunho: null,
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
const ui = { digitando: null, enviando: null, datacar: null, cursorItem: 0, editProd: null, editForn: null, filtroProd: '', filtroForn: '', filtroCot: '', statusCot: '' };

/* ---------------- persistência ---------------- */

function carregar() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizar(JSON.parse(raw));
  } catch (e) {
    console.error(e);
  }
  return structuredClone(DEFAULT_DB);
}

function normalizar(d) {
  const base = structuredClone(DEFAULT_DB);
  return {
    ...base,
    ...d,
    config: { ...base.config, ...(d.config || {}) },
    produtos: d.produtos || [],
    fornecedores: d.fornecedores || [],
    cotacoes: d.cotacoes || [],
  };
}

let timerLocal = null;

function gravarLocal() {
  clearTimeout(timerLocal);
  timerLocal = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    if (!nuvem.db) avisar('Não foi possível salvar os dados no navegador. Faça um backup em Configurações.\n\n' + e.message);
  }
}

/** Salva sem travar a digitação: grava depois de uma pequena pausa. */
function salvar() {
  cacheBusca = null;
  clearTimeout(timerLocal);
  timerLocal = setTimeout(gravarLocal, 400);
  agendarSincronia();
}

window.addEventListener('pagehide', () => { if (timerLocal) gravarLocal(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && timerLocal) gravarLocal(); });

try {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
} catch (e) { /* sem suporte */ }

/* ---------------- nuvem (quando aberto como página do Claude) ----------------
 * Os dados ficam em documentos: produtos e fornecedores em lotes,
 * uma cotação por documento e as configurações em "sistema/*". */

const LOTE = 200;
const nuvem = { db: null, downloads: null, enviado: {}, timer: null, gravando: false, pendente: false, status: 'local' };

function docsDoEstado() {
  const docs = {
    'sistema/config': db.config,
    'sistema/extra': { rascunho: db.rascunho || null, ultimoBackup: db.ultimoBackup || null },
  };
  for (const col of ['produtos', 'fornecedores']) {
    const lista = [...db[col]].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i * LOTE < lista.length; i++) docs[`${col}/lote-${pad(i)}`] = { itens: lista.slice(i * LOTE, (i + 1) * LOTE) };
  }
  for (const c of db.cotacoes) docs[`cotacoes/${c.id}`] = c;
  return Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, JSON.stringify(v)]));
}

function agendarSincronia() {
  if (!nuvem.db) return;
  clearTimeout(nuvem.timer);
  nuvem.timer = setTimeout(sincronizar, 1200);
}

async function sincronizar() {
  if (!nuvem.db) return;
  if (nuvem.gravando) { nuvem.pendente = true; return; }
  nuvem.gravando = true;
  mostrarStatus('salvando');
  try {
    const atual = docsDoEstado();
    for (const [path, json] of Object.entries(atual)) {
      if (nuvem.enviado[path] === json) continue;
      await comRetentativa(() => nuvem.db.doc(path).set(JSON.parse(json)));
      nuvem.enviado[path] = json;
    }
    for (const path of Object.keys(nuvem.enviado)) {
      if (path in atual) continue;
      await comRetentativa(() => nuvem.db.doc(path).delete());
      delete nuvem.enviado[path];
    }
    mostrarStatus('salvo');
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
  const ler = async col => (await nuvem.db.collection(col).limit(1000).get()).docs.filter(d => d.exists).map(d => [`${col}/${d.id}`, d.data()]);
  const [sis, prods, forns, cots] = await Promise.all(['sistema', 'produtos', 'fornecedores', 'cotacoes'].map(ler));
  const todos = [...sis, ...prods, ...forns, ...cots];
  if (!todos.length) return null;
  for (const [path, data] of todos) nuvem.enviado[path] = JSON.stringify(data);
  // Os documentos chegam congelados (somente leitura): trabalhamos sempre com cópias.
  const mapa = structuredClone(Object.fromEntries(sis));
  return normalizar({
    config: mapa['sistema/config'] || {},
    rascunho: mapa['sistema/extra']?.rascunho || null,
    ultimoBackup: mapa['sistema/extra']?.ultimoBackup || null,
    produtos: structuredClone(prods.flatMap(([, d]) => d.itens || [])),
    fornecedores: structuredClone(forns.flatMap(([, d]) => d.itens || [])),
    cotacoes: cots.map(([, d]) => structuredClone(d)),
  });
}

function mostrarStatus(s) {
  nuvem.status = s;
  const el = $('#statusNuvem');
  if (!el) return;
  const txt = { local: 'Salvo neste navegador', salvando: 'Salvando…', salvo: 'Salvo na nuvem', erro: 'Erro ao salvar', carregando: 'Carregando…' }[s];
  el.textContent = txt;
  el.dataset.s = s;
}

async function iniciarNuvem() {
  if (!window.claude || typeof window.claude.use !== 'function') return;
  const [dbx, dl] = await Promise.all([
    window.claude.use('db').catch(() => null),
    window.claude.use('downloads').catch(() => null),
  ]);
  nuvem.downloads = dl;
  if (!dbx) return;
  mostrarStatus('carregando');
  try {
    nuvem.db = dbx;
    const remoto = await carregarNuvem();
    if (remoto) {
      db = remoto;
      cacheBusca = null;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) { /* cache opcional */ }
      render();
      mostrarStatus('salvo');
    } else if (db.produtos.length || db.fornecedores.length || db.cotacoes.length || db.config.loja) {
      await sincronizar(); // primeira vez: leva para a nuvem o que já estava no navegador
    } else {
      mostrarStatus('salvo');
    }
  } catch (e) {
    console.error(e);
    nuvem.db = null;
    mostrarStatus('local');
    toast('Não consegui acessar os dados na nuvem. Usando os dados deste navegador.', 6000);
  }
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

function fmtMoeda(v) {
  return v == null || isNaN(v) ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtNum(v, dec = 3) {
  return v == null || isNaN(v) ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: dec });
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

function abrirDialogo(msg, botoes) {
  return new Promise(resolve => {
    const fundo = document.createElement('div');
    fundo.className = 'dlg-fundo';
    fundo.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">
      <p>${esc(msg).replace(/\n/g, '<br>')}</p>
      <div class="actions">${botoes.map((b, i) => `<button type="button" class="${b.cls || ''}" data-i="${i}">${esc(b.txt)}</button>`).join('')}</div>
    </div>`;
    const fechar = v => { fundo.remove(); document.removeEventListener('keydown', tecla, true); resolve(v); };
    const tecla = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fechar(botoes[0].valor); }
      else if (e.key === 'Enter' || e.key === ' ') { e.stopImmediatePropagation(); }
    };
    fundo.addEventListener('click', e => {
      e.stopPropagation();
      const b = e.target.closest('button[data-i]');
      if (b) fechar(botoes[+b.dataset.i].valor);
    });
    document.addEventListener('keydown', tecla, true);
    document.body.appendChild(fundo);
    fundo.querySelector('button:last-child').focus();
  });
}

/** Diálogo com um campo (texto com sugestões ou lista). Devolve o valor, ou null se cancelar. */
function pedirValor(msg, { valor = '', opcoes = [], tipo = 'texto', ok = 'OK' } = {}) {
  return new Promise(resolve => {
    const fundo = document.createElement('div');
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
    const fechar = v => { fundo.remove(); document.removeEventListener('keydown', tecla, true); resolve(v); };
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
    document.addEventListener('keydown', tecla, true);
    document.body.appendChild(fundo);
    inp().focus();
    if (inp().select) inp().select();
  });
}

function confirmar(msg, ok = 'Confirmar') {
  return abrirDialogo(msg, [{ txt: 'Cancelar', valor: false }, { txt: ok, valor: true, cls: 'primary' }]);
}

function avisar(msg) {
  return abrirDialogo(msg, [{ txt: 'OK', valor: undefined, cls: 'primary' }]);
}

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Salva um arquivo perguntando onde: no Chrome/Edge (arquivo aberto no computador) abre a janela
 * "Salvar como"; na página publicada, o próprio Claude pede a confirmação do download.
 * gerar() devolve o Blob. Retorna false se a pessoa cancelou.
 */
async function salvarComo(nome, gerar) {
  if (!nuvem.downloads && typeof window.showSaveFilePicker === 'function') {
    let handle = null;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: nome,
        types: [{ description: 'Planilha do Excel', accept: { [TIPO_XLSX]: ['.xlsx'] } }],
      });
    } catch (e) {
      if (e && e.name === 'AbortError') return false; // cancelou a janela
      handle = null; // navegador bloqueou a janela: baixa do jeito normal
    }
    if (handle) {
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
  if (!db.rascunho) db.rascunho = { titulo: '', prazoResposta: '', obs: '', itens: [], fornecedorIds: [] };
  return db.rascunho;
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

/**
 * Monta o comparativo de preços de uma cotação.
 * O vencedor de cada item é o menor preço, a não ser que a pessoa tenha escolhido outro fornecedor
 * (c.escolhas[i] = fornecedorId). l.preco é o preço do vencedor; l.min continua sendo o menor preço.
 */
function comparar(c) {
  const linhas = c.itens.map((it, i) => {
    const precos = c.fornecedores.map(f => {
      const p = f.respostas?.[i]?.preco;
      return p != null && p > 0 ? p : null;
    });
    const validos = precos.filter(p => p != null);
    const min = validos.length ? Math.min(...validos) : null;
    let vencedor = min == null ? -1 : precos.indexOf(min);
    let manual = false;
    const escolhido = c.escolhas?.[i];
    if (escolhido) {
      const j = c.fornecedores.findIndex(f => f.fornecedorId === escolhido);
      if (j >= 0 && precos[j] != null) { vencedor = j; manual = precos[j] !== min; }
    }
    const preco = vencedor >= 0 ? precos[vencedor] : null;
    return { it, i, precos, min, vencedor, preco, manual };
  });
  const totais = c.fornecedores.map((f, fi) => {
    let total = 0, cotados = 0, vencidos = 0, valorVencido = 0;
    for (const l of linhas) {
      const p = l.precos[fi];
      if (p == null) continue;
      total += p * l.it.quantidade;
      cotados++;
      if (l.vencedor === fi) { vencidos++; valorVencido += p * l.it.quantidade; }
    }
    return { total, cotados, vencidos, valorVencido };
  });
  const melhor = linhas.reduce((s, l) => s + (l.preco != null ? l.preco * l.it.quantidade : 0), 0);
  const menorPossivel = linhas.reduce((s, l) => s + (l.min != null ? l.min * l.it.quantidade : 0), 0);
  const itensCotados = linhas.filter(l => l.min != null).length;
  const escolhasManuais = linhas.filter(l => l.manual).length;
  return { linhas, totais, melhor, menorPossivel, itensCotados, escolhasManuais };
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

function preencherModelo(tpl, c, f) {
  const cfg = db.config;
  const vars = {
    fornecedor: f.contato || f.nome,
    numero: c.numero,
    loja: cfg.loja,
    comprador: cfg.comprador,
    telefone: cfg.telefone,
    email: cfg.email,
    prazo: c.prazoResposta ? fmtData(c.prazoResposta) : 'o prazo combinado',
    titulo: c.titulo || '',
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] || '' : m)).replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------- Excel: planilha para o fornecedor ---------------- */

const XL = {
  azul: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } },
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
 * Planilha da cotação (layout v3): Item, Código, Similar, QTD (sempre 1), Marca, Descrição e,
 * no final, as colunas VALOR e MARCA para o fornecedor preencher.
 * `f` pode ser nulo: planilha genérica, sem nome de fornecedor.
 */
async function gerarPlanilha(c, f) {
  const cfg = db.config;
  const wb = new ExcelJS.Workbook();
  wb.creator = cfg.loja || 'Sistema de Cotação';
  wb.created = new Date();

  const ws = wb.addWorksheet('Cotação', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const COLS = 8; // A..H
  const ULT = 'H';

  ws.mergeCells(`A1:${ULT}1`);
  const titulo = ws.getCell('A1');
  titulo.value = 'SOLICITAÇÃO DE COTAÇÃO';
  titulo.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titulo.fill = XL.azul;
  titulo.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 21;

  const info = (row, label, value, label2, value2) => {
    ws.mergeCells(`A${row}:B${row}`);
    ws.getCell(`A${row}`).value = label;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.mergeCells(`C${row}:E${row}`);
    ws.getCell(`C${row}`).value = value || '';
    if (label2) {
      ws.getCell(`F${row}`).value = label2;
      ws.getCell(`F${row}`).font = { bold: true };
      ws.mergeCells(`G${row}:H${row}`);
      ws.getCell(`G${row}`).value = value2 || '';
      ws.getCell(`G${row}`).alignment = { horizontal: 'left' };
    }
  };
  info(2, 'Solicitante:', cfg.loja, 'Cotação nº:', c.numero);
  info(3, 'CNPJ:', cfg.cnpj, 'Data:', fmtData(c.data));
  info(4, 'Contato:', [cfg.comprador, cfg.telefone].filter(Boolean).join(' - '), 'Responder até:', c.prazoResposta ? fmtData(c.prazoResposta) : '');
  info(5, 'E-mail:', cfg.email, 'Referência:', c.titulo || '');
  info(6, 'Endereço:', cfg.endereco);

  ws.mergeCells('A7:B7');
  ws.getCell('A7').value = 'Fornecedor:';
  ws.getCell('A7').font = { bold: true };
  ws.mergeCells(`C7:${ULT}7`);
  const cf = ws.getCell('C7');
  cf.value = f ? f.nome : '';
  cf.font = { bold: true, size: 12 };
  if (!f) { cf.fill = XL.amarelo; cf.protection = { locked: false }; }

  ws.mergeCells('A8:B8');
  ws.getCell('A8').value = 'Observações:';
  ws.getCell('A8').font = { bold: true };
  ws.getCell('A8').alignment = { vertical: 'top' };
  ws.mergeCells(`C8:${ULT}8`);
  ws.getCell('C8').value = c.obs || '';
  ws.getCell('C8').alignment = { vertical: 'top', wrapText: !!c.obs };
  if (c.obs && (c.obs.length > 120 || c.obs.includes('\n'))) ws.getRow(8).height = Math.min(120, 15 * Math.ceil(c.obs.length / 120 + (c.obs.match(/\n/g) || []).length));

  ws.mergeCells(`A9:${ULT}9`);
  const instr = ws.getCell('A9');
  instr.value = 'Preencha as colunas em AMARELO: VALOR (preço unitário) e MARCA (marca que você vai fornecer). Depois devolva esta planilha por e-mail.';
  instr.font = { italic: true, color: { argb: 'FF7F6000' } };
  instr.fill = XL.amarelo;
  instr.alignment = { vertical: 'middle' };

  const HEADER = 11;
  const FIRST = HEADER + 1;
  const cab = ['Item', 'Código', 'Similar', 'QTD', 'Marca', 'Descrição', 'VALOR', 'MARCA'];
  const hr = ws.getRow(HEADER);
  cab.forEach((txt, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = txt;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = XL.azul;
    cell.border = XL.borda;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  c.itens.forEach((it, i) => {
    const r = FIRST + i;
    const row = ws.getRow(r);
    row.values = [i + 1, it.codigo || '', it.similar || '', 1, it.marca || '', it.descricao];
    for (let col = 1; col <= COLS; col++) {
      const cell = row.getCell(col);
      cell.border = XL.borda;
      cell.alignment = { vertical: 'middle' };
    }
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
    const valor = row.getCell(7);
    valor.numFmt = XL.moeda;
    valor.dataValidation = {
      type: 'decimal',
      operator: 'greaterThanOrEqual',
      formulae: [0],
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: 'Valor inválido',
      error: 'Digite apenas o valor (número).',
    };
    for (const col of [7, 8]) {
      row.getCell(col).fill = XL.amarelo;
      row.getCell(col).protection = { locked: false };
    }
  });

  const LAST = FIRST + c.itens.length - 1;
  const TOTAL = LAST + 1;
  ws.mergeCells(`A${TOTAL}:F${TOTAL}`);
  ws.getCell(`A${TOTAL}`).value = 'TOTAL';
  ws.getCell(`A${TOTAL}`).alignment = { horizontal: 'right' };
  ws.getCell(`G${TOTAL}`).value = { formula: `SUM(G${FIRST}:G${LAST})` };
  ws.getCell(`G${TOTAL}`).numFmt = XL.moeda;
  for (const col of ['A', 'G', 'H']) {
    ws.getCell(`${col}${TOTAL}`).font = { bold: true };
    ws.getCell(`${col}${TOTAL}`).fill = XL.cinza;
    ws.getCell(`${col}${TOTAL}`).border = XL.borda;
  }

  // Larguras ajustadas ao conteúdo (como "Auto Ajuste" do Excel), no padrão definido pela loja.
  const larguras = cab.map((h, i) => {
    let m = String(h).length;
    c.itens.forEach(it => {
      const v = [String(c.itens.indexOf(it) + 1), it.codigo || '', it.similar || '', '1', it.marca || '', it.descricao || ''][i];
      if (v != null) m = Math.max(m, String(v).length);
    });
    return m + 2;
  });
  larguras[0] = Math.max(5, larguras[0]);
  larguras[6] = Math.max(12, larguras[6]); // VALOR: espaço para "R$ 1.234,56" sem virar ####
  ws.columns = larguras.map(width => ({ width: Math.min(width, 80) }));

  ws.views = [{ state: 'frozen', ySplit: HEADER }];
  if (cfg.protegerPlanilha) {
    await ws.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true });
  }

  // Aba oculta usada para reconhecer a planilha quando o fornecedor devolver.
  const meta = wb.addWorksheet('_dados', { state: 'veryHidden' });
  [
    'sistema-cotacao', c.id, f ? f.fornecedorId : '', HEADER, FIRST, c.itens.length, 0, c.numero, 3,
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
  const wb = new ExcelJS.Workbook();
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
function aplicarResposta(c, fi, ws, meta) {
  let first = meta?.first;
  let cond = meta?.cond;
  let versao = meta?.versao || 0;
  if (!first) {
    // Planilha sem aba de controle: procura o cabeçalho "VALOR" (v2) ou "Preço Unit." (v1).
    for (let r = 1; r <= 60 && !first; r++) {
      // procura a linha de cabeçalho (coluna A = "Item"); a faixa de instruções também cita VALOR/preço
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
  let qtd = 0;
  const limite = meta?.n || c.itens.length;
  for (let k = 0; k < limite; k++) {
    const r = first + k;
    const idx = parseInt(cellTexto(ws.getCell(`A${r}`)), 10);
    const i = Number.isInteger(idx) && idx >= 1 && idx <= c.itens.length ? idx - 1 : k;
    if (i >= c.itens.length) break;
    const preco = parseNum(cellValue(ws.getCell(`${colPreco}${r}`)));
    const marca = colMarca ? cellTexto(ws.getCell(`${colMarca}${r}`)) : '';
    const prazo = versao >= 2 ? '' : cellTexto(ws.getCell(`I${r}`));
    const obs = versao >= 2 ? '' : cellTexto(ws.getCell(`J${r}`));
    if (preco != null || marca || prazo || obs) respostas[i] = { preco, marca, prazo, obs };
    if (preco != null && preco > 0) qtd++;
  }
  if (!cond) {
    for (let r = first + limite; r <= first + limite + 20; r++) {
      if (/pagamento/i.test(cellTexto(ws.getCell(`A${r}`)))) { cond = r; break; }
    }
  }
  const condicoes = {};
  if (cond) COND_CAMPOS.forEach(([k], j) => { condicoes[k] = cellTexto(ws.getCell(`D${cond + j}`)); });

  const f = c.fornecedores[fi];
  f.respostas = respostas;
  f.cond = condicoes;
  f.respondidoEm = new Date().toISOString();
  salvar();
  return qtd;
}

async function importarResposta(file, cotId, fiSugerido) {
  try {
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
      const id = await pedirValor('Não consegui identificar a cotação desta planilha. Escolha a cotação:', {
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
    toast(`${qtd} preço(s) importado(s) de ${f.nome}.`);
    ir('cotacao', c.id);
    render();
  } catch (e) {
    console.error(e);
    avisar('Erro ao importar a planilha:\n' + e.message);
  }
}

/* ---------------- Excel: comparativo e produtos ---------------- */

async function exportarComparativo(c) {
  const { linhas, totais, melhor } = comparar(c);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comparativo', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const nf = c.fornecedores.length;
  const cab = ['Item', 'Código', 'Descrição', 'Unid.', 'Qtd.', ...c.fornecedores.map(f => f.nome), 'Preço escolhido', 'Fornecedor', 'Total'];
  ws.columns = [6, 14, 44, 8, 10, ...c.fornecedores.map(() => 18), 16, 24, 18].map(width => ({ width }));

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
      k + 1, l.it.codigo || '', l.it.descricao, l.it.unidade || '', l.it.quantidade,
      ...l.precos.map(p => p ?? ''),
      l.preco ?? '', l.vencedor >= 0 ? c.fornecedores[l.vencedor].nome + (l.manual ? ' (escolhido)' : '') : 'sem preço',
      l.preco != null ? l.preco * l.it.quantidade : '',
    ];
    for (let col = 1; col <= cab.length; col++) row.getCell(col).border = XL.borda;
    for (let j = 0; j < nf; j++) {
      const cell = row.getCell(6 + j);
      cell.numFmt = XL.moeda;
      if (j === l.vencedor) { cell.fill = XL.verde; cell.font = { bold: true, color: { argb: 'FF1E7B4A' } }; }
    }
    row.getCell(6 + nf).numFmt = XL.moeda;
    row.getCell(8 + nf).numFmt = XL.moeda;
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

/** Itens que cada fornecedor ganhou: [{ fi, f, itens: [{ it, i, preco, marca }], total }]. */
function pedidosPorFornecedor(c) {
  const { linhas } = comparar(c);
  return c.fornecedores.map((f, fi) => {
    const itens = linhas.filter(l => l.vencedor === fi).map(l => ({
      it: l.it, i: l.i, preco: l.preco, marca: f.respostas?.[l.i]?.marca || l.it.marca || '',
    }));
    return { fi, f, itens, total: itens.reduce((s, x) => s + x.preco * x.it.quantidade, 0) };
  }).filter(p => p.itens.length);
}

/** Monta uma aba "Pedido de compra" para um fornecedor no workbook `wb`. */
function abaPedido(wb, c, ped, nomeAba) {
  const cfg = db.config;
  const { f, itens } = ped;
  const ws = wb.addWorksheet(nomeAba, {
    pageSetup: { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const ULT = 'H';
  ws.mergeCells(`A1:${ULT}1`);
  const titulo = ws.getCell('A1');
  titulo.value = 'PEDIDO DE COMPRA';
  titulo.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titulo.fill = XL.azul;
  titulo.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 21;

  const info = (row, label, value, label2, value2) => {
    ws.mergeCells(`A${row}:B${row}`);
    ws.getCell(`A${row}`).value = label;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.mergeCells(`C${row}:E${row}`);
    ws.getCell(`C${row}`).value = value || '';
    if (label2) {
      ws.getCell(`F${row}`).value = label2;
      ws.getCell(`F${row}`).font = { bold: true };
      ws.mergeCells(`G${row}:H${row}`);
      ws.getCell(`G${row}`).value = value2 || '';
      ws.getCell(`G${row}`).alignment = { horizontal: 'left' };
    }
  };
  info(2, 'Comprador:', cfg.loja, 'Data:', fmtData(hojeISO()));
  info(3, 'CNPJ:', cfg.cnpj, 'Cotação nº:', c.numero);
  info(4, 'Contato:', [cfg.comprador, cfg.telefone].filter(Boolean).join(' - '), 'Referência:', c.titulo || '');
  info(5, 'E-mail:', cfg.email);
  info(6, 'Endereço:', cfg.endereco);

  ws.mergeCells('A7:B7');
  ws.getCell('A7').value = 'Fornecedor:';
  ws.getCell('A7').font = { bold: true };
  ws.mergeCells(`C7:${ULT}7`);
  ws.getCell('C7').value = [f.nome, f.contato].filter(Boolean).join(' — ');
  ws.getCell('C7').font = { bold: true, size: 12 };

  const conds = COND_CAMPOS.filter(([k]) => f.cond?.[k]);
  let r = 8;
  for (const [k, label] of conds) {
    ws.mergeCells(`A${r}:B${r}`);
    ws.getCell(`A${r}`).value = label + ':';
    ws.getCell(`A${r}`).font = { bold: true };
    ws.mergeCells(`C${r}:${ULT}${r}`);
    ws.getCell(`C${r}`).value = f.cond[k];
    r++;
  }

  const HEADER = r + 1;
  const FIRST = HEADER + 1;
  const cab = ['Item', 'Código', 'Similar', 'QTD', 'Marca', 'Descrição', 'Valor unit.', 'Total'];
  const hr = ws.getRow(HEADER);
  cab.forEach((txt, k) => {
    const cell = hr.getCell(k + 1);
    cell.value = txt;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = XL.azul;
    cell.border = XL.borda;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  itens.forEach((x, k) => {
    const n = FIRST + k;
    const row = ws.getRow(n);
    row.values = [k + 1, x.it.codigo || '', x.it.similar || '', x.it.quantidade, x.marca, x.it.descricao, x.preco, { formula: `D${n}*G${n}`, result: x.preco * x.it.quantidade }];
    for (let col = 1; col <= 8; col++) {
      row.getCell(col).border = XL.borda;
      row.getCell(col).alignment = { vertical: 'middle' };
    }
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(7).numFmt = XL.moeda;
    row.getCell(8).numFmt = XL.moeda;
  });

  const LAST = FIRST + itens.length - 1;
  const TOTAL = LAST + 1;
  ws.mergeCells(`A${TOTAL}:G${TOTAL}`);
  ws.getCell(`A${TOTAL}`).value = `TOTAL DO PEDIDO (${itens.length} ${itens.length === 1 ? 'item' : 'itens'})`;
  ws.getCell(`A${TOTAL}`).alignment = { horizontal: 'right' };
  ws.getCell(`H${TOTAL}`).value = { formula: `SUM(H${FIRST}:H${LAST})`, result: ped.total };
  ws.getCell(`H${TOTAL}`).numFmt = XL.moeda;
  for (const col of ['A', 'H']) {
    ws.getCell(`${col}${TOTAL}`).font = { bold: true };
    ws.getCell(`${col}${TOTAL}`).fill = XL.cinza;
    ws.getCell(`${col}${TOTAL}`).border = XL.borda;
  }

  const larguras = cab.map((h, k) => {
    let m = String(h).length;
    itens.forEach((x, j) => {
      const v = [String(j + 1), x.it.codigo || '', x.it.similar || '', String(x.it.quantidade), x.marca, x.it.descricao || ''][k];
      if (v != null) m = Math.max(m, String(v).length);
    });
    return m + 2;
  });
  larguras[0] = Math.max(5, larguras[0]);
  larguras[6] = Math.max(13, larguras[6]);
  larguras[7] = Math.max(14, larguras[7]);
  ws.columns = larguras.map(width => ({ width: Math.min(width, 80) }));
  ws.views = [{ state: 'frozen', ySplit: HEADER }];
  return ws;
}

function nomePedido(c, f) {
  return `Pedido_${c.numero}_${slug(f.nome)}.xlsx`;
}

/** Baixa o pedido de um fornecedor (fi) ou, sem fi, um arquivo com uma aba por fornecedor. */
async function baixarPedidos(c, fi) {
  const peds = pedidosPorFornecedor(c).filter(p => fi == null || p.fi === fi);
  if (!peds.length) { avisar('Nenhum item foi ganho por este fornecedor.'); return; }
  const wb = new ExcelJS.Workbook();
  wb.creator = db.config.loja || 'Sistema de Cotação';
  wb.created = new Date();
  const usados = new Set();
  for (const p of peds) {
    // nome da aba: até 31 caracteres, sem caracteres proibidos, sem repetir
    let base = p.f.nome.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Fornecedor';
    let nome = base, n = 2;
    while (usados.has(nome.toLowerCase())) nome = `${base.slice(0, 26)} ${n++}`;
    usados.add(nome.toLowerCase());
    abaPedido(wb, c, p, nome);
  }
  const arquivo = fi != null ? nomePedido(c, peds[0].f) : `Pedidos_${c.numero}.xlsx`;
  await baixarWorkbook(wb, arquivo);
}

async function exportarProdutos() {
  const wb = new ExcelJS.Workbook();
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
  codigo: ['codigo', 'cod', 'cod.', 'sku', 'referencia interna', 'ref interna'],
  descricao: ['descricao', 'produto', 'nome', 'item', 'descricao do produto'],
  unidade: ['unidade', 'un', 'und', 'unid', 'unid.', 'un.'],
  similar: ['similar', 'similares', 'equivalente', 'codigo similar', 'cod similar'],
  marca: ['marca', 'fabricante', 'referencia', 'ref', 'marca/ref.', 'marca/ref', 'brand'],
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
async function lerLinhasArquivo(file) {
  const cab = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const zip = cab[0] === 0x50 && cab[1] === 0x4b;
  const xlsAntigo = cab[0] === 0xd0 && cab[1] === 0xcf;
  if (xlsAntigo) throw new Error('Este arquivo está no formato antigo do Excel (.xls). Abra no Excel e salve como "Pasta de Trabalho do Excel (.xlsx)" ou como CSV, e selecione de novo.');
  if (zip) {
    const wb = new ExcelJS.Workbook();
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

const grupoDc = v => semAcento(v).replace(/\s+/g, ' ');
const chaveCodigo = v => semAcento(v).replace(/\s+/g, '');

/** Partes de um código para achar repetidos: "2527/GR12527" -> ["2527", "gr12527", "2527/gr12527"]. */
function tokensCodigo(cod) {
  const k = chaveCodigo(cod || '');
  if (!k) return [];
  const partes = k.split(/[\/,;|]+/).filter(t => t.length >= 3);
  return [...new Set([k, ...partes])];
}

const ORDEM_DC = { chave: 'OBS', arquivo: 'No arquivo', produto: 'Produto cadastrado', marca: 'Marca' };

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
    if (!mapa.has(k)) mapa.set(k, { k, rotulo: l.chave || 'Sem ' + d.cab[d.col], itens: [] });
    mapa.get(k).itens.push(l);
  }
  return [...mapa.values()].sort((a, b) => (!a.k - !b.k) || COLLATOR.compare(a.k, b.k));
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
  for (let i = depois + 1; i < gs.length; i++) if (['pendente', 'incompleto'].includes(estadoGrupo(gs[i]).estado)) return i;
  for (let i = 0; i <= depois && i < gs.length; i++) if (['pendente', 'incompleto'].includes(estadoGrupo(gs[i]).estado)) return i;
  return gs.length; // linha "Concluir"
}

function decidirGrupoDataCar(gi, decisao) {
  const d = ui.datacar;
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

function marcaAtualDataCar(l, p) {
  const d = ui.datacar;
  return l.marca ?? (p ? p.marca : (d.colMarca >= 0 ? l.cels[d.colMarca] : '')) ?? '';
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
  if (t.matches('select, input, textarea')) return; // seletores de coluna
  if (e.repeat && [' ', 'ArrowRight', 'ArrowLeft', 'Backspace', 'Enter'].includes(e.key)) { e.preventDefault(); return; } // tecla segurada não decide vários

  if (d.grupoAberto == null) {
    // ----- nível 1: grupos
    const n = gruposDataCar().length;
    const naLista = d.gcur < n;
    if (e.key === 'ArrowDown') { e.preventDefault(); moverGrupoDataCar(d.gcur + 1); }
    else if (e.key === 'ArrowUp' || e.key === 'Backspace') { e.preventDefault(); moverGrupoDataCar(d.gcur - 1); }
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
        <span>Grupos decididos: <b>${decididos}</b> de ${gs.length}</span>
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
  const linhas = gs.map((g, i) => {
    const e = estadoGrupo(g);
    const amostra = g.itens.slice(0, 3).map(l => (d.colDesc >= 0 && l.cels[d.colDesc]) || l.codigo).filter(Boolean);
    return `<div class="conf-grupo est-${e.estado} ${i === d.gcur ? 'atual' : ''}" data-g-idx="${i}">
      <div class="cg-obs"><b>${esc(g.rotulo)}</b><span>${e.n} ${e.n === 1 ? 'item' : 'itens'}</span></div>
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
  return `${progressoDataCar()}
    <div class="conf-grupos" role="listbox" aria-label="Grupos de ${esc(d.cab[d.col])}">
      ${linhas}
      <div class="conf-grupo conf-concluir ${d.gcur === gs.length ? 'atual' : ''}" data-g-idx="${gs.length}">
        <div><b>Concluir</b> · ${c.vai} item(ns) vão para a cotação${pend ? ` · <span class="conf-alerta">${pend} grupo(s) sem decisão</span>` : ' · ✓ todos os grupos decididos'}</div>
        <div class="small muted">Nesta linha, <span class="kbd">Enter</span> <span class="kbd">Enter</span> adiciona à cotação</div>
      </div>
    </div>
    <p class="small muted" style="margin:8px 0 0">
      <span class="kbd">↑</span> <span class="kbd">↓</span> grupos · <span class="kbd">→</span>/<span class="kbd">Espaço</span> grupo todo vai ·
      <span class="kbd">←</span> grupo todo não vai · <span class="kbd">Enter</span> escolher itens do grupo · <span class="kbd">Esc</span> sair
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
        : '<span class="badge warn">não cadastrado · será cadastrado ao adicionar</span>'}</div>
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
    <div class="dlg dlg-conf" role="dialog" aria-modal="true" aria-labelledby="dcTitulo" tabindex="-1" id="dcCaixa">
      <div class="row-between">
        <h3 id="dcTitulo" style="margin:0">Conferência por grupo de OBS</h3>
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
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      linhas = [];
      ws.eachRow({ includeEmpty: false }, row => {
        const vals = [];
        for (let col = 1; col <= Math.max(row.cellCount, 6); col++) vals.push(cellTexto(row.getCell(col)));
        linhas.push(vals);
      });
    }
    if (!linhas.length) throw new Error('Arquivo vazio.');

    const cab = linhas[0].map(semAcento);
    const idx = {};
    for (const [campo, nomes] of Object.entries(MAPA_COLUNAS)) {
      const i = cab.findIndex(h => nomes.includes(h));
      if (i >= 0) idx[campo] = i;
    }
    let dados = linhas;
    if (idx.descricao != null) dados = linhas.slice(1);
    else Object.assign(idx, { codigo: 0, descricao: 1, unidade: 2, marca: 3, categoria: 4, obs: 5 });

    const porCodigo = Object.fromEntries(db.produtos.filter(p => p.codigo).map(p => [semAcento(p.codigo), p]));
    let novos = 0, atualizados = 0;
    for (const l of dados) {
      const get = k => (idx[k] != null ? String(l[idx[k]] ?? '').trim() : '');
      const p = { codigo: get('codigo'), similar: get('similar'), descricao: get('descricao'), unidade: get('unidade').toUpperCase() || 'UN', marca: get('marca'), categoria: get('categoria'), obs: get('obs') };
      if (!p.descricao) continue;
      const existente = p.codigo && porCodigo[semAcento(p.codigo)];
      if (existente) {
        Object.assign(existente, Object.fromEntries(Object.entries(p).filter(([, v]) => v)));
        atualizados++;
      } else {
        const novo = { id: uid(), ...p, criadoEm: new Date().toISOString() };
        db.produtos.push(novo);
        if (novo.codigo) porCodigo[semAcento(novo.codigo)] = novo;
        novos++;
      }
    }
    salvar();
    render();
    toast(`${novos} produto(s) novo(s), ${atualizados} atualizado(s).`);
  } catch (e) {
    console.error(e);
    avisar('Erro ao importar produtos:\n' + e.message);
  }
}

/* ---------------- e-mail ---------------- */

function dadosEmail(c, f) {
  const assunto = preencherModelo(db.config.assuntoEmail, c, f);
  const corpo = preencherModelo(db.config.corpoEmail, c, f);
  return {
    assunto,
    corpo,
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(f.email)}&su=${enc(assunto)}&body=${enc(corpo)}`,
    outlook: `https://outlook.office.com/mail/deeplink/compose?to=${enc(f.email)}&subject=${enc(assunto)}&body=${enc(corpo)}`,
    mailto: `mailto:${enc(f.email)}?subject=${enc(assunto)}&body=${enc(corpo.replace(/\n/g, '\r\n'))}`,
  };
}

function marcarEnviado(c, fi) {
  const f = c.fornecedores[fi];
  if (!f) return;
  f.enviadoEm = new Date().toISOString();
  salvar();
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

/** Itens da cotação sempre em ordem alfabética (A-Z) pela descrição. */
function ordenarItensRascunho(r, prod) {
  r.itens.sort((a, b) => COLLATOR.compare(prod[a.produtoId]?.descricao || '', prod[b.produtoId]?.descricao || '')
    || COLLATOR.compare(a.codigoArquivo || prod[a.produtoId]?.codigo || '', b.codigoArquivo || prod[b.produtoId]?.codigo || ''));
}

function renderNova() {
  const r = rascunho();
  const prod = byId(db.produtos);
  r.itens = r.itens.filter(x => prod[x.produtoId]);
  ordenarItensRascunho(r, prod);
  const forn = byId(db.fornecedores);
  r.fornecedorIds = r.fornecedorIds.filter(id => forn[id]);

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
  const repetido = (x, i = r.itens.indexOf(x)) => !x.dupVisto && (parceiros[i].length > 0 || (x.obsArquivo || []).length > 1);
  const nRepetidos = r.itens.filter(repetido).length;
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
  const obsDe = x => {
    const k2 = chaveCodigo(codDe(x));
    const o = (r.obsPorCodigo && r.obsPorCodigo[k2]) || x.obsArquivo || [];
    return o.length ? o.map(v => v || 'sem OBS').join(' · ') : (prod[x.produtoId].obs || '—');
  };
  const painelRep = gruposRep.length ? `
    <div class="painel-dup">
      <div class="painel-dup-titulo">⚠ <b>${gruposRep.length} caso(s) de código repetido</b> · compare os itens lado a lado e decida: <b>✓ Manter</b> ou <b>✕ Tirar</b></div>
      ${gruposRep.map(g => `
        <div class="dup-grupo">
          <div class="dup-comum">Código em comum: <b>${esc(g.comum.toUpperCase())}</b> · ${g.itens.length} itens</div>
          ${g.itens.map(j => {
            const x = r.itens[j];
            const px = prod[x.produtoId];
            return `<div class="dup-item ${x.dupVisto ? 'visto' : ''}">
              <button type="button" class="link dup-num" data-act="irItem" data-i="${j}" title="Ver na lista">#${j + 1}</button>
              <span class="dup-cod">${esc(codDe(x))}</span>
              <span class="dup-desc">${esc(px.descricao)}</span>
              <span class="dup-obs">OBS: <b>${esc(obsDe(x))}</b></span>
              <span class="dup-marca">${esc(x.marca || px.marca || '')}</span>
              <span class="dup-acoes">${x.dupVisto ? '<span class="badge ok">mantido</span>' : `<button class="sm" data-act="manterItem" data-i="${j}">✓ Manter</button>`}
                <button class="sm danger" data-act="removerItem" data-i="${j}" title="Tirar da cotação">✕ Tirar</button></span>
            </div>`;
          }).join('')}
        </div>`).join('')}
    </div>` : '';

  const linhas = r.itens.map((x, i) => {
    const p = prod[x.produtoId];
    const dup = repetido(x, i);
    // OBS da planilha original: todas as linhas do arquivo com este código; senão as linhas usadas; senão a OBS do cadastro
    const k = chaveCodigo(x.codigoArquivo || p.codigo);
    const daPlanilha = (r.obsPorCodigo && r.obsPorCodigo[k]) || x.obsArquivo || [];
    const obs = daPlanilha.map(o => o || 'sem OBS');
    const origemObs = daPlanilha.length ? 'OBS na planilha' : p.obs ? 'OBS no cadastro' : '';
    const textoObs = daPlanilha.length ? obs : p.obs ? [p.obs] : [];
    return `<tr data-item-linha="${i}" class="${i === ui.cursorItem ? 'item-atual' : ''} ${dup ? 'item-dup' : ''}">
      <td class="c">${i + 1}</td>
      <td>${esc(x.codigoArquivo || p.codigo)}${dup ? ' <span class="badge warn">repetido</span>' : ''}${dup && parceiros[i].length ? `<br><span class="obs-dup">mesmo código em: ${parceiros[i].slice(0, 4).map(j => `<button type="button" class="link" data-act="irItem" data-i="${j}" title="Ir para a linha ${j + 1}">#${j + 1} ${esc(codDe(r.itens[j]))}</button>`).join(' ')}${parceiros[i].length > 4 ? ` +${parceiros[i].length - 4}` : ''}</span>` : ''}${x.codigoArquivo && x.codigoArquivo !== p.codigo ? `<br><span class="small muted">cadastro: ${esc(p.codigo)}</span>` : ''}${textoObs.length
        ? `<br><span class="${dup ? 'obs-dup' : 'obs-item'}">${origemObs}: <b>${textoObs.map(esc).join(' · ')}</b></span>`
        : dup ? '<br><span class="obs-dup">OBS: não encontrada. Importe o arquivo do DataCar de novo para ver.</span>' : ''}</td>
      <td style="width:170px"><input data-similar-prod="${p.id}" value="${esc(p.similar)}" placeholder="Opcional" aria-label="Códigos similares de ${esc(p.descricao)}"></td>
      <td style="width:170px"><input class="${(x.marca || p.marca) ? '' : 'falta'} ${x.marca ? 'so-cotacao' : ''}" data-marca-item="${i}" value="${esc(x.marca || p.marca)}" placeholder="Informar marca" title="${p.marca ? `Cadastro: ${esc(p.marca)}. Alterar aqui muda só nesta cotação.` : 'Sem marca no cadastro: a marca informada fica salva.'}" aria-label="Marca de ${esc(p.descricao)}">${x.marca ? `<br><span class="small muted">cadastro: ${esc(p.marca)}</span>` : ''}</td>
      <td>${esc(p.descricao)}</td>
      <td class="c" style="white-space:nowrap">${dup ? `<button class="sm" data-act="manterItem" data-i="${i}" title="Manter na cotação e tirar o destaque">✓ Manter</button> ` : ''}<button class="sm danger" data-act="removerItem" data-i="${i}" title="Remover">✕</button></td>
    </tr>`;
  }).join('');

  const fornList = db.fornecedores.length
    ? `<div class="checklist">${[...db.fornecedores].sort((a, b) => a.nome.localeCompare(b.nome)).map(f => `
        <label class="${r.fornecedorIds.includes(f.id) ? 'on' : ''}"><input type="checkbox" data-forn="${f.id}" ${r.fornecedorIds.includes(f.id) ? 'checked' : ''}>
        <span><b>${esc(f.nome)}</b><br><span class="small muted">${esc(f.email || 'sem e-mail')}</span></span></label>`).join('')}</div>`
    : '<p class="muted">Nenhum fornecedor cadastrado ainda.</p>';

  return `
  <section class="card">
    <h2>Nova cotação</h2>
    <div class="grid">
      <label>Título / referência (opcional)<input data-draft="titulo" value="${esc(r.titulo)}" placeholder="Ex.: Reposição mensal"></label>
      <label>Responder até<input type="date" data-draft="prazoResposta" value="${esc(r.prazoResposta)}"></label>
    </div>
    <label>Observações para o fornecedor (vai na planilha)<textarea data-draft="obs" placeholder="Ex.: Entrega na loja, informar prazo e forma de pagamento.">${esc(r.obs)}</textarea></label>
  </section>

  <section class="card">
    <h3>1. Itens da cotação (${r.itens.length})</h3>
    <div class="datacar-box">
      <label class="btn btn-primary" style="margin:0">📂 Abrir arquivo do DataCar<input type="file" class="hidden" accept=".xlsx,.xls,.csv,.txt,.htm,.html" data-import-datacar></label>
      <span class="small muted">Escolha o arquivo gerado pelo DataCar e marque os itens que vão para a cotação. Os itens são reconhecidos pelo <b>código</b>; a <b>OBS</b> serve para ordenar e agrupar.</span>
    </div>
    <p class="small muted" style="margin:10px 0 6px">Ou busque um produto cadastrado:</p>
    <div class="search">
      <input id="buscaProd" placeholder="Buscar por código, similar, descrição ou marca… (Enter adiciona o primeiro)" autocomplete="off">
      <div id="resultadosProd" class="results"></div>
    </div>
    <details>
      <summary>+ Cadastrar produto novo e adicionar</summary>
      <form data-form="produtoRapido" class="grid">
        <label>Código<input name="codigo"></label>
        <label>Descrição *<input name="descricao" required></label>
        <label>Unidade<input name="unidade" value="UN"></label>
        <label>Marca/Ref.<input name="marca"></label>
        <div class="actions" style="align-self:end"><button class="primary">Salvar e adicionar</button></div>
      </form>
    </details>
    ${painelRep}
    ${r.itens.length ? `<div class="table-wrap tab-itens" id="tabItens" tabindex="0" aria-label="Itens da cotação. Use as setas para navegar e digite para preencher a marca."><table>
      <thead><tr><th class="c">#</th><th>Código</th><th>Similar</th><th>Marca</th><th>Descrição A→Z</th><th></th></tr></thead>
      <tbody>${linhas}</tbody></table></div>
      <p class="small muted" style="margin:6px 0 0">Clique numa linha e use <span class="kbd">↑</span> <span class="kbd">↓</span> para navegar · digite para preencher a marca · <span class="kbd">Enter</span> salva · <span class="kbd">Esc</span> desfaz · <span class="kbd">F2</span> completa a marca sem apagar</p>` : '<p class="empty">Busque e adicione produtos acima.</p>'}
  </section>

  <section class="card">
    <h3>2. Fornecedores que vão receber (${r.fornecedorIds.length})</h3>
    <p class="small muted" style="margin:-6px 0 10px">Opcional. Você pode criar a cotação sem fornecedor e enviar a planilha para quem quiser; ao importar a resposta, o fornecedor é identificado pelo nome escrito na planilha.</p>
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

  <div class="actions">
    <button data-act="limparRascunho">Limpar tudo</button>
    <button class="primary" data-act="criarCotacao" title="Cria a cotação e salva a planilha em Excel">Criar cotação e salvar planilha →</button>
  </div>
  ${renderDataCar()}`;
}

let cacheBusca = null;
const COLLATOR = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

/** Texto de busca (sem acentos) de cada produto, calculado uma vez. */
function indiceBusca() {
  if (!cacheBusca) cacheBusca = db.produtos.map(p => [p, semAcento(`${p.codigo} ${p.similar || ''} ${p.descricao} ${p.marca} ${p.categoria}`)]);
  return cacheBusca;
}

function resultadosBusca(q) {
  const box = $('#resultadosProd');
  if (!box) return;
  q = semAcento(q);
  if (!q) { box.innerHTML = ''; return; }
  const termos = q.split(/\s+/);
  const ja = new Set(rascunho().itens.map(x => x.produtoId));
  const achados = [];
  for (const [p, t] of indiceBusca()) {
    if (termos.every(w => t.includes(w))) { achados.push(p); if (achados.length === 30) break; }
  }
  box.innerHTML = achados.length
    ? achados.map(p => `<button type="button" data-act="addItem" data-id="${p.id}" ${ja.has(p.id) ? 'disabled' : ''}>
        <b>${esc(p.codigo || '—')}</b> · ${esc(p.descricao)} ${p.marca ? `<span class="muted">(${esc(p.marca)})</span>` : ''}${p.similar ? ` <span class="muted small">sim. ${esc(p.similar)}</span>` : ''} <span class="muted small">${esc(p.unidade)}</span>
        ${ja.has(p.id) ? '<span class="badge">já adicionado</span>' : ''}</button>`).join('')
    : '<div class="none">Nenhum produto encontrado. Use "Cadastrar produto novo" abaixo.</div>';
}

function linhasCotacoes() {
  const q = semAcento(ui.filtroCot);
  const lista = [...db.cotacoes]
    .sort((a, b) => (b.data + b.numero).localeCompare(a.data + a.numero))
    .filter(c => !ui.statusCot || c.status === ui.statusCot)
    .filter(c => !q || semAcento(`${c.numero} ${c.titulo} ${c.fornecedores.map(f => f.nome).join(' ')} ${c.itens.map(i => i.descricao + ' ' + i.codigo).join(' ')}`).includes(q));
  if (!lista.length) return `<tr><td colspan="7" class="empty">Nenhuma cotação encontrada.</td></tr>`;
  return lista.map(c => {
    const resp = c.fornecedores.filter(f => f.respondidoEm).length;
    const { melhor, itensCotados } = comparar(c);
    return `<tr>
      <td><a href="#" data-route="cotacao" data-id="${c.id}"><b>${esc(c.numero)}</b></a></td>
      <td>${fmtData(c.data)}</td>
      <td>${esc(c.titulo || '—')}</td>
      <td class="c">${c.itens.length}</td>
      <td class="c"><span class="badge ${resp === c.fornecedores.length && resp ? 'ok' : resp ? 'warn' : ''}">${resp}/${c.fornecedores.length}</span></td>
      <td class="r">${itensCotados ? fmtMoeda(melhor) : '—'}</td>
      <td>${statusBadge(c.status)}</td>
    </tr>`;
  }).join('');
}

function renderCotacoes() {
  const abertas = db.cotacoes.filter(c => c.status === 'aberta');
  const aguardando = abertas.reduce((s, c) => s + c.fornecedores.filter(f => !f.respondidoEm).length, 0);
  return `
  <section class="card">
    <div class="row-between">
      <h2>Cotações</h2>
      <div class="row">
        <label class="btn" style="margin:0">📥 Importar planilha respondida<input type="file" class="hidden" accept=".xlsx,.xls" data-import-geral></label>
        <a class="btn btn-primary" href="#" data-route="nova">+ Nova cotação</a>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><span class="muted small">Total de cotações</span><b>${db.cotacoes.length}</b></div>
      <div class="stat"><span class="muted small">Abertas</span><b>${abertas.length}</b></div>
      <div class="stat"><span class="muted small">Respostas pendentes</span><b>${aguardando}</b></div>
    </div>
    <div class="row">
      <input class="grow" id="filtroCot" placeholder="Buscar por nº, título, fornecedor ou produto…" value="${esc(ui.filtroCot)}">
      <select id="statusCot" style="width:auto">
        <option value="">Todos os status</option>
        ${Object.entries(STATUS).map(([k, [t]]) => `<option value="${k}" ${ui.statusCot === k ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>
  </section>
  <section class="card table-wrap">
    <table>
      <thead><tr><th>Nº</th><th>Data</th><th>Título</th><th class="c">Itens</th><th class="c">Respostas</th><th class="r">Melhor total</th><th>Status</th></tr></thead>
      <tbody id="tbCot">${linhasCotacoes()}</tbody>
    </table>
  </section>`;
}

function renderCotacao(id) {
  const c = db.cotacoes.find(x => x.id === id);
  if (!c) return `<section class="card"><p class="empty">Cotação não encontrada. <a href="#" data-route="cotacoes">Voltar</a></p></section>`;
  const comp = comparar(c);
  const naLista = new Set(c.fornecedores.map(f => f.fornecedorId));
  const disponiveis = db.fornecedores.filter(f => !naLista.has(f.id)).sort((a, b) => a.nome.localeCompare(b.nome));

  const fornRows = c.fornecedores.map((f, fi) => {
    const t = comp.totais[fi];
    return `<tr>
      <td><b>${esc(f.nome)}</b>${f.contato ? `<br><span class="small muted">${esc(f.contato)}</span>` : ''}</td>
      <td class="small">${esc(f.email || '—')}</td>
      <td>${f.enviadoEm ? `<span class="badge ok">${fmtData(f.enviadoEm)}</span>` : '<span class="badge">não enviada</span>'}</td>
      <td>${f.respondidoEm ? `<span class="badge ok">${t.cotados}/${c.itens.length} itens</span>` : '<span class="badge warn">aguardando</span>'}</td>
      <td class="r">${f.respondidoEm ? fmtMoeda(t.total) : '—'}</td>
      <td class="actions-cell">
        <button class="sm" data-act="baixarPlanilha" data-f="${fi}" title="Baixar a planilha Excel deste fornecedor">⬇ Excel</button>
        <button class="sm" data-act="enviar" data-f="${fi}" title="Preparar o e-mail para este fornecedor">✉ Enviar</button>
        <label class="btn sm" style="margin:0" title="Importar a planilha que o fornecedor devolveu">📥 Importar<input type="file" class="hidden" accept=".xlsx,.xls" data-import="${fi}"></label>
        <button class="sm" data-act="digitar" data-f="${fi}" title="Digitar os preços manualmente">✎ Digitar</button>
        <button class="sm danger" data-act="removerFornCot" data-f="${fi}" title="Remover da cotação">✕</button>
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
    painel = `
    <section class="card" id="painelDigitar">
      <h3>Digitar preços — ${esc(f.nome)}</h3>
      <form data-form="precosManuais" data-f="${fi}">
        <div class="table-wrap"><table>
          <thead><tr><th class="c">#</th><th>Descrição</th><th class="r">Qtd.</th><th class="r">Preço unit. (R$)</th><th>Prazo</th><th>Observação</th></tr></thead>
          <tbody>${c.itens.map((it, i) => {
            const rr = f.respostas?.[i] || {};
            return `<tr>
              <td class="c">${i + 1}</td>
              <td>${esc(it.descricao)} <span class="muted small">${esc(it.unidade)}</span></td>
              <td class="r">${fmtNum(it.quantidade)}</td>
              <td style="width:140px"><input class="price" inputmode="decimal" name="p_${i}" value="${rr.preco != null ? esc(rr.preco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })) : ''}"></td>
              <td style="width:120px"><input name="z_${i}" value="${esc(rr.prazo)}"></td>
              <td><input name="o_${i}" value="${esc(rr.obs)}"></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
        <div class="grid" style="margin-top:12px">
          ${COND_CAMPOS.map(([k, label]) => `<label>${label}<input name="c_${k}" value="${esc(f.cond?.[k])}"></label>`).join('')}
        </div>
        <div class="actions">
          <button type="button" data-act="fecharDigitar">Cancelar</button>
          <button class="primary">Salvar preços</button>
        </div>
      </form>
    </section>`;
  }

  const temResposta = comp.itensCotados > 0;
  const nf = c.fornecedores.length;
  const ultimos = temResposta ? ultimosPrecos(c.id) : {};
  const chips = avs => avs.map(a => `<span class="alerta-preco ${a.tipo}" title="${esc(a.texto)}">⚠ ${esc(a.curto)}</span>`).join('');
  let qtdAlertas = 0;
  const tabelaComp = `
    <div class="table-wrap"><table class="tab-comp">
      <thead><tr>
        <th class="c">#</th><th>Produto</th><th class="r">Qtd.</th>
        ${c.fornecedores.map(f => `<th class="r">${esc(f.nome)}</th>`).join('')}
        ${temResposta ? '<th class="r">Preço escolhido</th><th>Fornecedor</th><th class="r">Total</th>' : ''}
      </tr></thead>
      <tbody>
        ${comp.linhas.map(l => {
          const ult = l.it.produtoId ? ultimos[l.it.produtoId] : null;
          const celulas = l.precos.map((p, j) => {
            const o = c.fornecedores[j].respostas?.[l.i];
            const extra = [o?.marca && `Marca: ${o.marca}`, o?.prazo, o?.obs].filter(Boolean).join(' · ');
            const avs = alertasPreco(p, ult, l.precos);
            if (avs.length) qtdAlertas++;
            const venc = j === l.vencedor && (nf > 1 || l.manual);
            const cls = ['r', venc ? 'best' : '', venc && l.manual ? 'escolhido' : '', p != null && nf > 1 ? 'escolhivel' : '', p != null && p === l.min && !venc && nf > 1 ? 'menor' : ''].filter(Boolean).join(' ');
            const dica = p == null ? '' : venc ? (l.manual ? 'Escolhido por você. Clique para voltar ao menor preço.' : 'Menor preço (vencedor).') : (p === l.min ? 'Menor preço. ' : '') + 'Clique para escolher este fornecedor para este item.';
            const attrs = p != null && nf > 1 ? ` data-act="escolherVencedor" data-i="${l.i}" data-f="${j}"` : '';
            return `<td class="${cls}"${attrs} title="${esc([dica, extra].filter(Boolean).join('\n'))}">${p != null ? fmtMoeda(p) : '<span class="muted">—</span>'}${venc && l.manual ? ' <span class="tag-escolha">escolhido</span>' : ''}${extra ? '<br><span class="small muted">' + esc(extra) + '</span>' : ''}${avs.length ? '<br>' + chips(avs) : ''}</td>`;
          }).join('');
          return `<tr>
          <td class="c">${l.i + 1}</td>
          <td>${esc(l.it.descricao)}<br><span class="small muted">${esc([l.it.codigo, l.it.similar && 'sim. ' + l.it.similar, l.it.marca].filter(Boolean).join(' · '))}</span></td>
          <td class="r">${fmtNum(l.it.quantidade)} ${esc(l.it.unidade)}</td>
          ${celulas}
          ${temResposta ? `<td class="r"><b>${l.preco != null ? fmtMoeda(l.preco) : '—'}</b>${ult ? `<br><span class="small muted" title="Último preço pago: ${esc(ult.fornecedor)}, cotação nº ${esc(ult.numero)} (${fmtData(ult.data)})">último ${fmtMoeda(ult.preco)}</span>` : ''}</td>
            <td>${l.vencedor >= 0 ? esc(c.fornecedores[l.vencedor].nome) + (l.manual ? `<br><span class="small muted">+${fmtMoeda((l.preco - l.min) * l.it.quantidade)} vs menor</span>` : '') : '<span class="muted">sem preço</span>'}</td>
            <td class="r">${l.preco != null ? fmtMoeda(l.preco * l.it.quantidade) : '—'}</td>` : ''}
        </tr>`;
        }).join('')}
        ${temResposta ? `<tr class="total">
          <td></td><td>Total dos itens cotados</td><td></td>
          ${comp.totais.map(t => `<td class="r">${t.cotados ? fmtMoeda(t.total) : '—'}<br><span class="small muted">${t.cotados}/${c.itens.length} itens · ${t.vencidos} ganho(s)</span></td>`).join('')}
          <td></td><td>${comp.escolhasManuais ? 'Total com suas escolhas' : 'Melhor combinação'}</td><td class="r">${fmtMoeda(comp.melhor)}${comp.escolhasManuais ? `<br><span class="small muted">menor possível ${fmtMoeda(comp.menorPossivel)}</span>` : ''}</td>
        </tr>
        ${COND_CAMPOS.map(([k, label]) => c.fornecedores.some(f => f.cond?.[k]) ? `<tr>
          <td></td><td class="small muted">${label}</td><td></td>
          ${c.fornecedores.map(f => `<td class="r small">${esc(f.cond?.[k] || '—')}</td>`).join('')}
          <td colspan="3"></td></tr>` : '').join('')}` : ''}
      </tbody>
    </table></div>`;

  const peds = temResposta ? pedidosPorFornecedor(c) : [];
  const semVencedor = comp.linhas.filter(l => l.vencedor < 0).length;
  const secaoPedidos = peds.length ? `
  <section class="card">
    <div class="row-between">
      <h3>Pedidos de compra</h3>
      ${peds.length > 1 ? '<button class="sm primary" data-act="baixarPedidos" title="Um arquivo Excel com uma aba para cada fornecedor">⬇ Todos os pedidos (um arquivo)</button>' : ''}
    </div>
    <p class="muted small" style="margin-top:0">Cada fornecedor recebe só os itens que ganhou no comparativo${comp.escolhasManuais ? `, incluindo as ${comp.escolhasManuais} escolha(s) feitas por você` : ''}.${semVencedor ? ` ${semVencedor} item(ns) ficaram sem preço e não entram em nenhum pedido.` : ''}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Fornecedor</th><th class="c">Itens</th><th class="r">Total do pedido</th><th>Pagamento / entrega</th><th></th></tr></thead>
      <tbody>${peds.map(p => `<tr>
        <td><b>${esc(p.f.nome)}</b></td>
        <td class="c">${p.itens.length}</td>
        <td class="r">${fmtMoeda(p.total)}</td>
        <td class="small">${esc([p.f.cond?.pagamento, p.f.cond?.prazo].filter(Boolean).join(' · ') || '—')}</td>
        <td class="actions-cell"><button class="sm" data-act="baixarPedido" data-f="${p.fi}">⬇ Pedido</button></td>
      </tr>`).join('')}
      <tr class="total"><td>Total</td><td class="c">${peds.reduce((s, p) => s + p.itens.length, 0)}</td><td class="r">${fmtMoeda(comp.melhor)}</td><td colspan="2"></td></tr>
      </tbody>
    </table></div>
  </section>` : '';

  return `
  <section class="card">
    <div class="row-between">
      <h2>Cotação nº ${esc(c.numero)} ${statusBadge(c.status)}</h2>
      <div class="row">
        <a class="btn" href="#" data-route="cotacoes">← Voltar</a>
        <select data-change="statusCot" style="width:auto">
          ${Object.entries(STATUS).map(([k, [t]]) => `<option value="${k}" ${c.status === k ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
    </div>
    <p class="muted" style="margin:0">Criada em ${fmtData(c.data)} · Responder até ${fmtData(c.prazoResposta)} · ${c.itens.length} itens · ${c.fornecedores.length} fornecedor(es)</p>
    ${c.titulo ? `<p style="margin:6px 0 0"><b>${esc(c.titulo)}</b></p>` : ''}
    ${c.obs ? `<p class="small" style="margin:6px 0 0;white-space:pre-wrap">${esc(c.obs)}</p>` : ''}
  </section>

  <section class="card">
    <h3>Fornecedores</h3>
    ${nf ? `<div class="table-wrap"><table>
      <thead><tr><th>Fornecedor</th><th>E-mail</th><th>Envio</th><th>Resposta</th><th class="r">Total</th><th>Ações</th></tr></thead>
      <tbody>${fornRows}</tbody></table></div>` : '<p class="empty">Nenhum fornecedor nesta cotação.</p>'}
    <div class="row" style="margin-top:10px">
      ${disponiveis.length ? `<select id="addFornCot" style="width:auto;max-width:280px">${disponiveis.map(f => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')}</select>
      <button class="sm" data-act="addFornCot">+ Adicionar fornecedor</button>` : ''}
      <button class="sm" data-act="baixarGeral" title="Planilha da cotação sem nome de fornecedor">⬇ Planilha da cotação</button>
      <label class="btn sm" style="margin:0" title="Importar uma planilha preenchida pelo fornecedor">📥 Importar planilha respondida<input type="file" class="hidden" accept=".xlsx,.xls" data-import-cot></label>
      ${nf > 1 ? '<button class="sm" data-act="baixarTodas">⬇ Baixar todas as planilhas</button>' : ''}
    </div>
    <p class="tip"><b>Como enviar:</b> clique em <b>✉ Enviar</b> na linha do fornecedor. Você baixa a planilha dele e abre o e-mail já com destinatário, assunto e texto. Só falta <b>anexar o arquivo baixado</b> e enviar.
    Quando o fornecedor devolver a planilha preenchida, use <b>📥 Importar</b> para lançar os preços automaticamente.</p>
  </section>

  ${painel}

  <section class="card">
    <div class="row-between">
      <h3>${temResposta ? 'Comparativo de preços' : 'Itens da cotação'}</h3>
      ${temResposta ? '<button class="sm" data-act="exportarComparativo">⬇ Exportar comparativo (Excel)</button>' : ''}
    </div>
    ${!temResposta ? '<p class="muted small">Assim que os fornecedores responderem, os preços aparecem aqui lado a lado, com o menor preço de cada item em verde.</p>' : ''}
    ${temResposta && nf > 1 ? `<p class="muted small" style="margin-top:0">O vencedor de cada item fica em verde. Para comprar de outro fornecedor, <b>clique no preço dele</b>; clique de novo para voltar ao menor preço.${comp.escolhasManuais ? ` <button class="sm" data-act="limparEscolhas">Desfazer as ${comp.escolhasManuais} escolha(s)</button>` : ''}</p>` : ''}
    ${qtdAlertas ? `<p class="aviso-alertas small">⚠ ${qtdAlertas} preço(s) fora do normal: mais de ${Math.round(LIMITE_ALERTA * 100)}% de diferença do último preço pago, ou muito diferente dos outros fornecedores. Passe o mouse no aviso para ver os detalhes.</p>` : ''}
    ${tabelaComp}
  </section>

  ${secaoPedidos}

  <div class="actions">
    <button data-act="duplicarCot">Duplicar como nova cotação</button>
    <button class="danger" data-act="excluirCot">Excluir cotação</button>
  </div>`;
}

function linhasProdutos() {
  const q = semAcento(ui.filtroProd);
  const precos = ultimosPrecos();
  const termos = q ? q.split(/\s+/) : [];
  const lista = indiceBusca().filter(([, t]) => termos.every(w => t.includes(w))).map(([p]) => p)
    .sort((a, b) => COLLATOR.compare(a.descricao, b.descricao));
  const LIMITE = 300;
  const extra = lista.length > LIMITE
    ? `<tr><td colspan="7" class="empty">Mostrando ${LIMITE} de ${lista.length.toLocaleString('pt-BR')} produtos. Use a busca para encontrar o que precisa.</td></tr>`
    : '';
  if (!lista.length) return `<tr><td colspan="7" class="empty">${db.produtos.length ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado. Cadastre acima ou importe de uma planilha.'}</td></tr>`;
  return lista.slice(0, LIMITE).map(p => {
    const u = precos[p.id];
    return `<tr>
      <td>${esc(p.codigo || '—')}${p.similar ? `<br><span class="small muted">sim. ${esc(p.similar)}</span>` : ''}</td>
      <td>${esc(p.descricao)}${p.obs ? `<br><span class="small muted">${esc(p.obs)}</span>` : ''}</td>
      <td class="c">${esc(p.unidade)}</td>
      <td>${esc(p.marca)}</td>
      <td>${esc(p.categoria)}</td>
      <td class="r">${u ? `${fmtMoeda(u.preco)}<br><span class="small muted">${esc(u.fornecedor)} · nº ${esc(u.numero)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="actions-cell">
        <button class="sm" data-act="editarProd" data-id="${p.id}">Editar</button>
        <button class="sm danger" data-act="excluirProd" data-id="${p.id}">✕</button>
      </td>
    </tr>`;
  }).join('') + extra;
}

function renderProdutos() {
  const p = ui.editProd ? db.produtos.find(x => x.id === ui.editProd) : null;
  const v = p || { unidade: 'UN' };
  return `
  <section class="card">
    <h2>${p ? 'Editar produto' : 'Produtos'} <span class="badge">${db.produtos.length}</span></h2>
    <form data-form="produto" class="grid">
      <label>Código<input name="codigo" value="${esc(v.codigo)}"></label>
      <label style="grid-column:span 2">Descrição *<input name="descricao" required value="${esc(v.descricao)}"></label>
      <label>Unidade<input name="unidade" value="${esc(v.unidade)}" placeholder="UN, CX, KG, M…"></label>
      <label>Similar (códigos equivalentes)<input name="similar" value="${esc(v.similar)}"></label>
      <label>Marca / Referência<input name="marca" value="${esc(v.marca)}"></label>
      <label>Categoria<input name="categoria" value="${esc(v.categoria)}" list="categorias"></label>
      <label style="grid-column:1/-1">Observação<input name="obs" value="${esc(v.obs)}"></label>
      <datalist id="categorias">${[...new Set(db.produtos.map(x => x.categoria).filter(Boolean))].sort().map(cat => `<option value="${esc(cat)}">`).join('')}</datalist>
      <div class="actions" style="grid-column:1/-1">
        ${p ? '<button type="button" data-act="cancelarProd">Cancelar</button>' : ''}
        <button class="primary">${p ? 'Salvar alterações' : '+ Adicionar produto'}</button>
      </div>
    </form>
  </section>
  <section class="card">
    <div class="row-between" style="margin-bottom:10px">
      <input class="grow" id="filtroProd" placeholder="Buscar produto…" value="${esc(ui.filtroProd)}">
      <div class="row">
        <label class="btn sm" style="margin:0" title="Colunas: Código, Descrição, Unidade, Marca, Categoria">📥 Importar Excel/CSV<input type="file" class="hidden" accept=".xlsx,.csv,.txt" data-import-produtos></label>
        <button class="sm" data-act="exportarProdutos">⬇ Exportar Excel</button>
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Código</th><th>Descrição</th><th class="c">Unid.</th><th>Marca</th><th>Categoria</th><th class="r">Último melhor preço</th><th></th></tr></thead>
      <tbody id="tbProd">${linhasProdutos()}</tbody>
    </table></div>
    <p class="tip">Para importar sua lista de produtos, use uma planilha com as colunas <b>Código, Descrição, Unidade, Similar, Marca, Categoria</b> (a primeira linha é o cabeçalho). Produtos com o mesmo código são atualizados.</p>
  </section>`;
}

function linhasFornecedores() {
  const q = semAcento(ui.filtroForn);
  const lista = db.fornecedores
    .filter(f => !q || semAcento(`${f.nome} ${f.contato} ${f.email} ${f.telefone} ${f.obs}`).includes(q))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  if (!lista.length) return `<tr><td colspan="5" class="empty">${db.fornecedores.length ? 'Nenhum fornecedor encontrado.' : 'Nenhum fornecedor cadastrado.'}</td></tr>`;
  return lista.map(f => {
    const n = db.cotacoes.filter(c => c.fornecedores.some(x => x.fornecedorId === f.id)).length;
    return `<tr>
      <td><b>${esc(f.nome)}</b>${f.obs ? `<br><span class="small muted">${esc(f.obs)}</span>` : ''}</td>
      <td>${esc(f.contato || '—')}</td>
      <td>${f.email ? `<a href="mailto:${esc(f.email)}">${esc(f.email)}</a>` : '—'}</td>
      <td>${esc(f.telefone || '—')}</td>
      <td class="c">${n}</td>
      <td class="actions-cell">
        <button class="sm" data-act="editarForn" data-id="${f.id}">Editar</button>
        <button class="sm danger" data-act="excluirForn" data-id="${f.id}">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function renderFornecedores() {
  const f = ui.editForn ? db.fornecedores.find(x => x.id === ui.editForn) : null;
  const v = f || {};
  return `
  <section class="card">
    <h2>${f ? 'Editar fornecedor' : 'Fornecedores'} <span class="badge">${db.fornecedores.length}</span></h2>
    <form data-form="fornecedor" class="grid">
      <label>Nome / empresa *<input name="nome" required value="${esc(v.nome)}"></label>
      <label>Contato (pessoa)<input name="contato" value="${esc(v.contato)}"></label>
      <label>E-mail<input name="email" type="email" value="${esc(v.email)}"></label>
      <label>Telefone / WhatsApp<input name="telefone" value="${esc(v.telefone)}"></label>
      <label style="grid-column:1/-1">Observação (o que fornece, condições…)<input name="obs" value="${esc(v.obs)}"></label>
      <div class="actions" style="grid-column:1/-1">
        ${f ? '<button type="button" data-act="cancelarForn">Cancelar</button>' : ''}
        <button class="primary">${f ? 'Salvar alterações' : '+ Adicionar fornecedor'}</button>
      </div>
    </form>
  </section>
  <section class="card">
    <input id="filtroForn" placeholder="Buscar fornecedor…" value="${esc(ui.filtroForn)}" style="margin-bottom:10px">
    <div class="table-wrap"><table>
      <thead><tr><th>Fornecedor</th><th>Contato</th><th>E-mail</th><th>Telefone</th><th class="c">Cotações</th><th></th></tr></thead>
      <tbody id="tbForn">${linhasFornecedores()}</tbody>
    </table></div>
  </section>`;
}

function renderConfig() {
  const c = db.config;
  return `
  <section class="card">
    <h2>Dados da loja</h2>
    <p class="muted small">Esses dados aparecem no cabeçalho da planilha enviada aos fornecedores e no e-mail.</p>
    <form data-form="config">
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
        Proteger a planilha (o fornecedor só consegue editar os campos amarelos)</label>
      <h3 style="margin-top:16px">Modelo do e-mail</h3>
      <p class="muted small">Você pode usar: {fornecedor} {numero} {loja} {comprador} {telefone} {email} {prazo} {titulo}</p>
      <label>Assunto<input name="assuntoEmail" value="${esc(c.assuntoEmail)}"></label>
      <label>Texto<textarea name="corpoEmail" rows="9">${esc(c.corpoEmail)}</textarea></label>
      <div class="actions"><button class="primary">Salvar configurações</button></div>
    </form>
  </section>
  <section class="card">
    <h2>Backup dos dados</h2>
    <p class="muted small">${nuvem.db
      ? 'Os dados ficam salvos <b>na nuvem, junto com esta página</b>, e aparecem em qualquer computador ou celular em que você abrir o link. Mesmo assim, baixe um backup de vez em quando.'
      : 'Os dados ficam salvos <b>somente neste navegador</b>. Faça backup com frequência e guarde o arquivo (Google Drive, pendrive…). Com o backup você também passa os dados para outro computador.'}</p>
    <div class="row">
      <button data-act="backup">⬇ Baixar backup</button>
      <label class="btn" style="margin:0">📥 Restaurar backup<input type="file" class="hidden" accept=".json" data-restaurar></label>
      <button class="danger" data-act="apagarTudo">Apagar todos os dados</button>
    </div>
    <p class="small muted" style="margin-top:10px">${db.produtos.length} produtos · ${db.fornecedores.length} fornecedores · ${db.cotacoes.length} cotações${db.ultimoBackup ? ` · último backup em ${fmtData(db.ultimoBackup)}` : ''}</p>
  </section>`;
}

/* ---------------- roteamento ---------------- */

const navegacao = { nome: 'cotacoes', id: null };

function rota() {
  return navegacao;
}

function ir(nome, id = null) {
  navegacao.nome = nome;
  navegacao.id = id;
  ui.digitando = null;
  ui.enviando = null;
  render();
  window.scrollTo(0, 0);
}

function render() {
  const { nome, id } = rota();
  const app = $('#app');
  const views = {
    nova: renderNova,
    cotacoes: renderCotacoes,
    cotacao: () => renderCotacao(id),
    produtos: renderProdutos,
    fornecedores: renderFornecedores,
    config: renderConfig,
  };
  try {
    app.innerHTML = (views[nome] || renderCotacoes)();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<section class="card"><h2>Não foi possível abrir esta tela</h2>
      <p class="muted">Ocorreu um erro: ${esc(e.message)}</p>
      <p class="muted small">Tente recarregar a página. Se continuar, avise com a mensagem acima.</p></section>`;
  }
  const ativo = nome === 'cotacao' ? 'cotacoes' : nome;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === ativo));
  $('#brand').textContent = db.config.loja ? `Cotações · ${db.config.loja}` : 'Cotações';
}

document.addEventListener('click', e => {
  const linhaGrupo = e.target.closest('[data-g-idx]');
  if (linhaGrupo && ui.datacar && !e.target.closest('button')) moverGrupoDataCar(+linhaGrupo.dataset.gIdx);
  const linhaItem = e.target.closest('[data-item-linha]');
  if (linhaItem) {
    const campo = e.target.closest('[data-marca-item], [data-similar-prod]');
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
    if (c) { marcarEnviado(c, +envio.dataset.marcaEnvio); setTimeout(render, 400); }
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

function adicionarItem(produtoId, quantidade = 1) {
  const r = rascunho();
  if (r.itens.some(x => x.produtoId === produtoId)) return;
  r.itens.push({ produtoId, quantidade });
  salvar();
  render();
  const busca = $('#buscaProd');
  if (busca) busca.focus();
}

const acoes = {
  addItem: el => adicionarItem(el.dataset.id),

  dcDecidir: el => decidirDataCar(el.dataset.d),
  dcEditarMarca: () => editarMarcaDataCar(),
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
    const mapaObs = { ...(rr.obsPorCodigo || {}) };
    const vistos = {};
    for (const l of d.linhas) {
      const k = chaveCodigo(l.codigo || '');
      if (!k) continue;
      if (!vistos[k]) { vistos[k] = true; mapaObs[k] = []; } // este arquivo substitui o anterior para o código
      mapaObs[k].push(l.chave || '');
    }
    rr.obsPorCodigo = mapaObs;
    if (!escolhidas.length) return avisar('Marque pelo menos um item.');
    const r = rascunho();
    const txt = (l, c) => (c >= 0 ? l.cels[c] : '');
    let novos = 0, somados = 0;
    for (const l of escolhidas) {
      const qtd = 1; // o fornecedor informa o preço unitário
      const codArq = l.codigo;
      let id = l.produtoId;
      if (!id) {
        // Produto novo: código = coluna de código do arquivo; a OBS (grupo) vai no campo Observação.
        const p = {
          id: uid(), codigo: codArq || l.chave, similar: '', obsDataCar: codArq ? '' : l.chave, descricao: txt(l, d.colDesc) || codArq || l.chave, unidade: 'UN',
          marca: (l.marca ?? txt(l, d.colMarca)).trim(), categoria: '', obs: l.chave, criadoEm: new Date().toISOString(),
        };
        db.produtos.push(p);
        id = p.id;
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
      if (ja) {
        ja.quantidade = qtd;
        ja.obsArquivo = [...(ja.obsArquivo || []), l.chave || ''];
        if (!ja.codigoArquivo) ja.codigoArquivo = codigoArquivo;
        if (l.marca !== undefined) ja.marca = marcaCotacao;
        somados++;
      } else {
        r.itens.push({ produtoId: id, quantidade: qtd, codigoArquivo, marca: marcaCotacao, obsArquivo: [l.chave || ''] });
      }
    }
    ui.datacar = null;
    salvar();
    render();
    toast(`${escolhidas.length} item(ns) adicionado(s)${novos ? `, ${novos} produto(s) novo(s) cadastrado(s)` : ''}${somados ? `, ${somados} já estava(m) na cotação` : ''}.`, 6000);
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

  removerItem: el => {
    const r = rascunho();
    const [x] = r.itens.splice(+el.dataset.i, 1); // tira só este item
    salvar();
    render();
    if (x) {
      const p = db.produtos.find(y => y.id === x.produtoId);
      toast(`Removido só o item ${x.codigoArquivo || p?.codigo || ''}${p ? ' · ' + p.descricao : ''}. Os outros continuam na cotação.`, 5000);
    }
  },

  limparRascunho: async () => {
    if (!(await confirmar('Limpar todos os itens e fornecedores desta nova cotação?'))) return;
    db.rascunho = null;
    salvar();
    render();
  },

  criarCotacao: async () => {
    const r = rascunho();
    const prod = byId(db.produtos);
    const forn = byId(db.fornecedores);
    const itens = r.itens.filter(x => prod[x.produtoId]);
    ordenarItensRascunho({ itens }, prod);
    if (!itens.length) return avisar('Adicione pelo menos um item.');
    const fornecedores = r.fornecedorIds.map(id => forn[id]).filter(Boolean);

    const cfg = db.config;
    const numero = String(cfg.proxNumero).padStart(4, '0');
    const c = {
      id: uid(),
      numero,
      titulo: r.titulo,
      data: hojeISO(),
      prazoResposta: r.prazoResposta,
      obs: r.obs,
      status: 'aberta',
      criadoEm: new Date().toISOString(),
      itens: itens.map(x => {
        const p = prod[x.produtoId];
        return { produtoId: p.id, codigo: x.codigoArquivo || p.codigo, codigoArquivo: x.codigoArquivo || '', codigoCadastro: p.codigo, similar: p.similar || '', descricao: p.descricao, unidade: p.unidade, marca: x.marca || p.marca, marcaCotacao: x.marca || '', quantidade: 1 };
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
    cfg.proxNumero = Number(cfg.proxNumero) + 1;
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

  baixarTodas: async () => {
    const c = cotAtual();
    for (let fi = 0; fi < c.fornecedores.length; fi++) {
      await baixarPlanilha(c, fi);
      await new Promise(r => setTimeout(r, 400));
    }
    toast(`${c.fornecedores.length} planilhas baixadas.`);
  },

  enviar: el => {
    const c = cotAtual();
    ui.enviando = { cotId: c.id, fi: +el.dataset.f };
    ui.digitando = null;
    render();
    $('#painelEnvio')?.scrollIntoView({ behavior: 'smooth' });
  },
  fecharEnvio: () => { ui.enviando = null; render(); },
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

  escolherVencedor: el => {
    const c = cotAtual();
    const i = +el.dataset.i, fi = +el.dataset.f;
    const f = c.fornecedores[fi];
    if (!f) return;
    const l = comparar(c).linhas[i];
    c.escolhas = { ...(c.escolhas || {}) };
    // clicar no vencedor escolhido (ou no menor preço) volta ao automático
    if (l.vencedor === fi) delete c.escolhas[i];
    else c.escolhas[i] = f.fornecedorId;
    salvar();
    render();
  },

  limparEscolhas: async () => {
    const c = cotAtual();
    if (!(await confirmar('Desfazer todas as escolhas feitas na mão e voltar ao menor preço em todos os itens?'))) return;
    c.escolhas = {};
    salvar();
    render();
  },

  baixarPedido: el => baixarPedidos(cotAtual(), +el.dataset.f),
  baixarPedidos: () => baixarPedidos(cotAtual()),

  duplicarCot: async () => {
    const c = cotAtual();
    const prod = byId(db.produtos);
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

  editarForn: el => { ui.editForn = el.dataset.id; render(); window.scrollTo(0, 0); },
  cancelarForn: () => { ui.editForn = null; render(); },
  excluirForn: async el => {
    const f = db.fornecedores.find(x => x.id === el.dataset.id);
    if (!(await confirmar(`Excluir o fornecedor "${f.nome}"? (As cotações antigas não são alteradas.)`))) return;
    db.fornecedores = db.fornecedores.filter(x => x.id !== f.id);
    salvar();
    render();
  },

  backup: () => {
    db.ultimoBackup = new Date().toISOString();
    salvar();
    baixarBlob(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }), `backup_cotacoes_${hojeISO()}.json`);
    render();
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
  produtoRapido: async form => {
    const d = formDados(form);
    if (!d.descricao) return;
    if (d.codigo && db.produtos.some(p => semAcento(p.codigo) === semAcento(d.codigo)) && !(await confirmar(`Já existe um produto com o código ${d.codigo}. Cadastrar mesmo assim?`))) return;
    const p = { id: uid(), codigo: d.codigo, descricao: d.descricao, unidade: (d.unidade || 'UN').toUpperCase(), marca: d.marca, categoria: '', obs: '', criadoEm: new Date().toISOString() };
    db.produtos.push(p);
    adicionarItem(p.id, 1);
    toast('Produto cadastrado e adicionado.');
  },

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

  produto: async form => {
    const d = formDados(form);
    if (!d.descricao) return;
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

  fornecedor: form => {
    const d = formDados(form);
    if (!d.nome) return;
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
      if (preco != null || prazo || obs) respostas[i] = { preco, prazo, obs };
    });
    f.respostas = respostas;
    f.cond = Object.fromEntries(COND_CAMPOS.map(([k]) => [k, d[`c_${k}`] || '']));
    f.respondidoEm = Object.keys(respostas).length ? f.respondidoEm || new Date().toISOString() : null;
    ui.digitando = null;
    salvar();
    render();
    toast(`Preços de ${f.nome} salvos.`);
  },

  config: form => {
    const d = formDados(form);
    Object.assign(db.config, d, {
      proxNumero: Math.max(1, parseInt(d.proxNumero, 10) || 1),
      protegerPlanilha: form.protegerPlanilha.checked,
    });
    salvar();
    render();
    toast('Configurações salvas.');
  },
};

/* ---------------- eventos (delegação) ---------------- */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !acoes[el.dataset.act]) return;
  e.preventDefault();
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
  if (t.dataset.draft) {
    rascunho()[t.dataset.draft] = t.value;
    salvar();
  } else if (t.dataset.qtd != null) {
    rascunho().itens[+t.dataset.qtd].quantidade = parseNum(t.value);
    salvar();
  } else if (t.dataset.dcMarca != null) {
    // a marca é gravada ao sair do campo (Enter, Tab, setas ou clique fora)
  } else if (t.id === 'buscaProd') {
    resultadosBusca(t.value);
  } else if (t.id === 'filtroProd') {
    ui.filtroProd = t.value;
    $('#tbProd').innerHTML = linhasProdutos();
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
});

/* ---------------- lista de itens da cotação: setas + digitar direto na marca ---------------- */

function moverCursorItem(i, focarTabela = true) {
  const linhas = document.querySelectorAll('[data-item-linha]');
  if (!linhas.length) return;
  ui.cursorItem = Math.max(0, Math.min(linhas.length - 1, i));
  linhas.forEach(tr => tr.classList.toggle('item-atual', +tr.dataset.itemLinha === ui.cursorItem));
  linhas[ui.cursorItem].scrollIntoView({ block: 'nearest' });
  if (focarTabela) $('#tabItens')?.focus({ preventScroll: true });
}

/** Põe o foco num campo (marca ou similar) da linha i. modo: 'fim' | 'tudo' | texto inicial. */
function focarCampoItem(i, campo, modo) {
  const attr = campo === 'similar' ? 'data-similar-prod' : 'data-marca-item';
  const tr = document.querySelector(`[data-item-linha="${i}"]`);
  const inp = tr && tr.querySelector(`[${attr}]`);
  if (!inp) return;
  moverCursorItem(i, false);
  inp.dataset.original = inp.value;
  inp.focus();
  if (modo === 'tudo') inp.select();
  else {
    if (modo !== 'fim' && modo != null) inp.value = modo;
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }
}

function teclaItens(e) {
  const t = e.target;
  const tab = $('#tabItens');
  const noCampo = t.matches('[data-marca-item], [data-similar-prod]');
  const linha = t.closest('[data-item-linha]');
  const atual = linha ? +linha.dataset.itemLinha : ui.cursorItem;
  if (noCampo) {
    const campo = t.matches('[data-similar-prod]') ? 'similar' : 'marca';
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prox = atual + (e.key === 'ArrowDown' ? 1 : -1);
      t.blur(); // salva (dispara "change") e redesenha
      focarCampoItem(Math.max(0, Math.min(rascunho().itens.length - 1, prox)), campo, 'tudo');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      t.blur();
      moverCursorItem(atual);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (t.dataset.original != null) t.value = t.dataset.original;
      t.blur();
      moverCursorItem(atual);
    }
    return;
  }
  if (t !== tab) return;
  const letra = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    moverCursorItem(ui.cursorItem + (e.key === 'ArrowDown' ? 1 : -1));
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    moverCursorItem(e.key === 'Home' ? 0 : rascunho().itens.length - 1);
  } else if (e.key === 'F2' || e.key === 'Enter') {
    e.preventDefault();
    focarCampoItem(ui.cursorItem, 'marca', 'fim');
  } else if (letra && e.key !== ' ') {
    e.preventDefault();
    focarCampoItem(ui.cursorItem, 'marca', e.key);
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    focarCampoItem(ui.cursorItem, 'marca', '');
  }
}

document.addEventListener('keydown', e => {
  if (!ui.datacar && e.target.closest && e.target.closest('#tabItens')) {
    teclaItens(e);
    return;
  }
  if (ui.datacar && $('#dlgDataCar') && !document.querySelector('.dlg-fundo:not(#dlgDataCar)')) {
    teclaDataCar(e);
    return;
  }
  if (e.target.id === 'buscaProd') {
    if (e.key === 'Enter') {
      e.preventDefault();
      const primeiro = $('#resultadosProd button:not(:disabled)');
      if (primeiro) primeiro.click();
    } else if (e.key === 'Escape') {
      e.target.value = '';
      resultadosBusca('');
    }
  }
});

document.addEventListener('change', async e => {
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
    toast(p.similar ? `Similar salvo no cadastro de ${p.codigo || p.descricao}.` : 'Similar removido do cadastro.');
  } else if (t.dataset.marcaItem != null) {
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
      toast(item.marca ? `Marca "${valor}" vale só nesta cotação. O cadastro continua "${p.marca}".` : `Voltou para a marca do cadastro: "${p.marca}".`);
    }
    salvar();
    render();
  } else if (t.id === 'dcColCod' || t.id === 'dcCol') {
    if (t.id === 'dcColCod') ui.datacar.colCod = +t.value; else ui.datacar.col = +t.value;
    casarLinhasDataCar();
    aplicarOrdemDataCar();
    Object.assign(ui.datacar, { pos: 0, gcur: 0, grupoAberto: null });
    renderSoDataCar();
    focarDataCar();
  } else if (t.id === 'statusCot') {
    ui.statusCot = t.value;
    $('#tbCot').innerHTML = linhasCotacoes();
  } else if (t.dataset.change === 'statusCot') {
    cotAtual().status = t.value;
    salvar();
    render();
  } else if (t.type === 'file' && t.files.length) {
    const file = t.files[0];
    t.value = '';
    if (t.dataset.import != null) await importarResposta(file, cotAtual()?.id, +t.dataset.import);
    else if (t.hasAttribute('data-import-geral')) await importarResposta(file, null, null);
    else if (t.hasAttribute('data-import-cot')) await importarResposta(file, cotAtual()?.id, null);
    else if (t.hasAttribute('data-import-produtos')) await importarProdutos(file);
    else if (t.hasAttribute('data-import-datacar')) await abrirArquivoDataCar(file);
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
});

// Fecha a lista de busca ao clicar fora.
document.addEventListener('click', e => {
  if (!e.target.closest('.search')) {
    const box = $('#resultadosProd');
    if (box) box.innerHTML = '';
  }
});

navegacao.nome = db.config.loja ? 'cotacoes' : 'config';
render();
mostrarStatus(nuvem.status);
iniciarNuvem();
