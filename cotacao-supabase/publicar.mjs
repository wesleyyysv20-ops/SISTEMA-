/**
 * Publica o sistema de cotação num PROJETO NOVO do Supabase e num PROJETO NOVO do Cloudflare Pages,
 * separados de qualquer outro projeto da conta. Roda no GitHub Actions (workflow "Publicar cotação").
 *
 * Usa os segredos SUPABASE_ACCESS_TOKEN e CLOUDFLARE_API_TOKEN (e, se existir, CLOUDFLARE_ACCOUNT_ID).
 * Pode rodar de novo: reaproveita o que já foi criado.
 *
 * 1. Supabase: cria o projeto "cotacoes-disppar" (região São Paulo), espera ficar pronto,
 *    roda o schema.sql liberando o e-mail de publicar.json, fecha os cadastros e envia o convite.
 * 2. Cloudflare: cria o projeto Pages "cotacoes-disppar" (o envio dos arquivos é feito pelo workflow).
 * 3. Escreve cotacao/config.js com a URL e a chave anon (pública) do Supabase.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const NOME = process.env.NOME_PROJETO || 'cotacoes-disppar';
const REGIAO = process.env.REGIAO_SUPABASE || 'sa-east-1';
const BRANCH = process.env.BRANCH || 'main';
const SB = process.env.SUPABASE_ACCESS_TOKEN;
const CF = process.env.CLOUDFLARE_API_TOKEN;
const { email } = JSON.parse(fs.readFileSync(path.join(aqui, 'publicar.json'), 'utf8'));

const falhar = msg => { console.error(`\n::error::${msg}`); process.exit(1); };
if (!SB) falhar('Falta o segredo SUPABASE_ACCESS_TOKEN (GitHub → Settings → Secrets and variables → Actions).');
if (!CF) falhar('Falta o segredo CLOUDFLARE_API_TOKEN (GitHub → Settings → Secrets and variables → Actions).');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) falhar('publicar.json precisa ter o e-mail de login: {"email": "voce@exemplo.com"}');

const esperar = ms => new Promise(r => setTimeout(r, ms));
const saida = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

async function chamar(base, token, metodo, rota, corpo, { aceitar = [] } = {}) {
  const r = await fetch(base + rota, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
  if (!r.ok && !aceitar.includes(r.status)) {
    throw new Error(`${metodo} ${rota} → ${r.status}: ${typeof dados === 'string' ? dados : JSON.stringify(dados)}`);
  }
  return { status: r.status, dados };
}
// endereços das APIs (trocados só nos testes, para um servidor simulado)
const API_SUPABASE = process.env.SUPABASE_API_URL || 'https://api.supabase.com';
const API_CLOUDFLARE = process.env.CLOUDFLARE_API_URL || 'https://api.cloudflare.com/client/v4';
const urlProjeto = ref => (process.env.SUPABASE_PROJETO_URL || 'https://{ref}.supabase.co').replace('{ref}', ref);
const ESPERA = Number(process.env.ESPERA_MS || 10000);
const supabase = (m, rota, corpo, o) => chamar(API_SUPABASE, SB, m, rota, corpo, o);
const cloudflare = (m, rota, corpo, o) => chamar(API_CLOUDFLARE, CF, m, rota, corpo, o);

// ---------------- Supabase: projeto novo ----------------
console.log(`\n== Supabase: projeto "${NOME}"`);
const projetos = (await supabase('GET', '/v1/projects')).dados;
let projeto = projetos.find(p => p.name === NOME);
if (projeto) {
  console.log(`Já existe (ref ${projeto.id}). Reaproveitando.`);
} else {
  const orgs = (await supabase('GET', '/v1/organizations')).dados;
  if (!orgs.length) falhar('Nenhuma organização no Supabase para criar o projeto.');
  const org = orgs[0];
  console.log(`Criando na organização "${org.name}"${orgs.length > 1 ? ` (a primeira de ${orgs.length})` : ''}, região ${REGIAO}.`);
  try {
    projeto = (await supabase('POST', '/v1/projects', {
      name: NOME, organization_id: org.id, region: REGIAO,
      db_pass: crypto.randomBytes(24).toString('base64url'), // guardada só no Supabase; dá para trocar no painel
    })).dados;
  } catch (e) {
    falhar(`Não consegui criar o projeto no Supabase. Se o plano gratuito já tem 2 projetos ativos, pause um que não use.\n${e.message}`);
  }
}
const ref = projeto.id;
for (let i = 0; ; i++) {
  const st = (await supabase('GET', `/v1/projects/${ref}`)).dados.status;
  if (st === 'ACTIVE_HEALTHY') break;
  if (i > 80) falhar(`O projeto não ficou pronto (status ${st}). Rode o workflow de novo em alguns minutos.`);
  if (i % 6 === 0) console.log(`Aguardando o projeto ficar pronto… (${st})`);
  await esperar(ESPERA);
}
console.log('Projeto pronto.');

const chaves = (await supabase('GET', `/v1/projects/${ref}/api-keys?reveal=true`)).dados;
const anon = chaves.find(k => k.name === 'anon')?.api_key;
const servico = chaves.find(k => k.name === 'service_role')?.api_key;
if (!anon || !servico) falhar('Não encontrei as chaves anon/service_role do projeto.');
console.log(`::add-mask::${servico}`);

// banco: tabelas, segurança e o e-mail liberado
const sql = fs.readFileSync(path.join(aqui, 'schema.sql'), 'utf8').replace(/seu-email@exemplo\.com/g, email.toLowerCase());
for (let i = 0; ; i++) {
  try { await supabase('POST', `/v1/projects/${ref}/database/query`, { query: sql }); break; } catch (e) {
    if (i >= 5) throw e;
    console.log('Banco ainda iniciando, tentando de novo…');
    await esperar(ESPERA * 1.5);
  }
}
console.log('Banco criado (tabelas, regras de acesso e e-mail liberado).');

// ---------------- Cloudflare Pages: projeto novo ----------------
console.log(`\n== Cloudflare Pages: projeto "${NOME}"`);
let conta = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!conta) {
  const contas = (await cloudflare('GET', '/accounts')).dados.result;
  if (!contas.length) falhar('O token da Cloudflare não enxerga nenhuma conta. Dê a ele a permissão "Cloudflare Pages: Edit".');
  conta = contas[0].id;
  console.log(`Conta: ${contas[0].name}`);
}
let pages = await cloudflare('GET', `/accounts/${conta}/pages/projects/${NOME}`, undefined, { aceitar: [404] });
if (pages.status === 404) {
  pages = await cloudflare('POST', `/accounts/${conta}/pages/projects`, { name: NOME, production_branch: BRANCH });
  console.log('Projeto Pages criado.');
} else console.log('Projeto Pages já existe. Reaproveitando.');
const site = `https://${pages.dados.result.subdomain}`;
console.log(`Endereço do site: ${site}`);

// ---------------- Supabase: login ----------------
await supabase('PATCH', `/v1/projects/${ref}/config/auth`, {
  site_url: site, uri_allow_list: `${site}/**`, disable_signup: true,
});
console.log('\nLogin configurado: cadastro aberto desligado, endereço do site liberado.');

const url = urlProjeto(ref);
const convite = await fetch(`${url}/auth/v1/invite?redirect_to=${encodeURIComponent(site)}`, {
  method: 'POST',
  headers: { apikey: servico, Authorization: `Bearer ${servico}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: email.toLowerCase() }),
});
if (convite.ok) console.log(`Convite enviado para ${email}: abra o e-mail e crie a sua senha.`);
else {
  const t = await convite.text();
  if (/already|registered|exists/i.test(t)) console.log(`O usuário ${email} já existe: entre com a sua senha (ou use "Esqueci a senha" no site).`);
  else console.log(`::warning::Não consegui enviar o convite (${convite.status}): ${t}. Crie o usuário em Authentication → Users.`);
}

// ---------------- config.js ----------------
fs.writeFileSync(path.join(aqui, '..', 'cotacao', 'config.js'), `/*
 * Configuração do site publicado (Cloudflare Pages + Supabase), gerada pelo workflow "Publicar cotação".
 * A chave anon é pública por natureza: quem protege os dados é o login e a tabela cotacao_usuarios.
 */
window.COTACAO_CONFIG = window.COTACAO_CONFIG || {
  supabaseUrl: '${url}',
  supabaseAnonKey: '${anon}',
};
`);
console.log('cotacao/config.js atualizado.');
saida('conta', conta);
saida('site', site);
