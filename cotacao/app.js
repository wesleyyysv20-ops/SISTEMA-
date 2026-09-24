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
const ui = { digitando: null, enviando: null, datacar: null, editProd: null, editForn: null, filtroProd: '', filtroForn: '', filtroCot: '', statusCot: '' };

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

function salvar() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    if (!nuvem.db) avisar('Não foi possível salvar os dados no navegador. Faça um backup em Configurações.\n\n' + e.message);
  }
  agendarSincronia();
}

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
  nuvem.timer = setTimeout(sincronizar, 500);
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
    const tecla = e => { if (e.key === 'Escape') { e.stopPropagation(); fechar(botoes[0].valor); } };
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

function confirmar(msg, ok = 'Confirmar') {
  return abrirDialogo(msg, [{ txt: 'Cancelar', valor: false }, { txt: ok, valor: true, cls: 'primary' }]);
}

function avisar(msg) {
  return abrirDialogo(msg, [{ txt: 'OK', valor: undefined, cls: 'primary' }]);
}

async function baixarWorkbook(wb, nome) {
  const buf = await wb.xlsx.writeBuffer();
  return baixarBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nome);
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

/** Monta o comparativo de preços de uma cotação. */
function comparar(c) {
  const linhas = c.itens.map((it, i) => {
    const precos = c.fornecedores.map(f => {
      const p = f.respostas?.[i]?.preco;
      return p != null && p > 0 ? p : null;
    });
    const validos = precos.filter(p => p != null);
    const min = validos.length ? Math.min(...validos) : null;
    const vencedor = min == null ? -1 : precos.indexOf(min);
    return { it, i, precos, min, vencedor };
  });
  const totais = c.fornecedores.map((f, fi) => {
    let total = 0, cotados = 0, vencidos = 0;
    for (const l of linhas) {
      const p = l.precos[fi];
      if (p == null) continue;
      total += p * l.it.quantidade;
      cotados++;
      if (p === l.min) vencidos++;
    }
    return { total, cotados, vencidos };
  });
  const melhor = linhas.reduce((s, l) => s + (l.min != null ? l.min * l.it.quantidade : 0), 0);
  const itensCotados = linhas.filter(l => l.min != null).length;
  return { linhas, totais, melhor, itensCotados };
}

/** Último melhor preço de cada produto (pela cotação mais recente que teve resposta). */
function ultimosPrecos() {
  const map = {};
  const cots = [...db.cotacoes].sort((a, b) => (a.data + a.numero).localeCompare(b.data + b.numero));
  for (const c of cots) {
    const { linhas } = comparar(c);
    for (const l of linhas) {
      if (!l.it.produtoId || l.min == null) continue;
      map[l.it.produtoId] = { preco: l.min, fornecedor: c.fornecedores[l.vencedor].nome, data: c.data, numero: c.numero };
    }
  }
  return map;
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

async function gerarPlanilha(c, f) {
  const cfg = db.config;
  const wb = new ExcelJS.Workbook();
  wb.creator = cfg.loja || 'Sistema de Cotação';
  wb.created = new Date();

  const ws = wb.addWorksheet('Cotação', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [6, 14, 44, 18, 8, 10, 17, 17, 16, 32].map(width => ({ width }));

  ws.mergeCells('A1:J1');
  const titulo = ws.getCell('A1');
  titulo.value = 'SOLICITAÇÃO DE COTAÇÃO';
  titulo.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titulo.fill = XL.azul;
  titulo.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  const info = (row, label, value, label2, value2) => {
    ws.mergeCells(`A${row}:B${row}`);
    ws.getCell(`A${row}`).value = label;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.mergeCells(`C${row}:F${row}`);
    ws.getCell(`C${row}`).value = value || '';
    if (label2) {
      ws.getCell(`G${row}`).value = label2;
      ws.getCell(`G${row}`).font = { bold: true };
      ws.mergeCells(`H${row}:J${row}`);
      ws.getCell(`H${row}`).value = value2 || '';
      ws.getCell(`H${row}`).alignment = { horizontal: 'left' };
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
  ws.mergeCells('C7:J7');
  ws.getCell('C7').value = f.nome;
  ws.getCell('C7').font = { bold: true, size: 12 };

  ws.mergeCells('A8:B8');
  ws.getCell('A8').value = 'Observações:';
  ws.getCell('A8').font = { bold: true };
  ws.getCell('A8').alignment = { vertical: 'top' };
  ws.mergeCells('C8:J8');
  ws.getCell('C8').value = c.obs || '';
  ws.getCell('C8').alignment = { wrapText: true, vertical: 'top' };
  if (c.obs) ws.getRow(8).height = Math.min(120, 15 * Math.ceil(c.obs.length / 110 + (c.obs.match(/\n/g) || []).length));

  ws.mergeCells('A9:J9');
  const instr = ws.getCell('A9');
  instr.value = 'Preencha somente os campos em AMARELO (preço unitário, prazo, observações e condições) e devolva esta planilha por e-mail. Não altere as demais colunas.';
  instr.font = { italic: true, color: { argb: 'FF7F6000' } };
  instr.fill = XL.amarelo;
  instr.alignment = { wrapText: true, vertical: 'middle' };
  ws.getRow(9).height = 30;

  const HEADER = 11;
  const FIRST = HEADER + 1;
  const cab = ['Item', 'Código', 'Descrição', 'Marca/Ref.', 'Unid.', 'Qtd.', 'Preço Unit. (R$)', 'Total (R$)', 'Prazo Entrega', 'Observação do fornecedor'];
  const hr = ws.getRow(HEADER);
  cab.forEach((txt, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = txt;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = XL.azul;
    cell.border = XL.borda;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  hr.height = 30;

  c.itens.forEach((it, i) => {
    const r = FIRST + i;
    const row = ws.getRow(r);
    row.values = [i + 1, it.codigo || '', it.similar ? `${it.descricao}\nSimilar: ${it.similar}` : it.descricao, it.marca || '', it.unidade || '', it.quantidade];
    row.getCell(8).value = { formula: `IF(G${r}="","",F${r}*G${r})` };
    for (let col = 1; col <= 10; col++) {
      const cell = row.getCell(col);
      cell.border = XL.borda;
      cell.alignment = { vertical: 'middle', wrapText: col === 2 || col === 3 || col === 10 };
    }
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(6).numFmt = '#,##0.###';
    row.getCell(8).numFmt = XL.moeda;
    const preco = row.getCell(7);
    preco.numFmt = XL.moeda;
    preco.dataValidation = {
      type: 'decimal',
      operator: 'greaterThanOrEqual',
      formulae: [0],
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: 'Valor inválido',
      error: 'Digite apenas o preço unitário (número).',
    };
    for (const col of [7, 9, 10]) {
      row.getCell(col).fill = XL.amarelo;
      row.getCell(col).protection = { locked: false };
    }
  });

  const LAST = FIRST + c.itens.length - 1;
  const TOTAL = LAST + 1;
  ws.mergeCells(`A${TOTAL}:G${TOTAL}`);
  ws.getCell(`A${TOTAL}`).value = 'TOTAL GERAL';
  ws.getCell(`A${TOTAL}`).alignment = { horizontal: 'right' };
  ws.getCell(`H${TOTAL}`).value = { formula: `SUM(H${FIRST}:H${LAST})` };
  ws.getCell(`H${TOTAL}`).numFmt = XL.moeda;
  for (const col of ['A', 'H', 'I', 'J']) {
    ws.getCell(`${col}${TOTAL}`).font = { bold: true };
    ws.getCell(`${col}${TOTAL}`).fill = XL.cinza;
    ws.getCell(`${col}${TOTAL}`).border = XL.borda;
  }

  const COND = TOTAL + 2;
  COND_CAMPOS.forEach(([, label], k) => {
    const r = COND + k;
    ws.mergeCells(`A${r}:C${r}`);
    ws.getCell(`A${r}`).value = label + ':';
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`A${r}`).alignment = { horizontal: 'right' };
    ws.mergeCells(`D${r}:J${r}`);
    const cell = ws.getCell(`D${r}`);
    cell.fill = XL.amarelo;
    cell.border = XL.borda;
    cell.protection = { locked: false };
  });

  ws.views = [{ state: 'frozen', ySplit: HEADER }];
  if (cfg.protegerPlanilha) {
    await ws.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true });
  }

  // Aba oculta usada para reconhecer a planilha quando o fornecedor devolver.
  const meta = wb.addWorksheet('_dados', { state: 'veryHidden' });
  [
    'sistema-cotacao', c.id, f.fornecedorId, HEADER, FIRST, c.itens.length, COND, c.numero, 1,
  ].forEach((v, i) => { meta.getCell(`A${i + 1}`).value = v; });

  return wb;
}

function nomePlanilha(c, f) {
  return `Cotacao_${c.numero}_${slug(f.nome)}.xlsx`;
}

async function baixarPlanilha(c, fi) {
  const f = c.fornecedores[fi];
  const wb = await gerarPlanilha(c, f);
  await baixarWorkbook(wb, nomePlanilha(c, f));
}

/* ---------------- Excel: leitura da resposta ---------------- */

async function lerPlanilha(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
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
    };
  }
  const ws = wb.getWorksheet('Cotação') || wb.worksheets.find(w => w.name !== '_dados');
  return { meta, ws };
}

/** Aplica os preços lidos da planilha no fornecedor `fi` da cotação `c`. Retorna qtd de preços. */
function aplicarResposta(c, fi, ws, meta) {
  let first = meta?.first;
  let cond = meta?.cond;
  if (!first) {
    // Planilha sem aba de controle: procura o cabeçalho "Preço Unit." na coluna G.
    for (let r = 1; r <= 60; r++) {
      if (/pre[çc]o/i.test(cellTexto(ws.getCell(`G${r}`)))) { first = r + 1; break; }
    }
    if (!first) throw new Error('Não encontrei a coluna de preços nesta planilha.');
  }
  const respostas = {};
  let qtd = 0;
  const limite = meta?.n || c.itens.length;
  for (let k = 0; k < limite; k++) {
    const r = first + k;
    const idx = parseInt(cellTexto(ws.getCell(`A${r}`)), 10);
    const i = Number.isInteger(idx) && idx >= 1 && idx <= c.itens.length ? idx - 1 : k;
    if (i >= c.itens.length) break;
    const preco = parseNum(cellValue(ws.getCell(`G${r}`)));
    const prazo = cellTexto(ws.getCell(`I${r}`));
    const obs = cellTexto(ws.getCell(`J${r}`));
    if (preco != null || prazo || obs) respostas[i] = { preco, prazo, obs };
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
    if (!c) throw new Error('Não consegui identificar a cotação desta planilha. Abra a cotação e use o botão "Importar" do fornecedor.');

    let fi = fiSugerido;
    if (meta) {
      const idx = c.fornecedores.findIndex(f => f.fornecedorId === meta.fornecedorId);
      if (idx >= 0 && fi != null && idx !== fi) {
        if (!(await confirmar(`Esta planilha foi gerada para "${c.fornecedores[idx].nome}". Importar os preços para "${c.fornecedores[idx].nome}"?`))) return;
      }
      if (idx >= 0) fi = idx;
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
  const cab = ['Item', 'Código', 'Descrição', 'Unid.', 'Qtd.', ...c.fornecedores.map(f => f.nome), 'Melhor preço', 'Fornecedor', 'Total (melhor)'];
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
      l.min ?? '', l.vencedor >= 0 ? c.fornecedores[l.vencedor].nome : 'sem preço',
      l.min != null ? l.min * l.it.quantidade : '',
    ];
    for (let col = 1; col <= cab.length; col++) row.getCell(col).border = XL.borda;
    for (let j = 0; j < nf; j++) {
      const cell = row.getCell(6 + j);
      cell.numFmt = XL.moeda;
      if (l.precos[j] != null && l.precos[j] === l.min) { cell.fill = XL.verde; cell.font = { bold: true, color: { argb: 'FF1E7B4A' } }; }
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
  ir.getCell(3).value = 'Itens cotados / itens mais baratos';
  totais.forEach((t, j) => { ir.getCell(6 + j).value = `${t.cotados}/${linhas.length} · ${t.vencidos} mais barato(s)`; });

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
      ordem: { campo: 'chave', dir: 1 }, // abre já em ordem A-Z pelo OBS
      agrupar: true,
      cursor: 0,
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

function atualizarResumoDataCar() {
  const d = ui.datacar;
  const sel = d.linhas.filter(l => l.sel).length;
  const novos = d.linhas.filter(l => l.sel && !l.produtoId).length;
  const grupos = new Set(d.linhas.filter(l => l.sel && l.chave).map(l => grupoDc(l.chave))).size;
  const el = $('#dcResumo');
  if (el) el.textContent = `${sel} selecionado(s)${grupos ? ` em ${grupos} grupo(s) de ${d.cab[d.col]}` : ''}${novos ? ` · ${novos} será(ão) cadastrado(s) como produto novo` : ''}`;
}

const grupoDc = v => semAcento(v).replace(/\s+/g, ' ');

/** Marca/desmarca a linha i — e, com "agrupar" ligado, todas as linhas com a mesma OBS. */
function marcarLinhaDataCar(i, valor) {
  const d = ui.datacar;
  const l = d.linhas[i];
  if (!l || !(l.codigo || l.chave)) return;
  const alvo = d.agrupar && l.chave ? grupoDc(l.chave) : null;
  d.linhas.forEach((x, j) => {
    if (j !== i && (!alvo || !x.chave || grupoDc(x.chave) !== alvo)) return;
    if (!(x.codigo || x.chave)) return;
    x.sel = valor;
    const tr = document.querySelector(`[data-dc-linha="${j}"]`);
    if (tr) {
      tr.classList.toggle('dc-on', valor);
      const cb = tr.querySelector('[data-dc-sel]');
      if (cb) cb.checked = valor;
    }
  });
  atualizarResumoDataCar();
}

function moverCursorDataCar(i) {
  const d = ui.datacar;
  if (!d.linhas.length) return;
  d.cursor = Math.max(0, Math.min(d.linhas.length - 1, i));
  document.querySelectorAll('tr.dc-atual').forEach(tr => tr.classList.remove('dc-atual'));
  const tr = document.querySelector(`[data-dc-linha="${d.cursor}"]`);
  if (tr) {
    tr.classList.add('dc-atual');
    tr.scrollIntoView({ block: 'nearest' });
  }
}

function focarDataCar() {
  atualizarResumoDataCar();
  const caixa = $('#dcCaixa');
  if (caixa && !caixa.contains(document.activeElement)) caixa.focus({ preventScroll: true });
  moverCursorDataCar(ui.datacar.cursor);
}

function teclaDataCar(e) {
  const d = ui.datacar;
  const t = e.target;
  const campoTexto = t.matches('input:not([type=checkbox]), select, textarea');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (t.tagName === 'SELECT') return;
    e.preventDefault();
    moverCursorDataCar(d.cursor + (e.key === 'ArrowDown' ? 1 : -1));
    if (campoTexto) {
      const q = document.querySelector(`[data-dc-marca="${d.cursor}"]`);
      if (q) { q.focus(); q.select(); } else $('#dcCaixa').focus({ preventScroll: true });
    } else {
      $('#dcCaixa').focus({ preventScroll: true });
    }
  } else if ((e.key === 'PageDown' || e.key === 'PageUp') && !campoTexto) {
    e.preventDefault();
    moverCursorDataCar(d.cursor + (e.key === 'PageDown' ? 10 : -10));
  } else if ((e.key === 'Home' || e.key === 'End') && !campoTexto) {
    e.preventDefault();
    moverCursorDataCar(e.key === 'Home' ? 0 : d.linhas.length - 1);
  } else if (e.key === ' ' && !campoTexto) {
    e.preventDefault();
    const idx = t.dataset && t.dataset.dcSel != null ? +t.dataset.dcSel : d.cursor;
    moverCursorDataCar(idx);
    marcarLinhaDataCar(idx, !d.linhas[idx].sel);
  } else if (e.key === 'Enter' && t.tagName !== 'BUTTON' && t.tagName !== 'SELECT') {
    e.preventDefault();
    acoes.dcAdicionar();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    acoes.dcCancelar();
  }
}

const ORDEM_DC = { chave: 'OBS', arquivo: 'No arquivo', produto: 'Produto cadastrado', marca: 'Marca' };

function chaveOrdemDataCar(l, campo) {
  const d = ui.datacar;
  const txt = c => (c >= 0 ? l.cels[c] : '');
  const p = l.produtoId ? db.produtos.find(x => x.id === l.produtoId) : null;
  if (campo === 'chave') return l.chave || '';
  if (campo === 'arquivo') return [d.colCod >= 0 && d.colCod !== d.col ? txt(d.colCod) : '', txt(d.colDesc)].filter(Boolean).join(' ') || l.cels.join(' ');
  if (campo === 'produto') return p ? `${p.codigo} ${p.descricao}` : '';
  if (campo === 'marca') return (p && p.marca) || l.marca || txt(d.colMarca) || '';
  return '';
}

/** Ordena as linhas do arquivo: clicar numa coluna ordena de A a Z; clicar de novo inverte (Z a A). */
function ordenarDataCar(campo) {
  const d = ui.datacar;
  const atual = d.linhas[d.cursor];
  if (d.ordem.campo !== campo) d.ordem = { campo, dir: 1 };
  else d.ordem.dir = -d.ordem.dir;
  aplicarOrdemDataCar();
  d.cursor = Math.max(0, d.linhas.indexOf(atual));
}

function aplicarOrdemDataCar() {
  const d = ui.datacar;
  const { campo: c, dir } = d.ordem;
  d.linhas.sort((a, b) => {
    if (!c) return a.orig - b.orig;
    const norm = v => semAcento(v).replace(/\s+/g, ' ');
    const ka = norm(chaveOrdemDataCar(a, c)), kb = norm(chaveOrdemDataCar(b, c));
    if (!ka !== !kb) return ka ? -1 : 1; // vazios sempre no fim
    return (ka.localeCompare(kb, 'pt-BR', { numeric: true, sensitivity: 'base' }) * dir) || a.orig - b.orig;
  });
}

function renderDataCar() {
  const d = ui.datacar;
  if (!d) return '';
  const prod = byId(db.produtos);
  const naCotacao = new Set(rascunho().itens.map(x => x.produtoId));
  const txt = (l, c) => (c >= 0 ? l.cels[c] : '');
  const tamGrupo = {};
  d.linhas.forEach(l => { if (l.chave) tamGrupo[grupoDc(l.chave)] = (tamGrupo[grupoDc(l.chave)] || 0) + 1; });
  return `
  <div class="dlg-fundo" id="dlgDataCar">
    <div class="dlg dlg-largo" role="dialog" aria-modal="true" aria-labelledby="dcTitulo" tabindex="-1" id="dcCaixa">
      <div class="row-between">
        <h3 id="dcTitulo" style="margin:0">Selecione os itens para a cotação</h3>
        <span class="muted small">${esc(d.arquivo)} · ${d.linhas.length} linha(s)</span>
      </div>
      <div class="row" style="margin:10px 0">
        <label style="margin:0;display:flex;gap:6px;align-items:center">Agrupar pelo campo
          <select id="dcCol" style="width:auto;margin:0">${d.cab.map((c, i) => `<option value="${i}" ${i === d.col ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        </label>
        <label style="margin:0;display:flex;gap:6px;align-items:center">Código do item
          <select id="dcColCod" style="width:auto;margin:0">
            <option value="-1" ${d.colCod < 0 ? 'selected' : ''}>(escolha a coluna)</option>
            ${d.cab.map((c, i) => `<option value="${i}" ${i === d.colCod ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </label>
        ${d.colCod < 0 ? '<span class="badge warn">Não achei a coluna de código: escolha ao lado</span>' : ''}
        <label style="margin:0;display:flex;gap:6px;align-items:center;color:var(--text)"><input type="checkbox" id="dcAgrupar" ${d.agrupar ? 'checked' : ''}> Marcar o grupo inteiro</label>
        <span class="grow"></span>
        <button class="sm" data-act="dcTodos">Marcar todos</button>
        <button class="sm" data-act="dcNenhum">Desmarcar todos</button>
      </div>
      <div class="table-wrap dc-lista"><table>
        <thead><tr><th></th>${Object.entries(ORDEM_DC).map(([campo, rotulo]) => {
          const ativo = d.ordem.campo === campo;
          const seta = ativo ? (d.ordem.dir === 1 ? ' A→Z' : ' Z→A') : '';
          return `<th aria-sort="${ativo ? (d.ordem.dir === 1 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="th-ordem ${ativo ? 'ativo' : ''}" data-act="dcOrdenar" data-campo="${campo}" title="Ordenar por ${esc(campo === 'chave' ? d.cab[d.col] : rotulo)}">${esc(campo === 'chave' ? d.cab[d.col] : rotulo)}${seta}</button></th>`;
        }).join('')}</tr></thead>
        <tbody>${d.linhas.map((l, i) => {
          const p = l.produtoId ? prod[l.produtoId] : null;
          const resumo = [d.colCod >= 0 && d.colCod !== d.col ? txt(l, d.colCod) : '', txt(l, d.colDesc), txt(l, d.colMarca)].filter(Boolean).join(' · ') || l.cels.filter((v, j) => j !== d.col && v).slice(0, 3).join(' · ');
          const ok = !!(l.codigo || l.chave);
          const n = l.chave ? tamGrupo[grupoDc(l.chave)] : 0;
          return `<tr class="${l.sel ? 'dc-on' : ''} ${ok ? '' : 'dc-vazia'} ${i === d.cursor ? 'dc-atual' : ''}" data-dc-linha="${i}">
            <td><input type="checkbox" data-dc-sel="${i}" ${l.sel ? 'checked' : ''} ${ok ? '' : 'disabled'} aria-label="Selecionar linha ${i + 1}"></td>
            <td><b>${esc(l.chave || '—')}</b>${n > 1 ? ` <span class="small muted">(${n})</span>` : ''}</td>
            <td class="small">${esc(resumo)}</td>
            <td class="small">${p
              ? `${esc(p.codigo)} · ${esc(p.descricao)}${naCotacao.has(p.id) ? ' <span class="badge">já na cotação</span>' : ''}`
              : ok ? '<span class="badge warn">não cadastrado · será cadastrado</span>' : '<span class="muted">sem código</span>'}</td>
            <td style="width:150px">${p
              ? `<input class="${(l.marca ?? p.marca) ? '' : 'falta'}" data-dc-marca="${i}" value="${esc(l.marca ?? p.marca)}" placeholder="Informar marca" title="${p.marca ? `Cadastro: ${esc(p.marca)}. Alterar aqui muda só nesta cotação.` : 'Sem marca no cadastro: a marca informada fica salva.'}" aria-label="Marca do item ${i + 1}">`
              : ok ? `<input data-dc-marca="${i}" value="${esc(l.marca ?? txt(l, d.colMarca))}" placeholder="Informar marca" aria-label="Marca do item ${i + 1}">` : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="small" style="margin:10px 0 0">Ordem: <b>${esc(d.ordem.campo === 'chave' ? d.cab[d.col] : ORDEM_DC[d.ordem.campo] || 'arquivo')}</b> ${d.ordem.dir === 1 ? 'de A a Z' : 'de Z a A'} <span class="muted">· clique no título de uma coluna para ordenar por ela, clique de novo para inverter</span></p>
      <p class="small muted" style="margin:4px 0 0"><span class="kbd">↑</span> <span class="kbd">↓</span> navegar · <span class="kbd">Espaço</span> marcar/desmarcar · <span class="kbd">Enter</span> adicionar · <span class="kbd">Esc</span> cancelar</p>
      <div class="row-between" style="margin-top:8px">
        <span class="small muted" id="dcResumo"></span>
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

function renderNova() {
  const r = rascunho();
  const prod = byId(db.produtos);
  r.itens = r.itens.filter(x => prod[x.produtoId]);
  const forn = byId(db.fornecedores);
  r.fornecedorIds = r.fornecedorIds.filter(id => forn[id]);

  const linhas = r.itens.map((x, i) => {
    const p = prod[x.produtoId];
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(x.codigoArquivo || p.codigo)}${x.codigoArquivo && x.codigoArquivo !== p.codigo ? `<br><span class="small muted">cadastro: ${esc(p.codigo)}</span>` : ''}</td>
      <td>${esc(p.descricao)}</td>
      <td style="width:170px"><input data-similar-prod="${p.id}" value="${esc(p.similar)}" placeholder="Opcional" aria-label="Códigos similares de ${esc(p.descricao)}"></td>
      <td style="width:170px"><input class="${(x.marca || p.marca) ? '' : 'falta'} ${x.marca ? 'so-cotacao' : ''}" data-marca-item="${i}" value="${esc(x.marca || p.marca)}" placeholder="Informar marca" title="${p.marca ? `Cadastro: ${esc(p.marca)}. Alterar aqui muda só nesta cotação.` : 'Sem marca no cadastro: a marca informada fica salva.'}" aria-label="Marca de ${esc(p.descricao)}">${x.marca ? `<br><span class="small muted">cadastro: ${esc(p.marca)}</span>` : ''}</td>
      <td class="c"><button class="sm danger" data-act="removerItem" data-i="${i}" title="Remover">✕</button></td>
    </tr>`;
  }).join('');

  const fornList = db.fornecedores.length
    ? `<div class="checklist">${[...db.fornecedores].sort((a, b) => a.nome.localeCompare(b.nome)).map(f => `
        <label><input type="checkbox" data-forn="${f.id}" ${r.fornecedorIds.includes(f.id) ? 'checked' : ''}>
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
      <span class="small muted">Escolha o arquivo gerado pelo DataCar e marque os itens que vão para a cotação. Os itens são reconhecidos pelo campo <b>OBS</b>.</span>
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
    ${r.itens.length ? `<div class="table-wrap"><table>
      <thead><tr><th class="c">#</th><th>Código</th><th>Descrição</th><th>Similar</th><th>Marca</th><th></th></tr></thead>
      <tbody>${linhas}</tbody></table></div>` : '<p class="empty">Busque e adicione produtos acima.</p>'}
  </section>

  <section class="card">
    <h3>2. Fornecedores que vão receber (${r.fornecedorIds.length})</h3>
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
    <button class="primary" data-act="criarCotacao">Criar cotação →</button>
  </div>
  ${renderDataCar()}`;
}

function resultadosBusca(q) {
  const box = $('#resultadosProd');
  if (!box) return;
  q = semAcento(q);
  if (!q) { box.innerHTML = ''; return; }
  const termos = q.split(/\s+/);
  const ja = new Set(rascunho().itens.map(x => x.produtoId));
  const achados = db.produtos
    .filter(p => { const t = semAcento(`${p.codigo} ${p.similar || ''} ${p.descricao} ${p.marca} ${p.categoria}`); return termos.every(w => t.includes(w)); })
    .slice(0, 30);
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
        <label class="btn" style="margin:0">📥 Importar planilha respondida<input type="file" class="hidden" accept=".xlsx" data-import-geral></label>
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
        <label class="btn sm" style="margin:0" title="Importar a planilha que o fornecedor devolveu">📥 Importar<input type="file" class="hidden" accept=".xlsx" data-import="${fi}"></label>
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
  const tabelaComp = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th class="c">#</th><th>Produto</th><th class="r">Qtd.</th>
        ${c.fornecedores.map(f => `<th class="r">${esc(f.nome)}</th>`).join('')}
        ${temResposta ? '<th class="r">Melhor</th><th>Fornecedor</th><th class="r">Total</th>' : ''}
      </tr></thead>
      <tbody>
        ${comp.linhas.map(l => `<tr>
          <td class="c">${l.i + 1}</td>
          <td>${esc(l.it.descricao)}<br><span class="small muted">${esc([l.it.codigo, l.it.similar && 'sim. ' + l.it.similar, l.it.marca].filter(Boolean).join(' · '))}</span></td>
          <td class="r">${fmtNum(l.it.quantidade)} ${esc(l.it.unidade)}</td>
          ${l.precos.map((p, j) => {
            const o = c.fornecedores[j].respostas?.[l.i];
            const extra = [o?.prazo, o?.obs].filter(Boolean).join(' · ');
            return `<td class="r ${p != null && p === l.min && nf > 1 ? 'best' : ''}" title="${esc(extra)}">${p != null ? fmtMoeda(p) : '<span class="muted">—</span>'}${extra ? '<br><span class="small muted">' + esc(extra) + '</span>' : ''}</td>`;
          }).join('')}
          ${temResposta ? `<td class="r"><b>${fmtMoeda(l.min)}</b></td>
            <td>${l.vencedor >= 0 ? esc(c.fornecedores[l.vencedor].nome) : '<span class="muted">sem preço</span>'}</td>
            <td class="r">${l.min != null ? fmtMoeda(l.min * l.it.quantidade) : '—'}</td>` : ''}
        </tr>`).join('')}
        ${temResposta ? `<tr class="total">
          <td></td><td>Total dos itens cotados</td><td></td>
          ${comp.totais.map(t => `<td class="r">${t.cotados ? fmtMoeda(t.total) : '—'}<br><span class="small muted">${t.cotados}/${c.itens.length} itens · ${t.vencidos} mais barato(s)</span></td>`).join('')}
          <td></td><td>Melhor combinação</td><td class="r">${fmtMoeda(comp.melhor)}</td>
        </tr>
        ${COND_CAMPOS.map(([k, label]) => c.fornecedores.some(f => f.cond?.[k]) ? `<tr>
          <td></td><td class="small muted">${label}</td><td></td>
          ${c.fornecedores.map(f => `<td class="r small">${esc(f.cond?.[k] || '—')}</td>`).join('')}
          <td colspan="3"></td></tr>` : '').join('')}` : ''}
      </tbody>
    </table></div>`;

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
    ${tabelaComp}
  </section>

  <div class="actions">
    <button data-act="duplicarCot">Duplicar como nova cotação</button>
    <button class="danger" data-act="excluirCot">Excluir cotação</button>
  </div>`;
}

function linhasProdutos() {
  const q = semAcento(ui.filtroProd);
  const precos = ultimosPrecos();
  const lista = db.produtos
    .filter(p => !q || q.split(/\s+/).every(w => semAcento(`${p.codigo} ${p.similar || ''} ${p.descricao} ${p.marca} ${p.categoria}`).includes(w)))
    .sort((a, b) => a.descricao.localeCompare(b.descricao));
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
  const linhaDc = e.target.closest('[data-dc-linha]');
  if (linhaDc && ui.datacar) {
    moverCursorDataCar(+linhaDc.dataset.dcLinha);
    if (!e.target.closest('input, button, select, label')) marcarLinhaDataCar(+linhaDc.dataset.dcLinha, !ui.datacar.linhas[+linhaDc.dataset.dcLinha].sel);
    if (!e.target.closest('input, select')) $('#dcCaixa')?.focus({ preventScroll: true });
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

  dcOrdenar: el => { ordenarDataCar(el.dataset.campo); render(); focarDataCar(); },
  dcTodos: () => { ui.datacar.linhas.forEach(l => { if (l.codigo || l.chave) l.sel = true; }); render(); focarDataCar(); },
  dcNenhum: () => { ui.datacar.linhas.forEach(l => { l.sel = false; }); render(); focarDataCar(); },
  dcCancelar: () => { ui.datacar = null; render(); },
  dcAdicionar: () => {
    const d = ui.datacar;
    const escolhidas = d.linhas.filter(l => l.sel && (l.codigo || l.chave));
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
        if (!ja.codigoArquivo) ja.codigoArquivo = codigoArquivo;
        if (l.marca !== undefined) ja.marca = marcaCotacao;
        somados++;
      } else {
        r.itens.push({ produtoId: id, quantidade: qtd, codigoArquivo, marca: marcaCotacao });
      }
    }
    ui.datacar = null;
    salvar();
    render();
    toast(`${escolhidas.length} item(ns) adicionado(s)${novos ? `, ${novos} produto(s) novo(s) cadastrado(s)` : ''}${somados ? `, ${somados} já estava(m) na cotação` : ''}.`, 6000);
  },

  removerItem: el => {
    rascunho().itens.splice(+el.dataset.i, 1);
    salvar();
    render();
  },

  limparRascunho: async () => {
    if (!(await confirmar('Limpar todos os itens e fornecedores desta nova cotação?'))) return;
    db.rascunho = null;
    salvar();
    render();
  },

  criarCotacao: () => {
    const r = rascunho();
    const prod = byId(db.produtos);
    const forn = byId(db.fornecedores);
    const itens = r.itens.filter(x => prod[x.produtoId]);
    if (!itens.length) return avisar('Adicione pelo menos um item.');
    const fornecedores = r.fornecedorIds.map(id => forn[id]).filter(Boolean);
    if (!fornecedores.length) return avisar('Selecione pelo menos um fornecedor.');

    const cfg = db.config;
    const numero = String(cfg.proxNumero).padStart(4, '0');
    cfg.proxNumero = Number(cfg.proxNumero) + 1;
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
    db.cotacoes.push(c);
    db.rascunho = null;
    salvar();
    ir('cotacao', c.id);
    toast(`Cotação nº ${numero} criada. Agora envie para os fornecedores.`);
  },

  baixarPlanilha: async el => {
    const c = cotAtual();
    await baixarPlanilha(c, +el.dataset.f);
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
    ui.datacar.linhas[+t.dataset.dcMarca].marca = t.value.trim();
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

document.addEventListener('keydown', e => {
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
  } else if (t.id === 'dcAgrupar') {
    ui.datacar.agrupar = t.checked;
    focarDataCar();
  } else if (t.id === 'dcColCod') {
    ui.datacar.colCod = +t.value;
    casarLinhasDataCar();
    aplicarOrdemDataCar();
    render();
    focarDataCar();
  } else if (t.id === 'dcCol') {
    ui.datacar.col = +t.value;
    casarLinhasDataCar();
    aplicarOrdemDataCar();
    render();
    focarDataCar();
  } else if (t.dataset.dcSel != null) {
    marcarLinhaDataCar(+t.dataset.dcSel, t.checked);
    moverCursorDataCar(+t.dataset.dcSel);
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
