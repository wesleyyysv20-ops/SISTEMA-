// =====================================================================
// Cotação DISPPAR — servidor local
// Entrega o site da cotação e responde aos mesmos pedidos que o sistema fazia
// ao Supabase (login, documentos com versão, funções de usuários e backups).
// Assim o sistema roda no computador da loja sem mudar o seu funcionamento.
// =====================================================================
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import * as B from './banco.js'

export const PASTA_SITE = process.env.PASTA_SITE ? path.resolve(process.env.PASTA_SITE) : path.resolve(import.meta.dirname, '..', 'cotacao')
const INICIO = Date.now()
export const estado = { link: null } // preenchido pelo túnel (link fixo)

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
}

// ---------- respostas ----------
function json(res, status, corpo, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
  res.end(corpo === undefined ? '' : JSON.stringify(corpo))
}
const vazio = (res, status = 204) => { res.writeHead(status, { 'Cache-Control': 'no-store' }); res.end() }
const erro = (res, status, message, code = 'P0001') => json(res, status, { code, message, details: null, hint: null })

async function lerCorpo(req, limite = 30 * 1024 * 1024) {
  const partes = []
  let tam = 0
  for await (const p of req) {
    tam += p.length
    if (tam > limite) throw B.erroUso('Envio grande demais.')
    partes.push(p)
  }
  const txt = Buffer.concat(partes).toString('utf8')
  return txt ? JSON.parse(txt) : {}
}

// ---------- quem está pedindo ----------
const tokenDe = req => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
const usuarioDe = req => B.usuarioDoToken(tokenDe(req))
const idDoUsuario = email => {
  const h = crypto.createHash('sha256').update(String(email)).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const usuarioAuth = u => ({ id: idDoUsuario(u.email), aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: { nome: u.nome || '' }, created_at: u.criado_em })
const ipDe = req => String(req.headers['cf-connecting-ip'] || req.headers['x-atende-ip'] || req.socket.remoteAddress || '')

// proteção contra tentativa de adivinhar senha: 10 erros em 10 minutos por endereço
const falhas = new Map()
function bloqueado(ip) {
  const f = falhas.get(ip)
  return f && f.n >= 10 && Date.now() - f.t < 10 * 60_000
}
function anotarFalha(ip) {
  const f = falhas.get(ip)
  if (!f || Date.now() - f.t > 10 * 60_000) falhas.set(ip, { n: 1, t: Date.now() })
  else f.n++
}

// ---------- login (mesmo formato do Supabase Auth) ----------
function sessaoResposta(u, s) {
  return { access_token: s.token, token_type: 'bearer', expires_in: s.expira - Math.floor(Date.now() / 1000), expires_at: s.expira, refresh_token: s.refresh, user: usuarioAuth(u) }
}
async function rotaAuth(req, res, url) {
  const p = url.pathname
  if (p === '/auth/v1/token' && req.method === 'POST') {
    const b = await lerCorpo(req)
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const s = B.renovarSessao(b.refresh_token)
      if (!s) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', msg: 'Invalid Refresh Token', code: 'refresh_token_not_found' })
      return json(res, 200, sessaoResposta(B.acharUsuario(s.email), s))
    }
    const ip = ipDe(req)
    if (bloqueado(ip)) return json(res, 429, { error: 'too_many_requests', error_description: 'Muitas tentativas. Espere 10 minutos.', msg: 'Muitas tentativas de senha. Espere 10 minutos e tente de novo.', code: 'over_request_rate_limit' })
    const u = B.acharUsuario(b.email)
    if (!u || !B.senhaConfere(b.password, u.senha)) {
      anotarFalha(ip)
      return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' })
    }
    falhas.delete(ip)
    return json(res, 200, sessaoResposta(u, B.criarSessao(u.email)))
  }
  if (p === '/auth/v1/user') {
    const u = usuarioDe(req)
    if (!u) return json(res, 401, { code: 401, msg: 'Sessão expirada. Entre de novo.', error_code: 'bad_jwt' })
    if (req.method === 'PUT') {
      const b = await lerCorpo(req)
      if (b.password) B.definirSenha(u.email, b.password, tokenDe(req))
      // a senha nova encerra as sessões dos outros computadores (este continua logado)
      return json(res, 200, usuarioAuth(B.acharUsuario(u.email)))
    }
    return json(res, 200, usuarioAuth(u))
  }
  if (p === '/auth/v1/logout') { B.encerrarSessao(tokenDe(req)); return vazio(res) }
  if (p === '/auth/v1/recover') return json(res, 200, {}) // sem e-mail no servidor local: o administrador troca a senha
  return json(res, 404, { msg: 'não encontrado' })
}

// ---------- documentos (mesmo formato do PostgREST) ----------
function filtro(url, campo) {
  const v = url.searchParams.get(campo)
  if (!v) return null
  if (v.startsWith('eq.')) return [v.slice(3)]
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(x => x.trim().replace(/^"|"$/g, ''))
  return null
}
const COLUNAS = ['caminho', 'colecao', 'dados', 'atualizado_em', 'atualizado_por']
function projetar(linhas, url) {
  const sel = (url.searchParams.get('select') || '*').split(',').map(s => s.trim()).filter(Boolean)
  const cols = sel.includes('*') ? COLUNAS : sel.filter(c => COLUNAS.includes(c))
  return linhas.map(l => Object.fromEntries(cols.map(c => [c, c === 'dados' ? JSON.parse(l.dados) : l[c]])))
}
function filtrar(url) {
  return B.listarDocs({ caminhos: filtro(url, 'caminho'), colecoes: filtro(url, 'colecao'), versoes: filtro(url, 'atualizado_em') })
}
function paginar(linhas, url, req) {
  let ini = Number(url.searchParams.get('offset')) || 0
  let lim = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : Infinity
  const faixa = /^(\d+)-(\d+)$/.exec(String(req.headers.range || ''))
  if (faixa) { ini = Number(faixa[1]); lim = Number(faixa[2]) - ini + 1 }
  return linhas.slice(ini, ini + lim)
}
async function rotaDocumentos(req, res, url) {
  const u = usuarioDe(req)
  const prefer = String(req.headers.prefer || '')
  const devolver = prefer.includes('return=representation')
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!u) return json(res, 200, []) // sem login não vê nada (como a segurança do Supabase)
    return json(res, 200, projetar(paginar(filtrar(url), url, req), url))
  }
  if (!u) return erro(res, 403, 'new row violates row-level security policy', '42501')
  if (req.method === 'POST') {
    const linhas = [].concat(await lerCorpo(req))
    const upsert = prefer.includes('merge-duplicates')
    if (!upsert && linhas.some(r => B.existeDoc(r.caminho))) return erro(res, 409, 'duplicate key value violates unique constraint', '23505')
    for (const r of linhas) {
      if (!r || typeof r.caminho !== 'string' || !r.caminho.includes('/')) return erro(res, 400, 'Documento inválido.')
      B.gravarDoc(r.caminho, r.dados ?? null, u.email)
    }
    return devolver ? json(res, 201, projetar(B.listarDocs({ caminhos: linhas.map(r => r.caminho) }), url)) : vazio(res, 201)
  }
  if (req.method === 'PATCH') {
    const b = await lerCorpo(req)
    const alvo = filtrar(url) // com o filtro da versão: só grava se ninguém gravou antes (senão volta vazio = conflito)
    for (const l of alvo) B.gravarDoc(l.caminho, b.dados ?? JSON.parse(l.dados), u.email)
    return devolver ? json(res, 200, projetar(B.listarDocs({ caminhos: alvo.map(l => l.caminho) }), url)) : vazio(res)
  }
  if (req.method === 'DELETE') {
    const alvo = filtrar(url)
    for (const l of alvo) B.apagarDoc(l.caminho)
    return devolver ? json(res, 200, projetar(alvo, url)) : vazio(res)
  }
  return erro(res, 405, 'método não aceito')
}

// ---------- funções (as mesmas do usuarios.sql / backup.sql / admin.sql) ----------
function soAdmin(u, msg = 'Só administradores podem fazer isso.') {
  if (!u || !u.admin) throw B.erroUso(msg, '42501')
}
async function rotaRpc(req, res, url) {
  const fn = url.pathname.slice('/rest/v1/rpc/'.length)
  const b = await lerCorpo(req)
  const u = usuarioDe(req)
  if (fn === 'cotacao_sou_admin') return json(res, 200, !!u?.admin)
  if (!u) return erro(res, 401, 'Sessão expirada. Entre de novo.', '42501')
  switch (fn) {
    case 'cotacao_listar_usuarios':
      soAdmin(u, 'Só administradores podem ver os usuários.')
      return json(res, 200, B.listarUsuarios())
    case 'cotacao_adicionar_usuario':
      soAdmin(u, 'Só administradores podem cadastrar usuários.')
      B.salvarUsuario({ email: b.p_email, senha: b.p_senha, nome: b.p_nome || null, admin: !!b.p_admin })
      return vazio(res)
    case 'cotacao_definir_senha':
      soAdmin(u, 'Só administradores podem trocar a senha de outra pessoa.')
      B.definirSenha(b.p_email, b.p_senha)
      return vazio(res)
    case 'cotacao_definir_admin':
      soAdmin(u, 'Só administradores podem definir administradores.')
      if (!b.p_admin && String(b.p_email).toLowerCase() === u.email) throw B.erroUso('Você não pode tirar o seu próprio acesso de administrador.')
      B.definirAdmin(b.p_email, !!b.p_admin)
      return vazio(res)
    case 'cotacao_remover_usuario':
      soAdmin(u, 'Só administradores podem tirar o acesso de alguém.')
      if (String(b.p_email).toLowerCase() === u.email) throw B.erroUso('Você não pode tirar o seu próprio acesso.')
      B.removerUsuario(b.p_email)
      return vazio(res)
    case 'cotacao_backup_agora':
      soAdmin(u, 'Só administradores podem fazer backup.')
      return json(res, 200, B.fazerBackupDocs(`${b.p_motivo || 'manual'} (${u.email})`, true))
    case 'cotacao_listar_backups':
      soAdmin(u, 'Só administradores podem ver os backups.')
      return json(res, 200, B.listarBackups())
    case 'cotacao_ler_backup':
      soAdmin(u, 'Só administradores podem ler os backups.')
      return json(res, 200, B.lerBackup(b.p_id))
    default:
      return erro(res, 404, `Could not find the function public.${fn}`, 'PGRST202')
  }
}

// ---------- quem está em cada tela (a "presença" do Supabase, por consulta) ----------
const presentes = new Map()
async function rotaPresenca(req, res) {
  const u = usuarioDe(req)
  if (!u) return json(res, 401, { msg: 'sem login' })
  const b = req.method === 'POST' ? await lerCorpo(req) : {}
  const agora = Date.now()
  if (b.chave) presentes.set(String(b.chave), { t: agora, estado: { ...(b.estado || {}), email: u.email } })
  for (const [k, v] of presentes) if (agora - v.t > 30_000) presentes.delete(k)
  return json(res, 200, [...presentes].filter(([k]) => k !== b.chave).map(([, v]) => v.estado))
}

// ---------- site ----------
function configLocal(res) {
  res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(`/* Servidor local da Central DISPPAR (gerado pelo servidor) */
window.COTACAO_CONFIG = { supabaseUrl: location.origin, supabaseAnonKey: 'local', local: true };\n`)
}
function arquivoDoSite(req, res, url) {
  let rel = decodeURIComponent(url.pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  const alvo = path.normalize(path.join(PASTA_SITE, rel))
  if (!alvo.startsWith(PASTA_SITE)) return json(res, 403, { msg: 'proibido' })
  fs.stat(alvo, (e, st) => {
    if (e || !st.isFile()) return json(res, 404, { msg: 'não encontrado' })
    const ext = path.extname(alvo).toLowerCase()
    res.writeHead(200, {
      'Content-Type': TIPOS[ext] || 'application/octet-stream',
      // páginas e código sempre conferem a versão nova; o resto pode ficar guardado um tempo
      'Cache-Control': ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    })
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(alvo).pipe(res)
  })
}

export function criarServidor() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local')
    try {
      if (req.method === 'OPTIONS') return vazio(res, 200)
      if (url.pathname === '/api/status') {
        return json(res, 200, { ok: true, sistema: 'cotacao', desde: new Date(INICIO).toISOString(), documentos: B.contarDocs(), usuarios: B.listarUsuarios().length, link: estado.link })
      }
      if (url.pathname.startsWith('/auth/v1/')) return await rotaAuth(req, res, url)
      if (url.pathname.startsWith('/rest/v1/rpc/')) return await rotaRpc(req, res, url)
      if (url.pathname === '/rest/v1/cotacao_documentos') return await rotaDocumentos(req, res, url)
      if (url.pathname === '/rest/v1/cotacao_usuarios') {
        const u = usuarioDe(req)
        return json(res, 200, u ? [{ email: u.email, nome: u.nome, admin: !!u.admin, criado_em: u.criado_em }] : [])
      }
      if (url.pathname === '/api/presenca') return await rotaPresenca(req, res)
      if (url.pathname === '/config.js') return configLocal(res)
      if (req.method === 'GET' || req.method === 'HEAD') return arquivoDoSite(req, res, url)
      return json(res, 404, { msg: 'não encontrado' })
    } catch (e) {
      if (e.uso) return erro(res, e.code === '42501' ? 403 : 400, e.message, e.code)
      console.error(`[${new Date().toLocaleTimeString('pt-BR')}] Erro em ${req.method} ${url.pathname}:`, e)
      return erro(res, 500, 'Erro no servidor: ' + e.message, 'XX000')
    }
  })
}

export function iniciarServidor(porta, host) {
  const srv = criarServidor()
  return new Promise((ok, falha) => {
    srv.once('error', falha)
    srv.listen(porta, host, () => { console.log(`Cotação no ar em http://${host}:${porta}`); ok(srv) })
  })
}
