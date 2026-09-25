/**
 * Apoio comum dos testes: abre o sistema (cotacao/index.html) num Chromium sem janela,
 * com os dados que o teste quiser, e captura os arquivos que o sistema "salva".
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
export const URL_SISTEMA = 'file://' + path.resolve(aqui, '../cotacao/index.html');
export const exemplo = nome => path.join(aqui, 'exemplos', nome);

let browser = null;

export async function navegador() {
  if (!browser) {
    const opcoes = {};
    const local = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
    if (fs.existsSync(local)) opcoes.executablePath = local;
    browser = await chromium.launch(opcoes);
  }
  return browser;
}

export async function fechar() {
  if (browser) await browser.close();
  browser = null;
}

/**
 * Abre o sistema com `dados` já gravados (formato do backup). Devolve a página, a lista de erros
 * de JavaScript e salvos(), que lê os arquivos salvos pelo sistema ({ nome, buffer }).
 */
export async function abrir(dados, { largura = 1400, altura = 1000 } = {}) {
  const b = await navegador();
  const context = await b.newContext({ viewport: { width: largura, height: altura }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await context.newPage();
  context.on('page', p => { if (p !== page) p.close().catch(() => {}); }); // abas do Gmail/Outlook
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await page.addInitScript(() => {
    window.__salvos = [];
    window.showSaveFilePicker = async o => ({
      name: o.suggestedName,
      createWritable: async () => ({
        write: async blob => {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          window.__salvos.push({ nome: o.suggestedName, b64: btoa(bin) });
        },
        close: async () => {},
      }),
    });
  });
  await page.goto(URL_SISTEMA);
  if (dados) {
    await page.evaluate(d => localStorage.setItem('sistemaCotacao.v1', JSON.stringify(d)), dados);
    await page.reload();
  }
  const salvos = async () => (await page.evaluate(() => window.__salvos)).map(s => ({ nome: s.nome, buffer: Buffer.from(s.b64, 'base64') }));
  return { page, context, erros, salvos, fechar: () => context.close() };
}

/** Espera um novo arquivo salvo depois de `acao()`. */
export async function salvarDepois(s, acao) {
  const antes = await s.page.evaluate(() => window.__salvos.length);
  await acao();
  await s.page.waitForFunction(n => window.__salvos.length > n, antes, { timeout: 15000 });
  return (await s.salvos()).at(-1);
}

export async function lerXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

/** Valor "simples" de uma célula (resultado da fórmula, texto do rich text). */
export function valor(cell) {
  const v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result;
    if (v.richText) return v.richText.map(t => t.text).join('');
  }
  return v;
}

export async function irPara(page, rota, id) {
  await page.evaluate(([r, i]) => ir(r, i), [rota, id ?? null]);
}

/* ---------- dados de exemplo ---------- */

export const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const diasAtras = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export const item = (codigo, descricao, marca = '', extra = {}) =>
  ({ produtoId: codigo, codigo, descricao, quantidade: 1, unidade: '', marca, similar: '', ...extra });

export const forn = (id, nome, respostas = null, extra = {}) => ({
  fornecedorId: id, nome, email: '', contato: '', enviadoEm: null,
  respondidoEm: respostas ? '2026-09-20T10:00:00Z' : null, respostas: respostas || {}, cond: {}, ...extra,
});

export const cotacao = (id, numero, data, status, itens, fornecedores, extra = {}) =>
  ({ id, numero, data, status, titulo: '', prazoResposta: '', obs: '', itens, fornecedores, ...extra });

export const base = (extra = {}) => ({ config: { loja: 'Loja Teste' }, produtos: [], fornecedores: [], cotacoes: [], ...extra });

/** O real formatado usa espaço não separável ("R$ 1,00"); os testes comparam com espaço comum. */
export const n = t => String(t).replace(/ /g, ' ');
export const ns = l => l.map(n);
